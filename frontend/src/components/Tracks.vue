<template>
  <div>
    TRACK CONTROL
    <button @click="reset">RESET</button>
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



      </el-col>
      <el-col v-if="track.curr_file" :span="6">
        <el-progress :color="track.track_group.color" type="circle" :stroke-width="3" :duration=6 :show-text=false
          :percentage=track.percentage :width=20>
        </el-progress>

      </el-col>
      <el-col v-if="track.curr_file" :span="6">{{ track.curr_file.original_name }}</el-col>
    </el-row>

  </div>
</template>
<script setup>

import { concat, toNumber } from "lodash";
import * as Tone from "tone"
import { ref, reactive } from "vue"
import { store, track_groups_by_id, tags_by_id, audio_players, files_by_id } from "../helpers/composable"
import { TrackCtrl, calculateBars } from "../helpers/TrackCtrl"

function reset() {



  tracks.map(track => {

    //console.log("le cambio el tag al track", old_tag, track.curr_file?.tag.name)
    if (track.curr_file) {
      track.remaining_beats = 0

      stop_file(track.curr_file.id, -1)
    }
  })
  selectTag()
  //set_next_step(-1)

}




let TAG_change_range = ref([6, 7])

let files_per_TRG = {}
let available_files_per_TRG = []
let files_per_TAG = []

let current_TAG = reactive({
  duration: 0,
  tag: null,
  curr_bar: 0,
  old_tag: null,

  remaining_beats: 0
})

let available_tags = []

let available_trgs = []

let tracks = reactive([])

function onBPMSliderchange(value) {
  Tone.Transport.bpm.value = value
  calculateBars()
}

function stop() {
  TrackCtrl.isPlaying = false
  Tone.Transport.stop()
  current_TAG.remaining_beats = 0
  tracks.map(track => {

    //console.log("le cambio el tag al track", old_tag, track.curr_file?.tag.name)
    if (track.curr_file) {
      track.remaining_beats = 0
      stop_file(track.curr_file.id, -1)
    }
  })
}

let a = 0

Tone.Transport.scheduleRepeat((time) => {
  // use the callback time to schedule events
  set_next_step(time)

}, "4n");

function start_file(id, time) {
  files_by_id[id].isPlaying = true
  audio_players[id].volume.value = files_by_id[id].props.volume
  audio_players[id].start(time)
}
function stop_file(id, time) {
  files_by_id[id].isPlaying = false
  audio_players[id].stop(time)
}


function start() {

  Tone.start()
  //Tone.setContext(new Tone.Context({ latencyHint: "playback" }))
  calculateBars()

  TrackCtrl.isPlaying = true
  Tone.Transport.timeSignature = "4/4"
  Tone.Transport.bpm.value = TrackCtrl.tempo
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
    tracks.push({
      percentage: 0,
      track_group: track_groups_by_id[value],
      curr_file: null,
      remaining_beats: 0
    })

  }
  selectTag()
  get_available_files_x_tag(current_TAG.tag.id)


  Tone.Transport.start()

}
function selectTag() {
  //console.log("llamaron a selectTag")
  let index = parseInt(Math.random() * available_tags.length)
  if (current_TAG.tag == null) {
    current_TAG.tag = { id: "nada", name: "vacio" }
  }
  current_TAG.old_tag = { ...current_TAG.tag }
  current_TAG.tag = available_tags[index]
  let base = parseInt((Math.random() * ((TAG_change_range.value[1] + 1) - (TAG_change_range.value[0]))) + (TAG_change_range.value[0]))
  //console.log(TAG_change_range.value[0], TAG_change_range.value[1], base)
  current_TAG.duration = Math.pow(2, base)
  //console.log("current_TAG.duration", current_TAG.dura1tion)
  current_TAG.remaining_beats = current_TAG.duration + 1

  //console.log("current tag", current_TAG)

}


function set_next_step(time) {



  //console.log("current_TAG.remaining_beats", current_TAG.remaining_beats)


  if (current_TAG.remaining_beats == 1) {
    //console.log("A buscar un TAG")

    selectTag()
    //console.log("Seleccioné nuevo tag", current_TAG.tag, current_TAG.old_tag)
    get_available_files_x_tag(current_TAG.tag.id)

    if ((current_TAG.old_tag.id !== current_TAG.tag.id)) {

      //console.log("cambió el tag", current_TAG.old_tag.id)
      tracks.map(track => {

        //console.log("le cambio el tag al track", old_tag, track.curr_file?.tag.name)
        if (track.curr_file) {
          //console.log("Track tiene current file")
          if (track.curr_file.tag) {

            //console.log("curr file tiene tag", tags_by_id[track.curr_file.tag], current_TAG.old_tag.name)
            if (track.curr_file.tag.id !== current_TAG.tag.id) {
              //if (true)
              //console.log("le puse remaining beats 0")
              track.remaining_beats = 0
              if (audio_players[track.curr_file.id].state == "started") {
                //console.log("estaba sonando, invoco audio stop", track.curr_file.original_name_short)
                stop_file(track.curr_file.id, -1)
              }
            }
          }
        }
      })
    }
  }
  current_TAG.remaining_beats--
  tracks.map(track => {

    if (track.remaining_beats == 0) {
      if (available_files_per_TRG[track.track_group.id].length == 0) return
      //player[track.track_group.id].buffer=
      //if (track.curr_file) {
      // audio_players[track.curr_file.id].stop(time)
      //}
      let trg = track.track_group.id
      let buffer_index = parseInt(Math.random() * (available_files_per_TRG[trg].length))
      //console.log("Buffer index", buffer_index, available_files_per_TRG[trg].length)
      let f = available_files_per_TRG[trg][buffer_index]
      //console.log("vvv", f, files_by_id[f])


      start_file(f, time)
      track.curr_file = files_by_id[f]
      track.remaining_beats = files_by_id[f].beats - 1

    } else {
      track.remaining_beats--
      track.percentage = (100 / track.curr_file.beats) * (track.remaining_beats)
    }
    //console.log(track)

  })

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