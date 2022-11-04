import { reactive, watch } from 'vue'
import * as api from './api'
import * as Tone from 'tone'
import { ToneAudioBuffer } from 'tone'

import axios from 'axios'
export const store = reactive({
  loginVisible: false,
  u_info: {},
  isLogged: false,
  track_groups: reactive([]),
  tags: reactive([]),
  curr_file: {},
  loading: true
})

export let audio_buffers = {}
export let files_by_id = {}
export let tags_by_id = {}
export let tgs_by_id = {}


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

    let prom_arr = []
    for (let i = 0; i < store.u_info.files.length; i++) {
      let f = store.u_info.files[i]

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
          f.percent = 0

        }
      })

    }
    console.log("begin loading")

    store.track_groups.splice(0)
    //store.track_groups = reactive([])
    store.u_info.tgs.map(e => {
      tgs_by_id[e.id] = e
      store.track_groups.push(e)
    })
    store.tags.splice(0)
    //store.tags = reactive([])
    store.u_info.tags.map(e => {
      tags_by_id[e.id] = e
      store.tags.push(e)
    })


    //console.log("get user info", ui)
    await delay(1500)
    //console.log("end loading")
    store.loading = false

    /*
    let temp = await Promise.all(prom_arr)
    temp.map((t) => {

      //console.log(t)
      //audio_buffers[t]
    })
    */

    //console.log(audio_buffers)

    //console.log(res_arr)
  }
  return res

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