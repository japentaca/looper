// Tests del DSP del master (docs/PLAN_MASTER.md, "Tests"). Correr con: cd frontend && npm test
import { describe, it, expect } from "vitest"
import {
  XOVER_LOW_HZ, XOVER_HIGH_HZ, LIMIT_CEILING_DB, LIMIT_LOOKAHEAD_MS, GLUE_MAKEUP_DB, COMP_BANDS,
  COMP_DEFAULT, knee_gain, BandComp, Crossover3, Limiter, MasterDsp, map_comp, normalize_comp,
} from "./master_dsp.js"

const FS_LIST = [44100, 48000]
const CEIL = Math.pow(10, LIMIT_CEILING_DB / 20)
const BLOCK = 128

// ---------------------------------------------------------------- helpers

const db = v => 20 * Math.log10(v)
const undb = v => Math.pow(10, v / 20)

function sine(fs, f, secs, amp = 1, phase = 0) {
  const n = Math.round(secs * fs)
  const a = new Float64Array(n)
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * f * i / fs + phase)
  return a
}

// ruido blanco uniforme en [−amp, amp] con semilla fija (LCG de Numerical Recipes, determinístico)
function noise(n, amp = 1, seed = 1) {
  const a = new Float64Array(n)
  let s = seed >>> 0
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    a[i] = amp * (s / 2147483648 - 1)
  }
  return a
}

function concat(...parts) {
  const n = parts.reduce((t, p) => t + p.length, 0)
  const a = new Float64Array(n)
  let o = 0
  for (const p of parts) {
    a.set(p, o)
    o += p.length
  }
  return a
}

const zeros = n => new Float64Array(n)

// RMS de a[from..to)
function rms(a, from = 0, to = a.length) {
  let s = 0
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return Math.sqrt(s / (to - from))
}

function max_abs(a) {
  let m = 0
  for (let i = 0; i < a.length; i++) {
    const v = Math.abs(a[i])
    if (v > m) m = v
  }
  return m
}

function all_finite(a) {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false
  return true
}

// pasa L/R por un MasterDsp en bloques de `block` muestras; salida en Float64Array (sin redondeo a
// float32, para las comparaciones exactas) o Float32Array (como en el worklet)
function run_dsp(dsp, L, R, { block = BLOCK, f32 = false } = {}) {
  const n = L.length
  const Out = f32 ? Float32Array : Float64Array
  const oL = new Out(n)
  const oR = new Out(n)
  for (let i = 0; i < n; i += block) {
    const m = Math.min(block, n - i)
    dsp.process(L.subarray(i, i + m), R.subarray(i, i + m), oL.subarray(i, i + m), oR.subarray(i, i + m), m)
  }
  return [oL, oR]
}

// pasa L/R por un Limiter suelto
function run_limiter(lim, L, R) {
  const n = L.length
  const oL = new Float64Array(n)
  const oR = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    lim.process(L[i], R[i])
    oL[i] = lim.yl
    oR[i] = lim.yr
  }
  return [oL, oR]
}

// pasa una señal mono por el canal 0 de un Crossover3
function run_xover(xo, x) {
  const n = x.length
  const low = new Float64Array(n)
  const mid = new Float64Array(n)
  const high = new Float64Array(n)
  const sum = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    xo.process(x[i], 0)
    low[i] = xo.low
    mid[i] = xo.mid
    high[i] = xo.high
    sum[i] = xo.low + xo.mid + xo.high
  }
  return { low, mid, high, sum }
}

// ---------------------------------------------------------------- 1. crossover plano

