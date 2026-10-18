// Motor: pistas one-shot (props.mode == "oneshot"). Se movió tal cual desde Tracks.vue: set_next_step
// llama oneshot_step en cada beat; stop() y reset() cancelan los disparos con pre-roll agendados. Lo que vive en
// Tracks.vue (arranque y corte de archivos, candidatos al sorteo y su peso) se recibe con bind_oneshot
// al montar el componente.
// Anchor (fase 4 del editor, docs/PLAN_EDITOR.md decisión 7): cada shot tiene un punto que cae en el beat
// (shot_anchor de region.js: project_files.props.anchor o, sin dato, el default del catálogo files.anchor =
// inicio o fin de la región). Pre-roll = (anchor − inicio de la región) / play_rate (shot_preroll): con 0 o
// chico (menos de PREROLL_ON_BEAT, preroll_path "beat") se dispara con la lógica del beat (oneshot_step, los
// "start" de siempre) arrancando pre-roll antes; con más se agenda por adelantado (preroll_step, que
// generaliza a los "end": un "end" es el caso anchor = stop, pre-roll = largo de la región).
import * as Tone from "tone"
import { TrackCtrl } from "./TrackCtrl"
import { audio_players, files_by_id, pick_weighted } from "./composable"
import { end_run } from "./engine_fx"
import { play_window, window_length, shot_preroll, preroll_path } from "./region"

const current_TAG = TrackCtrl.current_TAG
const tracks = TrackCtrl.tracks

// de Tracks.vue (ver bind_oneshot)
let start_file, stop_file, draw_candidates, file_weight
export function bind_oneshot(ctx) {
  ({ start_file, stop_file, draw_candidates, file_weight } = ctx)
}

// cada cuántos compases se tira el dado de density (valores de SHOT_BARS; default 1 = cada compás)
export const SHOT_BARS = [1, 2, 4, 8, 16, 32, 64]
export function shot_bars(trg) {
  let b = trg?.props?.bars
  return SHOT_BARS.includes(b) ? b : 1
}

// negra de la frase (0 = la primera) en la que cae un disparo de density: con probabilidad props.scatter
// (0..1, default 0) una al azar entre las `bars × beats_x_bar` de la frase (puede volver a salir la
// primera); si no, la primera. Con scatter 1 el reparto es parejo
function shot_offset(trg) {
  let scatter = trg.props?.scatter ?? 0
  if (!(Math.random() < scatter)) return 0
  return Math.floor(Math.random() * parseInt(TrackCtrl.beats_x_bar) * shot_bars(trg))
}

// paso de una pista one-shot: dispara si empieza un Tag (on_tag_change) o si en el primer downbeat de
// cada frase de props.bars compases (contados desde el inicio del transporte, como los loops) sale el
// dado de density; en ese caso cae en la negra de la frase que elige shot_offset (si no es la primera,
// queda en track.pending_shot = número de beat absoluto y dispara al llegar ahí). Si el Tag cambió en
// este beat, available_files_per_TRG ya es la del Tag nuevo (el archivo se sortea al disparar).
export function oneshot_step(track, time, n, tag_start, downbeat) {
  let p = track.track_group.props ?? {}
  // si la pista venía de modo loop, su loop se corta en este beat y deja de contar (fin de la tirada)
  end_run(track, time)
  if (track.curr_file) stop_file(track.curr_file.id, time)
  track.curr_file = null
  track.remaining_beats = 0
  track.resting = false

  // los archivos con pre-roll largo se deciden por adelantado (preroll_step); acá los de pre-roll 0 o chico
  preroll_step(track, time, n)

  let phrase_start = downbeat && Math.round(n / parseInt(TrackCtrl.beats_x_bar)) % shot_bars(track.track_group) == 0
  let fire = p.on_tag_change && tag_start
  if (phrase_start) {
    // un pendiente de la frase anterior que no llegó (se achicó bars a mitad de frase) se descarta
    track.pending_shot = null
    if (Math.random() < (p.density ?? 0)) {
      let k = shot_offset(track.track_group)
      if (k == 0) fire = true
      else track.pending_shot = n + k
    }
  }
  if (track.pending_shot == n) {
    track.pending_shot = null
    fire = true
  }
  if (!fire) return
  let files = draw_candidates(track).filter(id => preroll_path(preroll(id)) == "beat")
  if (!files.length) return
  let f = pick_weighted(files, file_weight)
  // si ese mismo player ya está sonando (un disparo anterior), se saltea: no se reinicia
  if (audio_players[f]?.state == "started") return
  // suena entero (o su región, ver start_file): no se le agenda stop. Arranca pre-roll antes (0 o menos de
  // PREROLL_ON_BEAT, dentro del margen con que se agenda el beat) para que su anchor caiga en el beat
  start_file(f, time - preroll(f), () => show_shot(track, f))
}

// nombre del último disparo en la tira y destello de su LED (se llama con Tone.Draw, al sonar)
function show_shot(track, f) {
  track.last_shot = files_by_id[f]
  track.shot_n = (track.shot_n ?? 0) + 1
}

