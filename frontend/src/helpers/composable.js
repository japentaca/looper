import { reactive } from 'vue'
import * as api from './api'
import * as Tone from 'tone'

import { ElMessage, ElMessageBox } from 'element-plus'
export const store = reactive({
  files: [],
  loginVisible: false,
  u_info: {},
  isLogged: false,
  // proyectos del usuario (lista: id, name, visibility, hidden, ts) y proyecto activo (misma forma).
  // Pistas, tags, archivos y config (TrackCtrl) son siempre los del proyecto activo
  projects: [],
  project: null,
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
  // modo lectura (/p/:id, proyecto público): se puede tocar START/STOP y el mixer, pero nada se
  // guarda. Todos los guardados de este archivo lo chequean y no mandan ningún request
  read_only: false,
})
export let files_by_id = reactive([])



export let audio_players = {}

export let tags_by_id = {}
export let track_groups_by_id = {}


import {
  TrackCtrl, calculateBars, stop_transport, delay_default, DELAY_TYPES, DELAY_DIVISIONS, DELAY_FEEDBACK_MAX,
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

// --- guardados: todos van contra el proyecto activo (store.project) ---
// En modo lectura (store.read_only) ninguno manda nada: los cambios quedan solo en memoria.
// can_save() es el único chequeo; cada guardado (y save_collection) lo llama.
function can_save() {
  return !!store.project && !store.read_only
}
// guarda la colección completa de tags / pistas del proyecto (el backend la reemplaza y limpia en
// los archivos del proyecto las referencias a tags / pistas que ya no están)
export async function save_tags() {
  if (!can_save()) return
  await save_collection(data => api.save_project_tags(store.project.id, data), store.tags, "los tags")
}
export async function save_trackGroups() {
  if (!can_save()) return
  await save_collection(data => api.save_project_track_groups(store.project.id, data), store.track_groups, "los track groups")
}
// pista, tags y volumen de un archivo dentro del proyecto activo (project_files)
export async function save_file(file) {
  if (!can_save()) return
  let data = { id: file.id, track_group: file.track_group ?? null, tags: file.tags ?? [], props: {} }
  let volume = Number(file.props?.volume)
  if (Number.isFinite(volume)) data.props.volume = volume
  await save_collection(() => api.save_project_files(store.project.id, { update: [data] }), null, "los datos del archivo")
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
  if (store.read_only) return
  clearTimeout(save_trg_timer)
  save_trg_timer = setTimeout(() => {
    save_trg_timer = null
    save_trackGroups()
  }, ms)
}
// --- config del proyecto (projects.props): tempo, compás, rango de cambio de Tag y delay ---
// guardado diferido: se llama al cambiar tempo, compás, el rango de Tag o el delay (no al cargar)
let save_project_props_timer = null
export function save_project_props_debounced(ms = 500) {
  if (store.read_only) return
  clearTimeout(save_project_props_timer)
  save_project_props_timer = setTimeout(() => {
    save_project_props_timer = null
    save_project_props()
  }, ms)
}
async function save_project_props() {
  if (!can_save()) return
  let props = {
    tempo: TrackCtrl.tempo, beats_x_bar: TrackCtrl.beats_x_bar, tag_range: [...TrackCtrl.tag_range],
    delay: { ...TrackCtrl.delay }
  }
  await save_collection(() => api.update_project(store.project.id, { props }), null,
    "la configuración (tempo / tag / delay)")
}
// antes de cambiar de proyecto (o de borrar el activo) se mandan ya los guardados diferidos
// pendientes: si no, saldrían después con el id del proyecto nuevo (o contra uno borrado)
export async function flush_pending_saves() {
  let jobs = []
  if (save_trg_timer) {
    clearTimeout(save_trg_timer)
    save_trg_timer = null
    jobs.push(save_trackGroups())
  }
  if (save_project_props_timer) {
    clearTimeout(save_project_props_timer)
    save_project_props_timer = null
    jobs.push(save_project_props())
  }
  await Promise.all(jobs)
}
function clamp(v, min, max, def) {
  v = Number(v)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
}
// aplica la config guardada (con defaults para lo que falte o sea inválido) a TrackCtrl y al transporte.
// El delay de mixer.js sigue a TrackCtrl con watchers. Va antes de calculateBars (los beats de los
// archivos dependen del tempo). No guarda nada: solo se guarda al tocar un control.
function apply_project_props(props) {
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
  if (!can_save()) return // red de seguridad: en modo lectura nunca sale un request de escritura
  try {
    let res = await api_fn(data)
    if (res.stat) return
  } catch (e) {
    console.log("Error guardando", label, e)
  }
  ElMessage({ type: 'error', message: `No se pudieron guardar ${label}` })
}



// último proyecto abierto en este navegador (localStorage puede no estar disponible: se ignora)
const LAST_PROJECT_KEY = "looper_project_id"
export function remember_project(id) {
  try { localStorage.setItem(LAST_PROJECT_KEY, id) } catch { /* sin localStorage */ }
}
function remembered_project() {
  try { return localStorage.getItem(LAST_PROJECT_KEY) } catch { return null }
}

// usuario (con la cuota) + lista de proyectos, y (re)carga del proyecto activo. Se llama al entrar,
// después del login y después de cada subida. Proyecto a abrir: el activo si sigue existiendo; si no,
// el último usado en este navegador; si no, el primero. Sin proyectos (cuenta nueva) se crea uno.
export const store_get_user_info = async () => {
  let res = await api.get_user_info()
  console.log("res get_user_info", res)
  if (res.stat) {
    store.isLogged = true
    store.session_lost = false
    start_session_check()

    store.u_info = res.u_info
    store.projects = res.u_info.projects ?? []
    if (store.projects.length == 0) {
      try {
        let pres = await api.create_project({ name: "My project" })
        if (pres.stat) store.projects.push(pres.data)
      } catch (e) {
        console.log("Error creando el proyecto inicial", e)
      }
    }
    let ids = store.projects.map(p => p.id)
    let id = [store.project?.id, remembered_project()].find(i => i && ids.includes(i)) ?? ids[0]
    if (id) {
      await load_project(id)
    } else {
      ElMessage({ type: 'error', message: "No se pudo cargar ni crear un proyecto" })
      store.loading = false
    }
  }
  return res
}

// carga el proyecto `id` como activo: config, pistas, tags y archivos (un Tone.Player solo para los
// archivos del proyecto; los de otro proyecto se liberan). Devuelve true si se cargó
export async function load_project(id) {
  store.read_only = false
  let same = store.project?.id === id
  if (!same) await flush_pending_saves()
  let pres
  try {
    pres = await api.get_project(id)
  } catch (e) {
    console.log("Error cargando el proyecto", e)
  }
  if (!pres?.stat) {
    ElMessage({ type: 'error', message: pres?.text || "No se pudo cargar el proyecto" })
    return false
  }
  let p = pres.data
  // aviso de memoria antes de crear los players (solo al abrir otro proyecto: una recarga del mismo,
  // p.ej. después de cada subida, no vuelve a preguntar). Si el usuario no quiere cargarlo se
  // conserva el proyecto actual; si no hay uno usable (primera carga, o el activo se borró) queda
  // sin proyecto abierto y se elige otro desde PROJECTS.
  if (!same && !(await confirm_project_memory(p))) {
    if (!store.project || !store.projects.some(r => r.id === store.project.id)) unload_project()
    store.loading = false
    return false
  }
  store.project = { id: p.id, name: p.name, visibility: p.visibility, hidden: p.hidden, ts: p.ts }
  remember_project(p.id)
  return await install_project(p, same)
}

// --- modo lectura (/p/:id) ---
// carga un proyecto público (GET /public/project/:id, sin sesión) en el store, en modo lectura:
// mismo motor y mismos players que un proyecto propio, pero ningún guardado manda requests (ver
// can_save). Los audios salen de GET /file/:id (público). Antes de llamarla con el transporte en
// marcha, hacer STOP (stop_transport). Devuelve { ok, status, text, creator }: status es el HTTP del error
// (404 = no existe o no es público, 429 = límite por IP), para que la vista elija el mensaje.
export async function load_public_project(id) {
  store.read_only = true
  // START deshabilitado hasta que terminen de cargar los audios (y el autostart espera a eso)
  TrackCtrl.isReady = false
  // las tiras no deben mostrar el estado de la corrida anterior (otro proyecto, o antes de ir a la galería)
  TrackCtrl.tracks.splice(0)
  let p
  try {
    let res = await api.get_public_project(id)
    p = res.data
  } catch (e) {
    console.log("Error cargando el proyecto público", e)
    return { ok: false, status: e?.response?.status ?? 0, text: api.error_text(e) }
  }
  if (!p) return { ok: false, status: 0, text: "No se pudo cargar el proyecto" }
  if (!(await confirm_project_memory(p))) {
    unload_project()
    store.loading = false
    return { ok: false, status: 0, text: "Loading cancelled" }
  }
  store.project = { id: p.id, name: p.name, visibility: "public", ts: p.ts }
  let ok = await install_project(p, false)
  // creator: { name, bio } (lo único del dueño que expone la API pública)
  return { ok, status: 200, text: "", creator: p.creator ?? { name: "", bio: null } }
}
// sale del modo lectura liberando los players (al dejar la vista pública por la galería)
export function unload_public_project() {
  stop_transport()
  TrackCtrl.current_TAG.tag = null
  unload_project()
}

// instala en el store un proyecto ya leído del backend (propio o público): config, pistas, tags y
// players. same = recarga del proyecto que ya estaba abierto
async function install_project(p, same) {
  // config del proyecto (tempo, compás, Tag, delay). En una recarga del mismo proyecto con el
  // transporte en marcha o con un guardado pendiente no se aplica: lo que está en pantalla es más
  // nuevo que lo de la base.
  if (!same || (!TrackCtrl.isPlaying && !save_project_props_timer)) apply_project_props(p.props)

  store.track_groups.splice(0)
  for (let t of p.track_groups ?? []) {
    t.props = { ...trg_default_props(), ...(t.props ?? {}) }
    // mute y solo ya no se guardan (viven en memoria en mixer.js): se descartan si quedaron de antes
    delete t.props.mute
    delete t.props.solo
    store.track_groups.push(t)
  }

  store.tags.splice(0)
  for (let t of p.tags ?? []) store.tags.push(t)
  rebuildIndexes()
  let prom_arr = []
  store.files = [...(p.files ?? [])]
  TrackCtrl.isReady = false

  // se liberan los players (y se olvidan los archivos) que no son de este proyecto
  let keep = new Set(store.files.map(f => f.id))
  for (let fid of Object.keys(audio_players)) {
    if (!keep.has(fid)) {
      dispose_player(audio_players[fid])
      delete audio_players[fid]
    }
  }
  for (let fid of Object.keys(files_by_id)) {
    if (!keep.has(fid)) delete files_by_id[fid]
  }

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
    let fid = prom.value.file.id
    // si es una recarga (subida, re-login) se libera el player anterior: si no, cada recarga deja
    // todos los buffers anteriores en memoria
    if (audio_players[fid] && audio_players[fid] !== prom.value.player) dispose_player(audio_players[fid])
    audio_players[fid] = prom.value.player
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

  return true
}
// --- aviso de memoria ---
// Tone.js decodifica cada archivo a PCM float32 (4 bytes) estéreo: segundos × 44 100 × 2 × 4 bytes
// (~21 MB por minuto), sin importar el bitrate del mp3. Si el total del proyecto supera ¼ de la
// memoria del equipo (navigator.deviceMemory, en GB; solo Chromium, que además la redondea y la
// limita a 8) se pregunta antes de cargar. Sin esa API se supone un equipo de 4 GB (límite 1 GB).
const PCM_BYTES_X_SECOND = 44100 * 2 * 4
const DEVICE_MEMORY_FALLBACK_GB = 4
const MEMORY_FRACTION = 1 / 4
// archivos sin duración medida (no debería pasar después de la fase 2): se estima por el tamaño
// del mp3 suponiendo 128 kbps, que da más segundos que el V0 real (estimación por lo alto)
const FALLBACK_BYTES_X_SECOND = 128000 / 8
// en modo instalación (?autostart=1) no hay nadie para contestar: se carga sin preguntar
const AUTOSTART = new URLSearchParams(window.location.search).get("autostart") == "1"

// memoria estimada (bytes) de los audios decodificados de una lista de archivos
export function estimate_files_memory(files) {
  let seconds = 0
  for (let f of files ?? []) {
    let d = Number(f.duration)
    if (Number.isFinite(d) && d > 0) seconds += d
    else if (Number(f.size) > 0) seconds += Number(f.size) / FALLBACK_BYTES_X_SECOND
  }
  return seconds * PCM_BYTES_X_SECOND
}
// límite (bytes) a partir del cual se avisa
export function memory_warning_limit() {
  let gb = Number(navigator.deviceMemory)
  if (!Number.isFinite(gb) || gb <= 0) gb = DEVICE_MEMORY_FALLBACK_GB
  return gb * 1024 ** 3 * MEMORY_FRACTION
}
function mb(bytes) {
  return Math.round(bytes / 1024 ** 2)
}
// true si se puede cargar el proyecto (no supera el límite, o el usuario eligió cargarlo igual)
async function confirm_project_memory(p) {
  let bytes = estimate_files_memory(p.files)
  let limit = memory_warning_limit()
  if (bytes <= limit) return true
  if (AUTOSTART) {
    console.log(`Proyecto grande (~${mb(bytes)} MB, límite ${mb(limit)} MB): se carga igual (autostart)`)
    return true
  }
  try {
    await ElMessageBox.confirm(
      `Project "${p.name}" needs about ${mb(bytes)} MB of memory to load its ${p.files.length} files `
      + `(this device: ~${mb(limit)} MB recommended). The browser may slow down or reload the page. `
      + "Load anyway?",
      "Large project", { confirmButtonText: "Load anyway", cancelButtonText: "Cancel", type: "warning" })
    return true
  } catch {
    return false
  }
}
// deja la app sin proyecto abierto (se canceló el aviso de memoria y no hay otro usable)
function unload_project() {
  store.project = null
  store.files = []
  store.track_groups.splice(0)
  store.tags.splice(0)
  rebuildIndexes()
  for (let fid of Object.keys(audio_players)) {
    dispose_player(audio_players[fid])
    delete audio_players[fid]
  }
  for (let fid of Object.keys(files_by_id)) delete files_by_id[fid]
  store.load_progress.done = 0
  store.load_progress.total = 0
  // no queda ningún audio por cargar: sin esto, en la primera carga de la página isReady seguiría en
  // false y Projects.vue tendría deshabilitados Open/Create/Delete (no se podría salir de NO PROJECT)
  TrackCtrl.isReady = true
}

// vuelve a pedir la lista de proyectos (después de crear, renombrar o borrar desde la UI)
export async function refresh_projects() {
  try {
    let res = await api.get_projects()
    if (res.stat) store.projects = res.data
  } catch (e) {
    console.log("Error leyendo los proyectos", e)
  }
}

// abre otro proyecto desde la UI: primero STOP (load_project no detiene el transporte y el motor
// quedaría sonando con los archivos del proyecto anterior) y se olvida el Tag actual, que es de ese
// proyecto. Devuelve true si se cargó
export async function switch_project(id) {
  stop_transport()
  TrackCtrl.current_TAG.tag = null
  return await load_project(id)
}

// borra un archivo propio (audio + cascada en todos los proyectos) o, si es importado, lo quita del
// proyecto activo (sigue en el catálogo). Si el backend lo acepta lo saca de store.files y libera su
// player (la clave queda en audio_players, como antes). Devuelve true si se hizo
export async function delete_project_file(file) {
  if (!can_save()) return false
  let res
  try {
    res = file.own ? await api.delete_file(file.id)
      : await api.save_project_files(store.project.id, { remove: [file.id] })
  } catch (e) {
    res = { stat: false, text: api.error_text(e) }
  }
  if (!res?.stat) {
    ElMessage({ type: 'error', message: res?.text || "No se pudo borrar el archivo" })
    return false
  }
  if (audio_players[file.id]) dispose_player(audio_players[file.id])
  let i = store.files.findIndex(f => f.id === file.id)
  if (i >= 0) store.files.splice(i, 1)
  for (let j = 0; j < store.files.length; j++) store.files[j].index = j
  return true
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