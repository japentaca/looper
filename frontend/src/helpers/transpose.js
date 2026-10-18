// Transposición, KEY LOCK, tonalidad efectiva y STRETCH (docs/PLAN_EDITOR.md, fase 7; decisiones 5 y 9). Funciones
// puras (sin Tone, Vue ni window; tests en transpose.test.js): las usan la carga de buffers (pitch.js), el preview
// (toneLib.js), el editor (FileEditor.vue, EditOps.vue), la lista (Files.vue) y las ediciones destructivas (edit_ops.js).
//
// Props del proyecto (project_files.props, opcionales; sin ninguna el archivo suena como siempre):
// - transpose: semitonos (número de TRANSPOSE_MIN a TRANSPOSE_MAX, pasos de TRANSPOSE_STEP). El navegador calcula
//   offline (Signalsmith) un buffer con ese cambio de tono y la misma duración, y el motor lo toca en lugar del original;
// - key_lock: true = compensa el cambio de tono del resample del motor (playbackRate = play_rate, ver file_timing en
//   TrackCtrl.js): el buffer se transpone además −12·log2(play_rate). Solo en loops (los shots van a velocidad original).
import { KEY_ATONAL, KEY_TONICS, normalize_key, key_label } from "./music_key"

export const TRANSPOSE_MIN = -12
export const TRANSPOSE_MAX = 12
export const TRANSPOSE_STEP = 0.1
// precisión del transpose efectivo (semitonos): define cuándo cambió (y hay que volver a calcular el buffer) y la
// clave del cache. Por debajo de la mitad de esto se toca el original
export const SEMIS_PRECISION = 0.01

function round_to(v, step) {
  return Math.round(v / step) * step
}
// número con hasta 2 decimales sin el ruido de punto flotante (0.30000000000000004 → 0.3)
function clean(v) {
  return Math.round(v * 100) / 100
}

// transpose guardado → número en rango, en pasos de TRANSPOSE_STEP; cualquier otra cosa = 0 (sin transponer)
export function parse_transpose(v) {
  let n = Number(v)
  if (typeof v != "number" || !Number.isFinite(n) || n < TRANSPOSE_MIN || n > TRANSPOSE_MAX) return 0
  return clean(round_to(n, TRANSPOSE_STEP))
}
export function parse_key_lock(v) {
  return v === true
}
// deja las props de tono normalizadas (al cargar el proyecto): transpose numérico (0 = nada) y key_lock booleano
export function normalize_pitch_props(props) {
  props.transpose = parse_transpose(props.transpose)
  props.key_lock = parse_key_lock(props.key_lock)
  return props
}
// lo que save_file manda (solo lo que tiene valor)
export function pitch_props_out(props) {
  let out = {}
  let t = parse_transpose(props?.transpose)
  if (t) out.transpose = t
  if (parse_key_lock(props?.key_lock)) out.key_lock = true
  return out
}

// semitonos que sube (o baja, negativo) un resample a velocidad `rate`
export function rate_semitones(rate) {
  return rate > 0 ? 12 * Math.log2(rate) : 0
}
// semitonos redondeados a SEMIS_PRECISION; casi 0 → 0
export function round_semis(s) {
  let r = clean(round_to(s, SEMIS_PRECISION))
  return Math.abs(r) < SEMIS_PRECISION / 2 ? 0 : r
}

// transpose efectivo del buffer que se calcula para un archivo (o el virtual del buffer de trabajo), en semitonos
// (redondeado a SEMIS_PRECISION; 0 = el original). f = { kind, play_rate, props: { transpose, key_lock } }.
// Con KEY LOCK (solo loops) se compensa el resample: transpose − 12·log2(play_rate). free = para tocarlo sin resample
// (preview libre, a velocidad original): sin la compensación
export function effective_transpose(f, { free = false } = {}) {
  let t = parse_transpose(f?.props?.transpose)
  let rate = Number(f?.play_rate)
  if (!free && f?.kind != "shot" && parse_key_lock(f?.props?.key_lock) && rate > 0) t -= rate_semitones(rate)
  return round_semis(t)
}

