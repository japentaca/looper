// DSP del master (ver docs/PLAN_MASTER.md): crossover Linkwitz-Riley de 4.º orden de 3 bandas con
// suma plana → compresor por banda (bypass con rampa) → limitador brickwall con lookahead (techo
// −1 dBFS). JS puro: sin window, Tone, Vue ni el `sampleRate` global del worklet (todo recibe `fs`),
// para poder testearlo en Node (master_dsp.test.js). Lo usa master_dsp.worklet.js.
//
// Todo el cálculo es en Number (doble precisión) por muestra; los buffers de E/S son Float32Array.
// Nada se aloca dentro de process(): los buffers se reservan en los constructores (sin GC en el
// hilo de audio).

export const XOVER_LOW_HZ = 120
export const XOVER_HIGH_HZ = 3000
export const BW_Q = Math.SQRT1_2            // Butterworth 2.º orden
export const LIMIT_CEILING_DB = -1
export const LIMIT_LOOKAHEAD_MS = 3
export const LIMIT_RELEASE_MS = 80
export const PARAM_SMOOTH_MS = 20           // makeup / trims
export const BYPASS_FADE_MS = 30            // on/off del compresor
export const GLUE_MAKEUP_DB = 4             // makeup fijo con amount = 1 (se escala con amount)
export const GLUE_THR_DB = 18               // cuánto baja el umbral con amount = 1
export const COMP_TRIM_MAX_DB = 6           // los trims LOW/MID/HIGH se acotan a ±este valor
export const COMP_BANDS = [                 // por banda: umbral base, ratio máx, rodilla, tiempos, detector
  { thr: -6,  ratio_max: 4, knee: 6, attack_ms: 30, release_ms: 200, rms_ms: 25 }, // low
  { thr: -8,  ratio_max: 3, knee: 6, attack_ms: 15, release_ms: 150, rms_ms: 10 }, // mid
  { thr: -14, ratio_max: 3, knee: 6, attack_ms: 5,  release_ms: 100, rms_ms: 5 },  // high
]
const BAND_KEYS = ["low", "mid", "high"]

// config por defecto del compresor del proyecto (COMP apagado: los proyectos viejos no se comprimen)
export const COMP_DEFAULT = Object.freeze({ on: false, amount: 0.5, low: 0, mid: 0, high: 0 })

// umbrales de anti-denormales (V8 no hace flush-to-zero): por debajo de esto el estado se pone en 0
const DENORM_STATE = 1e-15    // estados de los biquads (−300 dB)
const DENORM_POWER = 1e-15    // potencia media del detector RMS (−150 dB, muy debajo de cualquier umbral)
const DENORM_DB = 1e-9        // GR / makeup / trim en dB: se considera que llegaron

