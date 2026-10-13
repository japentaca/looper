import { reactive } from 'vue'
import * as api from './api'
import * as Tone from 'tone'

import { ElMessage } from 'element-plus'
export const store = reactive({
  files: [],
  loginVisible: false,
  u_info: {},
  isLogged: false,
  track_groups: reactive([]),
  tags: reactive([]),
  curr_file: {},
  loading: true,
  // avance de la carga de audios (archivos terminados / total), para la barra de la parte superior
  load_progress: { done: 0, total: 0 },
  alreadyMounted: false,
  // true si el backend dijo que no hay sesión (401/403) con el usuario ya cargado. La reproducción
  // sigue (los audios están en memoria) pero no se guardan cambios; App.vue lo muestra en el LED.
  session_lost: false,
})
export let files_by_id = reactive([])



export let audio_players = {}

export let tags_by_id = {}
export let track_groups_by_id = {}


import {
  TrackCtrl, calculateBars, delay_default, DELAY_TYPES, DELAY_DIVISIONS, DELAY_FEEDBACK_MAX,
  DELAY_LEVEL_MIN, DELAY_LEVEL_MAX, TEMPO_DEFAULT, BEATS_X_BAR_DEFAULT, TAG_RANGE_MIN, TAG_RANGE_MAX,
  TAG_RANGE_DEFAULT
} from './TrackCtrl.js'
import { on_session_lost } from './request'

// una respuesta 401/403 "Sin sesión" de cualquier endpoint marca la sesión como perdida. No se
// desloguea ni se recarga nada: eso cortaría el audio.
on_session_lost(() => {
  if (store.isLogged) store.session_lost = true
})

// chequeo periódico de la sesión mientras hay usuario cargado. Si nadie toca nada (instalación)
// no hay otras requests, así que sin esto la pérdida de sesión no se vería. Además, cada request
// renueva el TTL de la sesión en Redis. get_user_info responde { stat: false } (200) sin sesión.
const SESSION_CHECK_MS = 10 * 60 * 1000
let session_check_timer = null
function start_session_check() {
  if (session_check_timer) return
  session_check_timer = setInterval(async () => {
    if (!store.isLogged) return
    try {
      let res = await api.get_user_info()
      store.session_lost = !res.stat
    } catch (e) {
      // red caída o timeout: no se cambia el estado (no se sabe si la sesión sigue)
      console.log("Error chequeando la sesión", e)
    }
  }, SESSION_CHECK_MS)
}

