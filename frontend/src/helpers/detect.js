// Detectores del editor (docs/PLAN_EDITOR.md, fase 8; decisión 5): tonalidad de un loop y nota de un shot.
// Funciones puras sobre una señal mono (Float32Array) y su sample rate: sin Tone, Vue ni window (tests en
// detect.test.js con señales sintéticas). Corren en un Worker (detect.worker.js, lo usa detect_job.js).
//
// - detect_key: cromagrama (STFT con ventana Hann, picos espectrales interpolados entre 50 y 5000 Hz, afinación
//   estimada y cada pico sumado a su clase de altura con referencia 440 Hz) correlacionado con los perfiles de
//   Krumhansl–Kessler mayor y menor en las 24 tonalidades. Es una sugerencia: confunde relativas (C / Am comparten
//   notas) y a veces la quinta; la segunda candidata ayuda. Con poca confianza (material atonal o percusivo) dice
//   uncertain y sugiere "atonal".
// - detect_note: YIN (diferencia acumulada normalizada, umbral, interpolación parabólica) en varios tramos de la
//   porción con energía después del ataque; mediana de los tramos con altura. Sin altura definida → pitched false.
import { make_fft } from "./bpm_detect.js"
import { KEY_TONICS, KEY_ATONAL, normalize_key } from "./music_key.js"
import { TRANSPOSE_MIN, TRANSPOSE_MAX, parse_transpose } from "./transpose.js"

// --- utilidades ---
// mezcla mono de un tramo de canales (from y len en muestras; recortado al largo)
export function mono_mix(chans, from = 0, len = Infinity) {
  let n = chans[0]?.length ?? 0
  let a = Math.max(0, Math.min(n, Math.floor(from)))
  let b = Math.max(a, Math.min(n, a + Math.floor(Math.min(len, n))))
  let out = new Float32Array(b - a)
  let k = 1 / chans.length
  for (const c of chans) {
    for (let i = a; i < b; i++) out[i - a] += c[i] * k
  }
  return out
}

// frecuencia (Hz) → número MIDI con fracción (A4 = 440 Hz = 69)
export function freq_to_midi(f) {
  return 69 + 12 * Math.log2(f / 440)
}
export function midi_to_freq(m) {
  return 440 * Math.pow(2, (m - 69) / 12)
}
// número MIDI entero → nota con octava, con la grafía de KEY_TONICS (69 → "A4", 61 → "C#4")
export function note_name(midi) {
  let m = Math.round(midi)
  return KEY_TONICS[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1)
}
// cents con signo para mostrar: "+12¢", "−3¢", "±0¢"
export function fmt_cents(c) {
  let r = Math.round(c)
  return (r > 0 ? "+" : r < 0 ? "−" : "±") + Math.abs(r) + "¢"
}

function hann(n) {
  let w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)
  return w
}
function next_pow2(n) {
  let p = 1
  while (p < n) p *= 2
  return p
}

// --- tonalidad ---
// perfiles de Krumhansl–Kessler (1982): peso de cada grado (0 = tónica) en mayor y menor
export const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
export const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

export const KEY_FMIN = 50
export const KEY_FMAX = 5000
// ventana de la STFT: ~0,37 s (16384 muestras a 44,1/48 kHz: bins de ~2,7-2,9 Hz; con la interpolación de los
// picos alcanza para separar semitonos desde ~50 Hz), salto de media ventana
const KEY_WIN_SECS = 0.37
// picos más de 50 dB por debajo del más alto de la ventana no cuentan (ruido, colas de la ventana)
const KEY_PEAK_FLOOR = Math.pow(10, -50 / 20)
// ventanas más de 40 dB por debajo de la más fuerte se saltean (silencio)
const KEY_SILENT_FRAME = Math.pow(10, -40 / 20)
// contraste del cromagrama (desvío / media) a partir del cual cuenta entero: un acorde sostenido da ~1, un loop
// con armonía ~0,5-0,8, ruido blanco ~0,05. Debajo, la confianza baja en proporción
const KEY_CONTRAST_FULL = 0.5
// confianza mínima para sugerir una tonalidad; debajo: uncertain (sugiere "atonal")
export const KEY_MIN_CONFIDENCE = 0.6