describe.each(FS_LIST)("1. crossover LR4 (fs %i)", fs => {
  const FREQS = [20, 50, 100, 120, 200, 500, 1000, 3000, 5000, 10000, 18000]
  const half = Math.round(0.5 * fs)
  const band_db = (f) => {
    const x = sine(fs, f, 1)
    const r = run_xover(new Crossover3(fs), x)
    const from = x.length - half
    const ref = rms(x, from)
    return {
      sum: db(rms(r.sum, from) / ref),
      low: db(rms(r.low, from) / ref),
      mid: db(rms(r.mid, from) / ref),
      high: db(rms(r.high, from) / ref),
    }
  }

  it.each(FREQS)("suma plana a %i Hz (< 0.1 dB)", f => {
    const r = band_db(f)
    expect(Math.abs(r.sum)).toBeLessThan(0.1)
    // en la práctica el error es numérico (esperado ~1e-6 dB): margen estricto como red de regresión
    expect(Math.abs(r.sum)).toBeLessThan(1e-3)
  })

  it("barrido fino de 20 Hz a 20 kHz: suma plana (< 0.1 dB)", () => {
    // 1/12 de octava; se descarta el primer 0.25 s (transitorio) y se mide sobre un número entero de
    // ciclos (redondeado a muestras), para que el RMS no dependa de la fase
    let worst = 0
    for (let f = 20; f <= 20000; f *= Math.pow(2, 1 / 12)) {
      const x = sine(fs, f, 0.6)
      const r = run_xover(new Crossover3(fs), x)
      const from = Math.round(0.25 * fs)
      const len = Math.round(Math.floor(0.3 * f) * fs / f)
      const e = Math.abs(db(rms(r.sum, from, from + len) / rms(x, from, from + len)))
      if (e > worst) worst = e
    }
    expect(worst).toBeLessThan(0.1)
    expect(worst).toBeLessThan(0.01)
  })

  it("bandas a −6.02 dB en los cortes", () => {
    const a = band_db(XOVER_LOW_HZ)
    expect(Math.abs(a.low + 6.02)).toBeLessThan(0.2)
    expect(Math.abs(a.mid + 6.02)).toBeLessThan(0.2)
    const b = band_db(XOVER_HIGH_HZ)
    expect(Math.abs(b.mid + 6.02)).toBeLessThan(0.2)
    expect(Math.abs(b.high + 6.02)).toBeLessThan(0.2)
  })

  it("rechazo fuera de banda: low a 1 kHz y high a 500 Hz < −40 dB", () => {
    expect(band_db(1000).low).toBeLessThan(-40)
    expect(band_db(500).high).toBeLessThan(-40)
  })

  it("canales independientes", () => {
    const xo = new Crossover3(fs)
    const x = noise(4096, 0.5, 7)
    const a = new Float64Array(x.length)
    for (let i = 0; i < x.length; i++) {
      xo.process(x[i], 0)
      a[i] = xo.low + xo.mid + xo.high
      xo.process(0, 1)
      expect(xo.low + xo.mid + xo.high).toBe(0)
    }
    const ref = run_xover(new Crossover3(fs), x).sum
    for (let i = 0; i < x.length; i++) expect(a[i]).toBe(ref[i])
  })
})

// ---------------------------------------------------------------- 2. curva estática

describe("2. knee_gain", () => {
  it("rodilla dura: T −20, R 4, L −8 → −9 dB", () => {
    expect(knee_gain(-8, -20, 4, 0)).toBeCloseTo(-9, 12)
    expect(knee_gain(-20, -20, 4, 0)).toBe(0)
    expect(knee_gain(-30, -20, 4, 0)).toBe(0)
  })

  it("rodilla suave: W 6, L = T → (1/4 − 1)·6/8 = −0.5625", () => {
    expect(knee_gain(-20, -20, 4, 6)).toBeCloseTo(-0.5625, 12)
  })

  it("continuidad en L = T ± W/2", () => {
    for (const [T, R, W] of [[-20, 4, 6], [-10, 2, 12], [-30, 3, 1]]) {
      for (const edge of [T - W / 2, T + W / 2]) {
        const e = 1e-10
        expect(Math.abs(knee_gain(edge - e, T, R, W) - knee_gain(edge + e, T, R, W))).toBeLessThan(1e-9)
      }
      // y por debajo de la rodilla es 0, por arriba es la recta
      expect(knee_gain(T - W, T, R, W)).toBe(0)
      expect(knee_gain(T + W, T, R, W)).toBeCloseTo((1 / R - 1) * W, 12)
    }
  })

  it("R 1 → 0 siempre; monotonía", () => {
    for (const L of [-100, -20, 0, 20]) {
      expect(knee_gain(L, -20, 1, 6)).toBe(0)
      expect(knee_gain(L, -20, 1, 0)).toBe(0)
    }
    let prev = 0
    for (let L = -60; L <= 20; L += 0.25) {
      const g = knee_gain(L, -20, 3, 6)
      expect(g).toBeLessThanOrEqual(prev + 1e-15)
      expect(g).toBeLessThanOrEqual(0)
      prev = g
    }
  })
})

// ---------------------------------------------------------------- 3. GR estática con seno

