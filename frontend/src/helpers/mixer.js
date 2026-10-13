// Mixer de las pistas: un canal por track group (Tone.Channel, con volumen, mute y solo) y su vúmetro.
// Los players de los archivos del grupo se enrutan al canal en vez de ir directo a la salida.
// Además hay un vúmetro estéreo en la salida master. Los Meter solo analizan: no cambian el audio.
// El volumen y los efectos de cada pista viven en trg.props (se guardan con save_trackGroups); mute y solo, en memoria (mixer).
// Efectos por pista: player → Filter (lowpass) → Channel, y un send post-fader del canal a una reverb
// compartida. Con props.drift > 0 una caminata al azar lenta mueve el filtro y el send (start_drift).
// Delay global sincronizado al tempo (config en TrackCtrl.delay) con un send post-fader por pista.
import * as Tone from "tone"
import { reactive, watch } from "vue"
import { store, audio_players, files_by_id, save_trackGroups_debounced } from "./composable"
import { TrackCtrl, DELAY_DIVISIONS, DELAY_FEEDBACK_MAX } from "./TrackCtrl"

const FLOOR_DB = -48 // nivel que queda en 0 (abajo de esto el medidor está apagado)
const PEAK_HOLD_MS = 800 // cuánto se queda quieto el LED de pico antes de caer
const PEAK_FALL = 0.015 // caída del pico por frame (en escala 0..1)

const FILTER_OPEN_HZ = 20000 // filtro "abierto": no colorea (con Q 0 y -12 dB/oct)
const FILTER_MIN_HZ = 300 // hasta dónde puede cerrar el drift con drift = 1
const REV_OFF_DB = -40 // en el knob Rev: este valor (o menos) = sin reverb (props.reverb = null)
const DRIFT_SEND_DB = 9 // con drift = 1 el send oscila ± estos dB alrededor de props.reverb
const DRIFT_STEP = 0.2 // tamaño máximo del paso de la caminata al azar (en escala 0..1) por compás
const DLY_OFF_DB = REV_OFF_DB // en el knob Dly: mismo rango y mismo "off" que Rev (props.delay = null)
const DELAY_MAX_S = 6 // tiempo máximo del delay (con tempos muy lentos y divisiones largas se recorta)
const DELAY_TIME_RAMP = 0.1 // rampa al cambiar el tempo o la división (s): evita clics, las colas se "estiran"
const DELAY_FADE = 0.3 // fundido de salida del delay anterior al cambiar de tipo (s)
const TAPE_LOWPASS_HZ = 2000 // filtro dentro del lazo del delay "tape": cada repetición pasa una vez más

// trg id -> { channel, meter, filter, send, dly_send, walk }. walk = estado de la caminata al azar del drift:
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

// --- delay global (uno solo, como la reverb) ---
// sends de las pistas → delay_in → delay activo → fade → delay_out (nivel de retorno) → Destination
// (pasa por el limitador). Solo devuelve las repeticiones (wet = 1). Hay un único delay armado (el del
// tipo elegido): al cambiar de tipo se arma el nuevo y el anterior se apaga con un fundido corto y se
// libera, así nunca quedan procesando delays que no se escuchan. No va a la reverb y el drift no lo modula.
const delay_in = new Tone.Gain()
const delay_out = new Tone.Volume(TrackCtrl.delay.level).toDestination()
let delay_fx = null

// tiempo del delay en segundos según la división y TrackCtrl.tempo (el transporte toma ese mismo
// valor al soltar el knob Tempo). Se calcula a mano y no con Tone.Time("8n"), que usa el bpm del
// transporte en ese momento.
function delay_seconds(factor = 1) {
  let beats = DELAY_DIVISIONS[TrackCtrl.delay.division] ?? DELAY_DIVISIONS["8n."]
  return Math.min(DELAY_MAX_S, beats * factor * 60 / TrackCtrl.tempo)
}
function delay_feedback() {
  return Math.min(DELAY_FEEDBACK_MAX, Math.max(0, TrackCtrl.delay.feedback ?? 0))
}