// picos que se miran por ventana (los más fuertes): el resto es ruido y encarece la criba
const KEY_MAX_PEAKS = 60
// armónicos que caen en otra clase de altura (3 = quinta, 5 = tercera mayor, 6 = quinta) y tolerancia en semitonos
const SIEVE_HARMONICS = [3, 5, 6].map(h => 12 * Math.log2(h))
const SIEVE_TOL = 0.3

// criba de armónicos: a un pico que cae (±SIEVE_TOL) en el 3.º, 5.º o 6.º armónico de un pico más grave se le
// descuenta la amplitud de ese pico (si era un armónico, más débil que su fundamental, desaparece). Sin esto, el
// 5.º armónico de la tónica (su tercera mayor) empuja los menores a mayor y el 3.º suma quintas: una tríada de C con
// armónicos da Em. Las octavas (2.º, 4.º) caen en la misma clase y no molestan. list = [{ m (midi), a }]
export function harmonic_sieve(list) {
  let top = list.sort((p, q) => q.a - p.a).slice(0, KEY_MAX_PEAKS).sort((p, q) => p.m - q.m)
  let out = top.map(p => ({ m: p.m, a: p.a }))
  for (let i = 1; i < top.length; i++) {
    for (let j = 0; j < i; j++) {
      let d = top[i].m - top[j].m
      if (SIEVE_HARMONICS.some(h => Math.abs(d - h) < SIEVE_TOL)) out[i].a = Math.max(0, out[i].a - top[j].a)
    }
  }
  return out
}

// coeficiente de correlación de Pearson entre el cromagrama y el perfil rotado a la tónica `t`
function correlate(chroma, profile, t) {
  let mc = 0, mp = 0
  for (let i = 0; i < 12; i++) {
    mc += chroma[i]
    mp += profile[i]
  }
  mc /= 12
  mp /= 12
  let num = 0, dc = 0, dp = 0
  for (let i = 0; i < 12; i++) {
    let c = chroma[(t + i) % 12] - mc
    let p = profile[i] - mp
    num += c * p
    dc += c * c
    dp += p * p
  }
  return dc > 0 && dp > 0 ? num / Math.sqrt(dc * dp) : 0
}

// las 24 tonalidades ordenadas por correlación: [{ key ("C", "Am"...), r }]
export function key_scores(chroma) {
  let out = []
  for (let t = 0; t < 12; t++) {
    out.push({ key: KEY_TONICS[t], r: correlate(chroma, KK_MAJOR, t) })
    out.push({ key: KEY_TONICS[t] + "m", r: correlate(chroma, KK_MINOR, t) })
  }
  return out.sort((a, b) => b.r - a.r)
}