describe("3. GR estática (BandComp sola, rodilla dura)", () => {
  const fs = 48000
  const P = { on: true, thr: -20, ratio: 4, makeup: 0, trim: 0 }

  it("detector RMS: seno de 1 kHz a −8 dBFS RMS → GR 9 dB ± 0.5", () => {
    const bc = new BandComp(fs, { knee: 0, attack_ms: 15, release_ms: 150, rms_ms: 10 })
    bc.set_params(P, true)
    const x = sine(fs, 1000, 2, undb(-8) * Math.SQRT2)
    let s = 0
    let cnt = 0
    for (let i = 0; i < x.length; i++) {
      bc.process(x[i], x[i])
      if (i >= fs) {
        s += bc.gr
        cnt++
      }
    }
    expect(Math.abs(-s / cnt - 9)).toBeLessThan(0.5)
    // la ganancia aplicada corresponde a la GR
    expect(db(bc.gain)).toBeCloseTo(bc.gr, 9)
  })

  it("detector peak: seno con pico −8 dBFS → GR máxima 9 dB ± 0.5", () => {
    // attack corto respecto del período y release largo: la GR llega casi a la de la curva en el pico
    const bc = new BandComp(fs, { knee: 0, attack_ms: 0.5, release_ms: 500, detector: "peak" })
    bc.set_params(P, true)
    const x = sine(fs, 1000, 1, undb(-8))
    let gr_max = 0
    for (let i = 0; i < x.length; i++) {
      bc.process(x[i], -x[i] * 0.5)   // link estéreo: manda el canal más fuerte
      if (-bc.gr > gr_max) gr_max = -bc.gr
    }
    expect(Math.abs(gr_max - 9)).toBeLessThan(0.5)
    expect(bc.take_gr()).toBeCloseTo(gr_max, 9)
    expect(bc.take_gr()).toBe(0)
  })

  it("bajo el umbral no comprime", () => {
    const bc = new BandComp(fs, { knee: 0, attack_ms: 15, release_ms: 150, rms_ms: 10 })
    bc.set_params(P, true)
    const x = sine(fs, 1000, 1, undb(-30) * Math.SQRT2)
    for (let i = 0; i < x.length; i++) bc.process(x[i], x[i])
    expect(bc.gr).toBe(0)
    expect(bc.gain).toBe(1)
  })
})

// ---------------------------------------------------------------- 4. tiempos

describe("4. attack / release (peak, rodilla dura)", () => {
  it.each(FS_LIST)("escalón −40 → −10 → −40 dBFS (fs %i)", fs => {
    for (const cfg of COMP_BANDS) {
      const bc = new BandComp(fs, { knee: 0, attack_ms: cfg.attack_ms, release_ms: cfg.release_ms, detector: "peak" })
      bc.set_params({ on: true, thr: -20, ratio: 4, makeup: 0, trim: 0 }, true)
      const lo = undb(-40)
      const hi = undb(-10)
      for (let i = 0; i < 0.1 * fs; i++) bc.process(lo, lo)
      expect(bc.gr).toBe(0)

      // attack: GR final = (1/4 − 1)·10 = −7.5 dB
      const final = -7.5
      let t63 = -1
      const n_att = Math.round(20 * cfg.attack_ms / 1000 * fs)
      for (let i = 0; i < n_att; i++) {
        bc.process(hi, hi)
        if (t63 < 0 && bc.gr <= 0.632 * final) t63 = (i + 1) / fs * 1000
      }
      expect(bc.gr).toBeCloseTo(final, 6)
      expect(Math.abs(t63 - cfg.attack_ms)).toBeLessThan(0.3 * cfg.attack_ms)

      // release: cae al 37 %
      const start = bc.gr
      let t37 = -1
      const n_rel = Math.round(10 * cfg.release_ms / 1000 * fs)
      for (let i = 0; i < n_rel; i++) {
        bc.process(lo, lo)
        if (t37 < 0 && bc.gr >= 0.368 * start) t37 = (i + 1) / fs * 1000
      }
      expect(Math.abs(t37 - cfg.release_ms)).toBeLessThan(0.3 * cfg.release_ms)
    }
  })
})

// ---------------------------------------------------------------- 5. limitador: techo

