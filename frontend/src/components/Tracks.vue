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

      <!-- reverb global por convolución (TrackCtrl.reverb, guardada en projects.props): ◀ ▶ eligen el impulso
        (REVERB_IRS) y Level es el nivel de retorno. Cada pista le manda señal con su knob "Rev" -->
      <div v-if="!store.read_only" class="group g_reverb">
        <div class="delay_sel" :title="'Reverb ' + TrackCtrl.reverb.ir + ' (~' + REVERB_IRS[TrackCtrl.reverb.ir].rt60 + ' s)'">
          <span class="silk">Reverb</span>
          <Lcd small :digits="0">
            <span class="delay_lcd">{{ REVERB_IRS[TrackCtrl.reverb.ir].label }}</span>
          </Lcd>
          <div class="delay_btns">
            <LedButton size="small" text="◀" title="Impulso anterior" @click="step_reverb(-1)" />
            <LedButton size="small" text="▶" title="Impulso siguiente" @click="step_reverb(1)" />
          </div>
        </div>
        <Knob :model-value="TrackCtrl.reverb.level" :min="REVERB_LEVEL_MIN" :max="REVERB_LEVEL_MAX" :step="1" :size="48"
          label="Level" :title="'Reverb return ' + TrackCtrl.reverb.level + ' dB'"
          @update:model-value="v => set_reverb_cfg('level', v)" />
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

      <!-- compresor multibanda del master (TrackCtrl.comp, guardado en projects.props; worklet de mixer.js): COMP
        on/off, GLUE = cuánto comprime (0..1) y LOW/MID/HIGH = trim por banda en dB, con un LED de reducción de
        ganancia por banda (levels.comp_gr). Apagado, los knobs se atenúan pero se pueden mover (se guardan). Sin
        worklet (contexto no seguro) el compresor no existe: todo atenuado y COMP deshabilitado -->
      <div v-if="!store.read_only" class="group g_comp" :class="{ no_dsp: !levels.dsp }"
        :title="levels.dsp ? undefined : 'Requires a secure context (https)'">
        <LedButton size="small" text="COMP" led="green" :lit="TrackCtrl.comp.on" label="Dynamics"
          :disabled="!levels.dsp" :title="!levels.dsp ? 'Requires a secure context (https)' : TrackCtrl.comp.on ? 'Compressor on' : 'Compressor off'"
          @click="toggle_comp" />
        <div class="comp_ctrls" :class="{ off: !TrackCtrl.comp.on }">
          <Knob :model-value="TrackCtrl.comp.amount" :min="0" :max="1" :step="0.01" :size="48" label="Glue"
            :title="'Glue ' + Math.round(TrackCtrl.comp.amount * 100) + '%'"
            @update:model-value="v => set_comp('amount', Math.round(v * 100) / 100)" />
          <div v-for="(b, i) in COMP_BAND_KEYS" :key="b.key" class="comp_band">
            <GrLed :src="levels.comp_gr" :k="i" :red="6" :name="b.name" />
            <Knob :model-value="TrackCtrl.comp[b.key]" :min="COMP_BAND_MIN" :max="COMP_BAND_MAX" :step="0.5" :size="32"
              :label="b.name" :title="b.name + ' ' + band_label(TrackCtrl.comp[b.key])"
              @update:model-value="v => set_comp(b.key, v)" />
          </div>
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
          <!-- vúmetro real de la pista (nivel RMS con pico retenido). Se le pasa el objeto (src): si la tira
            leyera el nivel, Tracks.vue entero se re-renderizaría en cada frame mientras suena -->
          <LedMeter :src="levels.trgs[trg.id]" />
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
              disparo en cada tirada, props.density), dispersión (probabilidad de que el disparo caiga en una
              negra al azar de la frase en vez de la primera, props.scatter) y disparo al empezar cada Tag
              (props.on_tag_change) -->
            <div class="oneshot_ctrls" :class="{ ghost: !is_oneshot(trg) }">
              <Knob :model-value="SHOT_BARS.indexOf(shot_bars(trg))" :min="0" :max="SHOT_BARS.length - 1" :step="1"
                :size="36" label="Bars" :title="'Tirar el dado cada ' + shot_bars(trg) + ' compás(es)'"
                @update:model-value="v => set_bars(trg, v)" />
              <Knob :model-value="trg.props.density ?? 0" :min="0" :max="1" :step="0.05" :size="36" label="Dens"
                :title="'Density ' + Math.round((trg.props.density ?? 0) * 100) + '% cada ' + shot_bars(trg) + ' compás(es)'"
                @update:model-value="v => set_density(trg, v)" />
              <Knob :model-value="trg.props.scatter ?? 0" :min="0" :max="1" :step="0.05" :size="36" label="Scat"
                :title="'Scatter ' + Math.round((trg.props.scatter ?? 0) * 100) + '%: negra al azar dentro de ' + shot_bars(trg) + ' compás(es)'"
                @update:model-value="v => set_scatter(trg, v)" />
              <LedButton size="small" text="TAG" led="red" :lit="!!trg.props.on_tag_change"
                title="Disparar al empezar cada Tag" @click="toggle_on_tag_change(trg)" />
            </div>
            <!-- loop: probabilidad de descanso al terminar cada loop (0..1, guardada en props.rest), de
              encadenar otro descanso al terminar uno (0..REST_AGAIN_MAX, props.rest_again) y rango de su
              duración (props.rest_len: 4, 8, 16 o 32 compases) -->
            <div class="rest_ctrls" :class="{ ghost: is_oneshot(trg) }">
              <div class="rest_knobs">
                <Knob :model-value="trg.props.rest ?? 0" :min="0" :max="1" :step="0.05"
                  :size="36" label="Rest" :title="'Rest ' + Math.round((trg.props.rest ?? 0) * 100) + '%'"
                  @update:model-value="v => set_rest(trg, v)" />
                <!-- con Rest en 0 no hay descansos que encadenar: queda atenuado y sin respuesta -->
                <Knob :class="{ knob_off: !(trg.props.rest > 0) }" :model-value="rest_again(trg)" :min="0"
                  :max="REST_AGAIN_MAX" :step="0.05" :size="36" label="Again"
                  :title="'Again ' + Math.round(rest_again(trg) * 100) + '%: otro descanso al terminar uno'"
                  @update:model-value="v => set_rest_again(trg, v)" />
              </div>
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
          <!-- paneo (props.pan, -1..1; doble clic = centro) y efectos: send a la reverb compartida (props.reverb,
            dB; al mínimo = nada) y send al delay global (props.delay, ídem). Tres knobs de 30 px: entran en la tira -->
          <div v-if="!store.read_only" class="fx_ctrls">
            <Knob :model-value="trg.props.pan ?? 0" :min="-1" :max="1" :step="0.05" :size="30" label="Pan"
              :title="pan_label(trg.props.pan) + ' (doble clic: centro)'" @update:model-value="v => set_pan(trg.id, v)"
              @dblclick="set_pan(trg.id, 0)" />
            <Knob :model-value="trg.props.reverb ?? REV_OFF_DB" :min="REV_OFF_DB" :max="0" :step="1" :size="30"
              label="Rev" :title="trg.props.reverb == null ? 'Reverb: off' : 'Reverb send ' + trg.props.reverb + ' dB'"
              @update:model-value="v => set_reverb(trg.id, v)" />
            <Knob :model-value="trg.props.delay ?? DLY_OFF_DB" :min="DLY_OFF_DB" :max="0" :step="1" :size="30"
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
  REST_LEN_OPTIONS, note_engine_start
} from "../helpers/composable"
import {
  TrackCtrl, calculate_timing, register_stop, TEMPO_TOL_MAX, DELAY_TYPES, DELAY_DIVISIONS, DELAY_FEEDBACK_MAX, DELAY_LEVEL_MIN, DELAY_LEVEL_MAX,
  REVERB_IRS, REVERB_LEVEL_MIN, REVERB_LEVEL_MAX, COMP_BAND_MIN, COMP_BAND_MAX
} from "../helpers/TrackCtrl"
import Knob from "./hw/Knob.vue"
import Lcd from "./hw/Lcd.vue"
import ToggleSwitch from "./hw/ToggleSwitch.vue"
import LedButton from "./hw/LedButton.vue"
import Led from "./hw/Led.vue"
import LedMeter from "./hw/LedMeter.vue"
import GrLed from "./hw/GrLed.vue"
import StepLeds from "./hw/StepLeds.vue"
import {
  levels, mixer, route_player, toggle_mute, toggle_solo, set_volume, is_silenced,
  set_pan, set_reverb, REV_OFF_DB, set_delay, DLY_OFF_DB, fader_to_db, db_to_fader, db_label,
  vol_db, FILE_VOL_MAX_DB, fx_reset_all
} from "../helpers/mixer"
import { new_fx, FX_TYPES, MAX_FX_PER_TRACK } from "../helpers/fx"
import FxDialog from "./FxDialog.vue"
import Fader from "./hw/Fader.vue"
import RangePads from "./hw/RangePads.vue"
import { url_autostart } from "../helpers/utils"
import { bind_fx, fx_step, end_run, fx_back_to_base, clear_fx_state } from "../helpers/engine_fx"
import {
  bind_oneshot, oneshot_step, shot_bars, SHOT_BARS, cancel_end_shots, cancel_tag_end_shots, forget_end_shots
} from "../helpers/engine_oneshot"

