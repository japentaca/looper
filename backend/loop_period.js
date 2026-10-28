// Período de un loop: ¿el loop es la repetición de sus primeros P beats? Funciones puras (sin ffmpeg ni base),
// las usa trim_loops.js; tests en loop_period.test.js (npm test).
// El largo del beat es muestras / beats (fraccionario: a 145 BPM y 44,1 kHz son 18248,3 muestras), así que los
// bloques no empiezan en muestras enteras. Dos medidas de cada bloque contra el primero:
// - espectral (la que decide): espectrograma de magnitud con las ventanas alineadas al inicio de cada bloque
//   (redondeado a la muestra: medio sample no cambia la magnitud), en tres bandas (graves / medios / agudos),
//   cada una relativa a la energía de esa banda en el bloque 0. Se informa el bloque entero y cada beat: la
//   diferencia de un beat, relativa a la energía media por beat; un fill de un beat casi no mueve el total.
// - forma de onda (informativa): residuo con el bloque leído en su posición exacta (interpolación Lanczos) y el
//   mejor corrimiento en ±MAX_SHIFT muestras. Un sampler arranca cada golpe en una muestra entera, así que en los
//   agudos no llega a cero aunque el patrón sea igual. Tampoco restan limpio dos capas "iguales" con compresión
//   de bus: por eso no decide.

export const PERIODS = [4, 8, 16, 32]
const WIN = 2048
const HOP = 1024
const BAND_HZ = [250, 4000] // graves < 250 Hz, medios hasta 4 kHz, agudos arriba
const BAND_FLOOR = 1e-4 // una banda 40 dB por debajo de la más fuerte no cuenta (sería ruido relativo)
const LANCZOS_A = 8
const MAX_SHIFT = 3
const SHIFT_STEP = 0.5
const EPS = 1e-20

export const db = x => 10 * Math.log10(x + EPS)

// FFT radix 2 en el lugar (re, im: arrays del mismo largo, potencia de 2)
export function fft(re, im) {
  let n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    let half = len >> 1
    let ang = -2 * Math.PI / len
    for (let j = 0; j < half; j++) {
      let wr = Math.cos(ang * j)
      let wi = Math.sin(ang * j)
      for (let i = j; i < n; i += len) {
        let b = i + half
        let tr = re[b] * wr - im[b] * wi
        let ti = re[b] * wi + im[b] * wr
        re[b] = re[i] - tr
        im[b] = im[i] - ti
        re[i] += tr
        im[i] += ti
      }
    }
  }
}

const HANN = Float64Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WIN))

// magnitudes de los cuadros de un tramo: [canal][cuadro] = Float32Array(WIN / 2 + 1). Cuadros en start + j × HOP
// mientras entren en el tramo
function spectra(chs, start, len) {
  let re = new Float64Array(WIN)
  let im = new Float64Array(WIN)
  let frames = Math.max(0, Math.floor((len - WIN) / HOP) + 1)
  return chs.map(x => {
    let out = []
    for (let j = 0; j < frames; j++) {
      let s = start + j * HOP
      for (let i = 0; i < WIN; i++) {
        re[i] = (x[s + i] ?? 0) * HANN[i]
        im[i] = 0
      }
      fft(re, im)
      let m = new Float32Array(WIN / 2 + 1)
      for (let b = 0; b <= WIN / 2; b++) m[b] = Math.hypot(re[b], im[b])
      out.push(m)
    }
    return out
  })
}

function band_of(bin, sr) {
  let f = bin * sr / WIN
  return f < BAND_HZ[0] ? 0 : f < BAND_HZ[1] ? 1 : 2
}

// la peor de las bandas usadas (null = sin dato)
const worst_of = arr => Math.max(...arr.filter(v => v != null))

