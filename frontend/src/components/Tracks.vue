<template>
  <div>
    TRACK CONTROL
    <button @click="test">TEST</button>
    <div v-show="TrackCtrl.isReady == true">
      <el-button type="success" v-if="TrackCtrl.isPlaying == false" @click="start">START</el-button>
      <el-button type="danger" v-if="TrackCtrl.isPlaying == true" @click="stop">STOP</el-button>
    </div>

    <el-radio-group v-model="TrackCtrl.beats_x_bar">
      <el-radio label="3" border>3</el-radio>
      <el-radio label="4" border>4 </el-radio>
    </el-radio-group>
    <span>

      <el-slider class="slider" @change="onBPMSliderchange" v-model="TrackCtrl.tempo" :min="10" :max="160" />
      <span>{{
          store.tempo
      }} </span>
    </span>
    <div v-if="current_TAG.tag !== null">TAG=<span v-bind:style="{ 'background-color': current_TAG.tag.color }">{{
        current_TAG.tag.name
    }}</span><span>Duration:{{ current_TAG.duration }} Remaining:{{ current_TAG.remaining_beats }} </span></div>
    <span>TAG Time in bars. MIN={{ Math.pow(2, TAG_change_range[0]) }} MAX={{ Math.pow(2, TAG_change_range[1]) }}</span>
    <el-slider class="slider" v-model="TAG_change_range" range show-stops :show-tooltip="false" :min="5" :max="9" />

    TRACKS
    <el-row :gutter="20" v-for="(track, index) in tracks">
      <el-col :span="2" v-if="track.track_group"><span class="track"
          v-bind:style="{ 'background-color': track.track_group.color }"> {{
              track.track_group.name
          }} </span>
      </el-col>

      <el-col v-if="track.curr_file" :span="6">

        {{ track.curr_file.beats }} {{ track.remaining_beats + 1 }}
        <span v-if="track.curr_file.tag">TAG: {{ track.curr_file.tag_obj.name }}</span>


      </el-col>
      <el-col v-if="track.curr_file" :span="6">
        <el-progress :color="track.track_group.color" type="circle" :stroke-width="2" :duration=0 :show-text=false
          :percentage=track.percentage :width=20>
        </el-progress>

      </el-col>
      <el-col v-if="track.curr_file" :span="6">{{ track.curr_file.original_name_short }}</el-col>
    </el-row>

  </div>
</template>
<script setup>

import * as Tone from "tone"
import { ref, reactive } from "vue"
import { store, track_groups_by_id, tags_by_id, audio_buffers, files_by_id } from "../helpers/composable"
import { TrackCtrl, calculateBars } from "../helpers/TrackCtrl"

function test() {

  console.log("test")
  for (let k in audio_buffers) {
    //console.log(k)
    console.log(audio_buffers[k].loaded)
  }



}

let TAG_change_range = ref([5, 8])
let players = {}
let files_per_TRG = {}
let available_files_per_TRG = []
let files_per_TAG = []

let current_TAG = reactive({
  duration: 0,
  tag: null,
  curr_bar: 0,

  remaining_beats: 0
})

let available_tags = []

let available_trgs = []

let tracks = reactive([])

function onBPMSliderchange(value) {
  Tone.Transport.bpm = value
  calculateBars()
}

function stop() {
  TrackCtrl.isPlaying = false
  Tone.Transport.stop()
}

let a = 0
const loop = new Tone.Loop((time) => {
  //console.log(a++)
  //tt2.value++
  set_next_step(time + 0.1)
}, "4n")




