<template>
  <div class="tracks_panel">
    <section class="hw_panel controls">
      <div class="brand silk">Transport</div>

      <div class="group transport">
        <LedButton size="big" led="green" :lit="TrackCtrl.isPlaying" :disabled="TrackCtrl.isReady != true"
          :text="TrackCtrl.isPlaying ? 'STOP' : 'START'" label="Play / stop"
          @click="TrackCtrl.isPlaying ? stop() : start()" />
        <LedButton text="RESET" label="New tag" @click="reset" />
      </div>

      <div class="group tempo">
        <Knob v-model="TrackCtrl.tempo" :min="10" :max="160" label="Tempo" @change="onBPMSliderchange" />
        <Lcd :value="TrackCtrl.tempo" :digits="3" unit="BPM" />
        <!-- posición del transporte: compás.tiempo -->
        <Lcd :value="bar_position" :digits="4" caption="Bar . beat" />
      </div>

      <div class="group">
        <ToggleSwitch v-model="TrackCtrl.beats_x_bar" label="Time sig"
          :options="[{ value: '3', label: '3/4' }, { value: '4', label: '4/4' }]" @change="onSignatureChange" />
      </div>

      <div class="group">
        <!-- placa de aluminio con los dos faders del rango de cambio de TAG -->
        <div class="hw_plate tag_range">
          <span class="silk plate_title">Tag change</span>
          <div class="faders">
            <Fader v-model="tag_range_min" :min="5" :max="9" :marks="tag_range_marks" :length="104" label="Min" />
            <Fader v-model="tag_range_max" :min="5" :max="9" :marks="tag_range_marks" :length="104" label="Max" />
          </div>
          <span class="silk plate_value">{{ Math.pow(2, TAG_change_range[0]) }}–{{ Math.pow(2, TAG_change_range[1]) }}
            beats</span>
        </div>
      </div>

      <!-- TAG actual: cuenta regresiva de beats hasta el próximo cambio -->
      <div class="group tag_now">
        <div class="tag_lcd">
          <span class="silk">Current tag</span>
          <Lcd :value="TrackCtrl.isPlaying ? current_TAG.remaining_beats : ''" :digits="3"
            :unit="current_TAG.tag ? '/' + current_TAG.duration + ' BEATS' : '/--- BEATS'">
            <span class="lcd_label">Tag</span>
            <span class="tag_name">
              <span v-if="current_TAG.tag" class="tag_color" :style="{ background: current_TAG.tag.color }"></span>{{
                current_TAG.tag?.name ?? "----" }}
            </span>
          </Lcd>
        </div>
        <!-- aviso de cambio de TAG: destella en los últimos 4 beats -->
        <div class="warn">
          <Led color="red" :pulse="TrackCtrl.isPlaying && current_TAG.remaining_beats <= 4 ? beat.n : null" />
          <span class="silk dim">Change</span>
        </div>
      </div>
    </section>

    <section class="hw_panel tracks_list" v-if="tracks.length">
      <div class="strips_head">
        <span class="silk">Tracks</span>
        <Led color="green" :pulse="beat.downbeat ? null : beat.n" />
        <Led color="red" :pulse="beat.downbeat ? beat.n : null" />
        <span class="silk dim">Beat</span>
      </div>
      <div class="strips">
        <div class="strip" v-for="(track, index) in tracks" :key="index" :title="track.curr_file?.original_name"
          :class="{ silenced: track.track_group && is_silenced(track.track_group.id) }">
          <span class="strip_color" :style="{ background: track.track_group?.color }"></span>
          <span class="silk strip_name">{{ track.track_group?.name }}</span>
          <!-- LED de actividad: destella en cada beat mientras la pista suena, en rojo al reiniciar el loop -->
          <Led :color="track.curr_file && track_beat(track) == 1 ? 'red' : 'green'"
            :pulse="track.curr_file && TrackCtrl.isPlaying ? beat.n : null" />
          <!-- vúmetro real de la pista (nivel RMS con pico retenido) -->
          <LedMeter :value="levels.trgs[track.track_group?.id]?.level ?? 0"
            :peak="levels.trgs[track.track_group?.id]?.peak ?? 0" />
          <Lcd small :digits="2" :value="track.curr_file ? track_beat(track) : ''"
            :unit="track.curr_file ? '/' + track.curr_file.beats : ''" />
          <!-- posición dentro del loop -->
          <StepLeds :pos="track.curr_file && TrackCtrl.isPlaying ? track_beat(track) : 0"
            :beats="track.curr_file?.beats ?? 0" />
          <span class="file_name">{{ track.curr_file?.original_name ?? "—" }}</span>
          <!-- mute / solo de la pista (se mantienen entre START y START) -->
          <div class="mute_solo">
            <LedButton size="small" text="M" led="red" :lit="!!mixer.mute[track.track_group?.id]"
              @click="toggle_mute(track.track_group.id)" />
            <LedButton size="small" text="S" led="yellow" :lit="!!mixer.solo[track.track_group?.id]"
              @click="toggle_solo(track.track_group.id)" />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
<script setup>