export async function save_tags() {
  await save_collection(api.save_tags, store.tags, "los tags")
}
export async function save_trackGroups() {
  await save_collection(api.save_trackGroups, store.track_groups, "los track groups")
}
// config de cada pista (track group), guardada en user_track_groups.props.
// volume en dB (va al Tone.Channel); rest = probabilidad 0..1 de descansar al terminar cada loop
// (la usa el motor en Tracks.vue). mode = "loop" | "oneshot"; en oneshot la pista dispara archivos sueltos:
// on_tag_change = al empezar cada Tag, density = probabilidad 0..1 de disparar en cada compás.
// reverb = nivel del send a la reverb compartida en dB (null = nada; no se usa -Infinity porque
// JSON.stringify lo vuelve null igual); drift = modulación lenta 0..1 de filtro y send (ver mixer.js).
// delay = nivel del send al delay global en dB (null = nada, igual que reverb).
export function trg_default_props() {
  return { volume: 0, rest: 0, mode: "loop", on_tag_change: false, density: 0,
    reverb: null, drift: 0, delay: null }
}
// guardado diferido de los track groups (para controles que cambian seguido: volumen, knobs)
let save_trg_timer = null
export function save_trackGroups_debounced(ms = 500) {
  clearTimeout(save_trg_timer)
  save_trg_timer = setTimeout(() => {
    save_trg_timer = null
    save_trackGroups()
  }, ms)
}
// --- config global del usuario (users.props): tempo, compás, rango de cambio de Tag y delay ---
// guardado diferido: se llama al cambiar tempo, compás, el rango de Tag o el delay (no al cargar)
let save_user_props_timer = null
export function save_user_props_debounced(ms = 500) {
  clearTimeout(save_user_props_timer)
  save_user_props_timer = setTimeout(async () => {
    save_user_props_timer = null
    try {
      let res = await api.save_user_props({
        tempo: TrackCtrl.tempo, beats_x_bar: TrackCtrl.beats_x_bar, tag_range: [...TrackCtrl.tag_range],
        delay: { ...TrackCtrl.delay }
      })
      if (res.stat) return
    } catch (e) {
      console.log("Error guardando la config", e)
    }
    ElMessage({ type: 'error', message: "No se pudo guardar la configuración (tempo / tag / delay)" })
  }, ms)
}
function clamp(v, min, max, def) {
  v = Number(v)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
}
// aplica la config guardada (con defaults para lo que falte o sea inválido) a TrackCtrl y al transporte.
// El delay de mixer.js sigue a TrackCtrl con watchers. Va antes de calculateBars (los beats de los
// archivos dependen del tempo). No guarda nada: solo se guarda al tocar un control.
function apply_user_props(props) {
  let p = props ?? {}
  TrackCtrl.tempo = Math.round(clamp(p.tempo, 10, 160, TEMPO_DEFAULT)) // mismo rango que el knob Tempo
  TrackCtrl.beats_x_bar = ["3", "4"].includes(String(p.beats_x_bar)) ? String(p.beats_x_bar) : BEATS_X_BAR_DEFAULT
  // rango de cambio de Tag: exponentes enteros dentro de los faders, con min <= max
  let r = Array.isArray(p.tag_range) ? p.tag_range : TAG_RANGE_DEFAULT
  let r_min = Math.round(clamp(r[0], TAG_RANGE_MIN, TAG_RANGE_MAX, TAG_RANGE_DEFAULT[0]))
  let r_max = Math.round(clamp(r[1], TAG_RANGE_MIN, TAG_RANGE_MAX, TAG_RANGE_DEFAULT[1]))
  TrackCtrl.tag_range = [Math.min(r_min, r_max), Math.max(r_min, r_max)]
  let def = delay_default()
  let d = p.delay && typeof p.delay == "object" ? p.delay : {}
  Object.assign(TrackCtrl.delay, {
    type: DELAY_TYPES.includes(d.type) ? d.type : def.type,
    division: DELAY_DIVISIONS[d.division] ? d.division : def.division,
    feedback: clamp(d.feedback, 0, DELAY_FEEDBACK_MAX, def.feedback),
    level: clamp(d.level, DELAY_LEVEL_MIN, DELAY_LEVEL_MAX, def.level),
  })
  Tone.Transport.bpm.value = TrackCtrl.tempo
  Tone.Transport.timeSignature = parseInt(TrackCtrl.beats_x_bar)
}

async function save_collection(api_fn, data, label) {
  try {
    let res = await api_fn(data)
    if (res.stat) return
  } catch (e) {
    console.log("Error guardando", label, e)
  }
  ElMessage({ type: 'error', message: `No se pudieron guardar ${label}` })
}



