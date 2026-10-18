// Sesión de edición destructiva del editor (docs/PLAN_EDITOR.md, fase 6; decisión 9): un solo archivo a la vez (el
// del editor abierto). Guarda la selección, la pila de operaciones con UNDO/REDO y el buffer de trabajo (lo que
// muestran la pantalla y las lupas y toca el preview mientras haya cambios). Nada se sube hasta SAVE AS COPY /
// SAVE REGION AS COPY (EditOps.vue). Las operaciones puras están en edit_ops.js.
//
// Memoria: un buffer de 60 s estéreo ocupa ~21 MB en float. No se guarda una foto por paso: la pila es la lista de
// operaciones (objetos chicos) y el buffer de trabajo se recalcula desde la base al deshacer (rehacer y cada
// operación nueva se aplican sobre el buffer actual). La base es el buffer original (sin copiar) mientras la
// pila tenga hasta UNDO_MAX pasos; pasado eso, la operación más vieja se pliega en la base (deja de poder
// deshacerse). El buffer de trabajo es un AudioBuffer y sus canales se leen de él (no hay otra copia). Así hay
// como mucho dos buffers extra (base plegada y trabajo, ~42 MB con 60 s estéreo) más los temporales de una
// operación (que el recolector libera).
// La lista completa (también lo plegado) queda para llevar la región y el anchor del proyecto al buffer de trabajo.
// STRETCH (fase 7) es la excepción: su render (Signalsmith, asíncrono, en el Worker de stretch_queue.js) se guarda en la
// operación (op.out) para poder rehacerla y repetirla al deshacer sin volver a calcular: un buffer extra por STRETCH en
// la pila (se suelta al plegarla o al descartar el REDO). Mientras calcula, la sesión queda ocupada (edit.busy).
// La base sale del buffer original del archivo (source_buffer), no del que toca el motor (que puede estar transpuesto):
// el transpose no se hornea en la copia, pasa como prop.
import { reactive, markRaw } from "vue"
import * as Tone from "tone"
import { ElMessageBox } from "element-plus"
import { source_buffer } from "./composable"
import { TrackCtrl, file_timing } from "./TrackCtrl"
import { apply_op, apply_ops, op_length, clamp_range, work_file_of, map_pos, EDGE_RAMP, SEAM_XFADE } from "./edit_ops"
import { file_bpm } from "./region"
import { stretch_rate, stretch_length, stretch_bpm_range } from "./transpose"
import { render_chans } from "./stretch_queue"

export const UNDO_MAX = 64
// largo máximo del buffer de trabajo (s): el de las regiones (la copia igual no puede pasar de 1 minuto)
export const WORK_MAX_SECS = 120

// estado reactivo: archivo de la sesión, pasos que se pueden deshacer / rehacer, cambios sin guardar, selección
// ({ start, stop } en s del buffer de trabajo, o null), versión del buffer de trabajo (sube con cada cambio) y busy
// (un STRETCH calculando: no se aceptan otras operaciones)
export const edit = reactive({ file_id: null, undo_n: 0, redo_n: 0, dirty: false, sel: null, version: 0, busy: false })

// no reactivo (buffers grandes)
let base = null // canales del punto de partida de la pila (los originales del archivo, o con las operaciones plegadas)
let sr = 0
let ops = [] // todas las operaciones aplicadas (las primeras base_n ya están en base)
let base_n = 0
let redo_ops = []
let work = null // { buffer: AudioBuffer, chans: sus canales (getChannelData) } = resultado actual; null sin cambios
let gen = 0 // sube al descartar la sesión: un STRETCH que termina después ya no se aplica