function reset() {



  tracks.map(track => {

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
  first_step = true
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
let available_files_per_TRG = {}

// el estado del TAG y de los tracks vive en TrackCtrl para que otros componentes (pads) lo lean
let current_TAG = TrackCtrl.current_TAG

let available_tags = []

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
// texto del paneo para el title: "Pan C", "Pan L50", "Pan R25"
function pan_label(pan) {
  let v = Math.round((pan ?? 0) * 100)
  return "Pan " + (v == 0 ? "C" : (v < 0 ? "L" : "R") + Math.abs(v))
}
function set_rest(trg, v) {
  trg.props.rest = Math.round(v * 100) / 100 // evita 0.15000000000000002
  save_trackGroups_debounced()
}
// probabilidad de encadenar otro descanso al terminar uno (ver rest_again)
function set_rest_again(trg, v) {
  trg.props.rest_again = Math.min(REST_AGAIN_MAX, Math.round(v * 100) / 100)
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
  // un disparo pendiente (props.scatter) no sobrevive al cambio de modo
  let track = tracks.find(t => t.track_group?.id === trg.id)
  if (track) track.pending_shot = null
  save_trackGroups_debounced()
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
// probabilidad de que el disparo caiga en una negra al azar de la frase (0..1; ver shot_offset)
function set_scatter(trg, v) {
  trg.props.scatter = Math.round(v * 100) / 100
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
// un valor al azar (uniforme) de options entre lo y hi (ambos incluidos, valores de options)
function draw_in_range(options, [lo, hi]) {
  let i = options.indexOf(lo)
  return options[i + Math.floor(Math.random() * (options.indexOf(hi) - i + 1))]
}
// veces seguidas que va a sonar un loop recién sorteado: un valor de REPEAT_OPTIONS dentro de su rango
// props.repeat (con [2, 8] sale 2, 4 u 8)
function draw_repeat(file) {
  return draw_in_range(REPEAT_OPTIONS, parse_repeat(file.props?.repeat))
}
// beats de un descanso: un valor de REST_LEN_OPTIONS dentro de props.rest_len de la pista, en compases
// del compás actual
function draw_rest_beats(track) {
  return draw_in_range(REST_LEN_OPTIONS, parse_rest_len(track.track_group.props?.rest_len)) * parseInt(TrackCtrl.beats_x_bar)
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

// --- reverb global (TrackCtrl.reverb; mixer.js carga el impulso con un watcher) ---
const REVERB_IR_KEYS = Object.keys(REVERB_IRS)
function set_reverb_cfg(key, v) {
  TrackCtrl.reverb[key] = v
  save_project_props_debounced()
}
// ◀ ▶: impulso anterior / siguiente (dan la vuelta en los extremos)
function step_reverb(dir) {
  let n = REVERB_IR_KEYS.length
  let i = REVERB_IR_KEYS.indexOf(TrackCtrl.reverb.ir)
  set_reverb_cfg("ir", REVERB_IR_KEYS[(i + dir + n) % n])
}

// --- compresor multibanda del master (TrackCtrl.comp; mixer.js manda los cambios al worklet con un watcher) ---
// orden = el de levels.comp_gr
const COMP_BAND_KEYS = [{ key: "low", name: "Low" }, { key: "mid", name: "Mid" }, { key: "high", name: "High" }]
function set_comp(key, v) {
  TrackCtrl.comp[key] = v
  save_project_props_debounced()
}
function toggle_comp() {
  set_comp("on", !TrackCtrl.comp.on)
}
function band_label(db) {
  return (db > 0 ? "+" : "") + db + " dB"
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

    if (track.curr_file) {
      track.remaining_beats = 0
      stop_file(track.curr_file.id, -1)
    }
    track.repeats_left = 0
    track.resting = false
    clear_fx_state(track)
    track.end_points = []
    track.pending_shot = null
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
  note_engine_start(id, time, audio_players[id].playbackRate) // solo para el cursor del editor (WaveScreen.vue)
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
  let tag_ids = new Set()
  tracks.splice(0)
  forget_end_shots()
  files_per_TRG = []
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
      tag_ids.add(tag)
    }
  }

  for (const id of tag_ids) available_tags.push(tags_by_id[id])
  if (available_tags.length && available_tags.every(t => !(t?.weight > 0))) {
    ElMessage({ type: "warning", message: "All tags have weight 0: only files without tags will play." })
  }

  // un track por cada track group, tenga o no archivos (sin archivos queda en silencio)
  for (const trg of store.track_groups) {
    if (!files_per_TRG[trg.id]) files_per_TRG[trg.id] = []
    tracks.push({
      track_group: trg,
      curr_file: null,
      remaining_beats: 0,
      resting: false, // true mientras la pista descansa (ver props.rest en set_next_step)
      repeat_n: 1, // veces que se toca seguido el loop actual (sorteadas en su props.repeat)
      repeats_left: 0, // pasadas que le faltan después de la actual
      last_shot: null, // one-shot: último archivo disparado (para la tira)
      shot_n: null, // one-shot: cuenta de disparos (cada cambio hace destellar el LED de la tira)
      end_points: [], // one-shot: puntos ya decididos para los disparos "end" ({ at, tag }, ver end_step)
      pending_shot: null, // one-shot: beat absoluto del disparo de density corrido por props.scatter
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
  first_step = true
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
const autostart = url_autostart()
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
// true desde START o RESET hasta que set_next_step procesa el primer beat (ahí se tiran los dados de
// descanso de arranque, ver roll_start_rests)
let first_step = false
// "sin Tag": id del Tag que termina cuando era null (todos los pesos en 0), para tag_cuts
const NO_TAG_ID = "nada"

// one-shot y FX de transición viven en helpers/engine_oneshot.js y engine_fx.js: se les pasa lo que
// usan de acá (después de NO_TAG_ID, que es const)
bind_oneshot({ start_file, stop_file, draw_candidates, file_weight })
bind_fx({ tag_cuts, NO_TAG_ID, roll_rest })

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
  if (current_TAG.remaining_beats == 1) {
    // cambio de Tag: entra el preseleccionado (y se preselecciona el siguiente)
    let from_id = current_TAG.tag?.id ?? NO_TAG_ID
    start_tag(next_tag_entry())
    get_available_files_x_tag(current_TAG.tag?.id)

    for (const track of tracks) {
      if (!track.curr_file) continue
      // solo se cortan los loops que no tienen el tag nuevo; los que tienen varios tags (p.ej. A y B)
      // siguen sonando al pasar de A a B
      if (tag_cuts(track.curr_file, from_id, current_TAG.tag)) {
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
  if (first_step) {
    first_step = false
    roll_start_rests()
  }
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
    // un loop o de otro descanso, o en el primer beat tras START/RESET (roll_start_rests deja next_rest;
    // una pista en silencio por falta de candidatos no tira el dado), y
    // antes de mirar los candidatos: no los necesita, y si el Tag nuevo no tiene archivos para la
    // pista el descanso sorteado (p. ej. por un FX "before rest") igual se cumple y se cuenta en el LCD
    // al terminar un descanso, el dado es el de encadenar otro (props.rest_again), no el de Rest
    let rest_roll = () => was_resting ? Math.random() < rest_again(track.track_group) : roll_rest(track)
    if ((track.curr_file || was_resting || next_rest != null) && (next_rest ?? rest_roll())) {
      // el loop anterior se corta en este mismo beat (por si su audio dura un poco más que sus beats)
      drop_file(track, time)
      track.resting = true
      track.remaining_beats = draw_rest_beats(track) - 1
      return false
    }

    // pista sin archivos sorteables (ninguno disponible, compatible con el Tag y dentro de la
    // tolerancia de tempo): queda en silencio. El loop que terminó se suelta (si no, el LCD quedaba
    // congelado en su último beat)
    let candidates = draw_candidates(track)
    if (!candidates.length) {
      drop_file(track, time)
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
  return !!track.curr_file && !track.resting
}

// suelta el archivo de una pista loop: lo corta en time y deja la pista sin archivo ni repeticiones
function drop_file(track, time) {
  if (track.curr_file) stop_file(track.curr_file.id, time)
  track.curr_file = null
  track.repeat_n = 1
  track.repeats_left = 0
}

// dado de descanso (props.rest) al terminar una tirada
function roll_rest(track) {
  return Math.random() < (track.track_group.props?.rest ?? 0)
}

// probabilidad de encadenar otro descanso al terminar uno: props.rest_again, o la de Rest si nunca se
// tocó (antes se volvía a tirar el dado de Rest). Con tope REST_AGAIN_MAX: siempre queda chance de que
// vuelva un loop (con Rest en 1 la pista ya no queda muda para siempre)
const REST_AGAIN_MAX = 0.9
function rest_again(trg) {
  let v = trg.props?.rest_again ?? trg.props?.rest ?? 0
  return Math.min(Math.max(v, 0), REST_AGAIN_MAX)
}

// primer beat tras START o RESET: las pistas loop que van a sortear en este beat (con candidatos) tiran
// el dado de descanso como al final de un loop; el resultado queda en next_rest y lo usa loop_step en
// este mismo beat (tras START no hay curr_file y sin esto nunca descansaban). Si salen todas en
// descanso, una al azar arranca sonando (que al darle START o RESET suene algo)
function roll_start_rests() {
  let fresh = tracks.filter(t => !is_oneshot(t.track_group) && t.remaining_beats == 0 && draw_candidates(t).length)
  for (const t of fresh) t.next_rest = roll_rest(t)
  if (fresh.length && fresh.every(t => t.next_rest)) {
    fresh[Math.floor(Math.random() * fresh.length)].next_rest = false
  }
}

// archivos de cada pista compatibles con el Tag activo (sin tags = compatible con cualquier tag)
function get_available_files_x_tag(tag_id) {
  available_files_per_TRG = {}
  for (const { track_group: trg } of tracks) {
    available_files_per_TRG[trg.id] = (files_per_TRG[trg.id] ?? [])
      .filter(id => files_by_id[id].tags.length == 0 || files_by_id[id].tags.includes(tag_id))
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

/* panel ancho: grilla de dos filas. Fila 1: transporte, tempo, delay, master; fila 2: posición, Tag actual,
   reverb, compresor. La placa del rango de Tag ocupa las dos filas. Las columnas suman ~1470 px (medido en
   el navegador). En modo lectura no hay delay, reverb, rango ni compresor: tres columnas con el master en
   las dos filas, que entran desde 1300 px (como antes del compresor). Las áreas solo cuentan en la grilla */
.g_transport { grid-area: transport; }
.g_tempo { grid-area: tempo; }
.g_delay { grid-area: delay; }
.g_reverb { grid-area: reverb; }
.g_range { grid-area: range; }
.g_master { grid-area: master; }
.g_comp { grid-area: comp; }
.g_position { grid-area: position; }
.g_tag { grid-area: tag; }

@container (min-width: 1300px) {
  .controls.read_only {
    display: grid;
    grid-template-columns: auto auto auto;
    grid-template-areas:
      "transport tempo master"
      "position  tag   master";
    justify-content: space-between;
    align-items: center;
  }

  /* la primera columna arranca pegada al borde, sin línea separadora */
  .controls.read_only .g_transport,
  .controls.read_only .g_position {
    border-left: 0;
    padding-left: 4px;
  }

  /* el master ocupa el alto de las dos filas: su línea separadora también */
  .controls.read_only .g_master {
    align-self: stretch;
  }
}

@container (min-width: 1480px) {
  .controls:not(.read_only) {
    display: grid;
    grid-template-columns: auto auto auto auto auto;
    grid-template-areas:
      "transport tempo delay  range master"
      "position  tag   reverb range comp";
    justify-content: space-between;
    align-items: center;
  }

  .controls .g_transport,
  .controls .g_position {
    border-left: 0;
    padding-left: 4px;
  }

  /* la placa ocupa el alto de las dos filas */
  .g_range {
    align-self: stretch;
  }
}

/* compresor: apagado se atenúan GLUE y las bandas; sin worklet, todo el grupo */
.g_comp.no_dsp {
  opacity: 0.4;
}

.comp_ctrls {
  display: flex;
  align-items: center;
  gap: 12px;
  transition: opacity 0.15s;
}

.comp_ctrls.off {
  opacity: 0.5;
}

/* columna de una banda: LED de GR arriba, trim abajo */
.comp_band {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
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

.rest_knobs {
  display: flex;
  gap: 4px;
}

.knob_off {
  opacity: 0.45;
  pointer-events: none;
}

.oneshot_ctrls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: flex-end;
  gap: 4px;
}

/* Pan, Rev y Dly: knobs de 30 px en una fila de la tira */
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