// distancia espectral de un bloque contra el de referencia (mismos cuadros): { db, bands: [3], beats: [] }.
// db = la peor banda; beats[b] = la peor banda en ese beat, relativa a la energía media por beat de la referencia
function spectral_distance(ref, blk, spb, sr) {
  let nb = Math.max(1, Math.round(ref[0].length * HOP / spb))
  let num = [0, 0, 0]
  let den = [0, 0, 0]
  let bnum = Array.from({ length: nb }, () => [0, 0, 0])
  let bins = ref[0][0]?.length ?? 0
  let band = Array.from({ length: bins }, (_, b) => band_of(b, sr))
  for (let c = 0; c < ref.length; c++) {
    for (let j = 0; j < ref[c].length; j++) {
      let beat = Math.min(nb - 1, Math.floor((j * HOP + WIN / 2) / spb))
      let a = ref[c][j]
      let b = blk[c][j]
      for (let k = 1; k < bins; k++) {
        let d = (a[k] - b[k]) ** 2
        num[band[k]] += d
        den[band[k]] += a[k] * a[k]
        bnum[beat][band[k]] += d
      }
    }
  }
  let top = Math.max(...den)
  let used = den.map(d => d > 0 && d >= top * BAND_FLOOR)
  let bands = num.map((n, g) => used[g] ? db(n / den[g]) : null)
  let beats = bnum.map(bn => worst_of(bn.map((n, g) => used[g] ? db(n / (den[g] / nb)) : null)))
  return { db: worst_of(bands), bands, beats }
}

function lanczos_kernel(frac) {
  let w = new Float64Array(2 * LANCZOS_A)
  for (let i = 0; i < 2 * LANCZOS_A; i++) {
    let d = frac - (i - LANCZOS_A + 1)
    w[i] = d == 0 ? 1 : LANCZOS_A * Math.sin(Math.PI * d) * Math.sin(Math.PI * d / LANCZOS_A) / (Math.PI * Math.PI * d * d)
  }
  return w
}

// suma en acc (num, den y por beat si acc.beats) de (ref[i] - x(t0 + i))² y ref[i]², i en [0, len); t0 fraccionario
function wave_sums(ref, x, t0, len, spb, acc) {
  let i0 = Math.floor(t0)
  let w = lanczos_kernel(t0 - i0)
  for (let i = 0; i < len; i++) {
    let s = 0
    let base = i0 + i - LANCZOS_A + 1
    for (let k = 0; k < w.length; k++) s += (x[base + k] ?? 0) * w[k]
    let d = (ref[i] - s) ** 2
    if (acc.beats) acc.beats[Math.min(acc.beats.length - 1, Math.floor(i / spb))] += d
    acc.num += d
    acc.den += ref[i] * ref[i]
  }
}

// residuo de forma de onda del bloque en `start` (fraccionario) contra el bloque 0, len muestras. El corrimiento
// se elige con el primer beat. { db, shift, beats: [] } (beats relativos a la energía media por beat)
function wave_distance(chs, start, len, spb) {
  let probe = Math.min(len, Math.round(spb))
  let best = { shift: 0, v: Infinity }
  for (let s = -MAX_SHIFT; s <= MAX_SHIFT; s += SHIFT_STEP) {
    let acc = { num: 0, den: 0 }
    for (let x of chs) wave_sums(x, x, start + s, probe, spb, acc)
    if (acc.num < best.v) best = { shift: s, v: acc.num }
  }
  let nb = Math.max(1, Math.round(len / spb))
  let acc = { num: 0, den: 0, beats: new Float64Array(nb) }
  for (let x of chs) wave_sums(x, x, start + best.shift, len, spb, acc)
  return { db: db(acc.num / acc.den), shift: best.shift, beats: Array.from(acc.beats, v => db(v / (acc.den / nb))) }
}

// analiza un loop (chs: canales Float32Array del mismo largo) de `beats` beats. Para cada P de PERIODS que divide
// a beats, es menor y no baja de min_beats: la distancia de cada bloque k ≥ 1 contra el bloque 0.
// { spb, candidates: [{ P, blocks: [{ k, spec, bands, spec_beats, wave, shift, wave_beats }] }] }
export function analyze_loop(chs, sr, beats, { wave = true, min_beats = 1 } = {}) {
  let n = chs[0].length
  let spb = n / beats
  let cache = new Map()
  let spec_at = (start, len) => {
    let key = start + ":" + len
    if (!cache.has(key)) cache.set(key, spectra(chs, start, len))
    return cache.get(key)
  }
  let candidates = []
  for (let P of PERIODS) {
    if (P >= beats || beats % P || P < min_beats) continue
    let len = Math.floor(P * spb)
    let ref = spec_at(0, len)
    let blocks = []
    for (let k = 1; k < beats / P; k++) {
      let start = k * P * spb
      let s = spectral_distance(ref, spec_at(Math.round(start), len), spb, sr)
      let w = wave ? wave_distance(chs, start, Math.min(len, Math.floor(n - start - LANCZOS_A - MAX_SHIFT)), spb) : null
      blocks.push({
        k, spec: s.db, bands: s.bands, spec_beats: s.beats,
        wave: w?.db ?? null, shift: w?.shift ?? null, wave_beats: w?.beats ?? null,
      })
    }
    candidates.push({ P, blocks })
  }
  return { spb, candidates }
}

