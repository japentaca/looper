// Mixer de las pistas: un canal por track group (Tone.Channel, con volumen, mute y solo) y su vúmetro.
// Los players de los archivos del grupo se enrutan al canal en vez de ir directo a la salida.
// Además hay un vúmetro estéreo en la salida master. Los Meter solo analizan: no cambian el audio.
// El volumen, mute y solo de cada pista viven en trg.props (se guardan con save_trackGroups).
// Efectos por pista: player → Filter (lowpass) → Channel, y un send post-fader del canal a una reverb
// compartida. Con props.drift > 0 una caminata al azar lenta mueve el filtro y el send (start_drift).
import * as Tone from "tone"
import { reactive, watch } from "vue"
import { store, audio_players, files_by_id, save_trackGroups_debounced } from "./composable"
import { TrackCtrl } from "./TrackCtrl"

const FLOOR_DB = -48 // nivel que queda en 0 (abajo de esto el medidor está apagado)
const PEAK_HOLD_MS = 800 // cuánto se queda quieto el LED de pico antes de caer
const PEAK_FALL = 0.015 // caída del pico por frame (en escala 0..1)

const FILTER_OPEN_HZ = 20000 // filtro "abierto": no colorea (con Q 0 y -12 dB/oct)
const FILTER_MIN_HZ = 300 // hasta dónde puede cerrar el drift con drift = 1
const REV_OFF_DB = -40 // en el knob Rev: este valor (o menos) = sin reverb (props.reverb = null)
const DRIFT_SEND_DB = 9 // con drift = 1 el send oscila ± estos dB alrededor de props.reverb
const DRIFT_STEP = 0.2 // tamaño máximo del paso de la caminata al azar (en escala 0..1) por compás

// trg id -> { channel, meter, filter, send, walk }. walk = estado de la caminata al azar del drift:
// f 0..1 (0 = filtro abierto, 1 = lo más cerrado que permite drift) y s 0..1 (0.5 = send base)
const channels_by_trg = {}
// player -> track group al que está enrutado (WeakMap: si se recargan los audios, los players nuevos arrancan sin enrutar)
const trg_of_player = new WeakMap()
// limitador en el master para que la salida no clipee aunque coincidan varios loops fuertes.
// chain() solo rearma input → limiter → output de Destination: lo que entra (canales, preview) sigue igual.
const master_limiter = new Tone.Limiter(-1)
Tone.getDestination().chain(master_limiter)
// el vúmetro master cuelga del output de Destination, o sea que mide después del limitador
const master_meter = new Tone.Meter({ channels: 2, smoothing: 0.8 })
Tone.getDestination().connect(master_meter)
// reverb compartida (una sola para todas las pistas). wet = 1: solo devuelve la cola; la señal seca
// va por el canal. Va a Destination, así pasa por el limitador. Cada canal le manda un send propio.
const reverb = new Tone.Reverb({ decay: 6, wet: 1 }).toDestination()

function new_level() {
  return { level: 0, peak: 0, peak_time: 0 }
}

// niveles 0..1 para los LedMeter: levels.trgs[trg_id] y levels.master[0|1] (L/R)
export const levels = reactive({ trgs: {}, master: [new_level(), new_level()] })

// props de la pista (track group); {} si no existe. Se busca en store.track_groups (y no en el índice)
// para no depender de que rebuildIndexes() ya haya corrido, y para que sea reactivo.
function trg_props(trg) {
  return store.track_groups.find(t => t.id === trg)?.props ?? {}
}

// ganancia lineal del send según props.reverb (dB; null = sin reverb) y la caminata del drift
function send_gain(p, walk) {
  if (p.reverb == null) return 0
  let db = p.reverb + (walk.s * 2 - 1) * DRIFT_SEND_DB * (p.drift ?? 0)
  return Tone.dbToGain(Math.min(0, db))
}
// frecuencia del filtro según la caminata del drift (escala logarítmica entre abierto y FILTER_MIN_HZ)
function filter_freq(p, walk) {
  return FILTER_OPEN_HZ * Math.pow(FILTER_MIN_HZ / FILTER_OPEN_HZ, walk.f * (p.drift ?? 0))
}