export const store_get_user_info = async () => {
  let res = await api.get_user_info()
  console.log("res get_user_info", res)
  if (res.stat) {
    store.isLogged = true
    store.session_lost = false
    start_session_check()

    store.u_info = res.u_info
    // config global (tempo, compás, delay). En una recarga con el transporte en marcha o con un
    // guardado pendiente no se aplica: lo que está en pantalla es más nuevo que lo de la base.
    if (!TrackCtrl.isPlaying && !save_user_props_timer) apply_user_props(res.u_info.props)
    //console.log("llamo rebuild")

    //console.log("loops")
    store.track_groups.splice(0)
    if (!store.u_info.track_groups) store.u_info.track_groups = []
    for (let i = 0; i < store.u_info.track_groups.length; i++) {
      let t = store.u_info.track_groups[i]
      t.props = { ...trg_default_props(), ...(t.props ?? {}) }
      // mute y solo ya no se guardan (viven en memoria en mixer.js): se descartan si quedaron de antes
      delete t.props.mute
      delete t.props.solo
      store.track_groups.push(t)
    }

    store.tags.splice(0)
    if (!store.u_info.tags) store.u_info.tags = []
    for (let i = 0; i < store.u_info.tags.length; i++) {
      let t = store.u_info.tags[i]
      store.tags.push(t)
    }
    rebuildIndexes()
    //console.log("fin loop")
    let prom_arr = []
    //console.log("tags_by", tags_by_id)
    store.files = [...store.u_info.files]
    TrackCtrl.isReady = false

    console.log("begin loading files")
    store.load_progress.done = 0
    store.load_progress.total = store.files.length
    for (let i = 0; i < store.files.length; i++) {
      let f = store.files[i]
      //console.log(JSON.parse(JSON.stringify(f)))
      files_by_id[f.id] = f

      //console.log("f.trg", f.track_group)
      if (f.track_group !== null) {
        f.track_group_obj = track_groups_by_id[f.track_group]
        if (f.track_group_obj == undefined) f.track_group = null
        //console.log("vamo tgr", f.track_group, f.track_group_obj)
      }
      set_file_tags(f, f.tags)

      if (!f.props) {
        f.props = {}
      }
      if (!f.props.volume) f.props.volume = -6
      let url = import.meta.env.VITE_APP_BACKEND + "/api/file/" + f.id
      //console.log(url)
      f.isLoaded = false
      f.index = i
      f.bars = 0
      f.currentTime = 0
      f.original_name_short = f.original_name.substr(0, 15)
      f.percent = 0
      prom_arr.push(getAudioPlayer(url, f))

    }
    //console.log("llamo a promise.all")
    let res_prom = await Promise.allSettled(prom_arr)
    res_prom.map(prom => {
      //console.log(prom)
      let id = prom.value.file.id
      // si es una recarga (subida, re-login) se libera el player anterior: si no, cada recarga deja
      // todos los buffers anteriores en memoria
      if (audio_players[id] && audio_players[id] !== prom.value.player) dispose_player(audio_players[id])
      audio_players[id] = prom.value.player
    })

    //console.log("res_prom", res_prom)

    calculateBars()

    let failed = store.files.filter(f => f.loadError)
    if (failed.length > 0) {
      ElMessage({
        type: 'warning',
        duration: 0,
        showClose: true,
        message: `No se pudieron cargar ${failed.length} archivo(s): ${failed.map(f => f.original_name).join(", ")}`,
      })
    }

    TrackCtrl.isReady = true

    //console.log("end loading", store.files)
    store.loading = false

  }
  return res

}
// libera un player reemplazado. Si está sonando (p.ej. una recarga con el transporte en marcha) se
// libera recién cuando termina, para no cortar el audio.
function dispose_player(player) {
  if (player.state == "started") {
    player.onstop = () => setTimeout(() => player.dispose(), 0)
  } else {
    player.dispose()
  }
}
async function getAudioPlayer(url, file) {
  return new Promise((resolve, reject) => {
    let player = new Tone.Player({
      url: url, onload: (buf) => {
        //console.log("file loaded", file.id)

        file.isLoaded = true
        file.duration = player.buffer.duration
        file.duration_fixed = player.buffer.duration.toFixed(2)
        store.load_progress.done++

        resolve({ player: player, file: file })
      },
      // si un audio falla igual se resuelve, para que la app quede lista con el resto
      onerror: (err) => {
        console.log("Error cargando", file.original_name, err)
        file.loadError = true
        store.load_progress.done++
        resolve({ player: player, file: file })
      }
    }).toDestination()
  })
}
// un archivo puede tener varios tags: `tags` son los ids (lo que se guarda) y `tag_objs` los
// objetos de store.tags (solo cliente). Se descartan los ids de tags que ya no existen.
export function set_file_tags(file, ids) {
  file.tags = (Array.isArray(ids) ? ids : []).filter(id => tags_by_id[id])
  file.tag_objs = file.tags.map(id => tags_by_id[id])
}
// agrega el tag si el archivo no lo tiene y lo quita si ya lo tenía
export function toggle_file_tag(file, id) {
  if (file.tags.includes(id)) {
    set_file_tags(file, file.tags.filter(t => t !== id))
  } else {
    set_file_tags(file, [...file.tags, id])
  }
}
export function rebuildIndexes() {
  track_groups_by_id = {}
  for (let i = 0; i < store.track_groups.length; i++) {
    track_groups_by_id[store.track_groups[i].id] = store.track_groups[i]
  }
  tags_by_id = {}
  for (let i = 0; i < store.tags.length; i++) {
    tags_by_id[store.tags[i].id] = store.tags[i]
  }
  //console.log(tags_by_id, store.tags)


}
export const doLogout = async () => {
  let res = await api.logout()
  store.isLogged = false
  store.session_lost = false

  return res

}