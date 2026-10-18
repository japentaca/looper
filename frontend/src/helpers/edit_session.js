// Sesión de edición destructiva del editor (docs/PLAN_EDITOR.md, fase 6; decisión 9): un solo archivo a la vez (el
// del editor abierto). Guarda la selección, la pila de operaciones con UNDO/REDO y el buffer de trabajo (lo que
// muestran la pantalla y las lupas y toca el preview mientras haya cambios). Nada se sube hasta SAVE AS COPY /
// SAVE REGION AS COPY (EditOps.vue). Las operaciones puras están en edit_ops.js.
//
// Memoria: un buffer de 60 s estéreo ocupa ~21 MB en float. No se guarda una foto por paso: la pila es la lista de
// operaciones (objetos chicos) y el buffer de trabajo se recalcula desde la base al deshacer (rehacer y cada
// operación nueva se aplican sobre el buffer actual). La base es el buffer del player (sin copiar) mientras la
// pila tenga hasta UNDO_MAX pasos; pasado eso, la operación más vieja se pliega en la base (deja de poder
// deshacerse). El buffer de trabajo es un AudioBuffer y sus canales se leen de él (no hay otra copia). Así hay
// como mucho dos buffers extra (base plegada y trabajo, ~42 MB con 60 s estéreo) más los temporales de una
// operación (que el recolector libera).
// La lista completa (también lo plegado) queda para llevar la región y el anchor del proyecto al buffer de trabajo.
import { reactive, markRaw } from "vue"
import * as Tone from "tone"
import { ElMessageBox } from "element-plus"
import { audio_players } from "./composable"
import { TrackCtrl, file_timing } from "./TrackCtrl"
import { apply_op, apply_ops, op_length, clamp_range, work_file_of, map_pos, EDGE_RAMP } from "./edit_ops"

export const UNDO_MAX = 64
// largo máximo del buffer de trabajo (s): el de las regiones (la copia igual no puede pasar de 1 minuto)
export const WORK_MAX_SECS = 120

// estado reactivo: archivo de la sesión, pasos que se pueden deshacer / rehacer, cambios sin guardar, selección
// ({ start, stop } en s del buffer de trabajo, o null) y versión del buffer de trabajo (sube con cada cambio)
export const edit = reactive({ file_id: null, undo_n: 0, redo_n: 0, dirty: false, sel: null, version: 0 })

// no reactivo (buffers grandes)
let base = null // canales del punto de partida de la pila (los del player, o con las operaciones plegadas)
let sr = 0
let ops = [] // todas las operaciones aplicadas (las primeras base_n ya están en base)
let base_n = 0
let redo_ops = []
let work = null // { buffer: AudioBuffer, chans: sus canales (getChannelData) } = resultado actual; null sin cambios

function reset() {
  base = null
  sr = 0
  ops = []
  base_n = 0
  redo_ops = []
  work = null
  Object.assign(edit, { undo_n: 0, redo_n: 0, dirty: false, sel: null })
  edit.version++
}

// abre la sesión de un archivo (al abrir el editor o pasar a otro): si es otro, descarta todo
export function edit_open(file_id) {
  if (edit.file_id === file_id) return
  reset()
  edit.file_id = file_id
}
// cierra la sesión (al cerrar el editor): descarta los cambios
export function edit_close() {
  reset()
  edit.file_id = null
}

// pregunta antes de descartar cambios sin guardar (cerrar el editor, pasar a otro archivo). true = seguir
export async function confirm_discard() {
  if (!edit.dirty) return true
  try {
    await ElMessageBox.confirm("The destructive edits of this file are not saved (SAVE AS COPY). Discard them?",
      "Unsaved edits", { confirmButtonText: "Discard", cancelButtonText: "Keep editing", type: "warning" })
    return true
  } catch {
    return false
  }
}

// canales del buffer cargado del archivo (sin copiar) y su sample rate, o null
function player_chans(id) {
  let tb = audio_players[id]?.buffer
  let buf = tb?.loaded ? tb.get() : null
  if (!buf) return null
  let chans = []
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c))
  return { chans, sr: buf.sampleRate }
}

// canales actuales del archivo de la sesión: los de trabajo si hay cambios, si no los del player. null sin audio
export function current_chans(id) {
  void edit.version
  if (id !== edit.file_id) return null
  if (work) return { chans: work.chans, sr }
  return player_chans(id)
}
// AudioBuffer de trabajo del archivo (solo con cambios sin guardar; si no, null: se usa el del player)
export function work_buffer(id) {
  void edit.version
  return id === edit.file_id && work ? work.buffer : null
}
// largo actual (s) del archivo de la sesión
export function current_duration(id) {
  let c = current_chans(id)
  return c ? c.chans[0].length / c.sr : 0
}

