// Preview: escuchar un archivo suelto (lista de Files, editor, catálogo, admin). Cada preview usa un
// Tone.Player propio conectado a preview_input de mixer.js; al cortarse se libera.
// Dos modos (docs/PLAN_EDITOR.md, decisiones 1 y 2; switch SYNC global, recordado en este navegador):
// - libre (sync off): velocidad original, una vez, directo a Destination (como siempre);
// - sync: a play_rate (tempo del proyecto), en loop hasta STOP; con el motor andando arranca en el próximo
//   compás (shots: con su anchor en un beat, ver shot_preroll en region.js) y suena según el modo de escucha
//   (MIX / IN CONTEXT / SOLO, ver route_preview y gate_engine en mixer.js); con el motor parado, ya.
// Un archivo del proyecto suena con su región (play_window de region.js: start/stop, nudge y fade) en los dos
// modos: lo mismo que toca el motor y que se edita en RegionEditor.vue.
import * as Tone from 'tone'
import { reactive, watch } from "vue"
import { store, audio_players, files_by_id } from "../helpers/composable"
import { file_url } from "./api"
import { vol_db, FILE_VOL_MAX_DB, preview_input, route_preview, gate_engine } from "./mixer"
import { TrackCtrl } from "./TrackCtrl"
import { shot_sync_start, preview_pos } from "./preview_sync"
import { play_window, window_length, bake_region, shot_preroll } from "./region"