// umbrales sobre el peor beat de cada bloque (dB). Calibrados con Apex Psytrance (142 loops) y casos armados: un
// bloque repetido da < -100; capas iguales de un mismo pack, -30 a -60; hats encimados que caen con una muestra
// de diferencia (o un golpe de hat que varía) con graves y medios iguales, -20 a -28; una ganancia de +1 dB,
// -16; un beat distinto (fill), > 0. Alrededor de -30 y de -20 la distribución de Apex tiene huecos
export const THRESHOLDS = { same: -28, near: -20 }

// nivel de un bloque: "same" (igual), "near" (casi igual: diferencias chicas) o "diff"
export function block_level(b, th = THRESHOLDS) {
  let w = Math.max(...b.spec_beats)
  return w <= th.same ? "same" : w <= th.near ? "near" : "diff"
}

// decide el corte. En orden: el menor P con todos los bloques iguales → "cortar"; el menor P con todos iguales o
// casi → "casi" (para escuchar); el menor P en que los bloques distintos lo son solo en pocos beats (cada uno en
// hasta max(2, P/4): un fill, un remate; un golpe fuerte se derrama medio cuadro al beat anterior) → "variación"
// (cortar pierde la variación); si no, "no cortar".
// { P (null en "no cortar"), decision, reason }
export function decide({ candidates }, th = THRESHOLDS) {
  let levels = c => c.blocks.map(b => block_level(b, th))
  let worst = c => Math.max(...c.blocks.flatMap(b => b.spec_beats)).toFixed(0)
  for (let c of candidates) {
    if (levels(c).every(l => l == "same")) {
      return { P: c.P, decision: "cortar", reason: `${c.blocks.length + 1} bloques de ${c.P} iguales (peor beat ${worst(c)} dB)` }
    }
  }
  for (let c of candidates) {
    if (levels(c).every(l => l != "diff")) {
      return { P: c.P, decision: "casi", reason: `${c.blocks.length + 1} bloques de ${c.P} casi iguales (peor beat ${worst(c)} dB)` }
    }
  }
  let diff_beats = b => b.spec_beats.map((v, i) => [v, i + 1]).filter(([v]) => v > th.near)
  for (let c of candidates) {
    let bad = c.blocks.filter(b => block_level(b, th) == "diff")
    if (bad.every(b => diff_beats(b).length <= Math.max(2, c.P / 4))) {
      let desc = bad.map(b => `bloque ${b.k + 1} beat ${diff_beats(b).map(([v, i]) => `${i} (${v.toFixed(0)} dB)`).join(", ")}`)
      return { P: c.P, decision: "variación", reason: `de a ${c.P} se repite salvo ${desc.join("; ")}` }
    }
  }
  return { P: null, decision: "no cortar", reason: "ningún período se repite" }
}

// largo del corte en muestras: los primeros P beats exactos de un loop de `samples` muestras y `beats` beats
export function cut_length(samples, beats, P) {
  return Math.round(P * samples / beats)
}

// repetición por defecto de un loop según sus beats (la de los scripts de pistas de docs/LIBRERIAS.md)
export function default_repeat(beats) {
  return beats <= 8 ? [4, 16] : beats <= 16 ? [2, 8] : beats <= 32 ? [1, 4] : [1, 2]
}

// props.repeat de un loop que pasa de old_beats a new_beats. Si tenía la de por defecto, la de por defecto del largo
// nuevo; si no (la tocó el dueño, o no tiene = [1, 1]), multiplicada por old / new para que suene lo mismo, con
// tope en 16. { repeat, how: "regla" | "escalado" | "escalado con tope" }
export function trim_repeat(repeat, old_beats, new_beats) {
  let r = Array.isArray(repeat) ? repeat : [1, 1]
  let d = default_repeat(old_beats)
  if (r[0] == d[0] && r[1] == d[1]) return { repeat: default_repeat(new_beats), how: "regla" }
  let f = old_beats / new_beats
  let out = r.map(v => Math.min(16, v * f))
  return { repeat: out, how: out[1] < r[1] * f ? "escalado con tope" : "escalado" }
}