function get_strip(trg) {
  if (!channels_by_trg[trg]) {
    let p = trg_props(trg)
    // channelCount 2: si no, Tone.Channel pasa el audio a mono
    let channel = new Tone.Channel({
      channelCount: 2, volume: p.volume ?? 0, mute: !!p.mute, solo: !!p.solo
    }).toDestination()
    // filtro de la pista (los players entran acá). Tone.Filter es Gain → BiquadFilter → Gain nativos,
    // que ya son estéreo (a diferencia del Panner del Channel). Abierto a 20 kHz con Q 0 no colorea.
    let filter = new Tone.Filter({ type: "lowpass", frequency: FILTER_OPEN_HZ, Q: 0, rolloff: -12 })
    filter.connect(channel)
    let walk = { f: 0, s: 0.5 }
    // send a la reverb, tomado de la salida del canal: post-fader, post-mute y post-solo
    // (una pista muteada o callada por otro solo no manda reverb). Ganancia lineal, 0 = nada.
    let send = new Tone.Gain(send_gain(p, walk))
    channel.connect(send)
    send.connect(reverb)
    // vúmetro post-mute: muestra lo que realmente se escucha de la pista
    let meter = new Tone.Meter({ smoothing: 0.8 })
    channel.connect(meter)
    channels_by_trg[trg] = { channel, meter, filter, send, walk }
    levels.trgs[trg] = new_level()
  }
  return channels_by_trg[trg]
}

function get_channel(trg) {
  return get_strip(trg).channel
}

function remove_channel(trg) {
  let ch = channels_by_trg[trg]
  if (!ch) return
  ch.channel.solo = false // así los demás canales dejan de quedar callados por este solo
  ch.filter.dispose()
  ch.send.dispose()
  ch.channel.dispose()
  ch.meter.dispose()
  delete channels_by_trg[trg]
  delete levels.trgs[trg]
}

// un canal por cada track group: se crean al cargar (con lo guardado en props) o al agregar un pad,
// y se eliminan al borrarlo. Así el solo de una pista sin archivos sonando ya calla a las demás.
watch(() => store.track_groups.map(t => t.id).join(","), () => {
  let ids = store.track_groups.map(t => t.id)
  for (const trg of Object.keys(channels_by_trg)) {
    if (!ids.includes(trg)) remove_channel(trg)
  }
  for (const trg of ids) get_channel(trg)
}, { immediate: true })

// enruta el player del archivo al filtro (y de ahí al canal) de su track group (una sola vez; si el archivo cambió
// de grupo se pasa al canal nuevo)
export function route_player(file_id) {
  let trg = files_by_id[file_id]?.track_group
  let player = audio_players[file_id]
  if (!trg || !player || trg_of_player.get(player) === trg) return
  player.disconnect() // sale de Destination (o del canal anterior)
  player.connect(get_strip(trg).filter)
  trg_of_player.set(player, trg)
}

export function toggle_mute(trg) {
  let p = trg_props(trg)
  p.mute = !p.mute
  get_channel(trg).mute = p.mute
  save_trackGroups_debounced()
}

export function toggle_solo(trg) {
  let p = trg_props(trg)
  p.solo = !p.solo
  get_channel(trg).solo = p.solo
  save_trackGroups_debounced()
}

// volumen de la pista en dB (se llama mientras se mueve el fader; el guardado es diferido)
export function set_volume(trg, db) {
  let p = trg_props(trg)
  p.volume = db
  get_channel(trg).volume.value = db
  save_trackGroups_debounced()
}

// nivel del send a la reverb en dB (null = sin reverb). Se aplica ya (rampa corta, sin clics);
// si hay drift, la caminata sigue alrededor del valor nuevo.
export function set_reverb(trg, db) {
  let p = trg_props(trg)
  p.reverb = db == null || db <= REV_OFF_DB ? null : db
  let ch = get_strip(trg)
  ch.send.gain.rampTo(send_gain(p, ch.walk), 0.05)
  save_trackGroups_debounced()
}
export { REV_OFF_DB }

