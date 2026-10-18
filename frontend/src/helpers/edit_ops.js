// Ediciones destructivas del editor (docs/PLAN_EDITOR.md, fase 6; decisión 9). Funciones puras (sin Tone, Vue ni
// window; tests en edit_ops.test.js): las usan la sesión de edición (edit_session.js), el editor (EditOps.vue,
// RegionEditor.vue) y el render de las copias.
//
// - Operaciones sobre arrays de canales (un Float32Array por canal), en índices de muestra del buffer al que se
//   aplican: op = { type, a, b, db?, ramp? } con 0 <= a < b <= largo (b exclusivo). Nunca modifican la entrada:
//   devuelven canales nuevos.
//   cut = quita [a, b) (acorta); silence = [a, b) a cero (mismo largo); duplicate = repite [a, b) a continuación
//   (alarga); reverse = invierte [a, b); gain = [a, b) × 10^(db/20). silence y gain llevan una rampa de `ramp`
//   muestras en cada borde (adentro del rango) para no dejar un click.
// - Posiciones a través de las operaciones (map_pos): la región y el anchor del proyecto, guardados sobre el
//   archivo original, se llevan al buffer de trabajo (work_file_of) y de ahí a la copia (copy_plan).
// - Copia: copy_plan / selection_plan (qué parte del buffer, largo, beats, anchor), copy_props (props del
//   proyecto que pasan a la copia), encode_wav (WAV float de 32 bits).
import {
  play_window, window_length, shot_anchor, loop_region, region_beats, file_bpm, parse_fade, parse_nudge, parse_anchor
} from "./region"

export const OP_TYPES = ["cut", "silence", "duplicate", "reverse", "gain"]
// rango del control GAIN (dB)
export const GAIN_MIN = -24
export const GAIN_MAX = 12
// rampa de los bordes de silence y gain (s)
export const EDGE_RAMP = 0.002

export function db_to_gain(db) {
  return Math.pow(10, db / 20)
}
export function gain_to_db(g) {
  return g > 0 ? 20 * Math.log10(g) : -Infinity
}

// rango [a, b) entero dentro de [0, n]; null si queda vacío
export function clamp_range(a, b, n) {
  let lo = Math.max(0, Math.min(n, Math.round(Math.min(a, b))))
  let hi = Math.max(0, Math.min(n, Math.round(Math.max(a, b))))
  return hi > lo ? { a: lo, b: hi } : null
}

// largo (muestras) que deja la operación sobre un buffer de n muestras
export function op_length(n, op) {
  if (op.type == "cut") return n - (op.b - op.a)
  if (op.type == "duplicate") return n + (op.b - op.a)
  return n
}

// ganancia en la muestra i de [a, b) que va de 1 a g en los primeros `ramp` y vuelve a 1 en los últimos
function ramped(i, a, b, g, ramp) {
  if (ramp <= 0) return g
  let k = Math.min(i - a + 1, b - i) / (ramp + 1)
  return k >= 1 ? g : 1 + (g - 1) * k
}

// aplica una operación: canales nuevos (no toca `chans`)
export function apply_op(chans, op) {
  let { a, b } = op
  let len = b - a
  return chans.map(c => {
    let n = c.length
    let o
    switch (op.type) {
      case "cut":
        o = new Float32Array(n - len)
        o.set(c.subarray(0, a))
        o.set(c.subarray(b), a)
        return o
      case "duplicate":
        o = new Float32Array(n + len)
        o.set(c.subarray(0, b))
        o.set(c.subarray(a, b), b)
        o.set(c.subarray(b), b + len)
        return o
      case "reverse":
        o = c.slice()
        o.subarray(a, b).reverse()
        return o
      case "silence":
      case "gain": {
        o = c.slice()
        let g = op.type == "silence" ? 0 : db_to_gain(op.db ?? 0)
        let ramp = Math.min(Math.floor(len / 2), Math.max(0, Math.round(op.ramp ?? 0)))
        for (let i = a; i < b; i++) o[i] *= ramped(i, a, b, g, ramp)
        return o
      }
      default:
        throw new Error("Operación desconocida: " + op.type)
    }
  })
}
export function apply_ops(chans, ops) {
  let out = chans
  for (const op of ops) out = apply_op(out, op)
  return out
}