// cromagrama de la señal: { chroma (12 valores, 0 = C, suma 1; null sin material), tuning (semitonos, la
// desviación de la afinación respecto de 440 Hz, −0,5..0,5), frames (ventanas que contaron) }
export function chromagram(x, sr, { fmin = KEY_FMIN, fmax = KEY_FMAX } = {}) {
  let N = next_pow2(Math.round(sr * KEY_WIN_SECS))
  let hop = N / 2
  let fft = make_fft(N)
  let win = hann(N)
  let re = new Float64Array(N)
  let im = new Float64Array(N)
  let mag = new Float64Array(N / 2 + 1)
  let df = sr / N
  let kmin = Math.max(2, Math.floor(fmin / df))
  let kmax = Math.min(N / 2 - 2, Math.ceil(fmax / df))
  let starts = []
  if (x.length <= N) starts.push(0)
  else for (let s = 0; s + N <= x.length; s += hop) starts.push(s)
  // picos de todas las ventanas: midi (con fracción) y amplitud; y la energía de cada ventana
  let peaks = []
  let energies = []
  for (const s of starts) {
    let e = 0
    for (let i = 0; i < N; i++) {
      let v = s + i < x.length ? x[s + i] : 0
      e += v * v
      re[i] = v * win[i]
      im[i] = 0
    }
    fft(re, im)
    let top = 0
    for (let k = kmin - 1; k <= kmax + 1; k++) {
      mag[k] = Math.hypot(re[k], im[k])
      if (k >= kmin && k <= kmax && mag[k] > top) top = mag[k]
    }
    let list = []
    if (top > 0) {
      let floor = top * KEY_PEAK_FLOOR
      for (let k = kmin; k <= kmax; k++) {
        let b = mag[k]
        if (b <= floor || b <= mag[k - 1] || b < mag[k + 1]) continue
        // interpolación parabólica sobre el logaritmo: frecuencia y amplitud del pico entre bins
        let la = Math.log(mag[k - 1] + 1e-12), lb = Math.log(b), lc = Math.log(mag[k + 1] + 1e-12)
        let d = la - 2 * lb + lc
        let p = d < 0 ? 0.5 * (la - lc) / d : 0
        let f = (k + p) * df
        if (f < fmin || f > fmax) continue
        list.push({ m: freq_to_midi(f), a: Math.exp(lb - 0.25 * (la - lc) * p) })
      }
    }
    peaks.push(harmonic_sieve(list))
    energies.push(e)
  }
  let emax = Math.max(0, ...energies)
  if (!(emax > 0)) return { chroma: null, tuning: 0, frames: 0 }
  let gate = emax * KEY_SILENT_FRAME * KEY_SILENT_FRAME
  // afinación: media circular (ponderada por amplitud) de la desviación de cada pico respecto del semitono
  let cs = 0, sn = 0
  for (let j = 0; j < peaks.length; j++) {
    if (energies[j] < gate) continue
    for (const { m, a } of peaks[j]) {
      let ang = 2 * Math.PI * (m - Math.round(m))
      cs += a * Math.cos(ang)
      sn += a * Math.sin(ang)
    }
  }
  let tuning = cs || sn ? Math.atan2(sn, cs) / (2 * Math.PI) : 0
  // cromagrama: cada pico suma su amplitud a su clase de altura (corregida por la afinación). Sin normalizar por
  // ventana: las ventanas fuertes pesan más (peso de energía) y las casi silenciosas no aportan
  let chroma = new Float64Array(12)
  let frames = 0
  for (let j = 0; j < peaks.length; j++) {
    if (energies[j] < gate) continue
    frames++
    for (const { m, a } of peaks[j]) chroma[((Math.round(m - tuning) % 12) + 12) % 12] += a
  }
  let sum = chroma.reduce((a, b) => a + b, 0)
  if (!(sum > 0)) return { chroma: null, tuning, frames }
  return { chroma: Array.from(chroma, v => v / sum), tuning, frames }
}

// desvío / media de los 12 valores (0 = plano)
function contrast(chroma) {
  let m = 1 / 12
  let v = 0
  for (const c of chroma) v += (c - m) * (c - m)
  return Math.sqrt(v / 12) / m
}

// tonalidad de un loop. Devuelve { key (la mejor; null sin material), r (su correlación), second ({ key, r }: la
// mejor de las otras 23, a menudo la relativa), margin (r − second.r), contrast, confidence (0..1: la correlación
// atenuada si el cromagrama es casi plano), uncertain (confianza menor que KEY_MIN_CONFIDENCE), suggestion (lo que
// se propone guardar en music_key: key, o "atonal" si uncertain), tuning (semitonos), chroma }
export function detect_key(x, sr, opts = {}) {
  let { chroma, tuning } = chromagram(x, sr, opts)
  if (!chroma) {
    return { key: null, r: 0, second: null, margin: 0, contrast: 0, confidence: 0, uncertain: true,
      suggestion: KEY_ATONAL, tuning: 0, chroma: null }
  }
  let scores = key_scores(chroma)
  let [best, second] = scores
  let ct = contrast(chroma)
  let confidence = Math.max(0, best.r) * Math.min(1, ct / KEY_CONTRAST_FULL)
  let uncertain = confidence < KEY_MIN_CONFIDENCE
  return {
    key: best.key, r: best.r, second, margin: best.r - second.r, contrast: ct, confidence, uncertain,
    suggestion: uncertain ? KEY_ATONAL : best.key, tuning, chroma,
  }
}

// --- nota (YIN, de Cheveigné y Kawahara 2002) ---
export const NOTE_FMIN = 40
export const NOTE_FMAX = 2000
// umbral absoluto de la diferencia normalizada: el primer mínimo por debajo es el período
export const YIN_THRESHOLD = 0.15
// envolvente en bloques de 5 ms para ubicar el ataque y la porción con energía
const ENV_BLOCK_SECS = 0.005
// el análisis arranca este tiempo después del pico de la envolvente (se saltea el transitorio del ataque)
const ATTACK_SKIP_SECS = 0.02
// y termina cuando la envolvente cae 30 dB por debajo del pico (o a lo sumo ANALYSIS_MAX_SECS después)
const TAIL_DB = -30
const ANALYSIS_MAX_SECS = 1.5
// tramos analizados como mucho (repartidos en la porción con energía)
const NOTE_MAX_FRAMES = 24
// para decir que tiene altura: al menos la mitad de los tramos con período, y confianza mínima
const VOICED_MIN_RATIO = 0.5
export const NOTE_MIN_CONFIDENCE = 0.5