// archivo "virtual" con el buffer de trabajo (duración, región y anchor del proyecto llevados a ese buffer, y el
// tempo del motor: play_rate, play_beats, in_tempo); null sin cambios (se usa el archivo tal cual). Lo usan el
// preview (toneLib.js), la pantalla y la región (RegionEditor.vue) y el plan de la copia
export function work_file(file) {
  void edit.version
  if (!file || file.id !== edit.file_id || !work) return null
  let v = work_file_of(file, ops, sr, work.chans[0].length / sr)
  return Object.assign(v, file_timing(v, TrackCtrl.tempo, TrackCtrl.tempo_tol))
}

function to_buffer(chans) {
  let buf = Tone.getContext().createBuffer(chans.length, Math.max(1, chans[0].length), sr)
  chans.forEach((c, i) => buf.getChannelData(i).set(c))
  return markRaw(buf)
}
function set_work(chans) {
  if (chans) {
    // los canales calculados se copian al AudioBuffer y se sueltan: se trabaja sobre los del buffer
    let buffer = to_buffer(chans)
    work = { buffer, chans: chans.map((_, c) => buffer.getChannelData(c)) }
  } else work = null
  edit.dirty = !!work
  edit.undo_n = ops.length - base_n
  edit.redo_n = redo_ops.length
  // la selección queda dentro del buffer nuevo
  let d = work ? work.chans[0].length / sr : current_duration(edit.file_id)
  if (edit.sel && edit.sel.start >= d) edit.sel = null
  else if (edit.sel && edit.sel.stop > d) edit.sel = { start: edit.sel.start, stop: d }
  edit.version++
}

export function set_selection(sel) {
  edit.sel = sel && sel.stop - sel.start > 0 ? { start: sel.start, stop: sel.stop } : null
}

// qué operaciones se pueden hacer ahora (para habilitar los botones): con selección, todas (CUT no si la
// selección es el buffer entero); sin selección, REVERSE, GAIN y DUPLICATE sobre todo el buffer
export function can_do(type) {
  void edit.version
  let d = current_duration(edit.file_id)
  if (!(d > 0)) return false
  let sel = edit.sel
  if (type == "cut") return !!sel && sel.stop - sel.start < d - 1e-3
  if (type == "silence") return !!sel
  if (type == "duplicate") return d + (sel ? sel.stop - sel.start : d) <= WORK_MAX_SECS
  return true
}

// aplica una operación ("cut" | "silence" | "duplicate" | "reverse" | "gain") sobre la selección (o todo el buffer,
// ver can_do). opts.db = dB de gain. Devuelve true si se aplicó
export function edit_do(type, opts = {}) {
  let id = edit.file_id
  if (!id || !can_do(type)) return false
  if (!base) {
    let p = player_chans(id)
    if (!p) return false
    base = p.chans
    sr = p.sr
  }
  let cur = work ? work.chans : base
  let n = cur[0].length
  let r = edit.sel ? clamp_range(edit.sel.start * sr, edit.sel.stop * sr, n) : { a: 0, b: n }
  if (!r) return false
  let op = { type, a: r.a, b: r.b }
  if (type == "gain") op.db = Number(opts.db) || 0
  if (type == "silence" || type == "gain") op.ramp = Math.round(EDGE_RAMP * sr)
  if (op_length(n, op) < 1) return false
  let chans = apply_op(cur, op)
  ops.push(op)
  redo_ops = []
  // pila llena: la operación más vieja se pliega en la base (ya no se deshace)
  if (ops.length - base_n > UNDO_MAX) {
    base = apply_op(base, ops[base_n])
    base_n++
  }
  // selección después: CUT la quita; DUPLICATE pasa a la repetición (Ctrl+D otra vez la sigue repitiendo)
  if (type == "cut") edit.sel = null
  else if (type == "duplicate" && edit.sel) {
    let len = edit.sel.stop - edit.sel.start
    edit.sel = { start: map_pos(r.b, op) / sr - len, stop: map_pos(r.b, op) / sr }
  }
  set_work(chans)
  return true
}

export function edit_undo() {
  if (ops.length <= base_n) return false
  redo_ops.push(ops.pop())
  // sin nada aplicado (ni plegado) vuelve al buffer del player
  set_work(ops.length == 0 ? null : apply_ops(base, ops.slice(base_n)))
  return true
}
export function edit_redo() {
  if (!redo_ops.length || !base) return false
  let op = redo_ops.pop()
  let cur = work ? work.chans : base
  ops.push(op)
  set_work(apply_op(cur, op))
  return true
}