describe.each(FS_LIST)("5. limitador nunca pasa el techo (fs %i, sin clip de seguridad)", fs => {
  const LIM = CEIL * (1 + 1e-9)
  const check = (L, R) => {
    const lim = new Limiter(fs, { safety_clip: false })
    const [oL, oR] = run_limiter(lim, L, R)
    expect(max_abs(oL)).toBeLessThanOrEqual(LIM)
    expect(max_abs(oR)).toBeLessThanOrEqual(LIM)
    return [oL, oR, lim]
  }

  it("ruido a +12 dBFS (y limita de verdad: el pico queda cerca del techo)", () => {
    const L = noise(fs * 2, undb(12), 1)
    const R = noise(fs * 2, undb(12), 2)
    const [oL, oR] = check(L, R)
    expect(Math.max(max_abs(oL), max_abs(oR))).toBeGreaterThan(0.9 * CEIL)
  })

  it("impulsos aislados de amplitud 4 tras silencio (separaciones variadas)", () => {
    const n = fs * 2
    const L = zeros(n)
    const R = zeros(n)
    // separaciones menores que el lookahead, iguales, y mucho mayores que el release
    const gaps = [1, 2, 5, 50, 131, 132, 133, 144, 145, 300, 1000, 5000, 20000]
    let i = Math.round(0.1 * fs)
    let k = 0
    while (i < n) {
      const s = k % 3 === 0 ? 4 : -4
      if (k % 2 === 0) L[i] = s
      else R[i] = s
      if (k % 5 === 0) {
        L[i] = 4
        R[i] = -4
      }
      i += gaps[k % gaps.length]
      k++
    }
    check(L, R)
  })

  it("ráfagas de cuadrada a +6 dB", () => {
    const n = fs * 2
    const L = zeros(n)
    const R = zeros(n)
    const a = undb(6)
    for (let i = 0; i < n; i++) {
      const burst = Math.floor(i / (0.01 * fs)) % 3 === 0   // 10 ms de ráfaga, 20 ms de silencio
      const sq = Math.floor(i / (fs / 440 / 2)) % 2 === 0 ? a : -a
      L[i] = burst ? sq : 0
      R[i] = burst ? -sq * 0.7 : 0
    }
    const [oL] = check(L, R)
    expect(max_abs(oL)).toBeGreaterThan(0.9 * CEIL)
  })

  it("barrido de seno de 20 Hz a 20 kHz a +6 dB", () => {
    const n = fs * 3
    const L = new Float64Array(n)
    const a = undb(6)
    let ph = 0
    for (let i = 0; i < n; i++) {
      const f = 20 * Math.pow(1000, i / n)
      ph += 2 * Math.PI * f / fs
      L[i] = a * Math.sin(ph)
    }
    const [oL, oR] = check(L, L)
    expect(max_abs(oL)).toBeGreaterThan(0.95 * CEIL)
    for (let i = 0; i < n; i++) expect(oL[i]).toBe(oR[i])
  })

  it("un canal saturado y el otro en silencio", () => {
    const L = noise(fs, 8, 3)
    const R = zeros(fs)
    const [, oR] = check(L, R)
    expect(max_abs(oR)).toBe(0)
  })

  it("sobres de +20 dB por MasterDsp (COMP apagado y prendido al máximo)", () => {
    const n = fs * 2
    const L = concat(noise(n / 2, undb(20), 4), sine(fs, 60, 1, undb(20)))
    const R = concat(sine(fs, 5000, 1, undb(20)), noise(n / 2, undb(20), 5))
    for (const comp of [COMP_DEFAULT, { on: true, amount: 1, low: 6, mid: 6, high: 6 }]) {
      const dsp = new MasterDsp(fs, comp, { safety_clip: false })
      const [oL, oR] = run_dsp(dsp, L, R)
      expect(max_abs(oL)).toBeLessThanOrEqual(LIM)
      expect(max_abs(oR)).toBeLessThanOrEqual(LIM)
      const m = dsp.take_meters()
      expect(m.lim).toBeGreaterThan(10)
    }
  })

  it("con clip de seguridad (default) también, en float32", () => {
    const n = fs
    const L = Float32Array.from(noise(n, undb(12), 8))
    const R = Float32Array.from(noise(n, undb(12), 9))
    const [oL, oR] = run_dsp(new MasterDsp(fs, { on: true, amount: 1 }), L, R, { f32: true })
    expect(max_abs(oL)).toBeLessThanOrEqual(Math.fround(CEIL) * (1 + 1e-7))
    expect(max_abs(oR)).toBeLessThanOrEqual(Math.fround(CEIL) * (1 + 1e-7))
  })
})

// ---------------------------------------------------------------- 6. limitador transparente

