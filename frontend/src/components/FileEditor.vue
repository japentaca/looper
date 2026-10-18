<template>
  <el-dialog v-if="curr_edit_file != null" v-model="dialogVisible" :title="curr_edit_file.original_name" width="min(980px, 96vw)"
    class="hw_dialog editor_dialog" align-center draggable>
    <div class="edit_body">
      <!-- pantalla de onda a todo el ancho (grilla, cursores) con la región debajo: start/stop, SNAP, NUDGE, FADE
        y lupas (RegionEditor.vue). La grilla de un loop sigue al input Beats mientras se edita (beats_draft) -->
      <RegionEditor :file="curr_edit_file" :beats="beats_draft" :active="dialogVisible" />
      <div class="edit_left">
        <div class="edit_info">
          <span class="info_label">Duración</span>
          <span v-if="curr_edit_file.isLoaded">{{ curr_edit_file.duration_fixed }} s</span>
          <span v-else class="muted">cargando…</span>

          <!-- tipo y beats: solo el dueño los cambia (PUT /files/:id); el bpm lo deduce el backend -->
          <span class="info_label">Tipo</span>
          <span v-if="curr_edit_file.own && !store.read_only" class="toggle_row">
            <LedButton v-for="k in ['loop', 'shot']" :key="k" size="small" led="green" :text="k.toUpperCase()"
              :lit="(curr_edit_file.kind ?? 'loop') === k" :disabled="saving_timing"
              @click="curr_edit_file.kind !== k && save_timing(curr_edit_file, { kind: k })" />
          </span>
          <span v-else>{{ curr_edit_file.kind == 'shot' ? 'Shot' : 'Loop' }}</span>

          <template v-if="curr_edit_file.kind != 'shot'">
            <span class="info_label">Beats</span>
            <span class="timing_row">
              <el-input-number v-if="curr_edit_file.own && !store.read_only" :model-value="curr_edit_file.beats"
                size="small" :min="1" :max="BEATS_MAX" :precision="0" :step="1" :disabled="saving_timing"
                @input="set_beats_draft" @change="v => v && save_timing(curr_edit_file, { beats: v })" />
              <span v-else>{{ curr_edit_file.beats }}</span>
              <span>{{ fmt_bpm(curr_edit_file.bpm) }} BPM</span>
              <span v-if="out_of_tempo(curr_edit_file)" class="out_tempo"
                :title="not_drawable_title(curr_edit_file)">out of tempo</span>
            </span>
          </template>

          <!-- tonalidad: solo el dueño la cambia (PUT /files/:id) -->
          <span class="info_label">Key</span>
          <span v-if="curr_edit_file.own && !store.read_only">
            <el-select :model-value="curr_edit_file.music_key ?? ''" size="small" class="key_select" filterable
              :disabled="saving_timing" @change="v => save_timing(curr_edit_file, { music_key: v })">
              <el-option v-for="o in KEY_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </span>
          <span v-else>{{ key_label(curr_edit_file.music_key) }}</span>

          <!-- anclaje de los disparos one-shot (dato del archivo): solo el dueño lo cambia (PUT /files/:id) -->
          <span class="info_label" :title="ANCHOR_HELP">Anchor</span>
          <span v-if="curr_edit_file.own && !store.read_only" class="toggle_row">
            <LedButton v-for="a in ['start', 'end']" :key="a" size="small" led="green" :text="a.toUpperCase()"
              :lit="(curr_edit_file.anchor ?? 'start') === a" :disabled="saving_timing" :title="ANCHOR_TEXT[a]"
              @click="(curr_edit_file.anchor ?? 'start') !== a && save_timing(curr_edit_file, { anchor: a })" />
          </span>
          <span v-else :title="ANCHOR_HELP">{{ curr_edit_file.anchor == 'end' ? 'End' : 'Start' }}</span>

        </div>
      </div>

      <!-- placas: Volume a la izquierda (dos filas), Weight y Repeat apiladas a la derecha -->
      <div class="edit_plates">
        <!-- volumen del archivo (dB) como fader sobre placa de aluminio -->
        <div class="hw_plate volume">
          <span class="silk">Volume</span>
          <!-- posición 0..1 con la misma curva de consola que las pistas, con tope en 0 dB (fader_to_db en mixer.js) -->
          <Fader :model-value="db_to_fader(curr_edit_file.props.volume, FILE_VOL_MAX_DB)" :min="0" :max="1" :step="0.01"
            :length="150" :marks="volume_marks" :title="db_label(curr_edit_file.props.volume)"
            @update:model-value="v => curr_edit_file.props.volume = fader_to_db(v, FILE_VOL_MAX_DB)"
            @change="onChange(curr_edit_file)" />
          <Lcd small :digits="3" :value="curr_edit_file.props.volume > VOL_OFF_DB ? curr_edit_file.props.volume : '---'"
            unit="dB" />
        </div>
        <!-- peso del archivo en el sorteo de su pista (0 = no sale nunca; ver pick_weighted en composable.js) -->
        <div class="hw_plate weight" :title="weight_title(curr_edit_file)">
          <span class="silk">Weight</span>
          <Knob v-model="curr_edit_file.props.weight" :min="0" :max="WEIGHT_MAX" :size="56"
            @change="onChange(curr_edit_file)" />
          <Lcd small :digits="2" :value="curr_edit_file.props.weight" />
        </div>
        <!-- repetición: al salir sorteado, el loop suena seguido un número de veces al azar dentro de este rango -->
        <div class="hw_plate repeat" title="Times in a row the loop plays when drawn (random within the range; a Tag change cuts it)">
          <span class="silk">Repeat</span>
          <RangePads v-model="curr_edit_file.props.repeat" :options="REPEAT_OPTIONS" @change="onChange(curr_edit_file)" />
          <span class="silk">{{ repeat_label(curr_edit_file.props.repeat) }}</span>
        </div>
      </div>

      <!-- pista y tags del archivo en este proyecto, como pads del color de cada uno (los mismos de la sidebar).
        Track: uno solo (tocar el encendido lo deja sin pista). Tags: varios, cada pad prende o apaga el suyo -->
      <div class="assign">
        <div class="assign_row">
          <span class="silk assign_label">Track</span>
          <div class="pads">
            <button v-for="trg in store.track_groups" :key="trg.id" type="button" class="mini_pad"
              :class="{ lit: curr_edit_file.track_group === trg.id }" :style="{ '--pad_color': trg.color }"
              :disabled="store.read_only" @click="set_track_group(curr_edit_file, trg.id)">{{ trg.name }}</button>
            <span v-if="store.track_groups.length == 0" class="silk empty_pads">no tracks</span>
          </div>
        </div>
        <div class="assign_row">
          <span class="silk assign_label">Tags</span>
          <div class="pads">
            <button v-for="tag in store.tags" :key="tag.id" type="button" class="mini_pad"
              :class="{ lit: curr_edit_file.tags.includes(tag.id) }" :style="{ '--pad_color': tag.color }"
              :disabled="store.read_only" @click="toggleTag(curr_edit_file, tag.id)">{{ tag.name }}</button>
            <span v-if="store.tags.length == 0" class="silk empty_pads">no tags</span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog_footer">
        <span class="dialog_actions">
          <!-- preview: PLAY/STOP (Espacio); en sync, mientras espera el compás el LED titila -->
          <LedButton size="small" led="green" :lit="is_previewing(curr_edit_file) && !is_armed(curr_edit_file)"
            :blink="is_armed(curr_edit_file)" :text="is_previewing(curr_edit_file) ? 'STOP' : 'PLAY'"
            :disabled="!curr_edit_file.isLoaded" :title="preview_title(curr_edit_file) + ' (Space)'"
            @click="togglePreview(curr_edit_file)" />
          <!-- switch SYNC (Q): el mismo de la cabecera de la lista -->
          <LedButton size="small" text="SYNC" led="yellow" :lit="toneLib.preview_opts.sync" :title="sync_title() + ' (Q)'"
            @click="toneLib.toggle_preview_sync()" />
          <!-- modo de escucha (M rota): solo cuenta con SYNC y el motor andando; si no, se atenúa -->
          <span class="listen" :class="{ off: !listen_active }"
            :title="listen_active ? undefined : 'Listening mode: only with SYNC on and the engine running'">
            <LedButton v-for="m in LISTEN_MODES" :key="m.value" size="small" led="green" :text="m.text"
              :lit="toneLib.preview_opts.mode === m.value" :title="m.title + ' (M)'"
              @click="toneLib.set_preview_mode(m.value)" />
          </span>
          <LedButton size="small" text="DELETE" class="danger" @click="emit('delete', curr_edit_file)" />
        </span>
        <LedButton size="small" text="CLOSE" @click="dialogVisible = false" />
      </div>
    </template>
  </el-dialog>