// posición p (muestras, puede ser fraccionaria) del buffer de antes de la operación, en el de después:
// cut: lo de adentro del corte queda en su borde, lo de después se corre a la izquierda; duplicate: lo que está
// desde el fin del rango (incluido) se corre a la derecha (una región que termina justo ahí incluye la repetición;
// una que empieza ahí, no); el resto no cambia
export function map_pos(p, op) {
  if (op.type == "cut") return p < op.a ? p : p < op.b ? op.a : p - (op.b - op.a)
  if (op.type == "duplicate") return p < op.b ? p : p + (op.b - op.a)
  return p
}
export function map_through(p, ops) {
  for (const op of ops) p = map_pos(p, op)
  return p
}

// pico absoluto (lineal) de todos los canales
export function peak(chans) {
  let m = 0
  for (const c of chans) {
    for (let i = 0; i < c.length; i++) {
      let v = Math.abs(c[i])
      if (v > m) m = v
    }
  }
  return m
}

// --- la región del proyecto sobre el buffer de trabajo ---
const EPS = 1e-9
function round4(v) {
  return Math.round(v * 1e4) / 1e4
}

// tramo del archivo original que es la región del proyecto (s). Loop: [nudge + start × beat, nudge + stop × beat],
// sin región [nudge, nudge + beats × beat]: puede pasar del final del archivo (el motor toca esa parte como silencio
// y la tirada dura los beats igual). Shot: la región (sin región, el archivo entero). null sin datos
export function project_span(f) {
  let d = Number(f.duration)
  if (!(d > 0)) return null
  if (f.kind == "shot") {
    let w = play_window(f)
    return { start: w.offset, stop: w.duration == null ? d : w.offset + w.duration }
  }
  let bpm = file_bpm(f)
  let nudge = parse_nudge(f.props?.nudge) / 1000
  if (!(bpm > 0)) return { start: Math.min(nudge, d), stop: d }
  let spb = 60 / bpm
  let r = loop_region(f.props, f.beats) ?? { start: 0, stop: Number(f.beats) }
  return { start: Math.min(d, nudge + r.start * spb), stop: nudge + r.stop * spb }
}

// archivo "virtual" que describe el buffer de trabajo (largo `work_dur` s, resultado de `ops` sobre el original a
// `sr` Hz) con la región y el anchor del proyecto llevados a ese buffer: lo usan el preview (play_window,
// shot_preroll), la pantalla y las lupas mientras hay cambios sin guardar, y copy_plan para la copia. Sin
// play_rate / in_tempo (los agrega quien lo usa con file_timing). Loops: bpm del original, la región como
// region_beats explícita (con el nudge del original, salvo que un corte lo deje antes del inicio de la región:
// entonces lo que entre) y beats = los que entran en el buffer (o los de la región, si son más); shots: region_secs y el anchor guardado
// (props.anchor) llevado al buffer de trabajo (sin anchor guardado, el del catálogo sobre los bordes)
export function work_file_of(f, ops, sr, work_dur) {
  let span = project_span(f)
  let props = { ...(f.props ?? {}) }
  delete props.region_beats
  delete props.region_secs
  let v = { ...f, duration: work_dur, props }
  if (!span) return v
  // lo que pasa del final (fin de la región de un loop) se mueve como el final
  const map = t => map_through(t * sr, ops) / sr
  let s = Math.min(work_dur, map(span.start))
  let e = map(span.stop)
  if (f.kind == "shot") {
    e = Math.min(work_dur, e)
    if (e - s > EPS && (s > EPS || e < work_dur - EPS)) props.region_secs = [round4(s), round4(e)]
    let saved = parse_anchor(f.props?.anchor)
    if (saved != null) props.anchor = round4(Math.min(work_dur, map(saved)))
    else delete props.anchor
    return v
  }
  let bpm = file_bpm(f)
  if (!(bpm > 0)) return v
  let spb = 60 / bpm
  let nudge_ms = Math.min(parse_nudge(f.props?.nudge), Math.floor(s * 1000 + 1e-6))
  let nudge = nudge_ms / 1000
  props.nudge = nudge_ms
  v.bpm = bpm
  if (!(e - s > EPS)) {
    v.beats = Math.max(1, Math.floor((work_dur - nudge) / spb + 1e-6))
    return v
  }
  let rb = [(s - nudge) / spb, (e - nudge) / spb]
  props.region_beats = rb
  // los beats que entran en el buffer de trabajo (la grilla de la pantalla), y al menos los de la región (para que
  // loop_region no la recorte)
  v.beats = Math.max(1, Math.ceil(rb[1] - 1e-6), Math.floor((work_dur - nudge) / spb + 1e-6))
  return v
}