describe.each(FS_LIST)("6. limitador transparente bajo el techo (fs %i)", fs => {
  it("ruido con pico −6 dBFS → y[n] = x[n − (N − 1)] exacto", () => {
    const N = Math.max(1, Math.round(LIMIT_LOOKAHEAD_MS / 1000 * fs))
    const lim = new Limiter(fs)
    expect(lim.N).toBe(N)
    expect(lim.latency).toBe(N - 1)
    expect(N).toBe(fs === 44100 ? 132 : 144)
    const L = noise(fs, undb(-6), 10)
    const R = noise(fs, undb(-6), 11)
    const [oL, oR] = run_limiter(lim, L, R)
    const d = N - 1
    let err = 0
    for (let i = 0; i < L.length; i++) {
      const eL = Math.abs(oL[i] - (i >= d ? L[i - d] : 0))
      const eR = Math.abs(oR[i] - (i >= d ? R[i - d] : 0))
      err = Math.max(err, eL, eR)
    }
    expect(err).toBeLessThan(1e-12)
    expect(lim.take_gr()).toBe(0)
  })

  it("después de limitar vuelve a ser transparente (release)", () => {
    const lim = new Limiter(fs)
    const loud = noise(fs / 10, 4, 12)
    const quiet = noise(fs * 3, 0.5, 13)
    const x = concat(loud, quiet)
    const [oL] = run_limiter(lim, x, x)
    // al final (3 s después; release 80 ms → e^−37) la ganancia volvió a 1 exacto (sin quedar en 1 − ε)
    expect(lim.gain).toBe(1)
    const d = lim.latency
    for (let i = x.length - fs / 2; i < x.length; i++) expect(Math.abs(oL[i] - x[i - d])).toBeLessThan(1e-12)
  })

  it("el ataque es una rampa (sin escalón de ganancia)", () => {
    const lim = new Limiter(fs)
    const x = concat(zeros(1000), new Float64Array(fs / 10).fill(2))
    let prev = 1
    let max_step = 0
    for (let i = 0; i < x.length; i++) {
      lim.process(x[i], x[i])
      max_step = Math.max(max_step, Math.abs(lim.gain - prev))
      prev = lim.gain
    }
    // de 1 a c/2 en N muestras: paso ≈ (1 − c/2)/N
    expect(max_step).toBeLessThanOrEqual((1 - CEIL / 2) / lim.N + 1e-12)
    expect(lim.gain).toBeCloseTo(CEIL / 2, 9)
  })
})

// ---------------------------------------------------------------- 7. bypass

describe.each(FS_LIST)("7. bypass (fs %i)", fs => {
  // señal bajo el techo con contenido en las tres bandas
  const n = fs
  const L = Float32Array.from(noise(n, 0.3, 20).map((v, i) => v + 0.2 * Math.sin(2 * Math.PI * 80 * i / fs)))
  const R = Float32Array.from(noise(n, 0.3, 21).map((v, i) => v + 0.2 * Math.sin(2 * Math.PI * 6000 * i / fs)))

  const reference = () => {
    const xo = new Crossover3(fs)
    const sL = new Float64Array(n)
    const sR = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      xo.process(L[i], 0)
      sL[i] = xo.low + xo.mid + xo.high
      xo.process(R[i], 1)
      sR[i] = xo.low + xo.mid + xo.high
    }
    return [sL, sR]
  }

  const compare = comp => {
    const dsp = new MasterDsp(fs, comp)
    const [oL, oR] = run_dsp(dsp, L, R)
    const [sL, sR] = reference()
    const d = dsp.latency
    let err = 0
    for (let i = 0; i < n; i++) {
      err = Math.max(err, Math.abs(oL[i] - (i >= d ? sL[i - d] : 0)), Math.abs(oR[i] - (i >= d ? sR[i - d] : 0)))
    }
    expect(err).toBeLessThan(1e-9)
    // y el limitador no actuó (la prueba es válida solo bajo el techo)
    expect(dsp.take_meters().lim).toBe(0)
  }

  it("on: false = suma del crossover demorada N − 1", () => {
    compare({ on: false, amount: 0.5, low: 0, mid: 0, high: 0 })
  })

  it("on: false ignora amount y trims (bypass total)", () => {
    compare({ on: false, amount: 1, low: 6, mid: -6, high: 6 })
  })

  it("on: true con amount 0 y trims 0 (ratio 1) = bypass", () => {
    compare({ on: true, amount: 0, low: 0, mid: 0, high: 0 })
  })

  it("con COMP apagado no reporta GR de bandas", () => {
    const dsp = new MasterDsp(fs, COMP_DEFAULT)
    run_dsp(dsp, L, R)
    expect(dsp.take_meters().comp).toEqual([0, 0, 0])
  })
})

// ---------------------------------------------------------------- 8. sin clics

