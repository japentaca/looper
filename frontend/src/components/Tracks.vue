<template>
  <div class="tracks_panel">
    <section class="card controls">
      <div class="transport">
        <div v-show="TrackCtrl.isReady == true">
          <el-button type="success" size="large" v-if="TrackCtrl.isPlaying == false" @click="start">START</el-button>
          <el-button type="danger" size="large" v-if="TrackCtrl.isPlaying == true" @click="stop">STOP</el-button>
        </div>
        <el-button size="large" @click="reset">RESET</el-button>
      </div>

      <div class="control">
        <span class="label">Compás</span>
        <el-radio-group v-model="TrackCtrl.beats_x_bar" @change="onSignatureChange">
          <el-radio-button label="3">3/4</el-radio-button>
          <el-radio-button label="4">4/4</el-radio-button>
        </el-radio-group>
      </div>

      <div class="control grow">
        <span class="label">Tempo <b class="value">{{ TrackCtrl.tempo }} BPM</b></span>
        <el-slider @change="onBPMSliderchange" v-model="TrackCtrl.tempo" :min="10" :max="160" />
      </div>

      <div class="control grow">
        <span class="label">Cambio de TAG cada (beats, 2^n)
          <b class="value">{{ Math.pow(2, TAG_change_range[0]) }} – {{ Math.pow(2, TAG_change_range[1]) }}</b></span>
        <el-slider v-model="TAG_change_range" range show-stops :show-tooltip="false" :min="5" :max="9" />
      </div>
    </section>

    <section class="card tag_now" v-if="current_TAG.tag">
      <span class="label">TAG actual</span>
      <span class="chip" :style="{ background: current_TAG.tag.color }">{{ current_TAG.tag.name }}</span>
      <el-progress class="tag_progress" :percentage="tag_percent" :show-text="false" :stroke-width="6" />
      <span class="muted">{{ current_TAG.remaining_beats }} / {{ current_TAG.duration }} beats</span>
    </section>

    <section class="card tracks_list" v-if="tracks.length">
      <div class="label">Tracks</div>
      <div class="track_row" v-for="(track, index) in tracks" :key="index">
        <span class="chip track_name" v-if="track.track_group" :style="{ background: track.track_group.color }">{{
          track.track_group.name }}</span>
        <template v-if="track.curr_file">
          <span class="beats">{{ track.remaining_beats + 1 }} / {{ track.curr_file.beats }}</span>
          <el-progress class="track_progress" :color="track.track_group.color" :percentage="track.percentage"
            :show-text="false" :stroke-width="6" />
          <span class="file_name">{{ track.curr_file.original_name }}</span>
        </template>
      </div>
    </section>
  </div>
</template>
<script setup>

import * as Tone from "tone"
import { ref, reactive, computed } from "vue"
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

// porcentaje del TAG ya transcurrido (la barra avanza de 0 a 100)
const tag_percent = computed(() => {
  if (!current_TAG.duration) return 0
  let hecho = current_TAG.duration - current_TAG.remaining_beats
  return Math.min(100, Math.max(0, (100 / current_TAG.duration) * hecho))
})

let available_tags = []

let available_trgs = []

let tracks = reactive([])

function onBPMSliderchange(value) {
  Tone.Transport.bpm.value = value
  calculateBars()
}

function onSignatureChange(value) {
  Tone.Transport.timeSignature = parseInt(value)
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


Tone.Transport.scheduleRepeat((time) => {
  // use the callback time to schedule events
  set_next_step(time)

}, "4n")

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
  Tone.Transport.timeSignature = parseInt(TrackCtrl.beats_x_bar)
  Tone.Transport.bpm.value = TrackCtrl.tempo
  let temp_trg = {}
  let temp_tag = {}
  tracks.splice(0)
  files_per_TRG = []
  files_per_TAG = []
  available_tags = []




  for (let i = 0; i < store.files.length; i++) {
    let f = store.files[i]
    if (!f.isLoaded) continue // sin buffer, Tone no lo puede reproducir
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

  for (const key of Object.keys(temp_tag)) {
    available_tags.push(tags_by_id[key])
  }

  available_trgs = []
  for (const value of Object.values(temp_trg)) {
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
  get_available_files_x_tag(current_TAG.tag?.id)


  Tone.Transport.start()

}
function selectTag() {
  //console.log("llamaron a selectTag")
  let index = parseInt(Math.random() * available_tags.length)
  if (current_TAG.tag == null) {
    current_TAG.tag = { id: "nada", name: "vacio" }
  }
  current_TAG.old_tag = { ...current_TAG.tag }
  current_TAG.tag = available_tags[index] ?? null
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
    get_available_files_x_tag(current_TAG.tag?.id)

    if ((current_TAG.old_tag.id !== current_TAG.tag?.id)) {

      //console.log("cambió el tag", current_TAG.old_tag.id)
      tracks.map(track => {

        //console.log("le cambio el tag al track", old_tag, track.curr_file?.tag.name)
        if (track.curr_file) {
          //console.log("Track tiene current file")
          if (track.curr_file.tag) {

            //console.log("curr file tiene tag", tags_by_id[track.curr_file.tag], current_TAG.old_tag.name)
            // file.tag es el id (string); solo se cortan los loops de un tag distinto al nuevo
            if (track.curr_file.tag !== current_TAG.tag?.id) {
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
.tracks_panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  padding: 14px 16px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 20px 28px;
}

.transport {
  display: flex;
  gap: 8px;
}

.control {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.control.grow {
  flex: 1;
  min-width: 220px;
  padding: 0 8px;
}

.label {
  font-size: 11px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--muted);
}

.value {
  margin-left: 6px;
  color: var(--text);
  letter-spacing: 0;
}

.muted {
  color: var(--muted);
  font-size: 12px;
}

.chip {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  color: #111;
  font-size: 12px;
  font-weight: 600;
}

.tag_now {
  display: flex;
  align-items: center;
  gap: 14px;
}

.tag_progress {
  flex: 1;
}

.tracks_list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.track_row {
  display: grid;
  grid-template-columns: 120px 70px 1fr minmax(0, 260px);
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  border-top: 1px solid var(--border);
}

.track_name {
  justify-self: start;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.beats {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.file_name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 12px;
}
</style>
