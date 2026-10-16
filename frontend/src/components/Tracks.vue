<template>
  <div class="tracks_panel">
    <section class="hw_panel controls" :class="{ read_only: store.read_only }">
      <div class="brand silk">Transport</div>

      <!-- secciones: en un panel ancho van en una grilla de dos filas (ver .controls en el CSS); en uno
        angosto se acomodan en fila con wrap, en el orden del template -->
      <div class="group g_transport">
        <LedButton size="big" led="green" :lit="TrackCtrl.isPlaying" :disabled="TrackCtrl.isReady != true"
          :text="TrackCtrl.isPlaying ? 'STOP' : 'START'" label="Play / stop"
          @click="TrackCtrl.isPlaying ? stop() : request_start()" />
        <LedButton text="RESET" label="New tag" @click="reset" />
      </div>

      <div class="group g_tempo">
        <Knob v-model="TrackCtrl.tempo" :min="10" :max="160" label="Tempo" @change="onBPMSliderchange" />
        <Lcd :value="TrackCtrl.tempo" :digits="3" unit="BPM" />
        <!-- tolerancia de tempo (%, TrackCtrl.tempo_tol): los loops que haya que correr más que esto no se
          sortean (ver file_timing en TrackCtrl.js) -->
        <Knob v-model="TrackCtrl.tempo_tol" :min="0" :max="TEMPO_TOL_MAX" :step="0.5" :size="48" label="Tol"
          :title="'Tempo tolerance ±' + TrackCtrl.tempo_tol + '% (' + out_of_tempo + ' loop(s) out)'"
          @change="on_tol_change" />
      </div>

      <!-- posición del transporte (compás.tiempo) y compás del proyecto -->
      <div class="group g_position">
        <Lcd :value="bar_position" :digits="4" caption="Bar . beat" />
        <!-- modo lectura (/p/:id): solo START/STOP, RESET, master, tempo, tolerancia y el mixer (volumen, mute, solo); el resto
          de la config del proyecto no se muestra (no se guardaría nada igual, ver can_save en composable.js) -->
        <ToggleSwitch v-if="!store.read_only" v-model="TrackCtrl.beats_x_bar" label="Time sig"
          :options="[{ value: '3', label: '3/4' }, { value: '4', label: '4/4' }]" @change="onSignatureChange" />
      </div>

      <!-- delay global sincronizado al tempo (TrackCtrl.delay, guardado en projects.props). Cada pista le
        manda señal con su knob "Dly" -->
      <div v-if="!store.read_only" class="group g_delay">
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

      <div v-if="!store.read_only" class="group g_range">
        <!-- placa de aluminio con los pads del rango de cambio de TAG -->
        <div class="hw_plate tag_range">
          <span class="silk plate_title">Tag change</span>
          <RangePads v-model="tag_range_model" :options="tag_range_options" />
          <span class="silk plate_value">{{ Math.pow(2, TrackCtrl.tag_range[0]) }}–{{ Math.pow(2, TrackCtrl.tag_range[1]) }}
            beats</span>
        </div>
      </div>

      <!-- TAG actual: cuenta regresiva de beats hasta el próximo cambio -->
      <div class="group g_tag">
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

      <!-- volumen master (TrackCtrl.master, dB, guardado en projects.props; en modo lectura solo en memoria).
        Misma curva que los faders de las pistas: 0 dB a ~79 % del recorrido -->
      <div class="group g_master">
        <Knob :model-value="db_to_fader(TrackCtrl.master)" :min="0" :max="1" :step="0.01" :size="64" label="Master"
          :title="'Master ' + db_label(TrackCtrl.master)" @update:model-value="set_master" />
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
        <!-- reordenar: se arrastra la tira desde su nombre (el resto de la tira tiene knobs y faders) y se
          suelta sobre otra tira o sobre un pad de pista de la sidebar; también al revés. También acepta un
          pad de FX de la sidebar (FxPad.vue, looper/fx): agrega una instancia a props.fx -->
        <div class="strip" v-for="{ trg, track } in strips" :key="trg.id" :title="strip_file(trg, track)?.original_name"
          :class="{ silenced: is_silenced(trg.id), drop_over: drop_over_id === trg.id }"
          :draggable="drag_handle_id === trg.id" @dragstart="strip_dragstart($event, trg)" @dragend="strip_dragend"
          @dragover="strip_dragover($event, trg)" @dragleave="strip_dragleave($event, trg)"
          @drop="strip_drop($event, trg)">
          <span class="strip_color" :style="{ background: trg.color }"></span>
          <span class="silk strip_name" :class="{ handle: !store.read_only }" title="Arrastrar para mover la pista"
            @mousedown="grab_strip(trg)">{{
              trg.name }}</span>
          <!-- modo de la pista: loop (sortea loops encadenados) u one-shot (disparos sueltos), en props.mode -->
          <LedButton size="small" :text="is_oneshot(trg) ? 'SHOT' : 'LOOP'" led="yellow" :lit="is_oneshot(trg)"
            :title="is_oneshot(trg) ? 'One-shot: pasar a loop' : 'Loop: pasar a one-shot'" :disabled="store.read_only"
            @click="toggle_mode(trg)" />
          <!-- LED de actividad one-shot: destella (amarillo) en cada disparo -->
          <Led v-if="is_oneshot(trg)" color="yellow" :pulse="track && TrackCtrl.isPlaying ? track.shot_n : null" />
          <!-- LED de actividad loop: destella en cada beat mientras la pista suena, en rojo al reiniciar el loop -->
          <Led v-else :color="track?.curr_file && track_beat(track) == 1 ? 'red' : 'green'"
            :pulse="track?.curr_file && TrackCtrl.isPlaying ? beat.n : null" />
          <!-- vúmetro real de la pista (nivel RMS con pico retenido) -->
          <LedMeter :value="levels.trgs[trg.id]?.level ?? 0" :peak="levels.trgs[trg.id]?.peak ?? 0" />
          <!-- one-shot: el LCD muestra cada cuántos compases se tira el dado (no hay posición de loop) -->
          <Lcd v-if="is_oneshot(trg)" small :digits="2" :value="shot_bars(trg)" unit="SHOT" :caption="NBSP" />
          <!-- en descanso no hay archivo: el LCD cuenta los compases que faltan para el próximo loop, con el rótulo REST -->
          <!-- con repetición, el caption muestra la pasada actual sobre el total (p. ej. 2/4); sin ella queda un
            espacio duro para que el LCD (y la tira) no cambie de alto. El LCD one-shot lleva el mismo espacio -->
          <Lcd v-else small :digits="2" :value="track?.curr_file ? track_beat(track) : rest_bars_left(track)" :caption="repeat_caption(track)"
            :unit="track?.curr_file ? '/' + track.curr_file.play_beats : (track?.resting && TrackCtrl.isPlaying ? 'REST' : '')" />
          <!-- posición dentro del loop (no aplica a one-shot: queda invisible para que las tiras de los dos
            modos tengan el mismo alto y los faders queden alineados) -->
          <StepLeds :class="{ ghost: is_oneshot(trg) }"
            :pos="track?.curr_file && TrackCtrl.isPlaying && !is_oneshot(trg) ? track_beat(track) : 0"
            :beats="is_oneshot(trg) ? 0 : track?.curr_file?.play_beats ?? 0" />
          <!-- loop: archivo que suena; one-shot: último disparo -->
          <!-- clic: abre el diálogo de edición de ese archivo (Files.vue, vía store.edit_file_id) -->
          <span class="file_name" :class="{ editable: !store.read_only && strip_file(trg, track) }"
            @click="edit_strip_file(trg, track)">{{ strip_file(trg, track)?.original_name ?? "—" }}</span>
          <!-- controles de cada modo, en la misma celda; el del otro modo queda invisible (.ghost): la celda
            toma el alto del más alto y el fader de todas las tiras queda a la misma altura -->
          <div v-if="!store.read_only" class="mode_ctrls">
            <!-- one-shot: cada cuántos compases se tira el dado (props.bars), densidad (probabilidad de
              disparo en cada tirada, props.density) y disparo al empezar cada Tag (props.on_tag_change) -->
            <div class="oneshot_ctrls" :class="{ ghost: !is_oneshot(trg) }">
              <Knob :model-value="SHOT_BARS.indexOf(shot_bars(trg))" :min="0" :max="SHOT_BARS.length - 1" :step="1"
                :size="36" label="Bars" :title="'Tirar el dado cada ' + shot_bars(trg) + ' compás(es)'"
                @update:model-value="v => set_bars(trg, v)" />
              <Knob :model-value="trg.props.density ?? 0" :min="0" :max="1" :step="0.05" :size="36" label="Dens"
                :title="'Density ' + Math.round((trg.props.density ?? 0) * 100) + '% cada ' + shot_bars(trg) + ' compás(es)'"
                @update:model-value="v => set_density(trg, v)" />
              <LedButton size="small" text="TAG" led="red" :lit="!!trg.props.on_tag_change"
                title="Disparar al empezar cada Tag" @click="toggle_on_tag_change(trg)" />
            </div>
            <!-- loop: probabilidad de descanso al terminar cada loop (0..1, guardada en props.rest) y rango
              de su duración (props.rest_len: 4, 8, 16 o 32 compases) -->
            <div class="rest_ctrls" :class="{ ghost: is_oneshot(trg) }">
              <Knob :model-value="trg.props.rest ?? 0" :min="0" :max="1" :step="0.05"
                :size="36" label="Rest" :title="'Rest ' + Math.round((trg.props.rest ?? 0) * 100) + '%'"
                @update:model-value="v => set_rest(trg, v)" />
              <!-- con Rest en 0 no hay descansos: los pads quedan deshabilitados -->
              <RangePads small :model-value="parse_rest_len(trg.props.rest_len)" :options="rest_len_options"
                :disabled="!(trg.props.rest > 0)"
                :title="'Rest length: ' + rest_len_label(trg)" @update:model-value="v => set_rest_len(trg, v)" />
            </div>
          </div>
          <!-- volumen de la pista (dB, guardado en props.volume; en modo lectura solo en memoria) -->
          <!-- el fader trabaja en posición 0..1 con curva de consola (fader_to_db / db_to_fader en mixer.js) -->
          <Fader :model-value="db_to_fader(trg.props.volume)" :min="0" :max="1" :step="0.01" :length="84"
            :marks="strip_volume_marks" label="Vol" :title="db_label(trg.props.volume)"
            @update:model-value="v => set_volume(trg.id, fader_to_db(v))" />
          <!-- efectos: send a la reverb compartida (props.reverb, dB; al mínimo = nada) y send al delay global
            (props.delay, ídem) -->
          <div v-if="!store.read_only" class="fx_ctrls">
            <Knob :model-value="trg.props.reverb ?? REV_OFF_DB" :min="REV_OFF_DB" :max="0" :step="1" :size="36"
              label="Rev" :title="trg.props.reverb == null ? 'Reverb: off' : 'Reverb send ' + trg.props.reverb + ' dB'"
              @update:model-value="v => set_reverb(trg.id, v)" />
            <Knob :model-value="trg.props.delay ?? DLY_OFF_DB" :min="DLY_OFF_DB" :max="0" :step="1" :size="36"
              label="Dly" :title="trg.props.delay == null ? 'Delay: off' : 'Delay send ' + trg.props.delay + ' dB'"
              @update:model-value="v => set_delay(trg.id, v)" />
          </div>
          <!-- FX de transición (props.fx): un chip por instancia con la letra del tipo, encendido mientras
            su efecto suena (track.fx_active). Clic: FxDialog. Siempre MAX_FX_PER_TRACK lugares (los vacíos
            como zócalos apagados) para que la fila no cambie de alto ni de ancho. En modo lectura se ven
            pero no abren nada; en one-shot se atenúan (se guardan pero no suenan) -->
          <div class="fx_chips" :class="{ dim: is_oneshot(trg) }"
            :title="is_oneshot(trg) ? 'One-shot: los FX se conservan pero no suenan (solo en modo loop)' : ''">
            <button v-for="inst in trg.props.fx ?? []" :key="inst.id" type="button" class="fx_chip"
              :class="{ on: !!track?.fx_active?.includes(inst.id), editable: !store.read_only }"
              :title="fx_chip_title(trg, inst)" @click="open_fx(trg, inst)">{{ FX_TYPES[inst.type]?.chip ?? "?" }}</button>
            <span v-for="n in Math.max(0, MAX_FX_PER_TRACK - (trg.props.fx?.length ?? 0))" :key="'e' + n"
              class="fx_chip empty"></span>
          </div>
          <!-- mute / solo de la pista (solo en memoria: no se guardan) -->
          <div class="mute_solo">
            <LedButton size="small" text="M" led="red" :lit="!!mixer.mute[trg.id]" @click="toggle_mute(trg.id)" />
            <LedButton size="small" text="S" led="yellow" :lit="!!mixer.solo[trg.id]" @click="toggle_solo(trg.id)" />
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

    <FxDialog v-if="!store.read_only" v-model="fx_dialog.visible" :trg_id="fx_dialog.trg_id"
      :fx_id="fx_dialog.fx_id" />
  </div>