describe.each(FS_LIST)("8. cambios de parámetros sin saltos (fs %i)", fs => {
  it("on false→true, amount 0→1, trims −6→+6 y vuelta: ganancia de banda ≤ 0.5 % por muestra", () => {
    const secs = 2
    const n = secs * fs
    // contenido en las tres bandas: 60 Hz, 1 kHz y 8 kHz
    const x = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / fs
      x[i] = 0.3 * Math.sin(2 * Math.PI * 60 * t) + 0.35 * Math.sin(2 * Math.PI * 1000 * t) +
        0.1 * Math.sin(2 * Math.PI * 8000 * t)
    }
    const events = {
      [Math.round(0.2 * fs)]: { on: true, amount: 0, low: -6, mid: -6, high: -6 },
      [Math.round(0.5 * fs)]: { on: true, amount: 1, low: -6, mid: -6, high: -6 },
      [Math.round(0.8 * fs)]: { on: true, amount: 1, low: 6, mid: 6, high: 6 },
      [Math.round(1.1 * fs)]: { on: true, amount: 0.2, low: -6, mid: 0, high: 6 },
      [Math.round(1.4 * fs)]: { on: false, amount: 0.2, low: -6, mid: 0, high: 6 },
    }
    const dsp = new MasterDsp(fs, { on: false, amount: 0, low: -6, mid: -6, high: -6 })
    const inL = new Float32Array(1)
    const inR = new Float32Array(1)
    const oL = new Float32Array(1)
    const oR = new Float32Array(1)
    const prev = [1, 1, 1]
    const max_step = [0, 0, 0]
    const gr_seen = [0, 0, 0]
    for (let i = 0; i < n; i++) {
      if (events[i]) dsp.set_comp(events[i])
      inL[0] = x[i]
      inR[0] = x[i]
      dsp.process(inL, inR, oL, oR, 1)
      for (let b = 0; b < 3; b++) {
        const g = dsp.band_gain[b]
        max_step[b] = Math.max(max_step[b], Math.abs(g / prev[b] - 1))
        prev[b] = g
        gr_seen[b] = Math.max(gr_seen[b], -dsp.bands[b].gr)
      }
    }
    for (let b = 0; b < 3; b++) {
      expect(max_step[b]).toBeLessThan(0.005)
      // la prueba tiene sentido solo si las bandas comprimieron de verdad
      expect(gr_seen[b]).toBeGreaterThan(3)
    }
    // al final quedó apagado: bandas intactas
    expect(Array.from(dsp.band_gain)).toEqual([1, 1, 1])
  })

  it("rampas: el bypass tarda BYPASS_FADE_MS y los trims convergen", () => {
    const dsp = new MasterDsp(fs, { on: false, amount: 0, low: 6, mid: 6, high: 6 })
    const z = new Float32Array(BLOCK)
    const o = new Float32Array(BLOCK)
    dsp.set_comp({ on: true, amount: 0, low: 6, mid: 6, high: 6 })
    const blocks_30ms = Math.ceil(0.03 * fs / BLOCK)
    for (let i = 0; i < blocks_30ms - 1; i++) dsp.process(z, z, o, o, BLOCK)
    expect(dsp.bands[0].mix).toBeGreaterThan(0.8)
    expect(dsp.bands[0].mix).toBeLessThan(1)
    for (let i = 0; i < 2; i++) dsp.process(z, z, o, o, BLOCK)
    expect(dsp.bands[0].mix).toBe(1)
    // con silencio la ganancia es la del trim (+6 dB)
    expect(db(dsp.band_gain[0])).toBeCloseTo(6, 6)
  })
})

// ---------------------------------------------------------------- 9. estabilidad