// duración efectiva de un disparo en segundos: lo que suena del buffer (composable.js deja su duración en
// files_by_id[id].duration al cargar el audio; con región, el largo de la región: play_window de region.js)
// al playbackRate con que suena; 0 = sin dato. Con el pre-roll da cuándo deja de sonar un disparo agendado
function shot_length(id) {
  let f = files_by_id[id]
  let d = Number(f?.duration)
  return d > 0 ? window_length(play_window(f), d) / (f.play_rate || 1) : 0
}
// pre-roll de un disparo en segundos (shot_preroll de region.js): lo que suena antes de que su anchor caiga en
// el punto. 0 o chico = se dispara con la lógica del beat (oneshot_step); desde PREROLL_ON_BEAT = se agenda por
// adelantado (preroll_step); null = sin dato (no participa en ninguno de los dos, como antes un "end" sin
// duración). Ver preroll_path de region.js
function preroll(id) {
  let f = files_by_id[id]
  return f ? shot_preroll(f) : null
}

// disparos con pre-roll agendados ({ id, start, end, tag }: segundos del AudioContext; end = cuando deja de
// sonar, que en un "end" es el punto; tag = apunta a un cambio de Tag): para no volver a arrancar un archivo
// que sigue sonando o espera su turno, y para cancelarlos en STOP / RESET. Los nombres "end_shots" quedaron de
// cuando solo los "end" se agendaban por adelantado
let end_shots = []
// START: arranca sin disparos agendados (antes start() hacía end_shots = [])
export function forget_end_shots() {
  end_shots = []
}

// disparos con pre-roll largo (desde PREROLL_ON_BEAT; anchor después del inicio de la región; un "end" = anchor
// en el fin: riser, crash invertido): el anchor cae en el punto de disparo, así que el archivo arranca antes y se decide por
// adelantado. Puntos (cada uno por su lado; si caen en el mismo beat son uno solo y manda el de Tag): el
// próximo cambio de Tag (con on_tag_change, siempre dispara) y el inicio de la próxima frase de `bars`
// compases (con density > 0, tira el dado). Cada punto se decide una vez (track.end_points: { at: número de
// beat absoluto, tag }), en el primer beat en que hasta el punto falta menos que el pre-roll más largo + 1 beat
// (el último en que todavía entra), o en el último beat antes del punto. Se sortea con peso entre los de
// pre-roll de la pista compatibles con el Tag que suena y cuyo pre-roll entra. Con el tempo de ahora: si el
// tempo cambia después, el anchor ya no cae justo en el punto
function preroll_step(track, time, n) {
  let p = track.track_group.props ?? {}
  let files = draw_candidates(track).filter(id => preroll_path(preroll(id)) == "ahead")
  if (!files.length) return
  let spb = 60 / Tone.Transport.bpm.value
  let phrase = parseInt(TrackCtrl.beats_x_bar) * shot_bars(track.track_group)
  // beats desde este beat hasta cada punto. El cambio de Tag ocurre en el beat que empieza con
  // current_TAG.remaining_beats == 1 y acá ya está descontado el de este beat (ver tag_cut_beats)
  let points = []
  if (p.on_tag_change) points.push({ b: current_TAG.remaining_beats, always: true })
  if (p.density > 0) points.push({ b: phrase - n % phrase, always: false })
  let longest = Math.max(...files.map(preroll))
  track.end_points = track.end_points.filter(e => e.at > n)
  for (const { b, always } of points) {
    let at = n + b
    if (!(b >= 1) || track.end_points.some(e => e.at == at)) continue
    if (b > 1 && b * spb >= longest + spb) continue // todavía hay tiempo
    track.end_points.push({ at, tag: always })
    if (!always && !(Math.random() < p.density)) continue
    let point_time = time + b * spb
    let f = pick_weighted(files.filter(id => preroll(id) <= b * spb), file_weight)
    if (!f) continue // no entra ninguno (justo tras START, Tag corto, tempo lento)
    let start = point_time - preroll(f)
    // deja de sonar en el punto (un "end") o después (anchor intermedio)
    let end = Math.max(point_time, start + shot_length(f))
    // si ese mismo player está sonando o tiene un disparo agendado que todavía suena en `start`, se saltea
    let now = Tone.getContext().currentTime
    end_shots = end_shots.filter(s => s.end > now)
    if (audio_players[f]?.state == "started" || end_shots.some(s => s.id == f && s.end > start)) continue
    start_file(f, start, () => show_shot(track, f))
    end_shots.push({ id: f, start, end, tag: always })
  }
}

// STOP: corta todos los disparos con pre-roll agendados, hayan arrancado o no (Player.stop(ahora) también
// cancela un start agendado a futuro)
export function cancel_end_shots() {
  let ctx_now = Tone.getContext().currentTime
  for (const s of end_shots) {
    if (s.end > ctx_now && files_by_id[s.id]) stop_file(s.id, -1)
  }
  end_shots = []
}
// RESET: el cambio de Tag hacia el que apuntaban ya no ocurre. Se cancelan los disparos con pre-roll de Tag que
// todavía no arrancaron (los que arrancan dentro del lookahead ya no se pueden cortar antes de empezar:
// siguen, igual que los que ya suenan) y se olvidan los puntos de Tag decididos, para que el nuevo cambio
// (y una frase que caía en el mismo beat) se decidan otra vez. Los de frase siguen valiendo
export function cancel_tag_end_shots() {
  let now = Tone.now() // un stop se agenda como mucho a partir de acá
  let cancel = end_shots.filter(s => s.tag && s.start > now)
  // se corta en su propio inicio (no ya): Player.stop corta todas las fuentes del player, y un disparo
  // con pre-roll anterior del mismo archivo (de frase, que no se cancela) puede estar sonando todavía
  for (const s of cancel) if (files_by_id[s.id]) stop_file(s.id, s.start)
  end_shots = end_shots.filter(s => !cancel.includes(s))
  for (const track of tracks) track.end_points = track.end_points.filter(e => !e.tag)
}