</template>
<script setup>

import * as Tone from "tone"
import { ElMessage } from "element-plus"
import { ref, reactive, computed, watch, onBeforeUnmount } from "vue"
import {
  store, tags_by_id, audio_players, files_by_id, save_trackGroups, save_trackGroups_debounced,
  save_project_props_debounced, pick_weighted, parse_repeat, REPEAT_OPTIONS, move_item, parse_rest_len,
  REST_LEN_OPTIONS, file_anchor
} from "../helpers/composable"
import {
  TrackCtrl, calculate_timing, register_stop, TEMPO_TOL_MAX, DELAY_TYPES, DELAY_DIVISIONS, DELAY_FEEDBACK_MAX, DELAY_LEVEL_MIN, DELAY_LEVEL_MAX
} from "../helpers/TrackCtrl"
import Knob from "./hw/Knob.vue"
import Lcd from "./hw/Lcd.vue"
import ToggleSwitch from "./hw/ToggleSwitch.vue"
import LedButton from "./hw/LedButton.vue"
import Led from "./hw/Led.vue"
import LedMeter from "./hw/LedMeter.vue"
import StepLeds from "./hw/StepLeds.vue"
import {
  levels, mixer, route_player, toggle_mute, toggle_solo, set_volume, is_silenced,
  set_reverb, REV_OFF_DB, set_delay, DLY_OFF_DB, fader_to_db, db_to_fader, db_label,
  vol_db, FILE_VOL_MAX_DB, fx_schedule, fx_reset, fx_reset_all
} from "../helpers/mixer"
import { lead_beats, new_fx, FX_TYPES, MAX_FX_PER_TRACK } from "../helpers/fx"
import FxDialog from "./FxDialog.vue"
import Fader from "./hw/Fader.vue"
import RangePads from "./hw/RangePads.vue"