// YIN de un tramo: x[start .. start + 2·tau_max). Devuelve { tau (período en muestras, con fracción), ap
// (aperiodicidad: el valor de la diferencia normalizada en el mínimo; 0 = periódica) } o null sin período
export function yin_frame(x, start, tau_min, tau_max, threshold = YIN_THRESHOLD) {
  let W = tau_max
  let d = new Float64Array(tau_max + 2)
  // diferencia cuadrática d(τ) = Σ (x_j − x_{j+τ})² en una ventana de W muestras
  for (let tau = 1; tau <= tau_max + 1; tau++) {
    let s = 0
    for (let j = 0; j < W; j++) {
      let v = x[start + j] - x[start + j + tau]
      s += v * v
    }
    d[tau] = s
  }
  // diferencia acumulada normalizada d'(τ) = d(τ) · τ / Σ_{1..τ} d
  let dn = new Float64Array(tau_max + 2)
  dn[0] = 1
  let run = 0
  for (let tau = 1; tau <= tau_max + 1; tau++) {
    run += d[tau]
    dn[tau] = run > 0 ? d[tau] * tau / run : 1
  }
  // primer τ por debajo del umbral, bajando hasta su mínimo local; si ninguno pasa el umbral, sin período
  let tau = -1
  for (let t = Math.max(2, tau_min); t <= tau_max; t++) {
    if (dn[t] < threshold) {
      while (t + 1 <= tau_max && dn[t + 1] < dn[t]) t++
      tau = t
      break
    }
  }
  if (tau < 0) return null
  // interpolación parabólica del mínimo
  let a = dn[tau - 1], b = dn[tau], c = dn[tau + 1]
  let den = a - 2 * b + c
  let p = den > 0 ? 0.5 * (a - c) / den : 0
  if (Math.abs(p) > 1) p = 0
  return { tau: tau + p, ap: Math.max(0, b - 0.25 * (a - c) * p) }
}

// porción con energía después del ataque: [from, to) en muestras, o null si la señal es muda
export function sustain_span(x, sr) {
  let blk = Math.max(1, Math.round(sr * ENV_BLOCK_SECS))
  let n = Math.floor(x.length / blk)
  if (n == 0) return null
  let env = new Float64Array(n)
  let peak = 0, at = 0
  for (let b = 0; b < n; b++) {
    let s = 0
    for (let i = b * blk; i < (b + 1) * blk; i++) s += x[i] * x[i]
    env[b] = Math.sqrt(s / blk)
    if (env[b] > peak) {
      peak = env[b]
      at = b
    }
  }
  if (!(peak > 1e-5)) return null
  let floor = peak * Math.pow(10, TAIL_DB / 20)
  let end = at
  while (end + 1 < n && env[end + 1] >= floor) end++
  let from = at * blk + Math.round(sr * ATTACK_SKIP_SECS)
  let to = Math.min((end + 1) * blk, at * blk + Math.round(sr * ANALYSIS_MAX_SECS))
  return { from, to }
}

