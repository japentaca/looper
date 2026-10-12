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
})
export let files_by_id = reactive([])



export let audio_players = {}

export let tags_by_id = {}
export let track_groups_by_id = {}


import { TrackCtrl, calculateBars } from './TrackCtrl.js'

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
export function trg_default_props() {
  return { volume: 0, mute: false, solo: false, rest: 0, mode: "loop", on_tag_change: false, density: 0 }
}
// guardado diferido de los track groups (para controles que cambian seguido: mute, solo, volumen)
let save_trg_timer = null
export function save_trackGroups_debounced(ms = 500) {
  clearTimeout(save_trg_timer)
  save_trg_timer = setTimeout(() => {
    save_trg_timer = null
    save_trackGroups()
  }, ms)
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

    store.u_info = res.u_info
    //console.log("llamo rebuild")

    //console.log("loops")
    store.track_groups.splice(0)
    if (!store.u_info.track_groups) store.u_info.track_groups = []
    for (let i = 0; i < store.u_info.track_groups.length; i++) {
      let t = store.u_info.track_groups[i]
      t.props = { ...trg_default_props(), ...(t.props ?? {}) }
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
      let url = import.meta.env.VITE_APP_BACKEND + "/api/get_file?file=" + f.id + "&token=" + store.u_info.token
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
      audio_players[prom.value.file.id] = prom.value.player
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

  return res

}