function reset() {



  tracks.map(track => {

    //console.log("le cambio el tag al track", old_tag, track.curr_file?.tag.name)
    if (track.curr_file) {
      track.remaining_beats = 0
      track.repeats_left = 0

      stop_file(track.curr_file.id, -1)
    }
    // un descanso en curso también se corta: la pista vuelve a sortear con el Tag nuevo
    if (track.resting) {
      track.resting = false
      track.remaining_beats = 0
    }
    clear_fx_state(track)
  })
  // RESET es inmediato: los FX en curso se cortan ya (el próximo beat arranca limpio)
  fx_reset_all()
  // Tag nuevo ya (sorteo fresco, no el preseleccionado) y se sortea el siguiente
  start_tag(draw_tag())
  // los disponibles tienen que ser los del Tag nuevo (antes RESET seguía sorteando con los del anterior)
  get_available_files_x_tag(current_TAG.tag?.id)
  // los disparos "end" hacia el cambio de Tag que ya no ocurre: se cancelan los que no arrancaron (los
  // que ya suenan terminan donde terminen). El cambio de RESET no se anticipa: no lleva "end"
  cancel_tag_end_shots()
  //set_next_step(-1)

}




// pads del rango (exponente n de 2^n beats, en TrackCtrl.tag_range, guardado en projects.props);
// RangePads ya entrega [min, max] ordenado
const tag_range_options = [5, 6, 7, 8, 9].map(n => ({ value: n, label: Math.pow(2, n) }))
const tag_range_model = computed({
  get: () => TrackCtrl.tag_range,
  set: (v) => {
    TrackCtrl.tag_range = v
    save_project_props_debounced()
  }
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
// --- reordenar las tiras con drag&drop (mismos datos que los pads de la sidebar: msg_type, id y la marca
// looper/track_group; soltar una tira sobre un archivo de Files le asigna la pista, como un pad) ---
const drag_handle_id = ref(null) // tira agarrada del nombre (solo esa es draggable)
const dragging_id = ref(null)
const drop_over_id = ref(null)
// al soltar el botón (haya o no arrastre, y donde sea) la tira deja de ser draggable: si no, arrastrar un
// knob o el fader de esa tira empezaría a arrastrar la tira entera
function grab_strip(trg) {
  if (store.read_only) return
  drag_handle_id.value = trg.id
  window.addEventListener("mouseup", () => { drag_handle_id.value = null }, { once: true })
}
function strip_dragstart(e, trg) {
  e.dataTransfer.effectAllowed = "move"
  e.dataTransfer.setData("msg_type", "track_group")
  e.dataTransfer.setData("id", trg.id)
  e.dataTransfer.setData("looper/track_group", trg.id)
  dragging_id.value = trg.id
}
function strip_dragend() {
  drag_handle_id.value = dragging_id.value = drop_over_id.value = null
}
function strip_dragover(e, trg) {
  if (store.read_only) return
  let types = e.dataTransfer.types
  // pad de FX (copia) o tira / pad de pista (mover)
  let fx = types.includes("looper/fx")
  if (!fx && (dragging_id.value === trg.id || !types.includes("looper/track_group"))) return
  e.preventDefault()
  e.dataTransfer.dropEffect = fx ? "copy" : "move"
  drop_over_id.value = trg.id
}
function strip_dragleave(e, trg) {
  if (drop_over_id.value === trg.id && !e.currentTarget.contains(e.relatedTarget)) drop_over_id.value = null
}
// el motor no depende del orden: cada tira busca su track por id (ver strips)
async function strip_drop(e, trg) {
  drop_over_id.value = null
  if (store.read_only) return
  if (e.dataTransfer.types.includes("looper/fx")) {
    e.preventDefault()
    add_fx(trg, e.dataTransfer.getData("looper/fx"))
    return
  }
  if (!e.dataTransfer.types.includes("looper/track_group")) return
  e.preventDefault()
  await move_item(store.track_groups, e.dataTransfer.getData("id"), trg.id, save_trackGroups)
}
// --- FX de transición: instancias en trg.props.fx (helpers/fx.js); el motor las lee en cada beat ---

// soltar un pad de FX en la tira: instancia nueva con los defaults del tipo (también en one-shot:
// se guarda pero no suena hasta pasar la pista a loop)
function add_fx(trg, type) {
  if (!FX_TYPES[type]) return
  if (!Array.isArray(trg.props.fx)) trg.props.fx = []
  let list = trg.props.fx
  if (list.length >= MAX_FX_PER_TRACK) {
    ElMessage({ type: "warning", message: `Max ${MAX_FX_PER_TRACK} FX per track` })
    return
  }
  list.push(new_fx(type, list))
  save_trackGroups_debounced()
}

// diálogo de edición de una instancia (uno solo para todas las tiras)
const fx_dialog = reactive({ visible: false, trg_id: null, fx_id: null })
function open_fx(trg, inst) {
  if (store.read_only) return
  Object.assign(fx_dialog, { visible: true, trg_id: trg.id, fx_id: inst.id })
}
function fx_chip_title(trg, inst) {
  let t = (FX_TYPES[inst.type]?.label ?? inst.type) + " " + inst.lead + " · " + Math.round((inst.prob ?? 1) * 100) + "%"
  if (inst.cond == "rest") t += " · before rest"
  else if (inst.cond == "tag") t += " · on tag change"
  if (is_oneshot(trg)) t += " (one-shot: no suena)"
  return store.read_only ? t : t + " (clic para editar)"
}

// marcas del fader en dB, ubicadas según la curva (el de abajo del todo es silencio)
const strip_volume_marks = [6, 0, -12, -24].map(v => ({ value: db_to_fader(v), label: v > 0 ? "+" + v : v }))
  .concat({ value: 0, label: "-∞" })

// volumen master: el knob da la posición 0..1; mixer.js aplica TrackCtrl.master con un watcher
function set_master(pos) {
  TrackCtrl.master = fader_to_db(pos)
  save_project_props_debounced()
}

// probabilidad de descanso de la pista (se llama mientras se mueve el knob; el guardado es diferido)
function set_rest(trg, v) {
  trg.props.rest = Math.round(v * 100) / 100 // evita 0.15000000000000002
  save_trackGroups_debounced()
}
// rango de duración del descanso (RangePads ya entrega [min, max] ordenado)
const rest_len_options = REST_LEN_OPTIONS
function set_rest_len(trg, v) {
  trg.props.rest_len = v
  save_trackGroups_debounced()
}
function rest_len_label(trg) {
  let txt = (v) => v + " bars"
  let [lo, hi] = parse_rest_len(trg.props.rest_len)
  return lo === hi ? txt(lo) : txt(lo) + " – " + txt(hi)
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
// cada cuántos compases se tira el dado de density (valores de SHOT_BARS; default 1 = cada compás)
const SHOT_BARS = [1, 2, 4, 8, 16, 32, 64]
function shot_bars(trg) {
  let b = trg?.props?.bars
  return SHOT_BARS.includes(b) ? b : 1
}
// el knob da el índice dentro de SHOT_BARS
function set_bars(trg, i) {
  trg.props.bars = SHOT_BARS[Math.round(i)] ?? 1
  save_trackGroups_debounced()
}
// probabilidad de disparo en cada tirada (0..1)
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

// en modo lectura (/p/:id) no hay Files.vue ni se edita nada
function edit_strip_file(trg, track) {
  let file = strip_file(trg, track)
  if (file && !store.read_only) store.edit_file_id = file.id
}

// el tiempo del delay sigue a TrackCtrl.tempo solo (watch en mixer.js), también mientras se mueve el knob.
// El transporte y el playbackRate de los loops cambian juntos al soltar el knob: lo que suena sigue en fase
function onBPMSliderchange(value) {
  Tone.Transport.bpm.value = value
  calculate_timing()
  apply_rates()
  save_project_props_debounced()
}

function onSignatureChange(value) {
  Tone.Transport.timeSignature = parseInt(value)
  calculate_timing()
  save_project_props_debounced()
}

// tolerancia de tempo: cambia qué loops se sortean (desde el próximo sorteo; lo que suena sigue)
function on_tol_change() {
  calculate_timing()
  save_project_props_debounced()
}
// loops del proyecto que quedan fuera de la tolerancia (para el title del knob Tol)
const out_of_tempo = computed(() => store.files.filter(f => f.kind != "shot" && f.in_tempo === false).length)

// playbackRate de cada player según el tempo (file_timing); los que ya suenan lo toman en el momento
function apply_rates() {
  for (let f of store.files) {
    let player = audio_players[f.id]
    if (player && f.play_rate) player.playbackRate = f.play_rate
  }
}
// ¿la pista puede sortear el archivo? Los shots solo en pistas one-shot; los loops (en cualquier
// pista) si entran en la tolerancia de tempo. Se mira en cada sorteo: el tempo, la tolerancia y el
// modo de la pista pueden cambiar con el transporte en marcha
function playable(id, trg) {
  let f = files_by_id[id]
  if (!f) return false
  return f.kind == "shot" ? is_oneshot(trg) : f.in_tempo !== false
}
// candidatos al sorteo de una pista: los de su Track Group compatibles con el Tag, reproducibles y con
// peso > 0. Se sortean con pick_weighted según el peso del archivo en el proyecto (props.weight)
function draw_candidates(track) {
  return (available_files_per_TRG[track.track_group.id] ?? [])
    .filter(id => playable(id, track.track_group) && file_weight(id) > 0)
}
// veces seguidas que va a sonar un loop recién sorteado: un valor al azar (uniforme) de REPEAT_OPTIONS
// dentro de su rango props.repeat (con [2, 8] sale 2, 4 u 8)
function draw_repeat(file) {
  let [lo, hi] = parse_repeat(file.props?.repeat).map(v => REPEAT_OPTIONS.indexOf(v))
  return REPEAT_OPTIONS[lo + Math.floor(Math.random() * (hi - lo + 1))]
}
// beats de un descanso: un valor al azar (uniforme) de REST_LEN_OPTIONS dentro de props.rest_len de la
// pista, en compases del compás actual
function draw_rest_beats(track) {
  let [lo, hi] = parse_rest_len(track.track_group.props?.rest_len).map(v => REST_LEN_OPTIONS.indexOf(v))
  let v = REST_LEN_OPTIONS[lo + Math.floor(Math.random() * (hi - lo + 1))]
  return v * parseInt(TrackCtrl.beats_x_bar)
}
function file_weight(id) {
  return files_by_id[id]?.props?.weight ?? 0
}

// --- delay global (TrackCtrl.delay; mixer.js lo aplica con watchers) ---
const DELAY_TYPE_LABELS = { pingpong: "PING", stereo: "STEREO", dotted: "DOTTED", tape: "TAPE" }
const DELAY_DIVISION_LABELS = { "16n": "1/16", "8t": "1/8T", "8n": "1/8", "8n.": "1/8.", "4n": "1/4", "4n.": "1/4.", "2n": "1/2" }
function set_delay_cfg(key, v) {
  TrackCtrl.delay[key] = v
  save_project_props_debounced()
}
// los botones TYPE y TIME pasan a la opción siguiente (vuelven a la primera después de la última)
function cycle_delay(key, options) {
  let i = options.indexOf(TrackCtrl.delay[key])
  set_delay_cfg(key, options[(i + 1) % options.length])
}

function stop() {
  TrackCtrl.isPlaying = false
  Tone.Transport.stop()
  fx_reset_all() // filtros, ganancia y sends de los FX de transición vuelven ya a la base
  current_TAG.remaining_beats = 0
  // disparos "end" agendados (aún no arrancaron o ya suenan, aunque la pista haya pasado a loop): el
  // filtro por state de abajo no ve los agendados a futuro (state mira el presente)
  cancel_end_shots()
  tracks.map(track => {

    //console.log("le cambio el tag al track", old_tag, track.curr_file?.tag.name)
    if (track.curr_file) {
      track.remaining_beats = 0
      stop_file(track.curr_file.id, -1)
    }
    track.repeats_left = 0
    track.resting = false
    clear_fx_state(track)
    track.end_points = []
    // one-shot: se cortan los disparos que sigan sonando (pueden ser varios archivos superpuestos) y los
    // agendados que todavía no arrancaron: state mira el presente (no ve un start apenas futuro) y
    // Player.stop no hace nada si no hay ni uno ni otro, así que se llama para todos
    if (is_oneshot(track.track_group)) {
      for (const id of files_per_TRG[track.track_group.id] ?? []) {
        if (audio_players[id] && files_by_id[id]) stop_file(id, -1)
      }
    }
  })
}


// anticipación con que corre el callback del beat (Tone trae 0,1 s). Más margen = un cambio de Tag
// con mucho trabajo en el hilo principal (varias pistas que sortean, Vue, recolector) igual llega
// antes de `time` y no arranca tarde. Costo: lo que usa Tone.now() (preview, START, STOP/RESET)
// responde ese tiempo después; mute, solo y faders no (no se agendan)
const LOOK_AHEAD = 0.3
Tone.getContext().lookAhead = LOOK_AHEAD

// un solo scheduleRepeat por instancia del componente (no por START): STOP detiene el transporte pero
// no lo borra, y el próximo START lo reutiliza desde el tiempo 0. Se borra al desmontar.
const beat_repeat_id = Tone.Transport.scheduleRepeat((time) => {
  // número de beat y downbeat calculados desde los ticks del transporte en `time` (no del estado visual)
  let n = Math.round(Tone.Transport.getTicksAtTime(time) / Tone.Transport.PPQ)
  let downbeat = n % parseInt(TrackCtrl.beats_x_bar) == 0
  // callback tardío (hilo principal ocupado): lo que se agende en `time` arranca tarde
  // (currentTime crudo del AudioContext: Tone.now() ya le suma el lookAhead)
  let late = Tone.getContext().currentTime - time
  if (late > 0) console.warn(`Looper: beat ${n} agendado ${Math.round(late * 1000)} ms tarde`)

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

// espacio duro: caption "vacío" que igual ocupa su renglón en el LCD
const NBSP = String.fromCharCode(160)
// pasada actual sobre el total de la repetición del loop (p. ej. "2/4"); sin repetición, NBSP
function repeat_caption(track) {
  if (!track?.curr_file || !(track.repeat_n > 1)) return NBSP
  return (track.repeat_n - track.repeats_left) + "/" + track.repeat_n
}
// beat actual (1..beats) del loop que suena en la pista
function track_beat(track) {
  return track.curr_file.play_beats - track.remaining_beats
}
// compases que faltan para que termine el descanso (cuenta regresiva: el último compás muestra 1).
// Incluye el beat actual: con remaining_beats == 0 el próximo beat ya sortea un loop
function rest_bars_left(track) {
  if (!track?.resting || !TrackCtrl.isPlaying) return ''
  return Math.ceil((track.remaining_beats + 1) / parseInt(TrackCtrl.beats_x_bar))
}

// número de arranque de cada archivo: el Tone.Draw de start_file solo prende los indicadores si en el
// medio el archivo no se cortó (stop_file) ni se volvió a arrancar
const start_seq = {}
// on_start (opcional): se llama con Tone.Draw cuando el sonido arranca de verdad (indicadores de la tira)
function start_file(id, time, on_start) {
  let seq = start_seq[id] = (start_seq[id] ?? 0) + 1
  // loops y disparos "start" se agendan para el beat que viene: isPlaying se prende ya, como siempre
  // (con la pestaña oculta Tone.Draw descarta los eventos vencidos). Un disparo "end" se agenda
  // segundos antes: se prende recién cuando suena
  if (time < Tone.now() + LOOK_AHEAD) files_by_id[id].isPlaying = true
  audio_players[id].playbackRate = files_by_id[id].play_rate ?? 1
  audio_players[id].volume.value = vol_db(files_by_id[id].props.volume, FILE_VOL_MAX_DB)
  route_player(id)
  audio_players[id].start(time)
  Tone.Draw.schedule(() => {
    if (start_seq[id] != seq) return
    files_by_id[id].isPlaying = true
    on_start?.()
  }, time)
}
function stop_file(id, time) {
  start_seq[id] = (start_seq[id] ?? 0) + 1
  files_by_id[id].isPlaying = false
  audio_players[id].stop(time)
}


function start() {

  Tone.start()
  //Tone.setContext(new Tone.Context({ latencyHint: "playback" }))
  calculate_timing()

  TrackCtrl.isPlaying = true
  Tone.Transport.timeSignature = parseInt(TrackCtrl.beats_x_bar)
  Tone.Transport.bpm.value = TrackCtrl.tempo
  let temp_tag = {}
  tracks.splice(0)
  end_shots = []
  files_per_TRG = []
  files_per_TAG = []
  available_tags = []




  for (let i = 0; i < store.files.length; i++) {
    let f = store.files[i]
    if (!f.isLoaded) continue // sin buffer, Tone no lo puede reproducir
    // no disponible (oculto por el admin o dueño bloqueado): fuera del sorteo, tampoco aporta su Tag
    if (f.available === false) continue
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
  if (available_tags.length && available_tags.every(t => !(t?.weight > 0))) {
    ElMessage({ type: "warning", message: "All tags have weight 0: only files without tags will play." })
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
      repeat_n: 1, // veces que se toca seguido el loop actual (sorteadas en su props.repeat)
      repeats_left: 0, // pasadas que le faltan después de la actual
      last_shot: null, // one-shot: último archivo disparado (para la tira)
      shot_n: null, // one-shot: cuenta de disparos (cada cambio hace destellar el LED de la tira)
      end_points: [], // one-shot: puntos ya decididos para los disparos "end" ({ at, tag }, ver end_step)
      // FX de transición (ver fx_step): dado de descanso anticipado (null = sin sortear), ids de las
      // instancias ya evaluadas en la tirada actual e ids sonando (para los chips; vía Tone.Draw)
      next_rest: null,
      fx_fired: [],
      fx_active: [],
      fx_tag_end: false // true si las instancias de la tirada se evaluaron contra un corte por Tag
    })
  }
  start_tag(draw_tag())
  get_available_files_x_tag(current_TAG.tag?.id)

  beat.n = 0 // el transporte arranca de cero; evita mostrar la posición de la corrida anterior
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
// los demás componentes detienen el motor con stop_transport() (TrackCtrl.js)
register_stop(stop)
onBeforeUnmount(() => {
  register_stop(null)
  Tone.context.off("statechange", on_context_state)
  clearTimeout(resume_timer)
  Tone.Transport.clear(beat_repeat_id)
})

// true desde que se elige un Tag hasta que set_next_step procesa su primer beat
let tag_starting = false
// "sin Tag": old_tag cuando el Tag que termina era null (todos los pesos en 0)
const NO_TAG = { id: "nada", name: "vacio" }

// sorteo de un Tag y su duración (no lo activa). Ponderado por el peso del Tag (puede repetirse el
// actual); si todos pesan 0 sale null (no hay Tag y suenan solo los archivos sin tags). Duración:
// 2^n beats con n al azar en TrackCtrl.tag_range
function draw_tag() {
  let tag = pick_weighted(available_tags, t => t?.weight ?? 0)
  let base = parseInt((Math.random() * ((TrackCtrl.tag_range[1] + 1) - (TrackCtrl.tag_range[0]))) + (TrackCtrl.tag_range[0]))
  return { tag, duration: Math.pow(2, base) }
}

// ¿el Tag preseleccionado se puede activar todavía? Si se le bajó el peso a 0 mientras esperaba, no
// (y null, "sin Tag", solo vale si siguen todos en 0). La lista available_tags es la de START
function tag_drawable(tag) {
  if (tag) return tag.weight > 0
  return !available_tags.some(t => t?.weight > 0)
}

// activa un Tag sorteado ({ tag, duration }) y preselecciona el siguiente (current_TAG.next_tag y
// next_duration). Así se sabe de antemano qué pistas va a cortar el cambio y cuándo (ver
// tag_cut_beats). Lo llaman start() y reset() con un sorteo nuevo y set_next_step con el preseleccionado
function start_tag(drawn) {
  current_TAG.old_tag = { ...(current_TAG.tag ?? NO_TAG) }
  current_TAG.tag = drawn.tag
  current_TAG.duration = drawn.duration
  // set_next_step descuenta 1 antes de procesar el beat: en el primer beat del Tag queda en duration
  current_TAG.remaining_beats = drawn.duration + 1
  let next = draw_tag()
  current_TAG.next_tag = next.tag
  current_TAG.next_duration = next.duration
  // el próximo beat que procese set_next_step es el primero del Tag nuevo (ahí disparan los one-shot
  // con on_tag_change). Llamado desde set_next_step es ese mismo beat; desde start() o reset(), el siguiente.
  tag_starting = true
}

// el Tag que entra en el cambio: el preseleccionado, salvo que ya no sea sorteable (se re-sortea).
// Los pesos editados durante un Tag valen desde el sorteo siguiente: el preseleccionado no cambia
// (salvo que su peso pase a 0)
function next_tag_entry() {
  if (tag_drawable(current_TAG.next_tag)) {
    return { tag: current_TAG.next_tag, duration: current_TAG.next_duration }
  }
  return draw_tag()
}

// ¿el cambio de Tag de from_id a to_tag corta este archivo? Solo si el Tag cambia de verdad y el
// archivo tiene tags y no incluye el nuevo (los archivos sin tags nunca se cortan; to_tag null =
// "sin Tag" corta todos los que tienen tags)
function tag_cuts(file, from_id, to_tag) {
  if (from_id === to_tag?.id) return false
  return file.tags.length > 0 && !file.tags.includes(to_tag?.id)
}


function set_next_step(time, n, downbeat) {



  //console.log("current_TAG.remaining_beats", current_TAG.remaining_beats)


  if (current_TAG.remaining_beats == 1) {
    // cambio de Tag: entra el preseleccionado (y se preselecciona el siguiente)
    start_tag(next_tag_entry())
    get_available_files_x_tag(current_TAG.tag?.id)

    for (const track of tracks) {
      if (!track.curr_file) continue
      // solo se cortan los loops que no tienen el tag nuevo; los que tienen varios tags (p.ej. A y B)
      // siguen sonando al pasar de A a B
      if (tag_cuts(track.curr_file, current_TAG.old_tag.id, current_TAG.tag)) {
        // loop_step ve remaining_beats == 0 sin repeticiones en este mismo beat: fin de la tirada (end_run)
        track.remaining_beats = 0
        track.repeats_left = 0
        if (audio_players[track.curr_file.id].state == "started") {
          // se corta en el tiempo del beat (donde arranca el loop nuevo), no ya: el callback corre
          // hasta LOOK_AHEAD antes del beat y cortar ya dejaba ese silencio entre los dos
          stop_file(track.curr_file.id, time)
        }
      } else if (track.fx_tag_end) {
        // los FX se agendaron hacia un corte que al final no ocurrió (el Tag preseleccionado se
        // re-sorteó o se editaron los tags del archivo): vuelven a la base y se reevalúan contra el
        // fin que quede. next_rest se conserva (vale para el fin que llegue)
        fx_back_to_base(track, time)
      }
    }
  }
  current_TAG.remaining_beats--
  let tag_start = tag_starting
  tag_starting = false
  tracks.map(track => {

    // las pistas one-shot no usan remaining_beats ni descansos: solo deciden si disparan en este beat
    // (e ignoran props.fx)
    if (is_oneshot(track.track_group)) {
      oneshot_step(track, time, n, tag_start, downbeat)
      return
    }
    // FX de transición: se evalúan después del paso, con remaining_beats / repeats_left ya de este beat
    if (loop_step(track, time)) fx_step(track, time)
  })

}

// paso de una pista loop. Devuelve true si en este beat la pista está sonando una tirada (un loop y
// sus repeticiones), false si descansa o queda en silencio
function loop_step(track, time) {
  if (track.remaining_beats == 0) {
    // repetición: el loop que terminó vuelve a arrancar en este beat sin sortear otro (si sigue
    // siendo sorteable: no se quitó del proyecto, no se le bajó el peso a 0, sigue en tempo).
    // Una repetición no es fin de la tirada
    if (track.curr_file && track.repeats_left > 0 && draw_candidates(track).includes(track.curr_file.id)) {
      track.repeats_left--
      start_file(track.curr_file.id, time)
      track.remaining_beats = Math.max(1, track.curr_file.play_beats) - 1
      return true
    }
    // fin de la tirada (o del descanso): FX a la base. El dado de descanso pudo sortearse antes
    // (cond "rest", ver fx_step): se usa ese resultado
    let next_rest = track.next_rest
    end_run(track, time)
    let was_resting = track.resting
    track.resting = false

    // descanso: con probabilidad props.rest la pista calla una cantidad de compases sorteada en
    // props.rest_len (beats enteros desde este beat, así al volver sigue alineada al compás). Al fin de
    // un loop o de otro descanso (una pista en silencio por falta de candidatos no tira el dado), y
    // antes de mirar los candidatos: no los necesita, y si el Tag nuevo no tiene archivos para la
    // pista el descanso sorteado (p. ej. por un FX "before rest") igual se cumple y se cuenta en el LCD
    if ((track.curr_file || was_resting) && (next_rest ?? roll_rest(track))) {
      // el loop anterior se corta en este mismo beat (por si su audio dura un poco más que sus beats)
      if (track.curr_file) stop_file(track.curr_file.id, time)
      track.curr_file = null
      track.resting = true
      track.remaining_beats = draw_rest_beats(track) - 1
      track.percentage = 0
      track.repeat_n = 1
      track.repeats_left = 0
      return false
    }

    // pista sin archivos sorteables (ninguno disponible, compatible con el Tag y dentro de la
    // tolerancia de tempo): queda en silencio. El loop que terminó se suelta (si no, el LCD quedaba
    // congelado en su último beat)
    let candidates = draw_candidates(track)
    if (!candidates.length) {
      if (track.curr_file) stop_file(track.curr_file.id, time)
      track.curr_file = null
      track.percentage = 0
      track.repeat_n = 1
      track.repeats_left = 0
      return false
    }
    let f = pick_weighted(candidates, file_weight)

    start_file(f, time)
    track.curr_file = files_by_id[f]
    track.remaining_beats = Math.max(1, files_by_id[f].play_beats) - 1
    track.repeat_n = draw_repeat(files_by_id[f])
    track.repeats_left = track.repeat_n - 1
    return true
  }
  track.remaining_beats--
  // en descanso no hay archivo: solo se cuenta
  if (track.curr_file) track.percentage = (100 / track.curr_file.play_beats) * (track.remaining_beats)
  return !!track.curr_file && !track.resting
}

// dado de descanso (props.rest) al terminar una tirada
function roll_rest(track) {
  return Math.random() < (track.track_group.props?.rest ?? 0)
}

// --- FX de transición (trg.props.fx, ver helpers/fx.js y mixer.js) ---

// beats que faltan hasta el fin de la tirada, contando el beat actual: 1 = este es el último beat de
// lo que suena (el siguiente arranca otra cosa). Se llama después de loop_step (y de que set_next_step
// descontó current_TAG.remaining_beats). Es el mínimo entre el fin natural y el corte por Tag; by_tag =
// el fin es el corte por Tag (si los dos caen en el mismo beat cuenta como corte: ahí también cambia el Tag)
function beats_to_end(track) {
  let natural = natural_end_beats(track)
  let tag_cut = tag_cut_beats(track)
  return { left: Math.min(natural, tag_cut), by_tag: tag_cut <= natural }
}

// fin natural: en el último beat de la última repetición da 1
function natural_end_beats(track) {
  let play_beats = Math.max(1, track.curr_file.play_beats)
  return track.repeats_left * play_beats + track.remaining_beats + 1
}

// fin por corte de Tag: beats hasta el cambio si el cambio va a cortar el archivo (misma regla que
// set_next_step, con el Tag preseleccionado), si no Infinity. El corte ocurre en el beat que empieza
// con current_TAG.remaining_beats == 1, y acá ya está descontado el del beat actual: faltan
// exactamente current_TAG.remaining_beats beats. Ejemplo, Tag de 4 beats que empieza en el beat 10:
// start_tag deja 5; en el 10 se descuenta a 4, en el 11 a 3, en el 12 a 2, en el 13 a 1; en el 14 se
// ve 1 antes de descontar y se corta en su `time`. En el 10 da 4 (10, 11, 12, 13) y en el 13 da 1
// (último beat que suena), igual que un loop de 4 beats arrancado en el 10: remaining_beats 3 → 3 + 1 = 4
function tag_cut_beats(track) {
  if (!tag_cuts(track.curr_file, current_TAG.tag?.id ?? NO_TAG.id, current_TAG.next_tag)) return Infinity
  return Math.max(1, current_TAG.remaining_beats)
}

// ¿se cumple la condición de la instancia para el fin de esta tirada? by_tag = el fin es un corte por Tag
function fx_cond_ok(track, inst, by_tag) {
  if (inst.cond == "rest") {
    // el dado de descanso se sortea ahora y se guarda: loop_step lo usa en el fin
    if (track.next_rest == null) track.next_rest = roll_rest(track)
    return track.next_rest
  }
  // "tag" = el fin de esta tirada es un corte por cambio de Tag (si el natural llega antes, no)
  if (inst.cond == "tag") return by_tag
  return true
}

// en cada beat de una tirada: cada instancia se evalúa una sola vez por tirada, en el primer beat en que
// su anticipación (en beats) alcanza a los beats que faltan (>= y no ==: una tirada más corta que la
// anticipación dispara igual, recortada). Si pasa prob y cond, se agenda de `time` al fin
function fx_step(track, time) {
  let list = track.track_group.props?.fx
  if (!Array.isArray(list) || !list.length) return
  let { left, by_tag } = beats_to_end(track)
  let bpb = parseInt(TrackCtrl.beats_x_bar)
  for (const inst of list) {
    if (!inst?.id || track.fx_fired.includes(inst.id)) continue
    if (lead_beats(inst.lead, bpb) < left) continue
    track.fx_fired.push(inst.id)
    if (by_tag) track.fx_tag_end = true
    if (!(Math.random() < (inst.prob ?? 1))) continue
    if (!fx_cond_ok(track, inst, by_tag)) continue
    // segundos por beat con el tempo actual (un cambio de tempo en medio de la rampa se tolera)
    let end = time + left * 60 / Tone.Transport.bpm.value
    fx_schedule(track.track_group.id, inst, time, end)
    let id = inst.id
    // se chequea fx_fired al dibujar: un RESET entre el callback (hasta ~0,1 s antes) y el beat ya
    // limpió el estado y el chip quedaría encendido hasta el próximo fin con FX
    Tone.Draw.schedule(() => {
      if (TrackCtrl.isPlaying && track.fx_fired.includes(id) && !track.fx_active.includes(id)) track.fx_active.push(id)
    }, time)
  }
}

// fin de una tirada (en el beat donde arranca otro archivo, empieza un descanso, la corta el cambio de
// Tag o la pista pasa a one-shot): si algo se evaluó, los FX vuelven a la base exactamente en `time`. Se limpia el estado
function end_run(track, time) {
  fx_back_to_base(track, time)
  track.next_rest = null
}

// FX de la pista a la base en `time` (si algo se evaluó) y sin instancias evaluadas
function fx_back_to_base(track, time) {
  if (track.fx_fired.length) {
    fx_reset(track.track_group.id, time)
    Tone.Draw.schedule(() => { track.fx_active = [] }, time)
  }
  track.fx_fired = []
  track.fx_tag_end = false
}

// STOP y RESET (los nodos los lleva a la base fx_reset_all)
function clear_fx_state(track) {
  track.fx_fired = []
  track.fx_active = []
  track.next_rest = null
  track.fx_tag_end = false
}

// paso de una pista one-shot: dispara si empieza un Tag (on_tag_change) o si en el primer downbeat de
// cada frase de props.bars compases (contados desde el inicio del transporte, como los loops) sale el
// dado de density. Si el Tag cambió en este beat, available_files_per_TRG ya es la del Tag nuevo.
function oneshot_step(track, time, n, tag_start, downbeat) {
  let p = track.track_group.props ?? {}
  // si la pista venía de modo loop, su loop se corta en este beat y deja de contar (fin de la tirada)
  end_run(track, time)
  if (track.curr_file) stop_file(track.curr_file.id, time)
  track.curr_file = null
  track.remaining_beats = 0
  track.resting = false
  track.percentage = 0

  // los archivos con anchor "end" se deciden por adelantado (end_step); acá solo los "start"
  end_step(track, time, n)

  let phrase_start = downbeat && Math.round(n / parseInt(TrackCtrl.beats_x_bar)) % shot_bars(track.track_group) == 0
  let fire = (p.on_tag_change && tag_start) || (phrase_start && Math.random() < (p.density ?? 0))
  if (!fire) return
  let files = draw_candidates(track).filter(id => file_anchor(files_by_id[id]) != "end")
  if (!files.length) return
  let f = pick_weighted(files, file_weight)
  // si ese mismo player ya está sonando (un disparo anterior), se saltea: no se reinicia
  if (audio_players[f]?.state == "started") return
  // suena entero: no se le agenda stop
  start_file(f, time, () => show_shot(track, f))
}

// nombre del último disparo en la tira y destello de su LED (se llama con Tone.Draw, al sonar)
function show_shot(track, f) {
  track.last_shot = files_by_id[f]
  track.shot_n = (track.shot_n ?? 0) + 1
}

// duración efectiva de un disparo en segundos: la del buffer (composable.js la deja en
// files_by_id[id].duration al cargar el audio) al playbackRate con que suena; 0 = sin dato
function shot_length(id) {
  let f = files_by_id[id]
  let d = Number(f?.duration)
  return d > 0 ? d / (f.play_rate || 1) : 0
}

// disparos "end" agendados ({ id, start, end, tag }: segundos del AudioContext; tag = apunta a un cambio
// de Tag): para no volver a arrancar un archivo que sigue sonando o espera su turno, y para cancelarlos
// en STOP / RESET
let end_shots = []

// disparos con anchor "end": el archivo termina en el punto de disparo (riser, crash invertido), así
// que arranca antes y se decide por adelantado. Puntos (cada uno por su lado; si caen en el mismo beat
// son uno solo y manda el de Tag): el próximo cambio de Tag (con on_tag_change, siempre dispara) y el
// inicio de la próxima frase de `bars` compases (con density > 0, tira el dado). Cada punto se decide
// una vez (track.end_points: { at: número de beat absoluto, tag }), en el primer beat en que al "end" más largo
// le queda menos de su duración + 1 beat (el último en que todavía entra), o en el último beat antes del
// punto. Se sortea con peso entre los "end" de la pista compatibles con el Tag que suena y que entran.
// Con el tempo de ahora: si el tempo cambia después, el final ya no cae justo en el punto
function end_step(track, time, n) {
  let p = track.track_group.props ?? {}
  let files = draw_candidates(track).filter(id => file_anchor(files_by_id[id]) == "end" && shot_length(id) > 0)
  if (!files.length) return
  let spb = 60 / Tone.Transport.bpm.value
  let phrase = parseInt(TrackCtrl.beats_x_bar) * shot_bars(track.track_group)
  // beats desde este beat hasta cada punto. El cambio de Tag ocurre en el beat que empieza con
  // current_TAG.remaining_beats == 1 y acá ya está descontado el de este beat (ver tag_cut_beats)
  let points = []
  if (p.on_tag_change) points.push({ b: current_TAG.remaining_beats, always: true })
  if (p.density > 0) points.push({ b: phrase - n % phrase, always: false })
  let longest = Math.max(...files.map(shot_length))
  track.end_points = track.end_points.filter(e => e.at > n)
  for (const { b, always } of points) {
    let at = n + b
    if (!(b >= 1) || track.end_points.some(e => e.at == at)) continue
    if (b > 1 && b * spb >= longest + spb) continue // todavía hay tiempo
    track.end_points.push({ at, tag: always })
    if (!always && !(Math.random() < p.density)) continue
    let point_time = time + b * spb
    let f = pick_weighted(files.filter(id => shot_length(id) <= b * spb), file_weight)
    if (!f) continue // no entra ninguno (justo tras START, Tag corto, tempo lento)
    let start = point_time - shot_length(f)
    // si ese mismo player está sonando o tiene un disparo agendado que todavía suena en `start`, se saltea
    let now = Tone.getContext().currentTime
    end_shots = end_shots.filter(s => s.end > now)
    if (audio_players[f]?.state == "started" || end_shots.some(s => s.id == f && s.end > start)) continue
    start_file(f, start, () => show_shot(track, f))
    end_shots.push({ id: f, start, end: point_time, tag: always })
  }
}

// STOP: corta todos los disparos "end" agendados, hayan arrancado o no (Player.stop(ahora) también
// cancela un start agendado a futuro)
function cancel_end_shots() {
  let ctx_now = Tone.getContext().currentTime
  for (const s of end_shots) {
    if (s.end > ctx_now && files_by_id[s.id]) stop_file(s.id, -1)
  }
  end_shots = []
}
// RESET: el cambio de Tag hacia el que apuntaban ya no ocurre. Se cancelan los disparos "end" de Tag que
// todavía no arrancaron (los que arrancan dentro del lookahead ya no se pueden cortar antes de empezar:
// siguen, igual que los que ya suenan) y se olvidan los puntos de Tag decididos, para que el nuevo cambio
// (y una frase que caía en el mismo beat) se decidan otra vez. Los de frase siguen valiendo
function cancel_tag_end_shots() {
  let now = Tone.now() // un stop se agenda como mucho a partir de acá
  let cancel = end_shots.filter(s => s.tag && s.start > now)
  // se corta en su propio inicio (no ya): Player.stop corta todas las fuentes del player, y un disparo
  // "end" anterior del mismo archivo (de frase, que no se cancela) puede estar sonando todavía
  for (const s of cancel) if (files_by_id[s.id]) stop_file(s.id, s.start)
  end_shots = end_shots.filter(s => !cancel.includes(s))
  for (const track of tracks) track.end_points = track.end_points.filter(e => !e.tag)
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
  container-type: inline-size;
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

/* panel ancho: grilla de dos filas. Fila 1: transporte, tempo, delay; fila 2: posición y Tag actual.
   La placa del rango de Tag y el master ocupan las dos filas a la derecha. En modo lectura no hay
   delay ni rango: tres columnas. Las columnas suman ~1280 px (medido en el navegador). */
@container (min-width: 1300px) {
  .controls {
    display: grid;
    grid-template-columns: auto auto auto auto auto;
    grid-template-areas:
      "transport tempo delay range master"
      "position  tag   tag   range master";
    justify-content: space-between;
    align-items: center;
  }

  .controls.read_only {
    grid-template-columns: auto auto auto;
    grid-template-areas:
      "transport tempo master"
      "position  tag   master";
  }

  .g_transport { grid-area: transport; }
  .g_tempo { grid-area: tempo; }
  .g_delay { grid-area: delay; }
  .g_range { grid-area: range; }
  .g_master { grid-area: master; }
  .g_position { grid-area: position; }
  .g_tag { grid-area: tag; }

  /* la primera columna arranca pegada al borde, sin línea separadora */
  .controls .g_transport,
  .controls .g_position {
    border-left: 0;
    padding-left: 4px;
  }

  /* la placa y el master ocupan el alto de las dos filas: su línea separadora también */
  .g_range,
  .g_master {
    align-self: stretch;
  }
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

/* destino de un reordenamiento */
.strip.drop_over {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
}

.strip_name.handle {
  cursor: grab;
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

/* celda común de los controles de cada modo (loop: Rest; one-shot: Bars, Dens, TAG) */
.mode_ctrls {
  display: grid;
  justify-items: center;
  align-items: start;
}

.mode_ctrls > * {
  grid-area: 1 / 1;
}

/* control del otro modo: ocupa lugar pero no se ve ni se puede tocar (visibility también lo saca del foco) */
.ghost {
  visibility: hidden;
}

.rest_ctrls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.oneshot_ctrls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: flex-end;
  gap: 4px;
}

/* Rev y Dly: knobs de 36 px en una fila de la tira */
.fx_ctrls {
  display: flex;
  gap: 2px;
}

/* chips de los FX de transición: alto fijo (4 lugares siempre) para que los faders queden alineados */
.fx_chips {
  display: flex;
  gap: 4px;
  height: 18px;
}

.fx_chips.dim {
  opacity: 0.35;
}

.fx_chip {
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid #000;
  border-radius: 3px;
  background: linear-gradient(180deg, #2c2d30, #18191b);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  color: var(--hw_silk);
  font-family: var(--font_mono);
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  cursor: default;
  user-select: none;
}

.fx_chip.editable {
  cursor: pointer;
}

.fx_chip.editable:hover {
  border-color: var(--hw_yellow);
}

/* encendido (efecto sonando): LED amarillo */
.fx_chip.on {
  background: radial-gradient(circle at 40% 35%, #fff, var(--hw_yellow) 60%);
  box-shadow: 0 0 6px 2px rgba(255, 210, 60, 0.6);
  color: var(--hw_rubber_ink);
}

/* lugar libre: zócalo hundido, sin letra */
.fx_chip.empty {
  background: #0b0b0c;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 255, 255, 0.06);
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

.file_name.editable {
  cursor: pointer;
}

.file_name.editable:hover {
  opacity: 1;
  text-decoration: underline;
}
</style>