// arma el delay del tipo pedido y lo conecta entre delay_in y delay_out.
// Devuelve { input, fade, times: [[param, factor]], feedbacks: [param], nodes }
function make_delay(type) {
  let fade = new Tone.Gain(1).connect(delay_out)
  let fb = delay_feedback()
  let fx = { fade, times: [], feedbacks: [], nodes: [fade] }
  if (type == "stereo") {
    let d = new Tone.FeedbackDelay({ delayTime: delay_seconds(), feedback: fb, maxDelay: DELAY_MAX_S, wet: 1 })
    d.connect(fade)
    fx.input = d
    fx.times.push([d.delayTime, 1])
    fx.feedbacks.push(d.feedback)
    fx.nodes.push(d)
  } else if (type == "dotted") {
    // L con la división, R con 1.5 × la división (con puntillo): un delay mono por canal
    let split = new Tone.Split(2)
    let merge = new Tone.Merge(2).connect(fade)
    let opts = { feedback: fb, maxDelay: DELAY_MAX_S, wet: 1 }
    let l = new Tone.FeedbackDelay({ ...opts, delayTime: delay_seconds() })
    let r = new Tone.FeedbackDelay({ ...opts, delayTime: delay_seconds(1.5) })
    split.connect(l, 0, 0)
    split.connect(r, 1, 0)
    l.connect(merge, 0, 0)
    r.connect(merge, 0, 1)
    fx.input = split
    fx.times.push([l.delayTime, 1], [r.delayTime, 1.5])
    fx.feedbacks.push(l.feedback, r.feedback)
    fx.nodes.push(split, merge, l, r)
  } else if (type == "tape") {
    // lazo armado a mano: entrada → Delay → lowpass → salida, y lowpass → feedback → Delay. Cada
    // repetición pasa otra vez por el filtro (más oscura). El filtro es de un polo (ganancia ≤ 1 en
    // todas las frecuencias, sin resonancia) y el feedback llega a 0.9: la ganancia del lazo es < 1.
    let input = new Tone.Gain()
    let d = new Tone.Delay({ delayTime: delay_seconds(), maxDelay: DELAY_MAX_S })
    let lp = new Tone.OnePoleFilter({ frequency: TAPE_LOWPASS_HZ, type: "lowpass" })
    let feedback = new Tone.Gain(fb)
    input.connect(d)
    d.connect(lp)
    lp.connect(fade)
    lp.connect(feedback)
    feedback.connect(d)
    fx.input = input
    fx.times.push([d.delayTime, 1])
    fx.feedbacks.push(feedback.gain)
    fx.nodes.push(input, d, lp, feedback)
  } else {
    // pingpong (default): las repeticiones alternan entre L y R
    let d = new Tone.PingPongDelay({ delayTime: delay_seconds(), feedback: fb, maxDelay: DELAY_MAX_S, wet: 1 })
    d.connect(fade)
    fx.input = d
    fx.times.push([d.delayTime, 1])
    fx.feedbacks.push(d.feedback)
    fx.nodes.push(d)
  }
  delay_in.connect(fx.input)
  return fx
}

// cambia el tipo de delay. Las repeticiones que venían sonando en el anterior se cortan con un fundido
// de DELAY_FADE (no pasan al tipo nuevo). La liberación se agenda con el reloj del contexto de Tone.
function build_delay() {
  let old = delay_fx
  delay_fx = make_delay(TrackCtrl.delay.type)
  if (!old) return
  delay_in.disconnect(old.input)
  old.fade.gain.rampTo(0, DELAY_FADE)
  Tone.getContext().setTimeout(() => old.nodes.forEach(n => n.dispose()), DELAY_FADE + 0.1)
}
build_delay()
watch(() => TrackCtrl.delay.type, build_delay)
// tempo o división: se recalcula el tiempo en segundos (también mientras se mueve el knob Tempo)
watch(() => [TrackCtrl.tempo, TrackCtrl.delay.division], () => {
  for (const [param, factor] of delay_fx.times) param.rampTo(delay_seconds(factor), DELAY_TIME_RAMP)
})
watch(() => TrackCtrl.delay.feedback, () => {
  for (const param of delay_fx.feedbacks) param.rampTo(delay_feedback(), 0.05)
})
watch(() => TrackCtrl.delay.level, (db) => delay_out.volume.rampTo(db, 0.05))

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
// ganancia lineal del send al delay según props.delay (dB; null = sin delay). El drift no lo toca.
function dly_send_gain(p) {
  return p.delay == null ? 0 : Tone.dbToGain(Math.min(0, p.delay))
}
// frecuencia del filtro según la caminata del drift (escala logarítmica entre abierto y FILTER_MIN_HZ)
function filter_freq(p, walk) {
  return FILTER_OPEN_HZ * Math.pow(FILTER_MIN_HZ / FILTER_OPEN_HZ, walk.f * (p.drift ?? 0))
}

// mute / solo por pista: solo en memoria (no se guardan, a propósito: un solo o un mute olvidado
// dejaría muda la instalación al recargar). Viven acá y no en los tracks (que se rearman en cada START).
// Varias pistas pueden estar en solo a la vez.
export const mixer = reactive({ mute: {}, solo: {} })

function get_strip(trg) {
  if (!channels_by_trg[trg]) {
    let p = trg_props(trg)
    // channelCount 2: si no, Tone.Channel pasa el audio a mono
    let channel = new Tone.Channel({
      channelCount: 2, volume: p.volume ?? 0, mute: !!mixer.mute[trg], solo: !!mixer.solo[trg]
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
    // send al delay global, igual que el de la reverb: post-fader, post-mute y post-solo
    let dly_send = new Tone.Gain(dly_send_gain(p))
    channel.connect(dly_send)
    dly_send.connect(delay_in)
    // vúmetro post-mute: muestra lo que realmente se escucha de la pista
    let meter = new Tone.Meter({ smoothing: 0.8 })
    channel.connect(meter)
    channels_by_trg[trg] = { channel, meter, filter, send, dly_send, walk }
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
  ch.dly_send.dispose()
  ch.channel.dispose()
  ch.meter.dispose()
  delete channels_by_trg[trg]
  delete levels.trgs[trg]
  delete mixer.mute[trg]
  delete mixer.solo[trg]
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
  mixer.mute[trg] = !mixer.mute[trg]
  get_channel(trg).mute = mixer.mute[trg]
}

export function toggle_solo(trg) {
  mixer.solo[trg] = !mixer.solo[trg]
  get_channel(trg).solo = mixer.solo[trg]
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

// nivel del send al delay global en dB (null = nada; mismo rango y "off" que la reverb)
export function set_delay(trg, db) {
  let p = trg_props(trg)
  p.delay = db == null || db <= DLY_OFF_DB ? null : db
  get_strip(trg).dly_send.gain.rampTo(dly_send_gain(p), 0.05)
  save_trackGroups_debounced()
}
export { DLY_OFF_DB }

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
  if (mixer.mute[trg]) return true
  return !mixer.solo[trg] && Object.values(mixer.solo).some(v => v)
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
