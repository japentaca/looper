import { reactive, watch } from 'vue'
import * as api from './api'
import * as Tone from 'tone'
import { ToneAudioBuffer } from 'tone'

import axios from 'axios'
export const store = reactive({
  files: [],
  loginVisible: false,
  u_info: {},
  isLogged: false,
  track_groups: reactive([]),
  tags: reactive([]),
  curr_file: {},
  loading: true,
  alreadyMounted: false,
})
export let files_by_id = reactive([])



export let audio_players = {}

export let tags_by_id = {}
export let track_groups_by_id = {}


import { watchThrottled } from '@vueuse/core'
import { TrackCtrl, calculateBars } from './TrackCtrl.js'


watchThrottled(
  store.track_groups,
  async () => {
    console.log('track groups changed ! ', store.loading)
    if (!store.loading) {
      await api.save_trackGroups(store.track_groups)
      console.log('track groups saved')
    }
  },
  { throttle: 1000, deep: true },
)
watchThrottled(
  store.tags,
  async () => {
    console.log('tags changed!', store.loading)
    if (!store.loading) {
      await api.save_tags(store.tags)
      console.log('tags saved')
    }

  },
  { throttle: 1100, deep: true },
)

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
    for (let i = 0; i < store.files.length; i++) {
      let f = store.files[i]
      files_by_id[f.id] = f

      //console.log("f.trg", f.track_group)
      if (f.track_group !== null) {
        f.track_group_obj = track_groups_by_id[f.track_group]
        if (f.track_group_obj == undefined) f.track_group = null
        //console.log("vamo tgr", f.track_group, f.track_group_obj)
      }
      //console.log("f.tag", f.tag)
      if (f.tag !== undefined) {
        f.tag_obj = tags_by_id[f.tag]
        if (f.tag_obj == undefined) f.tag = null
        //console.log("vamo tag", f.tag, f.tag_obj)
      }

      if (!f.props) {
        f.props = {}
      }
      if (!f.props.oneShot) f.props.oneShot = false

      let url = import.meta.env.VITE_APP_BACKEND + "/api/get_file?file=" + f.id + "&token=" + store.u_info.token
      //console.log(url)
      f.isLoaded = false
      f.index = i
      f.bars = 0
      f.currentTime = 0
      f.original_name_short = f.original_name.substr(0, 20)
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


    TrackCtrl.isReady = true

    //console.log("end loading", store.files)
    store.loading = false

  }
  return res

}
async function getAudioPlayer(url, file) {
  return new Promise(async (resolve, reject) => {
    let player = new Tone.Player({
      url: url, onload: (buf) => {
        //console.log("file loaded", file.id)

        file.isLoaded = true
        file.duration = player.buffer.duration
        file.duration_fixed = player.buffer.duration.toFixed(2)

        resolve({ player: player, file: file })
      }
    }).toDestination()
  })
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
async function delay(tiempo) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(true)
    }, tiempo);
  })
}
export const doLogout = async () => {
  let res = await api.logout()
  store.isLogged = false

  return res

}