// --- tonalidad efectiva ---
// tonalidad (music_key) transpuesta `semis` semitonos redondeados al entero más cercano, con la grafía fija de
// KEY_TONICS ("C#m" + 2 → "Ebm"). Sin dato, "atonal" o algo que no se reconoce: tal cual
export function transpose_key(key, semis) {
  let k = normalize_key(key)
  if (!k || k == KEY_ATONAL) return key ?? null
  let minor = k.endsWith("m")
  let tonic = minor ? k.slice(0, -1) : k
  let i = KEY_TONICS.indexOf(tonic)
  let n = Math.round(Number(semis) || 0)
  let j = ((i + n) % 12 + 12) % 12
  return KEY_TONICS[j] + (minor ? "m" : "")
}

// semitonos con signo para mostrar: "+2", "-1.5" (sin decimales si es entero)
export function fmt_semis(s) {
  let r = clean(s)
  return (r > 0 ? "+" : r < 0 ? "−" : "±") + String(Math.abs(r))
}

// lo que muestran el editor, el cartucho y la tabla del proyecto: { text (tonalidad efectiva: music_key + transpose
// redondeado al semitono), mark (transpose con signo, redondeado al semitono; null sin transponer), transposed, title
// (el valor exacto si tiene fracción) }. resample = semitonos que agrega el resample del motor (loops sin KEY LOCK;
// 0 = no se aclara)
export function key_display(music_key, transpose, resample = 0) {
  let t = parse_transpose(transpose)
  let base = key_label(music_key)
  if (!t) {
    return { text: base, mark: null, transposed: false, title: undefined }
  }
  let n = Math.round(t)
  let text = music_key ? key_label(transpose_key(music_key, t)) : base
  let mark = n != 0 ? fmt_semis(n) : fmt_semis(t)
  let title = `Transposed ${fmt_semis(t)} semitones in this project`
    + (music_key && music_key != KEY_ATONAL ? ` (catalog key ${music_key})` : "")
  if (n != t) title += `; the key shown is rounded to the nearest semitone (${fmt_semis(n)})`
  if (Math.abs(resample) >= 0.05) title += `. The engine's tempo change adds ${fmt_semis(clean(resample))} (KEY LOCK off)`
  return { text, mark, transposed: true, title }
}

// --- STRETCH (operación destructiva: tempo sin cambiar el tono) ---
// el STRETCH cambia el tempo a lo sumo ×2 o ×½ (más allá el algoritmo pierde calidad)
export const STRETCH_RATIO_MAX = 2
// límites de BPM del backend (BPM_MIN / BPM_MAX de routes/api.js): la copia tiene que entrar
export const STRETCH_BPM_MIN = 20
export const STRETCH_BPM_MAX = 400

// velocidad del stretch para llevar un loop de bpm_from a bpm_to (> 1 = más rápido y más corto); 0 si falta un dato
export function stretch_rate(bpm_from, bpm_to) {
  let a = Number(bpm_from), b = Number(bpm_to)
  return a > 0 && b > 0 ? b / a : 0
}
// largo (muestras) del resultado de un stretch de n muestras a velocidad rate
export function stretch_length(n, rate) {
  return rate > 0 ? Math.max(0, Math.round(n / rate)) : n
}
// rango de BPM destino para un loop de `bpm` (enteros, dentro de STRETCH_RATIO_MAX y los límites del backend)
export function stretch_bpm_range(bpm) {
  let b = Number(bpm)
  if (!(b > 0)) return null
  let min = Math.max(STRETCH_BPM_MIN, Math.ceil(b / STRETCH_RATIO_MAX))
  let max = Math.min(STRETCH_BPM_MAX, Math.floor(b * STRETCH_RATIO_MAX))
  return min <= max ? { min, max } : null
}