// nota de un shot. Devuelve { pitched, freq (Hz), midi (con fracción), note ("C#3"), cents (−50..50, respecto de
// note), confidence (0..1), voiced (fracción de tramos con período) }; sin altura definida: pitched false (los
// demás datos, si hubo alguno, quedan como referencia)
export function detect_note(x, sr, { fmin = NOTE_FMIN, fmax = NOTE_FMAX, threshold = YIN_THRESHOLD } = {}) {
  let none = { pitched: false, freq: null, midi: null, note: null, cents: null, confidence: 0, voiced: 0 }
  let tau_min = Math.max(2, Math.floor(sr / fmax))
  let tau_max = Math.ceil(sr / fmin)
  let frame_len = 2 * tau_max + 2
  let span = sustain_span(x, sr)
  if (!span) return none
  let { from, to } = span
  // tramo corto (shot muy breve o muy grave): se usa lo que haya desde el pico, o desde el inicio
  if (to - from < frame_len) from = Math.max(0, to - frame_len)
  if (to - from < frame_len) to = Math.min(x.length, from + frame_len)
  if (to - from < frame_len) return none
  let count = Math.min(NOTE_MAX_FRAMES, 1 + Math.floor((to - from - frame_len) / tau_max))
  let step = count > 1 ? (to - from - frame_len) / (count - 1) : 0
  let found = []
  for (let i = 0; i < count; i++) {
    let r = yin_frame(x, Math.round(from + i * step), tau_min, tau_max, threshold)
    if (r) found.push({ midi: freq_to_midi(sr / r.tau), ap: r.ap })
  }
  let voiced = found.length / count
  if (!found.length) return { ...none, voiced }
  // mediana en semitonos (resiste saltos de octava sueltos); la confianza baja si los tramos no coinciden
  let sorted = found.map(f => f.midi).sort((a, b) => a - b)
  let midi = sorted[Math.floor(sorted.length / 2)]
  if (sorted.length % 2 == 0) midi = (midi + sorted[sorted.length / 2 - 1]) / 2
  let near = found.filter(f => Math.abs(f.midi - midi) < 0.5)
  let ap = near.reduce((s, f) => s + f.ap, 0) / Math.max(1, near.length)
  let agree = near.length / found.length
  let confidence = Math.max(0, Math.min(1, (1 - ap / threshold * 0.5) * agree * Math.min(1, voiced / VOICED_MIN_RATIO)))
  let m = Math.round(midi)
  let res = {
    pitched: voiced >= VOICED_MIN_RATIO && confidence >= NOTE_MIN_CONFIDENCE,
    freq: midi_to_freq(midi), midi, note: note_name(m), cents: (midi - m) * 100, confidence, voiced,
  }
  return res
}

// --- "afinar a…" (TUNE TO) ---
// transpose (semitonos, con 0,01 de precisión: parse_transpose) que lleva un shot de altura `midi` (con fracción, la
// detectada en el original) a la nota `target` (entera); null si queda fuera de TRANSPOSE_MIN..TRANSPOSE_MAX. Absoluto:
// reemplaza el transpose que tenga (la detección es sobre el original, sin transponer). Error de redondeo: ±0,5 cents
export function tune_semis(midi, target) {
  let s = Number(target) - Number(midi)
  if (!Number.isFinite(s) || s < TRANSPOSE_MIN - 0.05 || s > TRANSPOSE_MAX + 0.05) return null
  return parse_transpose(Math.min(TRANSPOSE_MAX, Math.max(TRANSPOSE_MIN, s)))
}
// notas destino alcanzables desde `midi` (dentro del rango del transpose), de la más aguda a la más grave:
// [{ midi, note, semis }]. tonic = clase de altura (0 = C) a marcar (la tónica del proyecto) o null
export function tune_targets(midi, tonic = null) {
  let out = []
  for (let m = Math.floor(midi + TRANSPOSE_MAX); m >= Math.ceil(midi + TRANSPOSE_MIN); m--) {
    let semis = tune_semis(midi, m)
    if (semis == null) continue
    out.push({ midi: m, note: note_name(m), semis, tonic: tonic != null && ((m % 12) + 12) % 12 == tonic })
  }
  return out
}
// nota destino por defecto: la más cercana en semitonos (corrige solo los cents)
export function nearest_target(midi) {
  return Math.round(midi)
}
// tonalidad dominante de una lista de music_key (las de los loops del proyecto): la más repetida si le gana a todas
// las demás (sin empate); sin dato, "atonal" o empate → null. Devuelve { key, tonic (clase de altura, 0 = C) }
export function dominant_key(keys) {
  let count = new Map()
  for (const k of keys) {
    let n = normalize_key(k)
    if (n && n != KEY_ATONAL) count.set(n, (count.get(n) ?? 0) + 1)
  }
  let sorted = [...count].sort((a, b) => b[1] - a[1])
  if (!sorted.length || (sorted.length > 1 && sorted[1][1] == sorted[0][1])) return null
  let key = sorted[0][0]
  return { key, tonic: KEY_TONICS.indexOf(key.endsWith("m") ? key.slice(0, -1) : key) }
}
