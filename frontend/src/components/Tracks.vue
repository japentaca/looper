<template>
  <div class="tracks_panel">
    <section class="hw_panel controls">
      <div class="brand silk">Transport</div>

      <div class="group transport">
        <LedButton size="big" led="green" :lit="TrackCtrl.isPlaying" :disabled="TrackCtrl.isReady != true"
          :text="TrackCtrl.isPlaying ? 'STOP' : 'START'" label="Play / stop"
          @click="TrackCtrl.isPlaying ? stop() : request_start()" />
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

      <!-- delay global sincronizado al tempo (TrackCtrl.delay, guardado en users.props). Cada pista le
        manda señal con su knob "Dly" -->
      <div class="group delay">
        <div class="delay_sel">
          <span class="silk">Delay</span>
          <Lcd small :digits="0">
            <span class="delay_lcd">{{ DELAY_TYPE_LABELS[TrackCtrl.delay.type] }} {{
              DELAY_DIVISION_LABELS[TrackCtrl.delay.division] }}</span>
          </Lcd>
          <div class="delay_btns">
            <LedButton size="small" text="TYPE" title="Tipo de delay (cicla)" @click="cycle_delay('type', DELAY_TYPES)" />
            <LedButton size="small" text="TIME" title="División del tempo (cicla)"
              @click="cycle_delay('division', Object.keys(DELAY_DIVISIONS))" />
          </div>
        </div>
        <Knob :model-value="TrackCtrl.delay.feedback" :min="0" :max="DELAY_FEEDBACK_MAX" :step="0.05" :size="48"
          label="Feedback" :title="'Feedback ' + Math.round(TrackCtrl.delay.feedback * 100) + '%'"
          @update:model-value="v => set_delay_cfg('feedback', Math.round(v * 100) / 100)" />
        <Knob :model-value="TrackCtrl.delay.level" :min="DELAY_LEVEL_MIN" :max="DELAY_LEVEL_MAX" :step="1" :size="48"
          label="Level" :title="'Delay return ' + TrackCtrl.delay.level + ' dB'"
          @update:model-value="v => set_delay_cfg('level', v)" />
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

    <!-- una tira por track group (pista), también con el transporte detenido y sin archivos -->
    <section class="hw_panel tracks_list" v-if="strips.length">
      <div class="strips_head">
        <span class="silk">Tracks</span>
        <Led color="green" :pulse="beat.downbeat ? null : beat.n" />
        <Led color="red" :pulse="beat.downbeat ? beat.n : null" />
        <span class="silk dim">Beat</span>
      </div>
      <div class="strips">
        <div class="strip" v-for="{ trg, track } in strips" :key="trg.id" :title="strip_file(trg, track)?.original_name"
          :class="{ silenced: is_silenced(trg.id) }">
          <span class="strip_color" :style="{ background: trg.color }"></span>
          <span class="silk strip_name">{{ trg.name }}</span>
          <!-- modo de la pista: loop (sortea loops encadenados) u one-shot (disparos sueltos), en props.mode -->
          <LedButton size="small" :text="is_oneshot(trg) ? 'SHOT' : 'LOOP'" led="yellow" :lit="is_oneshot(trg)"
            :title="is_oneshot(trg) ? 'One-shot: pasar a loop' : 'Loop: pasar a one-shot'" @click="toggle_mode(trg)" />
          <!-- LED de actividad one-shot: destella (amarillo) en cada disparo -->
          <Led v-if="is_oneshot(trg)" color="yellow" :pulse="track && TrackCtrl.isPlaying ? track.shot_n : null" />
          <!-- LED de actividad loop: destella en cada beat mientras la pista suena, en rojo al reiniciar el loop -->
          <Led v-else :color="track?.curr_file && track_beat(track) == 1 ? 'red' : 'green'"
            :pulse="track?.curr_file && TrackCtrl.isPlaying ? beat.n : null" />
          <!-- vúmetro real de la pista (nivel RMS con pico retenido) -->
          <LedMeter :value="levels.trgs[trg.id]?.level ?? 0" :peak="levels.trgs[trg.id]?.peak ?? 0" />
          <!-- one-shot: el LCD solo rotula SHOT (no hay posición de loop) -->
          <Lcd v-if="is_oneshot(trg)" small :digits="2" value="" unit="SHOT" />
          <!-- en descanso no hay archivo: el LCD queda en blanco con el rótulo REST -->
          <Lcd v-else small :digits="2" :value="track?.curr_file ? track_beat(track) : ''"
            :unit="track?.curr_file ? '/' + track.curr_file.beats : (track?.resting && TrackCtrl.isPlaying ? 'REST' : '')" />
          <!-- posición dentro del loop (no aplica a one-shot) -->
          <StepLeds v-if="!is_oneshot(trg)" :pos="track?.curr_file && TrackCtrl.isPlaying ? track_beat(track) : 0"
            :beats="track?.curr_file?.beats ?? 0" />
          <!-- loop: archivo que suena; one-shot: último disparo -->
          <span class="file_name">{{ strip_file(trg, track)?.original_name ?? "—" }}</span>
          <!-- one-shot: densidad (probabilidad de disparo por compás, props.density) y disparo al empezar
            cada Tag (props.on_tag_change) -->
          <div v-if="is_oneshot(trg)" class="oneshot_ctrls">
            <Knob :model-value="trg.props.density ?? 0" :min="0" :max="1" :step="0.05" :size="36" label="Dens"
              :title="'Density ' + Math.round((trg.props.density ?? 0) * 100) + '% por compás'"
              @update:model-value="v => set_density(trg, v)" />
            <LedButton size="small" text="TAG" led="red" :lit="!!trg.props.on_tag_change"
              title="Disparar al empezar cada Tag" @click="toggle_on_tag_change(trg)" />
          </div>
          <!-- probabilidad de descanso al terminar cada loop (0..1, guardada en props.rest) -->
          <Knob v-else :model-value="trg.props.rest ?? 0" :min="0" :max="1" :step="0.05" :size="36" label="Rest"
            :title="'Rest ' + Math.round((trg.props.rest ?? 0) * 100) + '%'" @update:model-value="v => set_rest(trg, v)" />
          <!-- volumen de la pista (dB, guardado en props.volume) -->
          <Fader :model-value="trg.props.volume" :min="-48" :max="6" :length="84" :marks="strip_volume_marks"
            label="Vol" :title="trg.props.volume + ' dB'" @update:model-value="v => set_volume(trg.id, v)" />
          <!-- efectos: send a la reverb compartida (props.reverb, dB; al mínimo = nada), send al delay global
            (props.delay, ídem) y modulación lenta del filtro y del send de reverb (props.drift, 0..1) -->
          <div class="fx_ctrls">
            <Knob :model-value="trg.props.reverb ?? REV_OFF_DB" :min="REV_OFF_DB" :max="0" :step="1" :size="36"
              label="Rev" :title="trg.props.reverb == null ? 'Reverb: off' : 'Reverb send ' + trg.props.reverb + ' dB'"
              @update:model-value="v => set_reverb(trg.id, v)" />
            <Knob :model-value="trg.props.delay ?? DLY_OFF_DB" :min="DLY_OFF_DB" :max="0" :step="1" :size="36"
              label="Dly" :title="trg.props.delay == null ? 'Delay: off' : 'Delay send ' + trg.props.delay + ' dB'"
              @update:model-value="v => set_delay(trg.id, v)" />
            <Knob :model-value="trg.props.drift ?? 0" :min="0" :max="1" :step="0.05" :size="36" label="Drift"
              :title="'Drift ' + Math.round((trg.props.drift ?? 0) * 100) + '%'"
              @update:model-value="v => set_drift(trg.id, Math.round(v * 100) / 100)" />
          </div>
          <!-- mute / solo de la pista (guardados en props) -->
          <div class="mute_solo">
            <LedButton size="small" text="M" led="red" :lit="!!trg.props.mute" @click="toggle_mute(trg.id)" />
            <LedButton size="small" text="S" led="yellow" :lit="!!trg.props.solo" @click="toggle_solo(trg.id)" />
          </div>
        </div>
      </div>
    </section>

    <!-- respaldo cuando el navegador no deja sonar el audio sin un gesto (autostart, o el AudioContext
      quedó suspendido y no se pudo reanudar solo): un clic en cualquier parte reanuda y arranca -->
    <div v-if="need_gesture" class="gesture_overlay" @click="gesture_start">
      <!-- sin @click propio: el clic nativo del botón sube al overlay (un solo gesture_start) -->
      <LedButton size="big" led="green" :lit="true" :text="TrackCtrl.isPlaying ? 'RESUME' : 'START'" />
      <span class="silk gesture_text">Click to start</span>
    </div>
  </div>