</template>
<script setup>
// Editor de un archivo del proyecto (el diálogo de edición; docs/PLAN_EDITOR.md): pantalla de onda y región
// (RegionEditor.vue), datos del archivo (tipo, beats, tonalidad, anclaje: solo el dueño), placas Volume / Weight /
// Repeat, pads de pista y tags, preview (PLAY/STOP, SYNC, modo de escucha) y sus atajos. Lo monta Files.vue:
// v-model = visible, file = archivo a editar; DELETE emite "delete" (la confirmación y el borrado son de Files.vue)

import { ref, watch, computed, onBeforeUnmount } from "vue"
import { store, save_file, save_file_debounced, WEIGHT_MAX, REPEAT_OPTIONS } from "../helpers/composable"
import LedButton from "./hw/LedButton.vue"
import Fader from "./hw/Fader.vue"
import RangePads from "./hw/RangePads.vue"
import Knob from "./hw/Knob.vue"
import Lcd from "./hw/Lcd.vue"
import RegionEditor from "./RegionEditor.vue"
import { TrackCtrl, calculate_timing } from "../helpers/TrackCtrl"
import { editor_key_ok, SPACE_TAKERS } from "../helpers/utils"
import { update_file, error_text } from "../helpers/api"
import { ElMessage } from 'element-plus'
import { KEY_OPTIONS, key_label } from "../helpers/music_key"
import {
  out_of_tempo, not_drawable_title, fmt_bpm, toggleTag, ANCHOR_TEXT, is_previewing, is_armed, togglePreview,
  preview_title, sync_title
} from "../helpers/file_ui"