function reset() {
  gen++
  base = null
  sr = 0
  ops = []
  base_n = 0
  redo_ops = []
  work = null
  Object.assign(edit, { undo_n: 0, redo_n: 0, dirty: false, sel: null, busy: false })
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

// canales del buffer original del archivo (sin copiar) y su sample rate, o null
function player_chans(id) {
  let buf = source_buffer(id)
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
  if (edit.busy) return false
  let d = current_duration(edit.file_id)
  if (!(d > 0)) return false
  let sel = edit.sel
  if (type == "cut") return !!sel && sel.stop - sel.start < d - 1e-3
  if (type == "silence") return !!sel
  if (type == "duplicate") return d + (sel ? sel.stop - sel.start : d) <= WORK_MAX_SECS
  return true
}

// base de la pila (al primer cambio): los canales originales del archivo. false si no está cargado
function ensure_base(id) {
  if (base) return true
  let p = player_chans(id)
  if (!p) return false
  base = p.chans
  sr = p.sr
  return true
}
// apila una operación ya aplicada (chans = el resultado)
function push_op(op, chans) {
  ops.push(op)
  redo_ops = []
  // pila llena: la operación más vieja se pliega en la base (ya no se deshace; el render de un STRETCH queda solo en
  // la base)
  if (ops.length - base_n > UNDO_MAX) {
    let old = ops[base_n]
    base = apply_op(base, old)
    if (old.type == "stretch") old.out = null
    base_n++
  }
  set_work(chans)
}

// aplica una operación ("cut" | "silence" | "duplicate" | "reverse" | "gain") sobre la selección (o todo el buffer,
// ver can_do). opts.db = dB de gain. Devuelve true si se aplicó
export function edit_do(type, opts = {}) {
  let id = edit.file_id
  if (!id || !can_do(type)) return false
  if (!ensure_base(id)) return false
  let cur = work ? work.chans : base
  let n = cur[0].length
  let r = edit.sel ? clamp_range(edit.sel.start * sr, edit.sel.stop * sr, n) : { a: 0, b: n }
  if (!r) return false
  let op = { type, a: r.a, b: r.b }
  if (type == "gain") op.db = Number(opts.db) || 0
  if (type == "silence" || type == "gain") op.ramp = Math.round(EDGE_RAMP * sr)
  if (type == "cut" || type == "duplicate" || type == "reverse") op.xfade = Math.round(SEAM_XFADE * sr)
  if (op_length(n, op) < 1) return false
  let chans = apply_op(cur, op)
  // selección después: CUT la quita; DUPLICATE pasa a la repetición (Ctrl+D otra vez la sigue repitiendo)
  if (type == "cut") edit.sel = null
  else if (type == "duplicate" && edit.sel) {
    let len = edit.sel.stop - edit.sel.start
    edit.sel = { start: map_pos(r.b, op) / sr - len, stop: map_pos(r.b, op) / sr }
  }
  push_op(op, chans)
  return true
}

// --- STRETCH (fase 7): el buffer entero a otro tempo sin cambiar el tono ---
// ¿se puede llevar el archivo de la sesión (file, del store) a bpm_to? { ok, reason?, bpm (el de ahora), rate, range }.
// Solo loops con tempo; dentro de stretch_bpm_range y del largo máximo de trabajo
export function stretch_check(file, bpm_to) {
  void edit.version
  if (!file || file.id !== edit.file_id) return { ok: false, reason: "no_session" }
  if (file.kind == "shot") return { ok: false, reason: "shot" }
  let bpm = file_bpm(work_file(file) ?? file)
  let range = stretch_bpm_range(bpm)
  if (!range) return { ok: false, reason: "no_tempo" }
  let rate = stretch_rate(bpm, bpm_to)
  let out = { bpm, rate, range }
  if (edit.busy) return { ...out, ok: false, reason: "busy" }
  if (!(bpm_to >= range.min && bpm_to <= range.max)) return { ...out, ok: false, reason: "range" }
  if (Math.abs(rate - 1) < 1e-4) return { ...out, ok: false, reason: "same" }
  let d = current_duration(file.id)
  if (!(d > 0)) return { ...out, ok: false, reason: "no_audio" }
  if (d / rate > WORK_MAX_SECS) return { ...out, ok: false, reason: "long" }
  return { ...out, ok: true }
}
// aplica el STRETCH (asíncrono: el render va al Worker). Devuelve true si se aplicó; false si no se podía, o si
// mientras calculaba se cerró la sesión o se pasó a otro archivo. Si el render falla, tira el error
export async function edit_stretch(file, bpm_to) {
  let chk = stretch_check(file, bpm_to)
  let id = edit.file_id
  if (!chk.ok || !ensure_base(id)) return false
  let cur = work ? work.chans : base
  let n = cur[0].length
  let token = gen
  edit.busy = true
  try {
    let out = await render_chans(cur, sr, { rate: chk.rate }, { urgent: true, wanted: () => token === gen })
    if (!out || token !== gen) return false
    if (out[0].length !== stretch_length(n, chk.rate)) throw new Error("STRETCH: largo inesperado")
    let op = { type: "stretch", a: 0, b: n, rate: chk.rate, out }
    // la selección se escala con el audio
    if (edit.sel) edit.sel = { start: map_pos(edit.sel.start * sr, op) / sr, stop: map_pos(edit.sel.stop * sr, op) / sr }
    push_op(op, apply_op(cur, op))
    return true
  } finally {
    if (token === gen) edit.busy = false
  }
}

export function edit_undo() {
  if (edit.busy || ops.length <= base_n) return false
  redo_ops.push(ops.pop())
  // sin nada aplicado (ni plegado) vuelve al buffer original
  set_work(ops.length == 0 ? null : apply_ops(base, ops.slice(base_n)))
  return true
}
export function edit_redo() {
  if (edit.busy || !redo_ops.length || !base) return false
  let op = redo_ops.pop()
  let cur = work ? work.chans : base
  ops.push(op)
  set_work(apply_op(cur, op))
  return true
}