</template>
<script setup>

import * as Tone from "tone"
import { ref, reactive, computed, watch, onBeforeUnmount } from "vue"
import {
  store, tags_by_id, audio_players, files_by_id, save_trackGroups_debounced, save_user_props_debounced
} from "../helpers/composable"
import {
  TrackCtrl, calculateBars, DELAY_TYPES, DELAY_DIVISIONS, DELAY_FEEDBACK_MAX, DELAY_LEVEL_MIN, DELAY_LEVEL_MAX
} from "../helpers/TrackCtrl"
import Knob from "./hw/Knob.vue"
import Lcd from "./hw/Lcd.vue"
import ToggleSwitch from "./hw/ToggleSwitch.vue"
import LedButton from "./hw/LedButton.vue"
import Led from "./hw/Led.vue"
import LedMeter from "./hw/LedMeter.vue"
import StepLeds from "./hw/StepLeds.vue"
import {
  levels, route_player, toggle_mute, toggle_solo, set_volume, is_silenced,
  set_reverb, set_drift, start_drift, stop_drift, REV_OFF_DB, set_delay, DLY_OFF_DB
} from "../helpers/mixer"
import Fader from "./hw/Fader.vue"

function reset() {



  tracks.map(track => {

    //console.log("le cambio el tag al track", old_tag, track.curr_file?.tag.name)
    if (track.curr_file) {
      track.remaining_beats = 0

      stop_file(track.curr_file.id, -1)
    }
    // un descanso en curso también se corta: la pista vuelve a sortear con el Tag nuevo
    if (track.resting) {
      track.resting = false
      track.remaining_beats = 0
    }
  })
  selectTag()
  // los disponibles tienen que ser los del Tag nuevo (antes RESET seguía sorteando con los del anterior)
  get_available_files_x_tag(current_TAG.tag?.id)
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

// tiras a mostrar: todos los track groups, con el estado de su track si el transporte ya arrancó
const strips = computed(() => store.track_groups.map(trg => ({
  trg,
  track: tracks.find(t => t.track_group?.id === trg.id) ?? null
})))
const strip_volume_marks = [0, -12, -24, -48].map(v => ({ value: v, label: v }))

// probabilidad de descanso de la pista (se llama mientras se mueve el knob; el guardado es diferido)
function set_rest(trg, v) {
  trg.props.rest = Math.round(v * 100) / 100 // evita 0.15000000000000002
  save_trackGroups_debounced()
}

// --- pistas one-shot (props.mode == "oneshot") ---
function is_oneshot(trg) {
  return trg?.props?.mode == "oneshot"
}
// el motor toma el modo nuevo en el próximo beat (ver set_next_step)
function toggle_mode(trg) {
  trg.props.mode = is_oneshot(trg) ? "loop" : "oneshot"
  save_trackGroups_debounced()
}
// probabilidad de disparo por compás (0..1)
function set_density(trg, v) {
  trg.props.density = Math.round(v * 100) / 100
  save_trackGroups_debounced()
}
function toggle_on_tag_change(trg) {
  trg.props.on_tag_change = !trg.props.on_tag_change
  save_trackGroups_debounced()
}
// archivo a mostrar en la tira: el loop que suena o el último disparo one-shot
function strip_file(trg, track) {
  return is_oneshot(trg) ? track?.last_shot : track?.curr_file
}

// el tiempo del delay sigue a TrackCtrl.tempo solo (watch en mixer.js), también mientras se mueve el knob
function onBPMSliderchange(value) {
  Tone.Transport.bpm.value = value
  calculateBars()
  save_user_props_debounced()
}

function onSignatureChange(value) {
  Tone.Transport.timeSignature = parseInt(value)
  calculateBars()
  save_user_props_debounced()
}

// --- delay global (TrackCtrl.delay; mixer.js lo aplica con watchers) ---
const DELAY_TYPE_LABELS = { pingpong: "PING", stereo: "STEREO", dotted: "DOTTED", tape: "TAPE" }
const DELAY_DIVISION_LABELS = { "16n": "1/16", "8t": "1/8T", "8n": "1/8", "8n.": "1/8.", "4n": "1/4", "4n.": "1/4.", "2n": "1/2" }
function set_delay_cfg(key, v) {
  TrackCtrl.delay[key] = v
  save_user_props_debounced()
}
// los botones TYPE y TIME pasan a la opción siguiente (vuelven a la primera después de la última)
function cycle_delay(key, options) {
  let i = options.indexOf(TrackCtrl.delay[key])
  set_delay_cfg(key, options[(i + 1) % options.length])
}

function stop() {
  TrackCtrl.isPlaying = false
  Tone.Transport.stop()
  stop_drift() // elimina el Tone.Loop del drift y vuelve filtros y sends a su base
  current_TAG.remaining_beats = 0
  tracks.map(track => {

    //console.log("le cambio el tag al track", old_tag, track.curr_file?.tag.name)
    if (track.curr_file) {
      track.remaining_beats = 0
      stop_file(track.curr_file.id, -1)
    }
    track.resting = false
    // one-shot: se cortan los disparos que sigan sonando (pueden ser varios archivos superpuestos)
    if (is_oneshot(track.track_group)) {
      for (const id of files_per_TRG[track.track_group.id] ?? []) {
        if (audio_players[id]?.state == "started") stop_file(id, -1)
      }
    }
  })
}


// un solo scheduleRepeat por instancia del componente (no por START): STOP detiene el transporte pero
// no lo borra, y el próximo START lo reutiliza desde el tiempo 0. Se borra al desmontar.
const beat_repeat_id = Tone.Transport.scheduleRepeat((time) => {
  // número de beat y downbeat calculados desde los ticks del transporte en `time` (no del estado visual)
  let n = Math.round(Tone.Transport.getTicksAtTime(time) / Tone.Transport.PPQ)
  let downbeat = n % parseInt(TrackCtrl.beats_x_bar) == 0

  // use the callback time to schedule events
  set_next_step(time, n, downbeat)

  // indicadores visuales: Tone.Draw los dispara cuando el beat suena de verdad (no en el lookahead)
  Tone.Draw.schedule(() => {
    beat.downbeat = downbeat
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
  let temp_tag = {}
  tracks.splice(0)
  files_per_TRG = []
  files_per_TAG = []
  available_tags = []




  for (let i = 0; i < store.files.length; i++) {
    let f = store.files[i]
    if (!f.isLoaded) continue // sin buffer, Tone no lo puede reproducir
    if (f.track_group) {
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
  // un track por cada track group, tenga o no archivos (sin archivos queda en silencio)
  for (const trg of store.track_groups) {
    if (!files_per_TRG[trg.id]) files_per_TRG[trg.id] = []
    available_trgs.push(trg)
    tracks.push({
      percentage: 0,
      track_group: trg,
      curr_file: null,
      remaining_beats: 0,
      resting: false, // true mientras la pista descansa (ver props.rest en set_next_step)
      last_shot: null, // one-shot: último archivo disparado (para la tira)
      shot_n: null // one-shot: beat del último disparo (hace destellar el LED de la tira)
    })
  }
  selectTag()
  get_available_files_x_tag(current_TAG.tag?.id)

  beat.n = 0 // el transporte arranca de cero; evita mostrar la posición de la corrida anterior
  start_drift() // modulación lenta de filtro y send (un Tone.Loop por compás, desde el tiempo 0)
  Tone.Transport.start()

}

// --- arranque con o sin gesto del usuario (autostart) y recuperación del AudioContext ---

// true = mostrar el overlay "Click to start": el navegador no deja reanudar el audio sin un gesto
const need_gesture = ref(false)
let starting = false

// espera a que el AudioContext quede "running" (como mucho `ms`). Tone.start() / resume() sin gesto
// pueden quedar pendientes para siempre, por eso la carrera con un timeout (no es audio: setTimeout está bien)
function try_resume(ms = 500) {
  let resume = Promise.resolve(Tone.start()).catch(() => { })
  return Promise.race([resume, new Promise(r => setTimeout(r, ms))])
    .then(() => Tone.context.state == "running")
}

// START pedido por el botón o por el autostart. Con un clic, Tone.start() reanuda el contexto ya;
// sin gesto (autostart) puede quedar bloqueado: entonces se muestra el overlay y no se arranca.
async function request_start() {
  if (TrackCtrl.isPlaying || starting) return
  starting = true
  try {
    if (Tone.context.state != "running" && !(await try_resume())) {
      need_gesture.value = true
      return
    }
    need_gesture.value = false
    if (!TrackCtrl.isPlaying) start()
  } finally {
    starting = false
  }
}

// clic en el overlay: es un gesto, así que Tone.start() sí reanuda. Si el transporte ya corría (el
// contexto se había suspendido) solo se reanuda; si no, se hace START.
async function gesture_start() {
  if (!(await try_resume(2000))) return // sigue el overlay
  need_gesture.value = false
  if (!TrackCtrl.isPlaying) start()
}

// autostart: con ?autostart=1 en la URL se hace START solo, una vez por carga de página, cuando
// terminan de cargar los audios (TrackCtrl.isReady). Una recarga posterior (subida, re-login) no rearranca.
const autostart = new URLSearchParams(window.location.search).get("autostart") == "1"
let autostarted = false
watch(() => TrackCtrl.isReady, (ready) => {
  if (!ready || !autostart || autostarted) return
  autostarted = true
  request_start()
}, { immediate: true })

// recuperación: si con el transporte corriendo el AudioContext pasa a "suspended" o "interrupted"
// (otra app tomó el audio, el SO lo suspendió, cambió el dispositivo de salida...) se reintenta
// resume() con backoff (1 s, 2 s, 4 s... hasta 30 s entre intentos, sin límite de intentos mientras
// el transporte siga en marcha). Después de 3 intentos fallidos se muestra además el overlay.
const RESUME_MAX_DELAY_MS = 30000
const RESUME_TRIES_BEFORE_OVERLAY = 3
let resume_tries = 0
let resume_timer = null

function on_context_state() {
  let st = Tone.context.state
  if (st == "running") {
    clearTimeout(resume_timer)
    resume_timer = null
    resume_tries = 0
    need_gesture.value = false
    return
  }
  if (st == "closed") return
  if (TrackCtrl.isPlaying) schedule_resume()
}

function schedule_resume() {
  if (resume_timer) return
  let delay = Math.min(RESUME_MAX_DELAY_MS, 1000 * Math.pow(2, resume_tries))
  resume_timer = setTimeout(async () => {
    resume_timer = null
    // con el transporte detenido no se insiste (el próximo START reanuda)
    if (!TrackCtrl.isPlaying || await try_resume(1000)) return
    resume_tries++
    if (resume_tries >= RESUME_TRIES_BEFORE_OVERLAY) need_gesture.value = true
    schedule_resume()
  }, delay)
}

// un solo listener por instancia del componente (no por START); se quita al desmontar
Tone.context.on("statechange", on_context_state)
onBeforeUnmount(() => {
  Tone.context.off("statechange", on_context_state)
  clearTimeout(resume_timer)
  Tone.Transport.clear(beat_repeat_id)
})

// true desde que se elige un Tag hasta que set_next_step procesa su primer beat
let tag_starting = false
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
  // el próximo beat que procese set_next_step es el primero del Tag nuevo (ahí disparan los one-shot
  // con on_tag_change). Llamado desde set_next_step es ese mismo beat; desde start() o reset(), el siguiente.
  tag_starting = true

  //console.log("current tag", current_TAG)

}


function set_next_step(time, n, downbeat) {



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
  let tag_start = tag_starting
  tag_starting = false
  tracks.map(track => {

    // las pistas one-shot no usan remaining_beats ni descansos: solo deciden si disparan en este beat
    if (is_oneshot(track.track_group)) {
      oneshot_step(track, time, n, tag_start, downbeat)
      return
    }

    if (track.remaining_beats == 0) {
      track.resting = false
      // pista sin archivos (o sin ninguno compatible con el Tag): queda en silencio
      if (!available_files_per_TRG[track.track_group.id]?.length) return
      //player[track.track_group.id].buffer=
      //if (track.curr_file) {
      // audio_players[track.curr_file.id].stop(time)
      //}
      let trg = track.track_group.id
      let buffer_index = parseInt(Math.random() * (available_files_per_TRG[trg].length))
      //console.log("Buffer index", buffer_index, available_files_per_TRG[trg].length)
      let f = available_files_per_TRG[trg][buffer_index]
      //console.log("vvv", f, files_by_id[f])

      // descanso: con probabilidad props.rest la pista calla durante lo que dura el loop sorteado
      // (beats enteros desde este beat, así al volver sigue alineada al compás como un loop más)
      if (Math.random() < (track.track_group.props?.rest ?? 0)) {
        // el loop anterior se corta en este mismo beat (por si su audio dura un poco más que sus beats)
        if (track.curr_file) stop_file(track.curr_file.id, time)
        track.curr_file = null
        track.resting = true
        track.remaining_beats = Math.max(1, files_by_id[f].beats) - 1
        track.percentage = 0
        return
      }

      start_file(f, time)
      track.curr_file = files_by_id[f]
      track.remaining_beats = files_by_id[f].beats - 1

    } else {
      track.remaining_beats--
      // en descanso no hay archivo: solo se cuenta
      if (track.curr_file) track.percentage = (100 / track.curr_file.beats) * (track.remaining_beats)
    }
    //console.log(track)

  })

}
// paso de una pista one-shot: dispara si empieza un Tag (on_tag_change) o si en un downbeat sale el
// dado de density. Si el Tag cambió en este beat, available_files_per_TRG ya es la del Tag nuevo.
function oneshot_step(track, time, n, tag_start, downbeat) {
  let p = track.track_group.props ?? {}
  // si la pista venía de modo loop, su loop se corta en este beat y deja de contar
  if (track.curr_file) stop_file(track.curr_file.id, time)
  track.curr_file = null
  track.remaining_beats = 0
  track.resting = false
  track.percentage = 0

  let fire = (p.on_tag_change && tag_start) || (downbeat && Math.random() < (p.density ?? 0))
  if (!fire) return
  let files = available_files_per_TRG[track.track_group.id]
  if (!files?.length) return
  let f = files[parseInt(Math.random() * files.length)]
  // si ese mismo player ya está sonando (un disparo anterior), se saltea: no se reinicia
  if (audio_players[f]?.state == "started") return
  // suena entero: no se le agenda stop
  start_file(f, time)
  Tone.Draw.schedule(() => {
    track.last_shot = files_by_id[f]
    track.shot_n = n
  }, time)
}

function get_available_files_x_tag(tag_id) {
  available_files_per_TRG = []
  //console.log("available_trgs.length!", available_trgs.length)
  for (let i = 0; i < available_trgs.length; i++) {
    let trg = available_trgs[i]
    //console.log("trg", trg)

    if (!available_files_per_TRG[trg.id]) { available_files_per_TRG[trg.id] = [] }

    let trg_files = files_per_TRG[trg.id] ?? []
    for (let l = 0; l < trg_files.length; l++) {
      let a = trg_files[l]
      //console.log(a,)
      let f = files_by_id[a]
      //console.log("ee", f)
      // sin tags = compatible con cualquier tag
      if (f.tags.length == 0 || f.tags.includes(tag_id)) {
        available_files_per_TRG[trg.id].push(a)
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

/* overlay "Click to start": cubre toda la ventana (el clic en cualquier parte cuenta como gesto) */
.gesture_overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: rgba(0, 0, 0, 0.72);
  cursor: pointer;
}

.gesture_overlay :deep(.cap) {
  transform: scale(1.6);
}

.gesture_text {
  margin-top: 16px;
  font-size: 18px;
  letter-spacing: 4px;
}

.oneshot_ctrls {
  display: flex;
  align-items: flex-end;
  gap: 4px;
}

/* Rev, Dly y Drift: tres knobs de 36 px entran justo en los 112 px de la tira */
.fx_ctrls {
  display: flex;
  gap: 2px;
}

.delay_sel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.delay_btns {
  display: flex;
  gap: 6px;
}

/* ancho fijo para que el LCD no cambie de tamaño al ciclar (el texto más largo es "DOTTED 1/16") */
.delay_lcd {
  display: inline-block;
  min-width: 11ch;
  font-family: var(--font_mono);
  text-align: center;
  font-size: 12px;
  letter-spacing: 1px;
  white-space: nowrap;
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
