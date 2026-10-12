// Mixer de las pistas: un canal por track group (Tone.Channel, con volumen, mute y solo) y su vúmetro.
// Los players de los archivos del grupo se enrutan al canal en vez de ir directo a la salida.
// Además hay un vúmetro estéreo en la salida master. Los Meter solo analizan: no cambian el audio.
// El volumen, mute y solo de cada pista viven en trg.props (se guardan con save_trackGroups).
import * as Tone from "tone"
import { reactive, watch } from "vue"
import { store, audio_players, files_by_id, save_trackGroups_debounced } from "./composable"
import { TrackCtrl } from "./TrackCtrl"

const FLOOR_DB = -48 // nivel que queda en 0 (abajo de esto el medidor está apagado)
const PEAK_HOLD_MS = 800 // cuánto se queda quieto el LED de pico antes de caer
const PEAK_FALL = 0.015 // caída del pico por frame (en escala 0..1)

const channels_by_trg = {} // trg id -> { channel, meter }
// player -> track group al que está enrutado (WeakMap: si se recargan los audios, los players nuevos arrancan sin enrutar)
const trg_of_player = new WeakMap()
// limitador en el master para que la salida no clipee aunque coincidan varios loops fuertes.
// chain() solo rearma input → limiter → output de Destination: lo que entra (canales, preview) sigue igual.
const master_limiter = new Tone.Limiter(-1)
Tone.getDestination().chain(master_limiter)
// el vúmetro master cuelga del output de Destination, o sea que mide después del limitador
const master_meter = new Tone.Meter({ channels: 2, smoothing: 0.8 })
Tone.getDestination().connect(master_meter)

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

function get_channel(trg) {
  if (!channels_by_trg[trg]) {
    let p = trg_props(trg)
    // channelCount 2: si no, Tone.Channel pasa el audio a mono
    let channel = new Tone.Channel({
      channelCount: 2, volume: p.volume ?? 0, mute: !!p.mute, solo: !!p.solo
    }).toDestination()
    // vúmetro post-mute: muestra lo que realmente se escucha de la pista
    let meter = new Tone.Meter({ smoothing: 0.8 })
    channel.connect(meter)
    channels_by_trg[trg] = { channel, meter }
    levels.trgs[trg] = new_level()
  }
  return channels_by_trg[trg].channel
}

function remove_channel(trg) {
  let ch = channels_by_trg[trg]
  if (!ch) return
  ch.channel.solo = false // así los demás canales dejan de quedar callados por este solo
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