// --- opciones del preview: se recuerdan por navegador (localStorage puede no estar o fallar: defaults) ---
const SYNC_KEY = "looper_preview_sync"
const MODE_KEY = "looper_preview_mode"
// modos de escucha (solo cuentan con sync y el motor andando): mix = encima de la mezcla, context = en lugar
// de lo que toca su pista (por el canal de la pista), solo = solo el preview (el motor calla, sigue andando)
export const PREVIEW_MODES = ["mix", "context", "solo"]
function read_option(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function write_option(key, v) {
  try { localStorage.setItem(key, v) } catch { /* sin localStorage: queda solo en memoria */ }
}
export const preview_opts = reactive({
  sync: read_option(SYNC_KEY) === "1",
  mode: PREVIEW_MODES.includes(read_option(MODE_KEY)) ? read_option(MODE_KEY) : "context",
})

// player del preview que suena o espera arrancar (null = nada)
let player = null
// preview en sync en curso (null = libre o nada): { file, t (arranque, s del AudioContext), engine (motor
// andando al arrancar), shot, gated (bajó eng_in de alguna pista: al soltar, el motor vuelve en el próximo compás) }
let run = null
// el preview actual lo pidió la lista o el editor (sigue al switch SYNC: cambiarlo lo vuelve a arrancar);
// false en los del catálogo y el admin, que siempre son libres
let follows_sync = false
// número del último pedido de preview (ver playUrl)
let url_request = 0
// para el cursor de WaveScreen.vue (preview_pos de preview_sync.js): arranque, punto de referencia (t0, off:
// posición en el buffer que se toca en t0), velocidad, largo de la vuelta, silencio de relleno del buffer y
// región (base = su inicio en el archivo, len = su largo)
let cur = { start: 0, t0: 0, off: 0, rate: 1, wrap: 0, pad: 0, base: 0, len: Infinity }
// invalida el apagado agendado del "armado" de un preview anterior
let arm_seq = 0
const DISPOSE_AFTER = 1 // s después del stop (que se agenda en Tone.now(), con el lookAhead) para liberar el player
const ARM_MIN = 0.05 // s: si el arranque está más lejos que el lookAhead + esto, el botón muestra "armado"

const engine_running = () => TrackCtrl.isPlaying && Tone.Transport.state == "started"
// próximo compás del transporte (con el motor andando), o ya
function next_bar() {
  return engine_running() ? Math.max(Tone.now(), Tone.Transport.nextSubdivision("1m")) : Tone.now()
}

function clear_flags(f) {
  if (f.isPreviewing) f.isPreviewing = false
  if (f.isPreviewArmed) f.isPreviewArmed = false
  if (f.isPreviewLoading) f.isPreviewLoading = false
}

// player nuevo para un preview (el anterior ya se soltó con release)
function new_player(buffer, volume) {
  let p = new Tone.Player().connect(preview_input)
  p.buffer.set(buffer)
  p.volume.value = volume
  // un preview libre que termina solo (los de sync están en loop: solo terminan con stop)
  p.onstop = () => {
    if (p !== player) return
    player = null
    clear_flags(store.curr_file)
    Tone.getContext().setTimeout(() => p.dispose(), DISPOSE_AFTER)
  }
  player = p
  return p
}

// corta el preview que suena (o espera arrancar) y deja todo como si no hubiera preview: sale otra vez
// directo y el motor de todas las pistas vuelve a sonar, en el próximo compás si anda (now = ya)
function release(now = false) {
  let p = player
  player = null
  if (p) {
    p.stop()
    Tone.getContext().setTimeout(() => p.dispose(), DISPOSE_AFTER)
  }
  arm_seq++
  clear_flags(store.curr_file)
  if (run?.gated) gate_engine(now ? Tone.now() : next_bar())
  route_preview(Tone.now())
  run = null
}

export async function playerStop() {
  // un preview por url que todavía se está descargando ya no debe arrancar
  url_request++
  release()
}

// preview de un archivo del proyecto (buffer ya cargado), según el switch SYNC (lista y editor). free = siempre
// libre (catálogo y admin)
export async function playFile(file, free = false) {
  url_request++
  release()
  store.curr_file = file
  let volume = vol_db(file.props.volume, FILE_VOL_MAX_DB)
  let w = play_window(file)
  if (preview_opts.sync && !free) start_sync(file, audio_players[file.id].buffer, volume, w)
  else start_free(audio_players[file.id].buffer, volume, w)
  follows_sync = !free
  file.isPreviewing = true
}

// libre: velocidad original, una vez, directo a Destination (el tiempo es el mismo que usaría start() sin
// argumento, Tone.now(); se anota para el cursor). w = región del archivo (play_window; null = entero)
function start_free(buffer, volume, w = null) {
  let p = new_player(buffer, volume)
  let t = Tone.now()
  route_preview(t)
  let offset = w?.offset ?? 0
  cur = { start: t, t0: t, off: 0, rate: 1, wrap: 0, pad: 0, base: offset, len: w?.duration ?? Infinity }
  if (w) {
    p.fadeIn = w.fade
    p.fadeOut = w.fade
  }
  p.start(t, offset, w?.duration ?? undefined)
}

// sync: a play_rate y en loop. Con el motor andando arranca en el próximo compás (loops) o beat (shots) y se
// enruta según preview_opts.mode; con el motor parado, ya y directo. Se toca en loop una copia de la región
// con el fade ya aplicado (region_buffer; en loop el player no aplicaría el fade en cada vuelta).
// w = región del archivo (play_window)
function start_sync(file, tone_buffer, volume, w) {
  let engine = engine_running()
  let now = Tone.now()
  let buf = tone_buffer.get()
  let shot = file.kind == "shot"
  let p, t, offset = 0
  if (shot) {
    // a velocidad original (como en el motor), repetido cada los beats que ocupa la región: el buffer lleva
    // relleno de silencio antes del shot (para que su anchor caiga en un beat) y después, hasta un largo entero
    // en beats. pre = el pre-roll del motor (anchor efectivo − inicio de la región)
    let dur = window_length(w, buf.duration)
    let spb = 60 / (engine ? Tone.Transport.bpm.value : TrackCtrl.tempo)
    let first = engine ? Math.max(now, Tone.Transport.nextSubdivision("4n")) : now
    let s = shot_sync_start({ now, first, spb, dur, pre: shot_preroll(file) ?? 0, engine })
    p = new_player(region_buffer(buf, { from: w.offset, len: dur, fade: w.fade, at: s.pad, total: s.period }), volume)
    p.loop = true
    t = s.time
    offset = s.offset
    cur = { start: t, t0: t, off: offset, rate: 1, wrap: s.period, pad: s.pad, base: w.offset, len: dur }
  } else {
    // la vuelta dura la tirada (w.period: los beats de la región, o los del archivo, × 60 / bpm): en el
    // transporte ocupa exactamente play_beats y no se desfasa de la grilla (sin el sobrante del mp3; si la
    // región es más corta, el resto es silencio; más larga, se corta). Sin datos de tempo, lo que queda del buffer
    let rate = file.play_rate || 1
    let rest = window_length(w, buf.duration)
    let wrap = w.period > 0 ? w.period : rest
    let len = Math.min(rest, wrap)
    p = new_player(region_buffer(buf, { from: w.offset, len, fade: w.fade, total: wrap }), volume)
    p.loop = true
    p.playbackRate = rate
    t = engine ? next_bar() : now
    cur = { start: t, t0: t, off: 0, rate, wrap, pad: 0, base: w.offset, len }
  }
  run = { file, t, engine, shot, gated: false }
  route_run(t)
  p.start(t, offset)
  // esperando el compás (o el beat): el botón de play titila hasta que arranca
  if (t - now > ARM_MIN) {
    file.isPreviewArmed = true
    let seq = ++arm_seq
    Tone.getContext().setTimeout(() => {
      if (seq === arm_seq) file.isPreviewArmed = false
    }, t - Tone.getContext().currentTime)
  }
}

// ruteo de un preview en sync desde `time`: con el motor parado, directo (el modo no cuenta); andando, según
// el modo: MIX directo y el motor entero; IN CONTEXT por el canal de su pista, que calla lo del motor (sin
// pista o sin canal → como MIX); SOLO directo y el motor callado
function route_run(time) {
  if (!run.engine) {
    route_preview(time)
    return
  }
  let mode = preview_opts.mode
  let ctx = route_preview(time, mode == "context" ? run.file.track_group : null)
  let muted = mode == "solo" ? "all" : ctx
  gate_engine(time, muted)
  run.gated = muted != null
}

// AudioBuffer con la copia de una región del archivo `src` (opciones de bake_region en region.js: from, len,
// fade, at = silencio antes, total = largo del buffer)
function region_buffer(src, opts) {
  let chans = []
  for (let c = 0; c < src.numberOfChannels; c++) chans.push(src.getChannelData(c))
  let data = bake_region(chans, src.sampleRate, opts)
  let out = Tone.getContext().createBuffer(data.length, data[0].length, src.sampleRate)
  data.forEach((d, c) => out.getChannelData(c).set(d))
  return out
}

// preview de un archivo que no está cargado en el proyecto (diálogo de importar): se descarga y
// decodifica solo ese archivo. Únicamente se guarda el buffer del último (el anterior queda para el
// recolector), así escuchar el catálogo no acumula memoria. Si mientras se descarga se pide otro
// preview o STOP, este ya no arranca. Mientras carga: file.isPreviewLoading = true. Siempre libre
const PREVIEW_VOLUME = -6 // dB, el volumen por defecto de un archivo en un proyecto
export async function playUrl(file, url) {
  let req = ++url_request
  release()
  store.curr_file = file
  store.curr_file.isPreviewLoading = true
  let buffer
  try {
    buffer = await new Tone.ToneAudioBuffer().load(url)
  } catch (e) {
    console.log("Error cargando el preview", url, e)
    if (req === url_request) store.curr_file.isPreviewLoading = false
    throw e
  }
  if (req !== url_request) return // se pidió otro preview o STOP mientras cargaba
  store.curr_file.isPreviewLoading = false
  start_free(buffer, PREVIEW_VOLUME)
  follows_sync = false
  store.curr_file.isPreviewing = true
}

// --- preview desde la UI (Files, catálogo, admin). Leen store.curr_file, así que son reactivas
// usadas en un template ---
// el archivo con ese id es el que suena en el preview (o, en sync, espera su arranque)
export function previewing(id) {
  return store.curr_file.isPreviewing == true && store.curr_file.id == id
}
// el preview de ese archivo está armado: en sync, esperando el próximo compás (o beat)
export function preview_armed(id) {
  return store.curr_file.isPreviewArmed == true && store.curr_file.id == id
}
// el archivo con ese id se está descargando para el preview
export function preview_loading(id) {
  return store.curr_file.isPreviewLoading == true && store.curr_file.id == id
}
// posición del preview dentro del archivo (segundos del buffer original) o null si no suena, todavía no
// arrancó (armado, o el lookAhead de Tone.now()) o está en el silencio de relleno de un shot en sync. No es
// reactiva: la lee el cursor de WaveScreen.vue en cada frame, mientras previewing() dice que suena
export function preview_position() {
  if (!store.curr_file.isPreviewing || !player) return null
  return preview_pos(cur, Tone.getContext().currentTime)
}
// play o stop de un archivo ({ id, original_name }): si está cargado en el proyecto se usa su
// buffer; si no, se descarga solo ese archivo. Siempre libre (catálogo y admin). Si falla la carga, tira el error
export async function toggle_preview(file) {
  if (previewing(file.id) || preview_loading(file.id)) return playerStop()
  let loaded = files_by_id[file.id]
  if (loaded?.isLoaded && audio_players[file.id]) await playFile(loaded, true)
  else await playUrl(file, file_url(file.id))
}
// corta el preview si es de un archivo que no está cargado en el proyecto (al cerrar un diálogo)
export function stop_foreign_preview() {
  let cf = store.curr_file
  if (cf.isPreviewLoading || (cf.isPreviewing && !files_by_id[cf.id])) playerStop()
}

// --- switch SYNC y modo de escucha (editor y cabecera de Files; atajos Q y M en el editor) ---
// cambiar SYNC con un preview de la lista o del editor sonando (o armado) lo vuelve a arrancar en el modo nuevo
export function set_preview_sync(on) {
  preview_opts.sync = !!on
  write_option(SYNC_KEY, on ? "1" : "0")
  let f = store.curr_file
  if (f.isPreviewing && follows_sync && files_by_id[f.id]?.isLoaded && audio_players[f.id]) playFile(f)
}
export function toggle_preview_sync() {
  set_preview_sync(!preview_opts.sync)
}
// cambiar el modo con un preview en sync sonando (motor andando) lo reenruta en el momento (o en su
// arranque, si está armado): lo que se había callado vuelve ya
export function set_preview_mode(mode) {
  if (!PREVIEW_MODES.includes(mode)) return
  preview_opts.mode = mode
  write_option(MODE_KEY, mode)
  if (run?.engine && player) route_run(Math.max(Tone.now(), run.t))
}
export function cycle_preview_mode() {
  let i = PREVIEW_MODES.indexOf(preview_opts.mode)
  set_preview_mode(PREVIEW_MODES[(i + 1) % PREVIEW_MODES.length])
}

// corta un preview en sync (RESET del motor, desmontar Tracks.vue); now = el motor vuelve ya, no en el
// próximo compás. Un preview libre sigue
export function stop_sync_preview(now = false) {
  if (run) release(now)
}

// START o STOP del motor: un preview en sync se corta (con el motor parado arrancó fuera de la grilla; con
// el motor andando su arranque y su ruteo dependían de él) y ninguna pista queda callada
watch(() => TrackCtrl.isPlaying, () => {
  if (run) release(true)
  gate_engine(Tone.now())
})
// al cambiar de proyecto se corta cualquier preview
watch(() => store.project?.id, () => playerStop())
// tempo nuevo (knob Tempo al soltarlo, calculate_timing): un loop en sync sigue al play_rate nuevo, como los
// players del motor (apply_rates; ambos se aplican en Tone.now()). El cursor se reancla para no saltar
watch(() => store.curr_file?.play_rate, (rate) => {
  if (!run || run.shot || !player || run.file !== store.curr_file || !(rate > 0)) return
  let now = Tone.now()
  if (now > cur.t0) {
    cur.off += (now - cur.t0) * cur.rate
    cur.t0 = now
  }
  cur.rate = rate
  player.playbackRate = rate
})
