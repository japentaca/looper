// Motor: FX de transición de las pistas loop (trg.props.fx). Se movió tal cual desde Tracks.vue: lo
// llama set_next_step en cada beat (fx_step después de loop_step) y loop_step / oneshot_step al fin de
// una tirada (end_run). Lo que vive en Tracks.vue (regla de corte por Tag y dado de descanso) se
// recibe con bind_fx al montar el componente.
import * as Tone from "tone"
import { TrackCtrl } from "./TrackCtrl"
import { lead_beats } from "./fx"
import { fx_schedule, fx_reset } from "./mixer"

const current_TAG = TrackCtrl.current_TAG

// de Tracks.vue (ver bind_fx)
let tag_cuts, NO_TAG_ID, roll_rest
export function bind_fx(ctx) {
  ({ tag_cuts, NO_TAG_ID, roll_rest } = ctx)
}

// --- FX de transición (trg.props.fx, ver helpers/fx.js y mixer.js) ---

// beats que faltan hasta el fin de la tirada, contando el beat actual: 1 = este es el último beat de
// lo que suena (el siguiente arranca otra cosa). Se llama después de loop_step (y de que set_next_step
// descontó current_TAG.remaining_beats). Es el mínimo entre el fin natural y el corte por Tag; by_tag =
// el fin es el corte por Tag (si los dos caen en el mismo beat cuenta como corte: ahí también cambia el Tag)
function beats_to_end(track) {
  let natural = natural_end_beats(track)
  let tag_cut = tag_cut_beats(track)
  return { left: Math.min(natural, tag_cut), by_tag: tag_cut <= natural }
}

// fin natural: en el último beat de la última repetición da 1
function natural_end_beats(track) {
  let play_beats = Math.max(1, track.curr_file.play_beats)
  return track.repeats_left * play_beats + track.remaining_beats + 1
}

// fin por corte de Tag: beats hasta el cambio si el cambio va a cortar el archivo (misma regla que
// set_next_step, con el Tag preseleccionado), si no Infinity. El corte ocurre en el beat que empieza
// con current_TAG.remaining_beats == 1, y acá ya está descontado el del beat actual: faltan
// exactamente current_TAG.remaining_beats beats. Ejemplo, Tag de 4 beats que empieza en el beat 10:
// start_tag deja 5; en el 10 se descuenta a 4, en el 11 a 3, en el 12 a 2, en el 13 a 1; en el 14 se
// ve 1 antes de descontar y se corta en su `time`. En el 10 da 4 (10, 11, 12, 13) y en el 13 da 1
// (último beat que suena), igual que un loop de 4 beats arrancado en el 10: remaining_beats 3 → 3 + 1 = 4
function tag_cut_beats(track) {
  if (!tag_cuts(track.curr_file, current_TAG.tag?.id ?? NO_TAG_ID, current_TAG.next_tag)) return Infinity
  return Math.max(1, current_TAG.remaining_beats)
}

// ¿se cumple la condición de la instancia para el fin de esta tirada? by_tag = el fin es un corte por Tag
function fx_cond_ok(track, inst, by_tag) {
  if (inst.cond == "rest") {
    // el dado de descanso se sortea ahora y se guarda: loop_step lo usa en el fin
    if (track.next_rest == null) track.next_rest = roll_rest(track)
    return track.next_rest
  }
  // "tag" = el fin de esta tirada es un corte por cambio de Tag (si el natural llega antes, no)
  if (inst.cond == "tag") return by_tag
  return true
}

// en cada beat de una tirada: cada instancia se evalúa una sola vez por tirada, en el primer beat en que
// su anticipación (en beats) alcanza a los beats que faltan (>= y no ==: una tirada más corta que la
// anticipación dispara igual, recortada). Si pasa prob y cond, se agenda de `time` al fin
export function fx_step(track, time) {
  let list = track.track_group.props?.fx
  if (!Array.isArray(list) || !list.length) return
  let { left, by_tag } = beats_to_end(track)
  let bpb = parseInt(TrackCtrl.beats_x_bar)
  for (const inst of list) {
    if (!inst?.id || track.fx_fired.includes(inst.id)) continue
    if (lead_beats(inst.lead, bpb) < left) continue
    track.fx_fired.push(inst.id)
    if (by_tag) track.fx_tag_end = true
    if (!(Math.random() < (inst.prob ?? 1))) continue
    if (!fx_cond_ok(track, inst, by_tag)) continue
    // segundos por beat con el tempo actual (un cambio de tempo en medio de la rampa se tolera)
    let end = time + left * 60 / Tone.Transport.bpm.value
    fx_schedule(track.track_group.id, inst, time, end)
    let id = inst.id
    // se chequea fx_fired al dibujar: un RESET entre el callback (hasta ~0,1 s antes) y el beat ya
    // limpió el estado y el chip quedaría encendido hasta el próximo fin con FX
    Tone.Draw.schedule(() => {
      if (TrackCtrl.isPlaying && track.fx_fired.includes(id) && !track.fx_active.includes(id)) track.fx_active.push(id)
    }, time)
  }
}

// fin de una tirada (en el beat donde arranca otro archivo, empieza un descanso, la corta el cambio de
// Tag o la pista pasa a one-shot): si algo se evaluó, los FX vuelven a la base exactamente en `time`. Se limpia el estado
export function end_run(track, time) {
  fx_back_to_base(track, time)
  track.next_rest = null
}

// FX de la pista a la base en `time` (si algo se evaluó) y sin instancias evaluadas
export function fx_back_to_base(track, time) {
  if (track.fx_fired.length) {
    fx_reset(track.track_group.id, time)
    Tone.Draw.schedule(() => { track.fx_active = [] }, time)
  }
  track.fx_fired = []
  track.fx_tag_end = false
}

// STOP y RESET (los nodos los lleva a la base fx_reset_all)
export function clear_fx_state(track) {
  track.fx_fired = []
  track.fx_active = []
  track.next_rest = null
  track.fx_tag_end = false
}
