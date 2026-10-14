// detección de los beats de un loop en el navegador (sugerencia para Uploader.vue; el usuario la
// confirma o la corrige). Sin dependencias: corre sobre el AudioBuffer decodificado.
//
// 1. Envolvente de onsets: mezcla mono, ventanas de WIN muestras cada HOP, FFT propia, flujo espectral
//    por bandas (suma de los aumentos de log-magnitud por bin), menos su media local y rectificada.
//    Las ventanas son circulares (el loop se repite): la primera se compara con la última.
// 2. Como el loop dura exactamente N beats, se prueba cada N entero con BPM entre BPM_MIN y BPM_MAX
//    con un peine circular de fase 0 (el loop empieza en un beat): energía media en los N pulsos
//    menos la línea de base. 2N agrega pulsos débiles (baja la media); N/2 acierta los mismos pulsos
//    que N, así que se castiga al candidato que tiene casi tanta energía a mitad de camino.
// 3. Ambigüedad de octava: el puntaje se pondera por un prior (BPM entre 70 y 180, cercanía al tempo
//    del proyecto, cantidades redondas de beats como NICE_BEATS de TrackCtrl.js).
// Devuelve { beats, bpm, confidence } o null si no hay pulso claro (confidence = cuánto sobresalen
// los pulsos de la línea de base, 0..1).

const WIN = 1024
const HOP = 512
const BPM_MIN = 50
const BPM_MAX = 250
const MIN_CONFIDENCE = 0.5
const MID_PENALTY = 0.4
const YIELD_FRAMES = 200 // cada cuántas ventanas se cede el hilo (no congelar la UI)
const MAX_SECONDS = 61

// FFT radix-2 iterativa en el lugar (re, im de largo n potencia de 2)
function make_fft(n) {
  let levels = Math.log2(n)
  let rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b)
    rev[i] = r
  }
  let cos = new Float64Array(n / 2)
  let sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos(2 * Math.PI * i / n)
    sin[i] = Math.sin(2 * Math.PI * i / n)
  }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) {
      let j = rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      let half = size / 2
      let step = n / size
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          let a = start + k
          let b = a + half
          let wr = cos[k * step]
          let wi = -sin[k * step]
          let tr = re[b] * wr - im[b] * wi
          let ti = re[b] * wi + im[b] * wr
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }
  }
}

const pause = () => new Promise(resolve => setTimeout(resolve, 0))

// envolvente de onsets circular: una muestra por ventana (frame i empieza en i * HOP). El flujo se
// calcula por bandas (graves, medios, agudos) y cada banda se normaliza por sus picos: así el bombo
// pesa tanto como los platillos (que en un flujo de banda ancha dominan por cubrir más bins)
const BANDS_HZ = [30, 150, 2000, 16000]
// los agudos (platillos) suelen marcar subdivisiones: pesan menos que bombo y caja
const BAND_WEIGHTS = [1, 1, 0.5]
async function onset_envelope(buffer) {
  let len = buffer.length
  let channels = buffer.numberOfChannels
  let mono = new Float32Array(len)
  for (let c = 0; c < channels; c++) {
    let data = buffer.getChannelData(c)
    for (let i = 0; i < len; i++) mono[i] += data[i] / channels
  }
  let frames = Math.floor(len / HOP)
  let bins = WIN / 2
  let edges = BANDS_HZ.map(hz => Math.min(bins, Math.max(1, Math.round(hz * WIN / buffer.sampleRate))))
  let n_bands = edges.length - 1
  let fft = make_fft(WIN)
  let hann = new Float32Array(WIN)
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WIN)
  let re = new Float64Array(WIN)
  let im = new Float64Array(WIN)
  let spectrum = frame => {
    let start = frame * HOP
    for (let i = 0; i < WIN; i++) {
      re[i] = mono[(start + i) % len] * hann[i]
      im[i] = 0
    }
    fft(re, im)
    let mag = new Float32Array(bins)
    for (let k = 0; k < bins; k++) mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]))
    return mag
  }
  let flux = Array.from({ length: n_bands }, () => new Float32Array(frames))
  let prev = spectrum(frames - 1)
  for (let f = 0; f < frames; f++) {
    let mag = spectrum(f)
    for (let b = 0; b < n_bands; b++) {
      let sum = 0
      for (let k = edges[b]; k < edges[b + 1]; k++) {
        let d = mag[k] - prev[k]
        if (d > 0) sum += d
      }
      flux[b][f] = sum
    }
    prev = mag
    if (f % YIELD_FRAMES == YIELD_FRAMES - 1) await pause()
  }
  // por banda: menos la media local (±LOCAL ventanas, circular), rectificada (quedan los picos) y
  // dividida por la media de sus picos más altos. Una banda sin picos apreciables (menos de
  // MIN_PEAK de aumento promedio por bin) no suma
  let LOCAL = 8
  let MIN_PEAK = 0.05
  let env = new Float32Array(frames)
  for (let b = 0; b < n_bands; b++) {
    let fl = flux[b]
    let e = new Float32Array(frames)
    for (let f = 0; f < frames; f++) {
      let m = 0
      for (let d = -LOCAL; d <= LOCAL; d++) m += fl[(f + d + frames) % frames]
      e[f] = Math.max(0, fl[f] - m / (2 * LOCAL + 1))
    }
    let top = top_mean(e)
    if (!(top / Math.max(1, edges[b + 1] - edges[b]) > MIN_PEAK)) continue
    for (let f = 0; f < frames; f++) env[f] += e[f] / top * BAND_WEIGHTS[b]
  }
  return env
}