// --- copias ---
// Qué se guarda de un archivo (el original o el virtual de work_file_of) para SAVE AS COPY: la región del proyecto
// horneada, como la toca el motor (play_window): { from, len, total (s del buffer: desde dónde, cuánto audio y largo
// de la copia, con silencio al final si len < total), beats (loops: los de la tirada; null en shots o sin tempo),
// anchor (shots con anchor guardado: llevado al inicio de la copia, s; si no, null) }. En un loop la copia dura los
// beats de la tirada exactos (el bpm no cambia). buffer_dur = largo del buffer (s)
export function copy_plan(f, buffer_dur) {
  let w = play_window(f)
  let len = window_length(w, buffer_dur)
  if (f.kind == "shot") {
    let a = shot_anchor(f)
    let anchor = a && a.saved != null ? round4(a.at - a.start) : null
    return { from: w.offset, len, total: len, beats: null, anchor }
  }
  if (!(w.period > 0)) return { from: w.offset, len, total: len, beats: null, anchor: null }
  let r = loop_region(f.props, f.beats)
  let beats = r ? region_beats(r.start, r.stop) : Math.max(1, Math.round(Number(f.beats)))
  return { from: w.offset, len: Math.min(len, w.period), total: w.period, beats, anchor: null }
}
// lo mismo para SAVE REGION AS COPY: la selección sel = { start, stop } (s del buffer) de f; en un loop, redondeada a
// beats enteros de su tempo (mínimo 1; lo que falta, silencio al final); en un shot, tal cual, con el anchor
// guardado si cae adentro de la selección
export function selection_plan(f, sel) {
  let len = Math.max(0, sel.stop - sel.start)
  if (f.kind == "shot") {
    let a = shot_anchor(f)
    let anchor = a && a.saved != null && a.at >= sel.start - EPS && a.at <= sel.stop + EPS
      ? round4(Math.max(0, a.at - sel.start)) : null
    return { from: sel.start, len, total: len, beats: null, anchor }
  }
  let bpm = file_bpm(f)
  if (!(bpm > 0)) return { from: sel.start, len, total: len, beats: null, anchor: null }
  let spb = 60 / bpm
  let beats = Math.max(1, Math.round(len / spb))
  let total = beats * spb
  return { from: sel.start, len: Math.min(len, total), total, beats, anchor: null }
}

// props del proyecto que pasan a la copia (no se hornean): volume, weight, repeat (si repite), fade y el anchor
// recalculado (shots). region_beats / region_secs / nudge no: ya están horneados
export function copy_props(props, anchor = null) {
  let out = {}
  if (Number.isFinite(props?.volume)) out.volume = props.volume
  if (Number.isInteger(props?.weight)) out.weight = props.weight
  if (Array.isArray(props?.repeat) && props.repeat.length == 2 && props.repeat[1] > 1) out.repeat = [...props.repeat]
  let fade = parse_fade(props?.fade)
  if (fade) out.fade = fade
  if (anchor != null && Number.isFinite(anchor)) out.anchor = anchor
  return out
}

// nombre por defecto de una copia: el del original sin extensión + " (edit)"; si ya existe en `taken` (nombres
// sin extensión, en minúsculas) se numera: " (edit 2)", " (edit 3)"...
export function copy_name(original_name, taken = new Set()) {
  let base = String(original_name ?? "").replace(/\.[a-z0-9]{2,4}$/i, "").trim() || "copy"
  let name = base + " (edit)"
  for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${base} (edit ${k})`
  return name
}
// nombre sin extensión (para comparar con copy_name)
export function strip_ext(name) {
  return String(name ?? "").replace(/\.[a-z0-9]{2,4}$/i, "")
}

// WAV PCM float de 32 bits (formato 3), little endian, canales intercalados: lo que sube el editor (el backend lo
// recodifica a mp3). Float para no recortar lo que pase de 0 dBFS (el editor avisa antes de guardar)
export function encode_wav(chans, sr) {
  let nch = chans.length
  let n = nch ? chans[0].length : 0
  let data_bytes = n * nch * 4
  let buf = new ArrayBuffer(44 + data_bytes)
  let v = new DataView(buf)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, "RIFF")
  v.setUint32(4, 36 + data_bytes, true)
  str(8, "WAVE")
  str(12, "fmt ")
  v.setUint32(16, 16, true)
  v.setUint16(20, 3, true) // WAVE_FORMAT_IEEE_FLOAT
  v.setUint16(22, nch, true)
  v.setUint32(24, sr, true)
  v.setUint32(28, sr * nch * 4, true)
  v.setUint16(32, nch * 4, true)
  v.setUint16(34, 32, true)
  str(36, "data")
  v.setUint32(40, data_bytes, true)
  let o = 44
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      v.setFloat32(o, chans[c][i], true)
      o += 4
    }
  }
  return buf
}
