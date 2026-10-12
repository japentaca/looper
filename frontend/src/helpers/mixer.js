// Mixer de las pistas: un canal por track group (Tone.Channel, con mute y solo) y su vúmetro.
// Los players de los archivos del grupo se enrutan al canal en vez de ir directo a la salida.
// Además hay un vúmetro estéreo en la salida master. Los Meter solo analizan: no cambian el audio.
import * as Tone from "tone"
import { reactive, watch } from "vue"
import { store, audio_players, files_by_id } from "./composable"
import { TrackCtrl } from "./TrackCtrl"

const FLOOR_DB = -48 // nivel que queda en 0 (abajo de esto el medidor está apagado)
const PEAK_HOLD_MS = 800 // cuánto se queda quieto el LED de pico antes de caer
const PEAK_FALL = 0.015 // caída del pico por frame (en escala 0..1)

const channels_by_trg = {} // trg id -> { channel, meter }
// player -> track group al que está enrutado (WeakMap: si se recargan los audios, los players nuevos arrancan sin enrutar)
const trg_of_player = new WeakMap()
const master_meter = new Tone.Meter({ channels: 2, smoothing: 0.8 })
Tone.getDestination().connect(master_meter)

function new_level() {
  return { level: 0, peak: 0, peak_time: 0 }
}

// niveles 0..1 para los LedMeter: levels.trgs[trg_id] y levels.master[0|1] (L/R)
export const levels = reactive({ trgs: {}, master: [new_level(), new_level()] })

// estado de mute/solo por track group; vive acá (y no en los tracks, que se rearman en cada START)
// para que se mantenga entre corridas. Varios grupos pueden estar en solo a la vez.
export const mixer = reactive({ mute: {}, solo: {} })

function get_channel(trg) {
  if (!channels_by_trg[trg]) {
    // channelCount 2: si no, Tone.Channel pasa el audio a mono
    let channel = new Tone.Channel({ channelCount: 2, mute: !!mixer.mute[trg], solo: !!mixer.solo[trg] }).toDestination()
    // vúmetro post-mute: muestra lo que realmente se escucha de la pista
    let meter = new Tone.Meter({ smoothing: 0.8 })
    channel.connect(meter)
    channels_by_trg[trg] = { channel, meter }
    levels.trgs[trg] = new_level()
  }
  return channels_by_trg[trg].channel
}

// enruta el player del archivo al canal de su track group (una sola vez; si el archivo cambió
// de grupo se pasa al canal nuevo)
export function route_player(file_id) {
  let trg = files_by_id[file_id]?.track_group
  let player = audio_players[file_id]
  if (!trg || !player || trg_of_player.get(player) === trg) return
  player.disconnect() // sale de Destination (o del canal anterior)
  player.connect(get_channel(trg))
  trg_of_player.set(player, trg)
}

export function toggle_mute(trg) {
  mixer.mute[trg] = !mixer.mute[trg]
  if (channels_by_trg[trg]) channels_by_trg[trg].channel.mute = mixer.mute[trg]
}

export function toggle_solo(trg) {
  mixer.solo[trg] = !mixer.solo[trg]
  if (channels_by_trg[trg]) channels_by_trg[trg].channel.solo = mixer.solo[trg]
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
