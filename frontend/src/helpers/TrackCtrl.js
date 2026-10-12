import { store } from "./composable"
import { reactive } from "vue"
export const TrackCtrl = reactive({
  tempo: 138,
  beats_x_bar: "4",
  isPlaying: false,
  isReady: false,
  // estado del motor (lo escribe Tracks.vue; los pads de la barra lateral lo leen)
  current_TAG: {
    duration: 0,
    tag: null,
    curr_bar: 0,
    old_tag: null,
    remaining_beats: 0
  },
  tracks: []
})
export function calculateBars() {

  for (let i = 0; i < store.files.length; i++) {
    let f = store.files[i]
    if (f.duration !== 0) {
      let bars = parseFloat(f.duration) / (((60 / TrackCtrl.tempo)) * parseInt(TrackCtrl.beats_x_bar))
      f.bars = bars.toFixed(2)
      f.beats = parseInt((parseFloat(f.duration) / (((60 / TrackCtrl.tempo)))).toFixed(0))
      //console.log(f.bars, f.beats)
    }

  }

}