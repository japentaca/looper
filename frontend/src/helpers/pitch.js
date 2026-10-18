// Transpose y KEY LOCK de los archivos del proyecto (docs/PLAN_EDITOR.md, fase 7; decisión 5): pre-render en memoria.
// Por cada archivo con transpose efectivo ≠ 0 (effective_transpose de transpose.js: transpose, menos el resample del
// motor con KEY LOCK) se calcula offline, en el Worker de Signalsmith (stretch_queue.js), un buffer con ese cambio de
// tono y la misma duración, y el player del motor pasa a tocarlo (set_play_buffer de composable.js). El original no
// se toca: lo siguen leyendo la pantalla de onda, la región, las ediciones destructivas y los renders.
// - Cuándo: después de cada calculate_timing (carga del proyecto con los buffers ya bajados, alta de una copia, knob
//   Tempo al soltarlo, Tol, compás, región, beats): se vuelven a mirar todos y solo se calcula lo que cambió (con
//   KEY LOCK, los que cambiaron de play_rate). Y al soltar TRANSPOSE o tocar KEY LOCK en el editor (urgente).
// - Mientras tanto: el motor toca lo que tenía (el original, o el transpuesto anterior); la carga no espera.
// - Memoria: un buffer extra por archivo transpuesto (el último calculado; al cambiar el transpose se reemplaza).
//   Como los archivos no cambian de contenido, el cache es por id: una recarga del proyecto (otra subida) no
//   vuelve a calcular.
// - Preview (preview_buffer): en sync toca el buffer del motor; libre (sin resample) con KEY LOCK necesita otro, sin la
//   compensación; con ediciones destructivas sin guardar, el buffer de trabajo transpuesto. Esos se calculan al
//   pedirlos (uno por buffer de origen) y, cuando llegan, on_pitch_ready avisa (toneLib.js vuelve a arrancar el preview).
import { reactive, watch } from "vue"
import { ElMessage } from "element-plus"
import { store, audio_players, files_by_id, source_buffer, set_play_buffer } from "./composable"
import { TrackCtrl } from "./TrackCtrl"
import { render_buffer } from "./stretch_queue"
import { effective_transpose } from "./transpose"
import { work_buffer, work_file } from "./edit_session"

// renders en curso por archivo (id → cantidad), para el "RENDERING…" del editor
export const pitch_state = reactive({ rendering: {} })
export function is_rendering(id) {
  return (pitch_state.rendering[id] ?? 0) > 0
}
function mark(id, d) {
  let n = (pitch_state.rendering[id] ?? 0) + d
  if (n > 0) pitch_state.rendering[id] = n
  else delete pitch_state.rendering[id]
}

let ready_cb = null
// fn(id) se llama cada vez que termina un render de ese archivo (motor o preview)
export function on_pitch_ready(fn) {
  ready_cb = fn
}

let error_shown = false
function render_failed(e) {
  console.log("Error calculando el transpose", e)
  if (error_shown) return
  error_shown = true
  ElMessage({ type: "warning", message: "Transpose could not be rendered in this browser: the original is played" })
}

// --- buffer del motor ---
const engine = new Map() // id → { semis, buffer } listo (el que toca el player)
const wanted = new Map() // id → semis que se está calculando

// transpose efectivo que tiene que tocar el motor para el archivo
export function engine_semis(file) {
  return effective_transpose(file)
}

// pone en el player del archivo el buffer de su transpose efectivo (o el original); si no está calculado, lo pide
// y mientras tanto queda lo que tenía. urgent = desde el editor (pasa adelante de la cola)
export function sync_file_pitch(file, urgent = false) {
  let id = file?.id
  if (!id || !audio_players[id] || !file.isLoaded || file.loadError) return
  let semis = engine_semis(file)
  if (semis === 0) {
    engine.delete(id)
    wanted.delete(id)
    set_play_buffer(id, null)
    return
  }
  let have = engine.get(id)
  if (have?.semis === semis) {
    wanted.delete(id)
    set_play_buffer(id, have.buffer)
    return
  }
  if (wanted.get(id) === semis) return
  let src = source_buffer(id)
  if (!src) return
  wanted.set(id, semis)
  mark(id, 1)
  const still = () => wanted.get(id) === semis && !!files_by_id[id]
  render_buffer(src, { semitones: semis }, { wanted: still, urgent })
    .then(buf => {
      if (!buf || !still()) return
      wanted.delete(id)
      engine.set(id, { semis, buffer: buf })
      set_play_buffer(id, buf)
      ready_cb?.(id)
    })
    .catch(e => {
      if (wanted.get(id) === semis) wanted.delete(id)
      render_failed(e)
    })
    .finally(() => mark(id, -1))
}

// todos los archivos del proyecto; se olvidan los que ya no están
export function sync_all_pitch() {
  for (const id of [...engine.keys(), ...wanted.keys()]) {
    if (!files_by_id[id]) {
      engine.delete(id)
      wanted.delete(id)
    }
  }
  for (const f of store.files) sync_file_pitch(f)
}
// cada calculate_timing reemplaza TrackCtrl.timing_basis (carga, alta de archivos, tempo, Tol, región...) y los ids
// cambian al agregar o quitar archivos
watch([() => TrackCtrl.timing_basis, () => store.files.map(f => f.id).join(",")], () => sync_all_pitch())

// --- buffer del preview ---
// transpuesto de buffers que no son el del motor (preview libre con KEY LOCK, buffer de trabajo): uno por origen
const extra = new WeakMap() // AudioBuffer de origen → { semis, buffer (null mientras se calcula) }
function extra_pitched(id, src, semis) {
  let e = extra.get(src)
  if (e?.semis === semis) return e.buffer
  e = { semis, buffer: null }
  extra.set(src, e)
  mark(id, 1)
  render_buffer(src, { semitones: semis }, { wanted: () => extra.get(src) === e, urgent: true })
    .then(buf => {
      if (!buf || extra.get(src) !== e) return
      e.buffer = buf
      ready_cb?.(id)
    })
    .catch(render_failed)
    .finally(() => mark(id, -1))
  return null
}

// AudioBuffer que toca el preview de un archivo del proyecto (null si no está cargado). free = libre, a velocidad
// original (sin la compensación de KEY LOCK). Si el transpuesto todavía no está, el de origen sin transponer (o el
// transpuesto anterior del motor) y se pide; al llegar avisa on_pitch_ready
export function preview_buffer(file, free) {
  let id = file.id
  let wb = work_buffer(id)
  let vf = wb ? work_file(file) ?? file : file
  let semis = effective_transpose(vf, { free })
  if (!wb) {
    let p = audio_players[id]
    if (!p?.buffer?.loaded) return null
    // el del motor sirve si es el mismo transpose (siempre en sync; en libre, sin KEY LOCK)
    if (semis === engine_semis(file)) {
      if (semis !== 0 && engine.get(id)?.semis !== semis) sync_file_pitch(file, true)
      return p.buffer.get()
    }
  }
  let src = wb ?? source_buffer(id)
  if (!src || semis === 0) return src
  return extra_pitched(id, src, semis) ?? src
}