// cantidad de modulación lenta 0..1. En 0 la pista vuelve a sus valores base (filtro abierto, send =
// props.reverb): ya si el transporte está detenido, o en el próximo compás si está corriendo.
export function set_drift(trg, v) {
  let p = trg_props(trg)
  p.drift = v
  if (!v) {
    let ch = get_strip(trg)
    ch.walk.f = 0
    ch.walk.s = 0.5
    if (!drift_loop) apply_base(ch, p, 0.5)
  }
  save_trackGroups_debounced()
}

function apply_base(ch, p, ramp) {
  ch.filter.frequency.rampTo(FILTER_OPEN_HZ, ramp)
  ch.send.gain.rampTo(send_gain(p, ch.walk), ramp)
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

// --- drift: un solo Tone.Loop (para todas las pistas) que corre con el transporte ---
let drift_loop = null

// cada compás, en el `time` del callback, da un paso de la caminata al azar en cada pista con drift
// y agenda una rampa de un compás hacia el valor nuevo (cambios suaves, sin saltos)
function drift_step(time) {
  for (const trg of Object.keys(channels_by_trg)) {
    let ch = channels_by_trg[trg]
    let p = trg_props(trg)
    if (p.drift > 0) {
      ch.walk.f = clamp01(ch.walk.f + (Math.random() * 2 - 1) * DRIFT_STEP)
      ch.walk.s = clamp01(ch.walk.s + (Math.random() * 2 - 1) * DRIFT_STEP)
    }
    // con drift 0 walk quedó en la base (set_drift): la rampa la lleva a filtro abierto / send base
    ch.filter.frequency.rampTo(filter_freq(p, ch.walk), "1m", time)
    ch.send.gain.rampTo(send_gain(p, ch.walk), "1m", time)
  }
}

// se llama en START, antes de Tone.Transport.start(): el loop arranca en el tiempo 0 del transporte
export function start_drift() {
  stop_drift()
  drift_loop = new Tone.Loop(drift_step, "1m").start(0)
}

// se llama en STOP: elimina el loop (no quedan eventos agendados en el transporte) y lleva todas
// las pistas a la base con una rampa corta. La caminata se reinicia en la próxima corrida.
export function stop_drift() {
  if (!drift_loop) return
  drift_loop.dispose()
  drift_loop = null
  for (const trg of Object.keys(channels_by_trg)) {
    let ch = channels_by_trg[trg]
    ch.walk.f = 0
    ch.walk.s = 0.5
    apply_base(ch, trg_props(trg), 0.5)
  }
}

// true si la pista no se escucha: está en mute u otra pista está en solo
export function is_silenced(trg) {
  if (trg_props(trg).mute) return true
  return !trg_props(trg).solo && store.track_groups.some(t => t.props?.solo)
}

function db_to_level(db) {
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB))
}

// devuelve true si el medidor todavía muestra algo (para saber cuándo apagar el loop)
function update(l, db, now) {
  l.level = db_to_level(db)
  if (l.level >= l.peak) {
    l.peak = l.level
    l.peak_time = now
  } else if (now - l.peak_time > PEAK_HOLD_MS) {
    l.peak = Math.max(l.level, l.peak - PEAK_FALL)
  }
  return l.level > 0 || l.peak > 0
}

let active = false
let raf = null

function frame(now) {
  let showing = false
  for (const trg of Object.keys(channels_by_trg)) {
    showing = update(levels.trgs[trg], channels_by_trg[trg].meter.getValue(), now) || showing
  }
  let master = master_meter.getValue()
  showing = update(levels.master[0], master[0], now) || showing
  showing = update(levels.master[1], master[1], now) || showing
  // al detenerse se sigue midiendo hasta que los medidores caen solos a cero
  raf = active || showing ? requestAnimationFrame(frame) : null
}

// el loop de animación corre solo mientras algo suena (transporte o preview)
watch(() => TrackCtrl.isPlaying || store.curr_file?.isPreviewing == true, (v) => {
  active = v
  if (v && raf === null) raf = requestAnimationFrame(frame)
})