function start() {


  //Tone.setContext(new Tone.Context({ latencyHint: "playback" }))

  TrackCtrl.isPlaying = true
  Tone.Transport.timeSignature = "4/4"
  Tone.Transport.bpm.value = TrackCtrl.tempo
  //Tone.Transport.bpm.value = 1
  //Tone.Transport.loop = true
  let selected_tgs = []
  let temp_trg = {}
  let temp_tag = {}
  tracks.splice(0)
  files_per_TRG = []



  for (let i = 0; i < store.files.length; i++) {
    let f = store.files[i]
    if (f.track_group) {
      temp_trg[f.track_group] = f.track_group
      if (!files_per_TRG[f.track_group]) {
        files_per_TRG[f.track_group] = []
      }
      files_per_TRG[f.track_group].push(f.id)
    }
    //console.log(f.tag)
    if (f.tag) {
      temp_tag[f.tag] = f.tag
      if (!files_per_TAG[f.tag]) { files_per_TAG[f.tag] = [] }
      files_per_TAG[f.tag].push(f.id)
    }
  }

  for (const [key, value] of Object.entries(temp_tag)) {
    available_tags.push(tags_by_id[key])
  }




  available_trgs = []
  for (const [key, value] of Object.entries(temp_trg)) {
    available_trgs.push(track_groups_by_id[value])
    // key y value traen el tag_id
    if (!players[value]) { players[value] = new Tone.Player().toDestination() }
    players[value].volume.value = -12

    tracks.push({
      percentage: 0,
      track_group: track_groups_by_id[value],
      curr_file: null,
      remaining_beats: 0
    })

  }

  //get_available_files_x_tag(current_TAG.value.id)


  //set_next_step(Tone.now())
  Tone.Transport.start()
  loop.start()
}
function selectTag() {
  let index = parseInt(Math.random() * available_tags.length)
  let base = parseInt((Math.random() * (TAG_change_range.value[1] - TAG_change_range.value[0])) + TAG_change_range.value[0])
  //console.log(TAG_change_range.value[0], TAG_change_range.value[1], base)
  current_TAG.duration = Math.pow(2, base)
  //console.log("current_TAG.duration", current_TAG.duration)
  current_TAG.remaining_beats = current_TAG.duration
  current_TAG.tag = available_tags[index]
  //console.log("current tag", current_TAG)

}
function get_available_files_x_tag(tag_id) {
  available_files_per_TRG = []
  //console.log("available_trgs.length!", available_trgs.length)
  for (let i = 0; i < available_trgs.length; i++) {
    let trg = available_trgs[i]
    //console.log("trg", trg)

    if (!available_files_per_TRG[trg.id]) { available_files_per_TRG[trg.id] = [] }

    for (let l = 0; l < files_per_TRG[trg.id].length; l++) {
      let a = files_per_TRG[trg.id][l]
      //console.log(a,)
      let f = files_by_id[a]
      //console.log("ee", f)
      if (f.tag == undefined || f.tag == tag_id) {
        available_files_per_TRG[f.track_group].push(a)
      }
    }
  }



}

function set_next_step(time) {


  current_TAG.remaining_beats--
  //console.log("current_TAG.remaining_beats", current_TAG.remaining_beats)
  if (current_TAG.remaining_beats < 0) {

    let old_tag = current_TAG.tag
    //console.log("Old tag", old_tag)
    if (!old_tag) old_tag = { id: "dumm" }
    selectTag()
    get_available_files_x_tag(current_TAG.tag.id)

    if (old_tag.id !== current_TAG.tag.id) {
      //console.log("cambió el tag")
      tracks.map(track => {

        //console.log("le camvio el tag al track", old_tag, track.curr_file?.tag)
        if (track.curr_file) {
          //console.log("TRack tiene current file")
          if (track.curr_file.tag) {
            //console.log("curr file tiene tag", track.curr_file.tag.id, old_tag)
            if (track.curr_file.tag.id !== old_tag.id)
              //console.log("le puse remaining beats 0", old_tag, track.curr_file.tag)
              track.remaining_beats = 0
          }
        }
      })
    }
  }

  tracks.map(track => {

    if (track.remaining_beats == 0) {
      if (available_files_per_TRG[track.track_group.id].length == 0) return
      //player[track.track_group.id].buffer=
      let trg = track.track_group.id
      let buffer_index = parseInt(Math.random() * (available_files_per_TRG[trg].length))
      //console.log("Buffer index", buffer_index, available_files_per_TRG[trg].length)
      let f = available_files_per_TRG[trg][buffer_index]
      //console.log("vvv", f, files_by_id[f])
      players[trg].buffer = audio_buffers[f].get()
      players[trg].start(time)
      track.curr_file = files_by_id[f]
      track.remaining_beats = parseInt(files_by_id[f].beats) - 1

    } else {
      track.remaining_beats--
      track.percentage = (100 / track.curr_file.beats) * (track.remaining_beats)
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