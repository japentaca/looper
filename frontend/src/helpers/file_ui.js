// helpers de un archivo compartidos por la lista (Files.vue) y el editor (FileEditor.vue): tempo, tags,
// anclaje y preview. Sin estado propio
import { toggle_file_tag, save_file, file_anchor } from "./composable"
import { TrackCtrl } from "./TrackCtrl"
import * as toneLib from "./toneLib"
import { shot_anchor } from "./region"
import { key_display, rate_semitones, parse_key_lock } from "./transpose"

// archivo no disponible (oculto por el admin o dueño bloqueado): queda en el proyecto pero el motor
// no lo sortea. Se muestra atenuado (cartucho y fila de la tabla).
const unavailable_title = "Unavailable: hidden by an admin or its owner is blocked. It is not played."

// --- tempo (ver file_timing en TrackCtrl.js) ---
// loop que habría que correr más que la tolerancia del proyecto: tampoco se sortea
export function out_of_tempo(file) {
  return file.kind != "shot" && file.in_tempo === false
}
export function not_drawable_title(file) {
  if (file.available === false) return unavailable_title
  if (out_of_tempo(file)) {
    // timing_basis y no tempo / tempo_tol: esos cambian en vivo mientras se arrastra el knob (ver TrackCtrl.js)
    let { tempo, tol } = TrackCtrl.timing_basis
    return `Out of tempo: at ${fmt_bpm(file.bpm)} BPM it is more than ±${tol}% away from `
      + `${tempo} BPM (also at half or double time). It is not played.`
  }
  return undefined
}
export function fmt_bpm(bpm) {
  let n = Number(bpm)
  return n > 0 ? String(Math.round(n * 10) / 10) : "–"
}

export async function toggleTag(file, id) {
  toggle_file_tag(file, id)
  await save_file(file)
}

// --- tonalidad efectiva en el proyecto (fase 7; key_display de transpose.js) ---
// { text, mark, transposed, title }: music_key + transpose redondeado al semitono, con la marca del transpose. En un
// loop sin KEY LOCK el title aclara cuánto agrega el resample del motor
export function key_view(file) {
  let resample = file.kind != "shot" && !parse_key_lock(file.props?.key_lock) ? rate_semitones(file.play_rate) : 0
  return key_display(file.music_key, file.props?.transpose, resample)
}

// --- anclaje de los disparos one-shot (ver file_anchor en composable.js) ---
export const ANCHOR_TEXT = {
  start: "Start: the file starts at the trigger point",
  end: "End: the file ends at the trigger point (riser, reverse crash)",
}
// margen para decidir si un anchor del proyecto cae en un borde de la región (s)
const ANCHOR_EDGE_EPS = 0.001
// anchor efectivo de un archivo para la lista (cartucho y tabla): null si es "start" (lo normal, no se marca);
// si no { key ("end" | "point", para ordenar), text (pre-roll en s si es un punto intermedio), title }. Un shot
// usa el anchor del proyecto (props.anchor, recortado a la región: shot_anchor de region.js) si tiene; si no,
// y en los loops, el del catálogo (files.anchor)
export function list_anchor(file) {
  let a = file.kind == "shot" && file.props?.anchor != null ? shot_anchor(file) : null
  if (!a || a.saved == null) {
    return file_anchor(file) == "end" ? { key: "end", text: "end", title: "Catalog anchor. " + ANCHOR_TEXT.end } : null
  }
  if (a.stop != null && Math.abs(a.at - a.stop) < ANCHOR_EDGE_EPS) {
    return { key: "end", text: "end", title: "Project anchor. " + ANCHOR_TEXT.end }
  }
  let pre = a.at - a.start
  if (pre < ANCHOR_EDGE_EPS) return null
  return {
    key: "point", text: pre.toFixed(2) + " s",
    title: `Project anchor: the point ${pre.toFixed(3)} s after the start of the region falls on the trigger point`
  }
}

// el archivo es el que está sonando en el preview (o, en sync, espera su arranque)
export function is_previewing(file) {
  return toneLib.previewing(file.id)
}
// preview en sync armado: espera el próximo compás (o beat) del motor
export function is_armed(file) {
  return toneLib.preview_armed(file.id)
}

// el botón de preview es play o stop según si ese archivo ya suena en el preview
// (lo que suena en el motor no se corta desde acá)
export function togglePreview(file) {
  if (is_previewing(file)) toneLib.playerStop()
  else toneLib.playFile(file)
}

export function preview_title(file) {
  if (is_armed(file)) return "Armed: starts on the next bar (beat for a shot). Click to cancel"
  return is_previewing(file) ? "Stop preview" : "Preview"
}

// --- switch SYNC del preview (toneLib.preview_opts; docs/PLAN_EDITOR.md, decisiones 1 y 2) ---
export function sync_title() {
  return toneLib.preview_opts.sync
    ? "Sync on: preview at the project tempo, looped until stop; with the engine running it starts on the next bar"
    : "Sync off: preview at the original speed, once"
}