import * as Tone from "tone"
import { ref, reactive, computed } from "vue"
import { store, track_groups_by_id, tags_by_id, audio_players, files_by_id } from "../helpers/composable"
import { TrackCtrl, calculateBars } from "../helpers/TrackCtrl"
import Knob from "./hw/Knob.vue"
import Lcd from "./hw/Lcd.vue"
import ToggleSwitch from "./hw/ToggleSwitch.vue"
import LedButton from "./hw/LedButton.vue"
import Led from "./hw/Led.vue"
import LedMeter from "./hw/LedMeter.vue"
import StepLeds from "./hw/StepLeds.vue"
import { levels, mixer, route_player, toggle_mute, toggle_solo, is_silenced } from "../helpers/mixer"
import Fader from "./hw/Fader.vue"

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

// faders del rango (exponente n de 2^n beats): mover uno empuja al otro para que siempre min <= max
const tag_range_marks = [5, 6, 7, 8, 9].map(n => ({ value: n, label: Math.pow(2, n) }))
const tag_range_min = computed({
  get: () => TAG_change_range.value[0],
  set: (v) => { TAG_change_range.value = [v, Math.max(v, TAG_change_range.value[1])] }
})
const tag_range_max = computed({
  get: () => TAG_change_range.value[1],
  set: (v) => { TAG_change_range.value = [Math.min(v, TAG_change_range.value[0]), v] }
})

let files_per_TRG = {}
let available_files_per_TRG = []
let files_per_TAG = []

// el estado del TAG y de los tracks vive en TrackCtrl para que otros componentes (pads) lo lean
let current_TAG = TrackCtrl.current_TAG

let available_tags = []

let available_trgs = []

let tracks = TrackCtrl.tracks

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

  // indicadores visuales: Tone.Draw los dispara cuando el beat suena de verdad (no en el lookahead)
  let n = Math.round(Tone.Transport.getTicksAtTime(time) / Tone.Transport.PPQ)
  Tone.Draw.schedule(() => {
    beat.downbeat = n % parseInt(TrackCtrl.beats_x_bar) == 0
    beat.n = n
  }, time)
}, "4n")

// beat del transporte (para los LEDs); downbeat = primer tiempo del compás
const beat = reactive({ n: 0, downbeat: false })

// compás y tiempo del transporte para el LCD ("12.3"); vacío con el transporte detenido
const bar_position = computed(() => {
  if (!TrackCtrl.isPlaying) return ""
  let bpb = parseInt(TrackCtrl.beats_x_bar)
  return (Math.floor(beat.n / bpb) % 1000 + 1) + "." + (beat.n % bpb + 1)
})

// beat actual (1..beats) del loop que suena en la pista
function track_beat(track) {
  return track.curr_file.beats - track.remaining_beats
}

function start_file(id, time) {
  files_by_id[id].isPlaying = true
  audio_players[id].volume.value = files_by_id[id].props.volume
  route_player(id)
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
    // un archivo puede tener varios tags: cuenta en cada uno
    for (let tag of f.tags) {
      temp_tag[tag] = tag
      if (!files_per_TAG[tag]) { files_per_TAG[tag] = [] }
      files_per_TAG[tag].push(f.id)
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

  beat.n = 0 // el transporte arranca de cero; evita mostrar la posición de la corrida anterior
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
          if (track.curr_file.tags.length > 0) {

            // solo se cortan los loops que no tienen el tag nuevo; los que tienen varios tags
            // (p.ej. A y B) siguen sonando al pasar de A a B
            if (!track.curr_file.tags.includes(current_TAG.tag?.id)) {
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
      // sin tags = compatible con cualquier tag
      if (f.tags.length == 0 || f.tags.includes(tag_id)) {
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
  align-items: center;
  gap: 18px 0;
  padding-top: 34px;
}

/* cada sección del panel separada por una línea serigrafiada */
.group {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  border-left: 1px solid rgba(228, 225, 216, 0.18);
}

.group:nth-child(2) {
  border-left: 0;
  padding-left: 4px;
}

.faders {
  display: flex;
  gap: 6px;
}

.plate_value {
  letter-spacing: 1px;
}

.brand {
  position: absolute;
  top: 10px;
  left: 30px;
  font-size: 12px;
  letter-spacing: 3px;
}

.tag_now {
  margin-left: auto;
}

.tag_lcd {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lcd_label {
  font-size: 9px;
  letter-spacing: 1.5px;
  opacity: 0.75;
}

.tag_name {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  letter-spacing: 1px;
}

/* color del TAG como una pegatina sobre el LCD */
.tag_color {
  flex: none;
  width: 10px;
  height: 10px;
  border: 1px solid rgba(0, 0, 0, 0.5);
  border-radius: 2px;
}

.warn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

/* el panel de tracks ocupa solo el ancho de sus tiras */
.tracks_list {
  align-self: flex-start;
  max-width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.strips_head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 8px;
}

.dim {
  opacity: 0.6;
}

.strips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/* tira de canal: plástico negro hundido en el chasis */
.strip {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 112px;
  padding: 14px 8px 10px;
  border-radius: 4px;
  background: var(--hw_tex_plastic) center / cover, #151517;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.7), 0 1px 0 rgba(255, 255, 255, 0.07);
  overflow: hidden;
}

/* pista que no se escucha (mute, u otra en solo): se apaga el nombre y el archivo */
.strip.silenced .strip_name,
.strip.silenced .file_name {
  opacity: 0.3;
}

.mute_solo {
  display: flex;
  gap: 6px;
}

.strip_color {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
}

.strip_name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file_name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--hw_silk);
  opacity: 0.6;
  font-size: 10px;
}
</style>