import * as toneLib from "../helpers/toneLib"
import { fader_to_db, db_to_fader, db_label, FILE_VOL_MAX_DB, VOL_OFF_DB } from "../helpers/mixer"

const props = defineProps({
  modelValue: { type: Boolean, default: false }, // diálogo visible
  file: { type: Object, default: null }, // archivo que se edita (de store.files)
})
const emit = defineEmits(["update:modelValue", "delete"])

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
})
const curr_edit_file = computed(() => props.file)

// cambia tipo, beats, tonalidad o anclaje de un archivo propio. El backend recalcula el bpm; con la respuesta se
// actualiza el archivo y se recalcula su playbackRate (vale para el próximo sorteo)
const saving_timing = ref(false)
async function save_timing(file, data) {
  saving_timing.value = true
  try {
    let res = await update_file(file.id, data)
    if (!res.stat) return ElMessage({ type: 'error', message: res.text || "No se pudo guardar" })
    file.kind = res.data.kind
    file.beats = res.data.beats
    file.bpm = res.data.bpm
    file.music_key = res.data.music_key
    file.anchor = res.data.anchor ?? "start"
    calculate_timing()
  } catch (e) {
    ElMessage({ type: 'error', message: error_text(e) })
  } finally {
    saving_timing.value = false
    // guardado (o no): la grilla vuelve a los beats del archivo
    if ("beats" in data) beats_draft.value = null
  }
}
// beats que muestra el input mientras se edita (al tipear o con +/-), para que la pantalla de onda
// redibuje la grilla antes de guardar; null = los del archivo. Se guarda igual que antes, en @change
const BEATS_MAX = 1024
const beats_draft = ref(null)
function set_beats_draft(v) {
  beats_draft.value = Number.isInteger(v) && v >= 1 && v <= BEATS_MAX ? v : null
}


// marcas en dB ubicadas según la curva; abajo del todo = silencio
const volume_marks = [0, -6, -12, -24, -36].map(v => ({ value: db_to_fader(v, FILE_VOL_MAX_DB), label: v }))
  .concat({ value: 0, label: "-∞" })

// al abrir el editor (o pasar a otro archivo) la grilla vuelve a los beats del archivo
watch([() => props.file, () => props.modelValue], ([, open]) => {
  if (open) beats_draft.value = null
})

// pista del archivo en el proyecto: tocar la que ya tiene lo deja sin pista
async function set_track_group(file, id) {
  if (file.track_group === id) id = null
  file.track_group = id
  await save_file(file)
}
function weight_title(file) {
  let w = file.props.weight
  return w == 0 ? "Weight 0: never drawn"
    : `Chance of being drawn, relative to the other files of its track (0 = never, ${WEIGHT_MAX} = max)`
}

// --- anclaje de los disparos one-shot (ver file_anchor en composable.js) ---
const ANCHOR_HELP = "Where a one-shot track places the file relative to its trigger point (Tag change or phrase "
  + "start). Loop tracks ignore it."

function repeat_label(r) {
  if (!r) return ""
  return r[0] == r[1] ? "×" + r[0] : "×" + r[0] + "–" + r[1]
}

// volumen, peso y Repeat del diálogo: guardado diferido (con la rueda o las flechas cambian de a pasos)
function onChange(file) {
  save_file_debounced(file)
}

// --- modo de escucha del preview (toneLib.preview_opts; docs/PLAN_EDITOR.md, decisiones 1 y 2) ---
const LISTEN_MODES = [
  { value: "mix", text: "MIX", title: "Mix: the preview plays over the whole mix" },
  { value: "context", text: "IN CONTEXT", title: "In context: the preview replaces what its track plays, through the track channel" },
  { value: "solo", text: "SOLO", title: "Solo: only the preview; the engine keeps running, muted" },
]
// el modo de escucha solo cuenta con sync y el motor andando
const listen_active = computed(() => toneLib.preview_opts.sync && TrackCtrl.isPlaying)