// media del 5 % más alto
function top_mean(values) {
  let sorted = Float32Array.from(values).sort()
  let top = sorted.subarray(Math.floor(sorted.length * 0.95))
  return top.reduce((a, b) => a + b, 0) / Math.max(1, top.length)
}

// valor de la envolvente cerca de una posición fraccionaria (máximo en ±1 ventana, circular)
function peak_at(env, pos) {
  let n = env.length
  let i = Math.round(pos)
  let v = 0
  for (let d = -1; d <= 1; d++) v = Math.max(v, env[(((i + d) % n) + n) % n])
  return v
}

// peine de N pulsos con fase 0 (con un pequeño corrimiento por el retardo del flujo espectral).
// on = energía media en los pulsos; mid = energía media a mitad de camino entre pulsos
function comb(env, n_beats) {
  let period = env.length / n_beats
  let best = { on: -Infinity, mid: 0 }
  for (let shift = -2; shift <= 2; shift++) {
    let on = 0
    let mid = 0
    for (let k = 0; k < n_beats; k++) {
      let pos = k * period + shift
      on += peak_at(env, pos) / n_beats
      mid += peak_at(env, pos + period / 2) / n_beats
    }
    if (on > best.on) best = { on, mid }
  }
  return best
}

function prior(n_beats, bpm, tempo) {
  let w = 1
  if (bpm < 70 || bpm > 180) w *= 0.8
  if (tempo > 0) w *= 1 - 0.3 * Math.min(1, Math.abs(Math.log2(bpm / tempo)))
  // cantidades redondas (como NICE_BEATS de TrackCtrl.js): múltiplos de 4 y 1, 2, 3, 6
  if (!(n_beats % 4 == 0 || [1, 2, 3, 6].includes(n_beats))) w *= 0.85
  return w
}

// buffer: AudioBuffer (o algo con getChannelData, sampleRate, numberOfChannels, length, duration)
// duration: duración del loop en segundos (default: la del buffer); tempo: tempo del proyecto
export async function detect_beats(buffer, { duration, tempo } = {}) {
  let d = Number(duration) > 0 ? Number(duration) : buffer.duration
  if (!(d > 0) || d > MAX_SECONDS || buffer.length < WIN * 4) return null
  let env = await onset_envelope(buffer)
  let frames = env.length
  let scale = top_mean(env)
  if (!(scale > 1e-6)) return null
  // línea de base: lo que da un pulso cualquiera (media de la envolvente con el mismo máximo local)
  let base = 0
  for (let f = 0; f < frames; f++) base += peak_at(env, f) / frames

  let candidates = []
  let n_min = Math.max(1, Math.ceil(d * BPM_MIN / 60))
  let n_max = Math.floor(d * BPM_MAX / 60)
  for (let n = n_min; n <= n_max; n++) {
    if (frames / n < 4) break // pulsos demasiado juntos para la resolución de la envolvente
    let { on, mid } = comb(env, n)
    // N y N/2 aciertan los mismos pulsos: si a mitad de camino suena casi tan fuerte como en los
    // pulsos, el pulso real es el doble (se castiga N). 2N agrega pulsos débiles: baja su media
    let mid_ratio = on > 0 ? mid / on : 1
    let penalty = 1 - MID_PENALTY * Math.min(1, Math.max(0, (mid_ratio - 0.3) / 0.4))
    let score = (on - base) / scale * penalty
    let bpm = n * 60 / d
    candidates.push({ n, bpm, score, confidence: on > 0 ? (on - base) / on : 0, weighted: score * prior(n, bpm, tempo) })
  }
  if (candidates.length == 0) return null
  let best = candidates.reduce((a, b) => (b.weighted > a.weighted ? b : a))
  if (!(best.score > 0) || best.confidence < MIN_CONFIDENCE) return null
  return {
    beats: best.n,
    bpm: Math.round(best.bpm * 10) / 10,
    confidence: Math.round(best.confidence * 100) / 100
  }
}
