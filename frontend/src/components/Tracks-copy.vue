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

import { concat, toNumber } from "lodash";
import * as Tone from "tone"
import { ref, reactive } from "vue"
import { store, track_groups_by_id, tags_by_id, audio_players, files_by_id } from "../helpers/composable"
import { TrackCtrl, calculateBars } from "../helpers/TrackCtrl"

function test() {

  console.log("test")
  for (let k in audio_players) {
    //console.log(k)
    console.log(audio_players[k].loaded)
  }



}

let TAG_change_range = ref([5, 6])

le pepe = {}

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

Tone.Transport.scheduleRepeat((time) => {
  // use the callback time to schedule events
  set_next_step(time)

}, "4n");



async function start() {


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
  for (let i = 0; i < store.files.length; i++) {
    let f = store.files[i]
    if (f.track_group) {
      if (!pepe[f.track_group]) {
        pepe[f.track_group] = {}
      }

    }


    selectTag()
    get_available_files_x_tag(current_TAG.tag.id)


    await Tone.Transport.start()



  }
  function selectTag() {
    console.log("llamaron a selectTag")
    let index = parseInt(Math.random() * available_tags.length)
    current_TAG.tag = available_tags[index]
    let base = parseInt((Math.random() * (TAG_change_range.value[1] - (TAG_change_range.value[0] + 1))) + (TAG_change_range.value[0]))
    //console.log(TAG_change_range.value[0], TAG_change_range.value[1], base)
    current_TAG.duration = Math.pow(2, base)
    //console.log("current_TAG.duration", current_TAG.duration)
    current_TAG.remaining_beats = current_TAG.duration

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



    //console.log("current_TAG.remaining_beats", current_TAG.remaining_beats)
    current_TAG.remaining_beats--
    if (current_TAG.remaining_beats < 0) {
      console.log("Selecciono nuevo tag")
      let old_tag
      if (!current_TAG.tag) {
        old_tag = { ...current_TAG.tag }
      } else {
        old_tag = { id: "dummy", name: "epepe" }
      }
      selectTag()
      console.log("Seleccioné nuevo tag", current_TAG.tag.name)
      get_available_files_x_tag(current_TAG.tag.id)

      if ((old_tag.id !== current_TAG.tag.id) && false) {
        //console.log("cambió el tag")
        tracks.map(track => {

          //console.log("le cambio el tag al track", old_tag, track.curr_file?.tag.name)
          if (track.curr_file) {
            //console.log("Track tiene current file")
            if (track.curr_file.tag) {

              //console.log("curr file tiene tag", tags_by_id[track.curr_file.tag], old_tag.name)
              if (track.curr_file.tag.id !== old_tag.id)
                //if (true)
                //console.log("le puse remaining beats 0")
                track.remaining_beats = 0
              if (audio_players[track.curr_file.id].state == "started") {
                console.log("estaba sonando, invoco audio stop", track.curr_file.original_name_short)
                audio_players[track.curr_file.id].stop(time)
              }

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

        audio_players[f].start(time)
        track.curr_file = files_by_id[f]
        track.remaining_beats = files_by_id[f].beats - 1

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