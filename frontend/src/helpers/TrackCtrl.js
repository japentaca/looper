import { store } from "./composable"
import { reactive } from "vue"

// --- delay global (ver mixer.js) ---
// tipos: pingpong = ping-pong estéreo, stereo = la misma repetición en los dos canales,
// dotted = L con la división y R con 1.5 × la división, tape = cada repetición más oscura
export const DELAY_TYPES = ["pingpong", "stereo", "dotted", "tape"]
// divisiones (notación de Tone) → duración en beats (negras). El tiempo del delay se calcula con el tempo.
export const DELAY_DIVISIONS = { "16n": 0.25, "8t": 1 / 3, "8n": 0.5, "8n.": 0.75, "4n": 1, "4n.": 1.5, "2n": 2 }
export const DELAY_FEEDBACK_MAX = 0.9 // el feedback nunca llega a 1 (las repeticiones siempre se apagan)
export const DELAY_LEVEL_MIN = -24 // nivel de retorno del delay en dB (DELAY_LEVEL_MIN..DELAY_LEVEL_MAX)
export const DELAY_LEVEL_MAX = 6
export function delay_default() {
  return { type: "pingpong", division: "8n.", feedback: 0.4, level: 0 }
}
export const TEMPO_DEFAULT = 138
// tolerancia de tempo del proyecto (%, knob Tol): cuánto se puede acelerar o frenar un loop para que
// entre en el tempo. Con resample (playbackRate) también cambia el tono: 6 % ≈ un semitono
export const TEMPO_TOL_DEFAULT = 6
export const TEMPO_TOL_MAX = 12
export const BEATS_X_BAR_DEFAULT = "4"
// rango del cambio de Tag: exponentes [min, max] de 2^n beats (pads TAG CHANGE, de TAG_RANGE_MIN a TAG_RANGE_MAX)
export const TAG_RANGE_MIN = 5
export const TAG_RANGE_MAX = 9
export const TAG_RANGE_DEFAULT = [6, 7]
export const MASTER_DEFAULT = 0 // volumen master en dB (knob Master; curva y rango en mixer.js)

// tempo, compás, rango de cambio de Tag, delay y volumen master son la config del proyecto activo: se guardan en
// projects.props (save_project_props_debounced en composable.js) y se aplican al cargar el proyecto
export const TrackCtrl = reactive({
  tempo: TEMPO_DEFAULT,
  tempo_tol: TEMPO_TOL_DEFAULT,
  beats_x_bar: BEATS_X_BAR_DEFAULT,
  tag_range: [...TAG_RANGE_DEFAULT],
  delay: delay_default(),
  master: MASTER_DEFAULT,
  isPlaying: false,
  isReady: false,
  // estado del motor (lo escribe Tracks.vue; los pads de la barra lateral lo leen)
  current_TAG: {
    duration: 0,
    tag: null,
    curr_bar: 0,
    old_tag: null,
    remaining_beats: 0
  },
  tracks: []
})
// STOP del motor. stop() es local de Tracks.vue: lo registra al montarse (y lo quita al desmontarse)
// para que otros componentes puedan detener el transporte, p. ej. antes de cambiar de proyecto
let stop_fn = null
export function register_stop(fn) {
  stop_fn = fn
}
export function stop_transport() {
  if (TrackCtrl.isPlaying && stop_fn) stop_fn()
}
// --- tempo de los archivos ---
// Un loop (kind = "loop") trae `beats` (lo carga el creador) y `bpm` (deducido en el backend). Suena con
// playbackRate = tempo del proyecto / bpm (resample: cambia también el tono). Se prueba a su tempo, al
// doble y a la mitad (×1, ×2, ×½: un loop de 70 entra en un proyecto de 140 ocupando el doble de beats)
// y se usa el que menos lo corre. Si el corrimiento supera la tolerancia (TrackCtrl.tempo_tol, %) queda
// fuera del sorteo (in_tempo = false). Un shot (kind = "shot") suena siempre a velocidad original.
// Por archivo deja: play_rate, play_beats (beats del transporte que ocupa) e in_tempo.
const TEMPO_TOL_FLOOR = 0.5 // con tolerancia 0 igual se acepta este margen de redondeo (%)
const TEMPO_MULTS = [1, 2, 0.5]

export function file_timing(f, tempo, tol) {
  let d = Number(f.duration)
  let beats_at_tempo = d > 0 ? Math.max(1, Math.round(d * tempo / 60)) : 1
  if (f.kind == "shot") return { play_rate: 1, play_beats: beats_at_tempo, in_tempo: true }
  let beats = Number(f.beats)
  let bpm = Number(f.bpm) || (beats > 0 && d > 0 ? beats * 60 / d : 0)
  // loop sin datos de tempo (no debería pasar: la migración los completa): no se sortea
  if (!(beats > 0) || !(bpm > 0)) return { play_rate: 1, play_beats: beats_at_tempo, in_tempo: false }
  let best = null
  for (let m of TEMPO_MULTS) {
    if (!Number.isInteger(beats * m)) continue // a medio tempo hace falta una cantidad par de beats
    let rate = tempo / (bpm * m)
    let dev = Math.abs(Math.log(rate))
    if (!best || dev < best.dev) best = { rate, beats: beats * m, dev }
  }
  let max_dev = Math.max(tol, TEMPO_TOL_FLOOR) / 100
  return { play_rate: best.rate, play_beats: best.beats, in_tempo: Math.abs(best.rate - 1) <= max_dev }
}

// recalcula el tempo de todos los archivos del proyecto (al cargar y al cambiar tempo, tolerancia o
// compás). Los players que ya suenan toman el playbackRate nuevo en Tracks.vue (apply_rates)
export function calculate_timing() {
  for (let f of store.files) {
    Object.assign(f, file_timing(f, TrackCtrl.tempo, TrackCtrl.tempo_tol))
    f.bars = (f.play_beats / parseInt(TrackCtrl.beats_x_bar)).toFixed(2)
  }
}

// sugerencia para la subida (Uploader.vue): tipo y beats a partir de la duración y el tempo del
// proyecto. Menos de SHOT_MAX_SECONDS = shot. Si no, la cantidad "redonda" de beats que deja el loop
// más cerca del tempo (o la exacta, si cierra a menos de 1 %). El usuario la confirma o la corrige
const SHOT_MAX_SECONDS = 1
const NICE_BEATS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256]
export function suggest_timing(duration, tempo) {
  let d = Number(duration)
  if (!(d > 0)) return { kind: "loop", beats: null }
  if (d < SHOT_MAX_SECONDS) return { kind: "shot", beats: null }
  let exact = Math.round(d * tempo / 60)
  if (exact >= 1 && Math.abs(exact * 60 / d / tempo - 1) < 0.01) return { kind: "loop", beats: exact }
  let best = null
  for (let n of NICE_BEATS) {
    let dev = Math.abs(Math.log(n * 60 / d / tempo))
    if (!best || dev < best.dev) best = { n, dev }
  }
  return { kind: "loop", beats: best.n }
}
