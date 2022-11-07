<template>
  <div>
    TRACK CONTROL
    <div v-show="TrackCtrl.isReady == true">
      <el-button type="success" v-if="TrackCtrl.isPlaying == false" @click="start">START</el-button>
      <el-button type="danger" v-if="TrackCtrl.isPlaying == true" @click="stop">STOP</el-button>
    </div>
    Beats x Bar tt={{ tt }} tt2={{ tt2 }}
    <el-radio-group v-model="TrackCtrl.beats_x_bar">
      <el-radio label="3" border>3</el-radio>
      <el-radio label="4" border>4 </el-radio>
    </el-radio-group>
    <span>

      <el-slider class="slider" @change="onSliderchange" v-model="TrackCtrl.tempo" :min="10" :max="160" />
      <span>{{
          store.tempo
      }} </span>
    </span>
    TRACKS
    <el-row :gutter="20" v-for="(track, index) in tracks">
      <el-col :span="6" v-if="track.track_group"><span class="track"
          v-bind:style="{ 'background-color': track.track_group.color }"> {{
              track.track_group.name
          }} </span>
      </el-col>
      <el-col v-if="track.curr_file" :span="6">
        {{ track.curr_file.beats }} {{ track.curr_file.original_name_short }}
      </el-col>
      <el-col :span="6">
        {{ track.remaining_beats }}
      </el-col>
    </el-row>

  </div>
</template>
<script setup>
import { tooltipV2ContentKey } from "element-plus";
import * as Tone from "tone"
import { ref, reactive } from "vue"
import { store, track_groups_by_id, tags_by_id, audio_buffers, files_by_id } from "../helpers/composable"
import { TrackCtrl, calculateBars } from "../helpers/TrackCtrl"


let players = {}
let files_per_TRG = {}
let files_per_TAG = []
let tracks = reactive([])

function onSliderchange(value) {
  Tone.Transport.bpm = value
  calculateBars()
}

function stop() {
  TrackCtrl.isPlaying = false
  Tone.Transport.stop()
}
let tt = ref(0)
let tt2 = ref(0)
let a = 0
const loop = new Tone.Loop((time) => {
  //console.log(a++)
  //tt2.value++
  set_next_step(time + 0.2)
}, "4n")


Tone.Transport.scheduleRepeat((time) => {
  // use the callback time to schedule events
  //console.log("t", time)
  //osc.start(time).stop(time + 0.1);

  tt.value = 'Quarter Notes:' + (Tone.Transport.getTicksAtTime(time) / 192)
  //tt.value = time
  //set_next_step(time)
}, "4n");

function start() {


  TrackCtrl.isPlaying = true
  Tone.Transport.timeSignature = "4/4"
  Tone.Transport.bpm.value = TrackCtrl.tempo
  //Tone.Transport.bpm.value = 1
  //Tone.Transport.loop = true
  let temp = {}
  tracks.splice(0)
  files_per_TRG = []


  for (let i = 0; i < store.files.length; i++) {
    let f = store.files[i]
    if (f.track_group) {
      temp[f.track_group] = f.track_group
      if (!files_per_TRG[f.track_group]) { files_per_TRG[f.track_group] = [] }
      files_per_TRG[f.track_group].push(f.id)
    }
  }
  for (const [key, value] of Object.entries(temp)) {
    // key y value traen el tag_id

    if (!players[value]) { players[value] = new Tone.Player().toDestination() }

    tracks.push({
      track_group: track_groups_by_id[value],
      curr_file: null,
      remaining_beats: 0
    })

  }


  set_next_step(0)
  Tone.Transport.start()
  loop.start()
}

function set_next_step(time) {

  tracks.map(track => {
    if (track.remaining_beats == 0) {
      //player[track.track_group.id].buffer=
      let trg = track.track_group.id
      let buffer_index = parseInt(Math.random() * (files_per_TRG[trg].length - 1))
      //console.log("Buffer index", buffer_index, files_per_TRG[trg].length)
      let f = files_per_TRG[trg][buffer_index]
      //console.log(f, files_by_id[f])
      players[trg].buffer = audio_buffers[f].get()
      players[trg].start(time)
      track.remaining_beats = parseInt(files_by_id[f].beats) - 1
      track.curr_file = files_by_id[f]
    } else {
      track.remaining_beats--
    }
    //console.log(track)

  })

}





</script>



<style scoped>
.track {
  border-style: solid;
  padding-left: 3px;

}

.slider {
  width: 300px;
}
</style>