// coeficiente de un polo con constante de tiempo `ms`
function pole(ms, fs) {
  return Math.exp(-1 / (ms / 1000 * fs))
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

// ---------------------------------------------------------------- biquads

// coeficientes RBJ (cookbook, bilineal con prewarp en f0), normalizados por a0.
// type: "lp" | "hp" | "ap"
export function biquad_coefs(type, fs, f0, q = BW_Q) {
  const w0 = 2 * Math.PI * f0 / fs
  const c = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const a0 = 1 + alpha
  let b0, b1, b2
  if (type === "lp") {
    b0 = b2 = (1 - c) / 2
    b1 = 1 - c
  } else if (type === "hp") {
    b0 = b2 = (1 + c) / 2
    b1 = -(1 + c)
  } else if (type === "ap") {
    b0 = 1 - alpha
    b1 = -2 * c
    b2 = 1 + alpha
  } else {
    throw new Error("biquad_coefs: tipo desconocido " + type)
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: -2 * c / a0, a2: (1 - alpha) / a0 }
}

// un biquad de un canal, forma transpuesta directa II
export class Biquad {
  constructor(type, fs, f0, q = BW_Q) {
    const k = biquad_coefs(type, fs, f0, q)
    this.b0 = k.b0
    this.b1 = k.b1
    this.b2 = k.b2
    this.a1 = k.a1
    this.a2 = k.a2
    this.z1 = 0
    this.z2 = 0
  }

  process(x) {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }

  reset() {
    this.z1 = 0
    this.z2 = 0
  }

  // anti-denormales: estados despreciables a 0 exacto
  flush() {
    if (Math.abs(this.z1) < DENORM_STATE) this.z1 = 0
    if (Math.abs(this.z2) < DENORM_STATE) this.z2 = 0
  }
}

// ---------------------------------------------------------------- crossover

// crossover LR4 de 3 bandas (por canal: 9 biquads; LR4 = dos Butterworth iguales en cascada):
//   low  = AP(f2)·LP4(f1)·x
//   mid  = LP4(f2)·HP4(f1)·x
//   high = HP4(f2)·HP4(f1)·x
// Suma = AP(f1)·AP(f2)·x (LP4 + HP4 = AP2 con el mismo f0): magnitud 1 en todas las frecuencias.
// process(x, ch) deja this.low / this.mid / this.high (escalares) para el canal ch.
export class Crossover3 {
  constructor(fs, f1 = XOVER_LOW_HZ, f2 = XOVER_HIGH_HZ, channels = 2) {
    this.ch = []
    for (let i = 0; i < channels; i++) {
      this.ch.push({
        lp1a: new Biquad("lp", fs, f1), lp1b: new Biquad("lp", fs, f1),
        ap2: new Biquad("ap", fs, f2),
        hp1a: new Biquad("hp", fs, f1), hp1b: new Biquad("hp", fs, f1),
        lp2a: new Biquad("lp", fs, f2), lp2b: new Biquad("lp", fs, f2),
        hp2a: new Biquad("hp", fs, f2), hp2b: new Biquad("hp", fs, f2),
      })
    }
    // todos los biquads en una lista (reset / flush / tests)
    this.biquads = this.ch.flatMap(c => Object.values(c))
    this.low = 0
    this.mid = 0
    this.high = 0
  }

  process(x, ch) {
    const f = this.ch[ch]
    this.low = f.ap2.process(f.lp1b.process(f.lp1a.process(x)))
    const hp1 = f.hp1b.process(f.hp1a.process(x))
    this.mid = f.lp2b.process(f.lp2a.process(hp1))
    this.high = f.hp2b.process(f.hp2a.process(hp1))
  }

  reset() {
    for (const b of this.biquads) b.reset()
    this.low = this.mid = this.high = 0
  }

  flush() {
    for (const b of this.biquads) b.flush()
  }
}

// ---------------------------------------------------------------- compresor

// curva estática con rodilla suave (Giannoulis–Massberg–Reiss 2012): nivel L (dB), umbral T (dB),
// ratio R, ancho de rodilla W (dB) → cambio de ganancia en dB (≤ 0). W = 0: rodilla dura.
export function knee_gain(L, T, R, W) {
  if (!(R > 1)) return 0
  const s = 1 / R - 1
  const d = L - T
  if (!(W > 0)) return d > 0 ? s * d : 0
  if (2 * d < -W) return 0
  if (2 * d > W) return s * d
  const e = d + W / 2
  return s * e * e / (2 * W)
}

// compresor de una banda, estéreo con link total (una sola ganancia para L y R).
// cfg: { knee, attack_ms, release_ms, rms_ms, detector: "rms" (default) | "peak" }.
// Parámetros con set_params({ on, thr, ratio, makeup, trim }, snap):
//   ganancia = 10^((mix·(gr + makeup + trim)) / 20)
// mix (0..1) es el bypass: va a on ? 1 : 0 en rampa lineal de BYPASS_FADE_MS; con mix = 0 la banda
// sale intacta. makeup y trim siguen a su objetivo con un polo de PARAM_SMOOTH_MS. Un cambio de
// umbral o ratio salta gc, pero gr lo sigue con attack/release: sin clic.
export class BandComp {
  constructor(fs, cfg = {}) {
    this.knee = cfg.knee ?? 0
    this.peak = cfg.detector === "peak"
    this.b_rms = pole(cfg.rms_ms ?? 10, fs)
    this.a_att = pole(cfg.attack_ms ?? 10, fs)
    this.a_rel = pole(cfg.release_ms ?? 100, fs)
    this.a_par = pole(PARAM_SMOOTH_MS, fs)
    this.mix_step = 1 / (BYPASS_FADE_MS / 1000 * fs)
    // objetivos
    this.on = false
    this.thr = 0
    this.ratio = 1
    this.makeup_t = 0
    this.trim_t = 0
    // estado
    this.mix = 0
    this.makeup = 0
    this.trim = 0
    this.ms = 0       // potencia media (detector RMS)
    this.gr = 0       // GR suavizada en dB (≤ 0)
    this.gain = 1     // última ganancia lineal aplicada
    this.gr_max = 0   // máxima GR efectiva (dB, positiva) desde take_gr()
  }

  set_params(p, snap = false) {
    this.on = p.on === true
    this.thr = p.thr
    this.ratio = p.ratio
    this.makeup_t = p.makeup
    this.trim_t = p.trim
    if (snap) {
      this.mix = this.on ? 1 : 0
      this.makeup = this.makeup_t
      this.trim = this.trim_t
    }
  }

  // una muestra de la banda (L, R) → ganancia lineal para los dos canales
  process(xl, xr) {
    // bypass: rampa lineal de mix
    if (this.on) {
      if (this.mix < 1) this.mix = Math.min(1, this.mix + this.mix_step)
    } else if (this.mix > 0) {
      this.mix = Math.max(0, this.mix - this.mix_step)
    }
    if (this.mix === 0) {
      // apagado del todo: sin detección (ahorra CPU); al prender arranca de cero bajo la rampa de mix
      this.ms = 0
      this.gr = 0
      this.makeup = this.makeup_t
      this.trim = this.trim_t
      this.gain = 1
      return 1
    }
    this.makeup = this.makeup_t + this.a_par * (this.makeup - this.makeup_t)
    this.trim = this.trim_t + this.a_par * (this.trim - this.trim_t)

    // detección con link estéreo total
    const d = Math.max(xl * xl, xr * xr)
    let L
    if (this.peak) {
      L = 10 * Math.log10(d + 1e-30)
    } else {
      this.ms += (1 - this.b_rms) * (d - this.ms)
      L = 10 * Math.log10(this.ms + 1e-30)
    }
    const gc = knee_gain(L, this.thr, this.ratio, this.knee)
    // balística en dB: attack si pide más reducción, release si menos
    const a = gc < this.gr ? this.a_att : this.a_rel
    this.gr = a * this.gr + (1 - a) * gc

    const red = -this.mix * this.gr
    if (red > this.gr_max) this.gr_max = red
    this.gain = Math.pow(10, this.mix * (this.gr + this.makeup + this.trim) / 20)
    return this.gain
  }

  // máxima GR efectiva (dB, positiva) desde la llamada anterior; la resetea
  take_gr() {
    const v = this.gr_max
    this.gr_max = 0
    return v
  }

  reset() {
    this.mix = this.on ? 1 : 0
    this.makeup = this.makeup_t
    this.trim = this.trim_t
    this.ms = 0
    this.gr = 0
    this.gain = 1
    this.gr_max = 0
  }

  // anti-denormales (al final de cada bloque)
  flush() {
    if (this.ms < DENORM_POWER) this.ms = 0
    if (Math.abs(this.gr) < DENORM_DB) this.gr = 0
    if (Math.abs(this.makeup - this.makeup_t) < DENORM_DB) this.makeup = this.makeup_t
    if (Math.abs(this.trim - this.trim_t) < DENORM_DB) this.trim = this.trim_t
  }
}

// config del proyecto acotada: on boolean, amount 0..1, trims ±COMP_TRIM_MAX_DB (valores inválidos → default)
export function normalize_comp(comp) {
  const c = comp && typeof comp === "object" ? comp : {}
  const num = (v, lo, hi, def) => Number.isFinite(v) ? clamp(v, lo, hi) : def
  return {
    on: c.on === true,
    amount: num(c.amount, 0, 1, COMP_DEFAULT.amount),
    low: num(c.low, -COMP_TRIM_MAX_DB, COMP_TRIM_MAX_DB, 0),
    mid: num(c.mid, -COMP_TRIM_MAX_DB, COMP_TRIM_MAX_DB, 0),
    high: num(c.high, -COMP_TRIM_MAX_DB, COMP_TRIM_MAX_DB, 0),
  }
}

// controles del proyecto { on, amount, low, mid, high } → parámetros de las 3 bandas
// [{ on, thr, ratio, makeup, trim }]. amount = 0 → ratio 1 (no comprime); el makeup es fijo
// (GLUE_MAKEUP_DB·amount, sin makeup automático para que no bombee); el trim va después del compresor.
export function map_comp(comp) {
  const c = normalize_comp(comp)
  return COMP_BANDS.map((b, i) => ({
    on: c.on,
    thr: b.thr - GLUE_THR_DB * c.amount,
    ratio: 1 + (b.ratio_max - 1) * c.amount,
    makeup: GLUE_MAKEUP_DB * c.amount,
    trim: c[BAND_KEYS[i]],
  }))
}

// ---------------------------------------------------------------- limitador

// brickwall con lookahead, estéreo enlazado, techo c = 10^(LIMIT_CEILING_DB/20).
// N = muestras de lookahead; latencia = N − 1. Por muestra:
//   g_req = p > c ? c/p : 1 (p = max(|xL|, |xR|))
//   h = mínimo de g_req en las últimas N muestras (cola monótona sobre buffer circular)
//   r = h < r ? h : release exponencial hacia h (siempre r ≤ h)
//   b = promedio de r en las últimas N muestras → y = x[n − (N − 1)]·b
// Cada r promediado cubre la muestra n − (N − 1) en su ventana de mínimo → b ≤ g_req[n − (N − 1)]
// → |y| ≤ c. El ataque es una rampa de N muestras. opts.safety_clip = false quita el clip final
// (que solo cubre redondeo) para que el test verifique la garantía.
// process(xl, xr) deja this.yl / this.yr.
export class Limiter {
  constructor(fs, opts = {}) {
    this.c = Math.pow(10, LIMIT_CEILING_DB / 20)
    const N = Math.max(1, Math.round(LIMIT_LOOKAHEAD_MS / 1000 * fs))
    this.N = N
    this.latency = N - 1
    this.safety_clip = opts.safety_clip !== false
    this.a_rel = pole(LIMIT_RELEASE_MS, fs)
    this.dl = new Float64Array(N)     // demora L
    this.dr = new Float64Array(N)     // demora R
    this.rb = new Float64Array(N)     // últimos N valores de r
    this.qv = new Float64Array(N)     // cola monótona: valores
    this.qi = new Float64Array(N)     // cola monótona: índice de muestra
    this.reset()
  }

  reset() {
    this.dl.fill(0)
    this.dr.fill(0)
    this.rb.fill(1)
    this.sum = this.N
    this.q_head = 0
    this.q_len = 0
    this.pos = 0
    this.n = 0
    this.r = 1
    this.gain = 1
    this.gain_min = 1
    this.yl = 0
    this.yr = 0
  }

  process(xl, xr) {
    const N = this.N
    const c = this.c
    const n = this.n
    const al = xl < 0 ? -xl : xl
    const ar = xr < 0 ? -xr : xr
    const p = al > ar ? al : ar
    const g_req = p > c ? c / p : 1

    // mínimo deslizante: vence el más viejo (índice n − N), saca del fondo los ≥ g_req y agrega
    const qv = this.qv
    const qi = this.qi
    if (this.q_len > 0 && qi[this.q_head] <= n - N) {
      this.q_head = this.q_head + 1 === N ? 0 : this.q_head + 1
      this.q_len--
    }
    while (this.q_len > 0) {
      let back = this.q_head + this.q_len - 1
      if (back >= N) back -= N
      if (qv[back] >= g_req) this.q_len--
      else break
    }
    let tail = this.q_head + this.q_len
    if (tail >= N) tail -= N
    qv[tail] = g_req
    qi[tail] = n
    this.q_len++
    const h = qv[this.q_head]

    // release
    let r = this.r
    if (h < r) r = h
    else {
      r += (1 - this.a_rel) * (h - r)
      if (h - r < 1e-12) r = h
    }
    this.r = r

    // promedio de r (suma corriente) y demora de la señal
    const pos = this.pos
    this.sum += r - this.rb[pos]
    this.rb[pos] = r
    this.dl[pos] = xl
    this.dr[pos] = xr
    let rd = pos + 1
    if (rd === N) rd = 0
    const b = this.sum / N
    let yl = this.dl[rd] * b
    let yr = this.dr[rd] * b
    if (this.safety_clip) {
      yl = yl > c ? c : yl < -c ? -c : yl
      yr = yr > c ? c : yr < -c ? -c : yr
    }
    this.yl = yl
    this.yr = yr
    this.gain = b
    if (b < this.gain_min) this.gain_min = b

    this.pos = rd
    if (rd === 0) {
      // la suma corriente se recalcula exacta en cada vuelta del buffer (no deriva)
      let s = 0
      for (let i = 0; i < N; i++) s += this.rb[i]
      this.sum = s
    }
    this.n = n + 1
  }

  // máxima GR (dB, positiva) desde la llamada anterior; la resetea
  take_gr() {
    const v = -20 * Math.log10(this.gain_min)
    this.gain_min = 1
    return v > 0 ? v : 0
  }
}

// ---------------------------------------------------------------- master

// cadena completa estéreo: crossover → compresor por banda → suma → limitador.
// new MasterDsp(fs, comp, opts): comp = { on, amount, low, mid, high } (se aplica sin rampa);
// opts.safety_clip (ver Limiter). set_comp(comp) cambia los parámetros (con rampas).
// process(inL, inR, outL, outR, n); take_meters() → { comp: [l, m, h], lim } (GR máxima en dB
// desde la llamada anterior). band_gain[i] = última ganancia lineal de cada banda.
export class MasterDsp {
  constructor(fs, comp, opts = {}) {
    this.fs = fs
    this.xover = new Crossover3(fs, XOVER_LOW_HZ, XOVER_HIGH_HZ)
    this.bands = COMP_BANDS.map(b => new BandComp(fs, b))
    this.limiter = new Limiter(fs, opts)
    this.latency = this.limiter.latency
    this.band_gain = new Float64Array([1, 1, 1])
    this.set_comp(comp, true)
  }

  set_comp(comp, snap = false) {
    this.comp = normalize_comp(comp)
    const p = map_comp(this.comp)
    for (let i = 0; i < 3; i++) this.bands[i].set_params(p[i], snap)
  }

  process(inL, inR, outL, outR, n) {
    const xo = this.xover
    const b0 = this.bands[0]
    const b1 = this.bands[1]
    const b2 = this.bands[2]
    const lim = this.limiter
    const bg = this.band_gain
    let chk = 0
    for (let i = 0; i < n; i++) {
      let xl = inL[i]
      let xr = inR[i]
      // entrada saneada: un NaN/Infinity aguas arriba no "pega" el estado de los filtros
      if (xl !== xl || !isFinite(xl)) xl = 0
      if (xr !== xr || !isFinite(xr)) xr = 0
      xo.process(xl, 0)
      const ll = xo.low, ml = xo.mid, hl = xo.high
      xo.process(xr, 1)
      const lr = xo.low, mr = xo.mid, hr = xo.high
      const g0 = b0.process(ll, lr)
      const g1 = b1.process(ml, mr)
      const g2 = b2.process(hl, hr)
      bg[0] = g0
      bg[1] = g1
      bg[2] = g2
      lim.process(ll * g0 + ml * g1 + hl * g2, lr * g0 + mr * g1 + hr * g2)
      outL[i] = lim.yl
      outR[i] = lim.yr
      chk += lim.yl + lim.yr
    }
    xo.flush()
    b0.flush()
    b1.flush()
    b2.flush()
    // red de seguridad: si algo no es finito (no debería), se resetea y el bloque sale en silencio
    if (chk !== chk || !isFinite(chk)) {
      this.reset()
      for (let i = 0; i < n; i++) {
        outL[i] = 0
        outR[i] = 0
      }
    }
  }

  take_meters() {
    return {
      comp: [this.bands[0].take_gr(), this.bands[1].take_gr(), this.bands[2].take_gr()],
      lim: this.limiter.take_gr(),
    }
  }

  reset() {
    this.xover.reset()
    for (const b of this.bands) b.reset()
    this.limiter.reset()
    this.band_gain.fill(1)
  }
}