describe.each(FS_LIST)("9. estabilidad (fs %i)", fs => {
  const ON = { on: true, amount: 1, low: 3, mid: 0, high: -3 }

  // with_gr: la GR (en dB) vuelve a 0 con el release, que es lento (200 ms en low: llega a 1e-9 dB
  // recién a los ~5 s); los estados de los biquads y la potencia del detector se anulan mucho antes
  const states_zero = (dsp, with_gr = true) => {
    for (const b of dsp.xover.biquads) {
      expect(b.z1).toBe(0)
      expect(b.z2).toBe(0)
    }
    for (const b of dsp.bands) {
      expect(b.ms).toBe(0)
      if (with_gr) expect(b.gr).toBe(0)
    }
  }

  it("10 s de silencio → salida exactamente 0 y estados en 0", () => {
    for (const comp of [COMP_DEFAULT, ON]) {
      const dsp = new MasterDsp(fs, comp)
      const z = new Float32Array(10 * fs)
      const [oL, oR] = run_dsp(dsp, z, z, { f32: true })
      expect(max_abs(oL)).toBe(0)
      expect(max_abs(oR)).toBe(0)
      states_zero(dsp)
    }
  })

  it("ruido seguido de 1 s de silencio → estados en 0 y salida en 0", () => {
    for (const comp of [COMP_DEFAULT, ON]) {
      const dsp = new MasterDsp(fs, comp)
      const L = Float32Array.from(concat(noise(fs, 1.5, 30), zeros(fs)))
      const R = Float32Array.from(concat(noise(fs, 1.5, 31), zeros(fs)))
      const [oL, oR] = run_dsp(dsp, L, R, { f32: true })
      states_zero(dsp, false)
      expect(max_abs(oL.subarray(oL.length - fs / 2))).toBe(0)
      expect(max_abs(oR.subarray(oR.length - fs / 2))).toBe(0)
      // 6 s más de silencio: también la GR quedó en 0 exacto (sin decaer a subnormales)
      const z = new Float32Array(6 * fs)
      run_dsp(dsp, z, z, { f32: true })
      states_zero(dsp)
    }
  })

  it("NaN / ±Infinity en la entrada → salida finita, igual que con 0 en esa muestra", () => {
    const n = fs / 2
    const base = Float32Array.from(noise(n, 0.5, 32))
    const bad = Float32Array.from(base)
    const ref = Float32Array.from(base)
    for (const [i, v] of [[1000, NaN], [5000, Infinity], [5001, -Infinity], [9000, NaN]]) {
      bad[i] = v
      ref[i] = 0
    }
    const [bL, bR] = run_dsp(new MasterDsp(fs, ON), bad, base, { f32: true })
    const [rL, rR] = run_dsp(new MasterDsp(fs, ON), ref, base, { f32: true })
    expect(all_finite(bL)).toBe(true)
    expect(all_finite(bR)).toBe(true)
    for (let i = 0; i < n; i++) {
      expect(bL[i]).toBe(rL[i])
      expect(bR[i]).toBe(rR[i])
    }
  })

  it("amplitud 1e6 → finita y ≤ techo; 1e-30 → finita", () => {
    for (const comp of [COMP_DEFAULT, ON]) {
      const big = Float32Array.from(noise(fs / 2, 1e6, 33))
      const [oL, oR] = run_dsp(new MasterDsp(fs, comp, { safety_clip: false }), big, big)
      expect(all_finite(oL) && all_finite(oR)).toBe(true)
      expect(max_abs(oL)).toBeLessThanOrEqual(CEIL * (1 + 1e-9))
      const tiny = Float32Array.from(sine(fs, 1000, 0.5, 1e-30))
      const [tL, tR] = run_dsp(new MasterDsp(fs, comp), tiny, tiny, { f32: true })
      expect(all_finite(tL) && all_finite(tR)).toBe(true)
      expect(max_abs(tL)).toBeLessThan(1e-20)
    }
  })

  it("un estado corrupto (NaN interno) → bloque en silencio, reset y vuelve a sonar", () => {
    const dsp = new MasterDsp(fs, ON)
    const x = new Float32Array(BLOCK).fill(0.1)
    const oL = new Float32Array(BLOCK)
    const oR = new Float32Array(BLOCK)
    dsp.process(x, x, oL, oR, BLOCK)
    dsp.xover.biquads[0].z1 = NaN
    // el NaN llega a la salida recién tras la latencia del limitador (N − 1 > 128 muestras): ningún
    // bloque sale con valores no finitos y alguno de los dos siguientes sale en silencio (reset)
    let silent = 0
    for (let k = 0; k < 2; k++) {
      dsp.process(x, x, oL, oR, BLOCK)
      expect(all_finite(oL) && all_finite(oR)).toBe(true)
      if (max_abs(oL) === 0 && max_abs(oR) === 0) silent++
    }
    expect(silent).toBe(1)
    for (const b of dsp.xover.biquads) expect(Number.isFinite(b.z1) && Number.isFinite(b.z2)).toBe(true)
    for (let i = 0; i < 4; i++) dsp.process(x, x, oL, oR, BLOCK)
    expect(all_finite(oL)).toBe(true)
    expect(max_abs(oL)).toBeGreaterThan(0.01)
  })

  it("bloques de tamaño variable dan el mismo resultado que bloques de 128", () => {
    // no es bit a bit: el anti-denormales corre al final de cada bloque y, en las primeras muestras,
    // la potencia del detector arranca por debajo de su umbral (difiere en ~1 ulp)
    const L = Float32Array.from(noise(fs / 2, 2, 34))
    const R = Float32Array.from(noise(fs / 2, 2, 35))
    const [aL, aR] = run_dsp(new MasterDsp(fs, ON), L, R, { block: 128 })
    const [bL, bR] = run_dsp(new MasterDsp(fs, ON), L, R, { block: 1 })
    const [cL, cR] = run_dsp(new MasterDsp(fs, ON), L, R, { block: 37 })
    let err = 0
    for (let i = 0; i < L.length; i++) {
      err = Math.max(err, Math.abs(bL[i] - aL[i]), Math.abs(bR[i] - aR[i]), Math.abs(cL[i] - aL[i]), Math.abs(cR[i] - aR[i]))
    }
    expect(err).toBeLessThan(1e-12)
  })
})