// --- atajos del editor (docs/PLAN_EDITOR.md, decisión 11): Espacio = play/stop del preview, Q = SYNC, M = modo
// de escucha (reglas de foco en editor_key_ok de utils.js; G y las flechas de la región, en RegionEditor.vue) ---
function on_editor_key(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  let key = e.code == "Space" ? "space" : e.key?.toLowerCase()
  if (!["space", "q", "m"].includes(key)) return
  if (!editor_key_ok(e, key == "space" ? SPACE_TAKERS : null)) return
  e.preventDefault()
  if (e.repeat) return
  let f = curr_edit_file.value
  if (key == "space") {
    if (f?.isLoaded) togglePreview(f)
  } else if (key == "q") toneLib.toggle_preview_sync()
  else toneLib.cycle_preview_mode()
}

// editor abierto: atajos activos. Al cerrarlo se corta el preview del archivo editado (en sync quedaría en
// loop) y todo vuelve a la normalidad (ninguna pista queda callada)
watch(dialogVisible, (open) => {
  if (open) {
    window.addEventListener("keydown", on_editor_key)
    return
  }
  window.removeEventListener("keydown", on_editor_key)
  if (curr_edit_file.value && is_previewing(curr_edit_file.value)) toneLib.playerStop()
})
onBeforeUnmount(() => {
  window.removeEventListener("keydown", on_editor_key)
  if (dialogVisible.value && curr_edit_file.value && is_previewing(curr_edit_file.value)) toneLib.playerStop()
})

</script>
<style scoped>
.key_select {
  width: 96px;
}

.out_tempo {
  color: var(--danger);
  font-weight: 700;
}

.timing_row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.edit_info {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 10px 12px;
  align-items: center;
}

.info_label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.6px;
  text-transform: uppercase;
  color: var(--hw_silk);
  opacity: 0.75;
}

.muted {
  color: var(--muted);
}

.toggle_row {
  display: flex;
  gap: 6px;
}

/* pista y tags: bahía hundida a lo ancho, debajo de los datos y las placas */
.assign {
  flex: 1 1 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 4px;
  border: 1px solid #0a0a0b;
  background: rgba(0, 0, 0, 0.32);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.7), 0 1px 0 rgba(255, 255, 255, 0.06);
}

.assign_row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.assign_label {
  width: 44px;
  flex: none;
  padding-top: 7px;
}

.pads {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 120px;
  overflow-y: auto;
  padding: 2px 2px 5px;
}

.empty_pads {
  padding-top: 7px;
  opacity: 0.5;
}

/* pad chico de goma con la franja del color, como los de la sidebar (SidebarItem.vue); encendido se tiñe */
.mini_pad {
  min-width: 64px;
  max-width: 150px;
  height: 30px;
  padding: 0 10px 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid #0c0c0d;
  border-radius: 5px;
  background:
    linear-gradient(0deg, color-mix(in srgb, var(--pad_color) 55%, #2a2b2e) 0 3px, transparent 3px),
    radial-gradient(ellipse at 50% 35%, #55575b, #3b3c40 70%);
  box-shadow: 0 3px 0 #0e0e0f, 0 4px 6px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  color: var(--hw_silk);
  font-family: var(--font_mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.08s, box-shadow 0.08s, transform 0.05s;
}

.mini_pad:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #0e0e0f, 0 2px 3px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.mini_pad.lit {
  background: radial-gradient(ellipse at 50% 40%,
      color-mix(in srgb, var(--pad_color) 85%, #fff),
      color-mix(in srgb, var(--pad_color) 70%, #222) 75%);
  box-shadow: 0 3px 0 #0e0e0f, 0 0 12px 1px color-mix(in srgb, var(--pad_color) 50%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
  color: #111;
}

.mini_pad:focus-visible {
  outline: 2px solid var(--hw_red);
  outline-offset: 2px;
}

.mini_pad:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.danger :deep(.cap) {
  color: #8f1d12;
}

.edit_body {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 20px;
}

/* la columna de datos no se achica por debajo de 300 px: si no entra, las placas bajan */
.edit_left {
  flex: 1 1 300px;
  min-width: 300px;
}

.edit_plates {
  display: grid;
  grid-template-columns: auto auto;
  grid-template-rows: auto 1fr;
  gap: 12px;
  align-items: start;
}

.volume {
  grid-row: 1 / 3;
}

.weight {
  justify-self: start;
}

.dialog_footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}

.dialog_actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-end;
}

/* modo de escucha: sin sync o con el motor parado no cuenta (se puede elegir igual) */
.listen {
  display: inline-flex;
  gap: 4px;
  align-items: flex-end;
  padding: 0 6px;
  border-left: 1px solid rgba(228, 225, 216, 0.18);
  border-right: 1px solid rgba(228, 225, 216, 0.18);
}

.listen.off {
  opacity: 0.5;
}
</style>
