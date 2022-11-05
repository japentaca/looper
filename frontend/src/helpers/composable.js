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
export const TrackCtrl = {
  props: reactive({ tempo: 143, bpb: "4" }),
  calculateBars: () => {

    for (let i = 0; i < store.files.length; i++) {
      let f = store.files[i]
      if (f.duration !== 0) {
        let bars = ((TrackCtrl.props.tempo / 60) * parseFloat(f.duration)) * parseInt(TrackCtrl.props.bpb)
        console.log(bars)
        //f.bars=TrackCtrl.props.tempo
      }

    }

  }

}


export let audio_buffers = {}
export let files_by_id = {}
export let tags_by_id = {}
export let track_groups_by_id = {}


import { reactiveComputed, watchThrottled } from '@vueuse/core'

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
    console.log("llamo rebuild")

    console.log("loops")
    store.track_groups.splice(0)
    for (let i = 0; i < store.u_info.track_groups.length; i++) {
      let t = store.u_info.track_groups[i]
      store.track_groups.push(t)
    }

    store.tags.splice(0)
    for (let i = 0; i < store.u_info.tags.length; i++) {
      let t = store.u_info.tags[i]
      store.tags.push(t)
    }
    rebuildIndexes()
    console.log("fin loop")
    let prom_arr = []
    //console.log("tags_by", tags_by_id)
    store.files = [...store.u_info.files]
    for (let i = 0; i < store.files.length; i++) {
      let f = store.files[i]

      //console.log("f.trg", f.track_group)
      if (f.track_group !== null) {
        f.track_group_obj = track_groups_by_id[f.track_group]
        if (f.track_group_obj == undefined) f.track_group = null
        //console.log("vamo tgr", f.track_group, f.track_group_obj)
      }
      //console.log("f.tag", f.tag)
      if (f.tag !== null) {
        f.tag_obj = tags_by_id[f.tag]
        if (f.tag_obj !== undefined) f.tag = null
        //console.log("vamo tag", f.tag, f.tag_obj)
      }

      if (f.props) {
        f.props.JSON.parse(f.props)
      } else {
        f.props = {}
      }
      // defaultValues
      if (!f.props.oneShot) f.props.oneShot = false



      let url = import.meta.env.VITE_APP_BACKEND + "/api/get_file?file=" + f.id + "&token=" + store.u_info.token
      //console.log(url)
      f.isLoaded = false
      f.index = i

      audio_buffers[f.id] = new ToneAudioBuffer({
        url: url, onload: (buf) => {
          //console.log("file loaded", f.original_name)
          files_by_id[f.id] = f
          f.isLoaded = true
          f.duration = buf.duration.toFixed(2)
          f.currentTime = 0
          f.original_name_short = f.original_name.substr(0, 20)
          f.percent = 0



        }
      })
    }

    console.log("begin loading")

    await delay(1500)
    console.log("end loading")
    store.loading = false

  }
  return res

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