// ---------------------------------------------------------------- 10. mapeo

describe("10. map_comp", () => {
  it("amount 0 → ratio 1 en las 3 bandas, umbral base, sin makeup", () => {
    const p = map_comp({ on: true, amount: 0, low: 0, mid: 0, high: 0 })
    expect(p).toHaveLength(3)
    p.forEach((b, i) => {
      expect(b.ratio).toBe(1)
      expect(b.thr).toBe(COMP_BANDS[i].thr)
      expect(b.makeup).toBe(0)
      expect(b.on).toBe(true)
    })
  })

  it("amount 1 → ratio_max y thr − 18", () => {
    map_comp({ on: true, amount: 1 }).forEach((b, i) => {
      expect(b.ratio).toBe(COMP_BANDS[i].ratio_max)
      expect(b.thr).toBe(COMP_BANDS[i].thr - 18)
      expect(b.makeup).toBe(GLUE_MAKEUP_DB)
    })
  })

  it("makeup = GLUE_MAKEUP_DB·amount; ejemplo del plan con amount 0.5", () => {
    for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
      for (const b of map_comp({ on: true, amount })) expect(b.makeup).toBeCloseTo(GLUE_MAKEUP_DB * amount, 12)
    }
    const p = map_comp({ on: true, amount: 0.5 })
    expect(p.map(b => [b.thr, b.ratio])).toEqual([[-15, 2.5], [-17, 2], [-23, 2]])
    expect(p[0].makeup).toBe(2)
  })

  it("trims por banda y acotado de valores inválidos", () => {
    const p = map_comp({ on: true, amount: 0.5, low: 1.5, mid: -2, high: 6 })
    expect(p.map(b => b.trim)).toEqual([1.5, -2, 6])
    expect(normalize_comp({ on: "yes", amount: 7, low: -20, mid: NaN, high: "3" }))
      .toEqual({ on: false, amount: 1, low: -6, mid: 0, high: 0 })
    expect(normalize_comp(undefined)).toEqual({ ...COMP_DEFAULT })
    expect(normalize_comp(null)).toEqual({ ...COMP_DEFAULT })
  })

  it("take_meters devuelve la GR máxima y la resetea", () => {
    const fs = 48000
    const dsp = new MasterDsp(fs, { on: true, amount: 1 })
    const x = Float32Array.from(noise(fs / 2, 2, 40))
    run_dsp(dsp, x, x)
    const m = dsp.take_meters()
    expect(m.lim).toBeGreaterThan(1)
    m.comp.forEach(v => expect(v).toBeGreaterThan(1))
    const z = new Float32Array(BLOCK)
    const o = new Float32Array(BLOCK)
    const m0 = dsp.take_meters()
    expect(m0).toEqual({ comp: [0, 0, 0], lim: 0 })
    // en silencio sin resetear el estado del compresor la GR va bajando (release), no salta a 0
    dsp.process(z, z, o, o, BLOCK)
    expect(dsp.take_meters().comp[2]).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------- performance

describe("performance", () => {
  it("60 s de audio estéreo a 48 kHz en bloques de 128, muy por debajo de tiempo real", () => {
    const fs = 48000
    const secs = 60
    const n = secs * fs
    // señal fuerte (comprime y limita) generada de antemano; solo se mide el process
    const L = Float32Array.from(noise(n, 1.2, 50))
    const R = Float32Array.from(noise(n, 1.2, 51))
    const oL = new Float32Array(BLOCK)
    const oR = new Float32Array(BLOCK)
    const result = {}
    for (const [name, comp] of [["COMP on", { on: true, amount: 0.7 }], ["COMP off", COMP_DEFAULT]]) {
      const dsp = new MasterDsp(fs, comp)
      const t0 = performance.now()
      for (let i = 0; i + BLOCK <= n; i += BLOCK) {
        dsp.process(L.subarray(i, i + BLOCK), R.subarray(i, i + BLOCK), oL, oR, BLOCK)
      }
      const ms = performance.now() - t0
      result[name] = ms
      console.log(`master_dsp ${name}: ${secs} s de audio en ${ms.toFixed(0)} ms ` +
        `(${(secs * 1000 / ms).toFixed(0)}× tiempo real, ${(ms / secs / 10).toFixed(2)} % de un núcleo)`)
    }
    // margen amplio para máquinas lentas: al menos 10× tiempo real
    expect(result["COMP on"]).toBeLessThan(secs * 1000 / 10)
    expect(result["COMP off"]).toBeLessThan(secs * 1000 / 10)
  }, 60000)
})
