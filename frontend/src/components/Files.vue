<template>
  <div>
    <div class="view_switch">
      <el-radio-group v-model="fileListViewMode" size="small">
        <el-radio-button label="Box" />
        <el-radio-button label="Table" />

      </el-radio-group>
      <!-- filtro por tonalidad (solo lo que se muestra; el motor sortea todos) -->
      <span class="key_filter">
        <span class="silk">Key</span>
        <el-select v-model="key_filter.tonic" size="small" class="key_select" placeholder="any" clearable filterable>
          <el-option v-for="t in KEY_TONICS" :key="t" :label="t" :value="t" />
        </el-select>
        <el-checkbox v-model="key_filter.atonal" size="small" :disabled="!key_filter.tonic">+ atonal</el-checkbox>
        <span v-if="key_filter.tonic" class="muted">{{ shown_files.length }} / {{ store.files.length }}</span>
      </span>
    </div>
    <div v-show="(fileListViewMode == 'Box')" class="box">
      <!-- cada archivo es un cartucho: etiqueta de papel con bandas de color del Track Group y de sus Tags.
        FileCart calcula si suena (clase playing y el LED vía slot): Files.vue no lee el estado del motor -->
      <FileCart v-for="file in shown_files" :key="file.id" v-slot="{ sounding }" :file="file"
        :class="{ drag_over: drag_id === file.id, unavailable: !drawable(file) }"
        :title="not_drawable_title(file)" @dragover="ondragover($event, file)"
        @dragleave="ondragleave($event, file)" @drop="ondrop($event, file)">
        <div class="grip">
          <Led color="green" :lit="sounding" />
        </div>
        <div class="label">
          <div class="bands">
            <span :style="{ background: trg_of(file)?.color ?? 'transparent' }"></span>
            <span class="tag_bands">
              <span v-for="tag in file.tag_objs" :key="tag.id" :style="{ background: tag.color }"></span>
            </span>
          </div>
          <el-tooltip effect="dark" :content="file.original_name" placement="top-start">
            <p class="name">{{ file.original_name }}</p>
          </el-tooltip>
          <p class="specs">
            <template v-if="file.isLoaded">{{ file.duration_fixed }} s · {{ timing_text(file) }}<template
                v-if="file.music_key"> · {{ file.music_key }}</template></template>
            <template v-else>loading…</template>
            <span v-if="file_anchor(file) == 'end'" class="anchor_mark" :title="anchor_title(file)"> · ⇥end</span>
            <span v-if="file.available === false" class="unavailable_mark"> · unavailable</span>
            <span v-else-if="out_of_tempo(file)" class="unavailable_mark"> · out of tempo</span>
          </p>
          <p class="tags">
            <span class="chip" :class="{ empty: !trg_of(file) }"
              :style="{ background: trg_of(file)?.color }">{{ trg_of(file)?.name ?? "no group" }}</span>
            <span v-for="tag in file.tag_objs" :key="tag.id" class="chip" :style="{ background: tag.color }">{{
              tag.name }}</span>
            <span v-if="file.tag_objs.length == 0" class="chip empty">no tag</span>
          </p>
        </div>
        <div class="cart_foot">
          <span class="actions">
            <el-icon v-if="file.isLoaded" :size="iconSize" class="icons" :title="preview_title(file)"
              @click="togglePreview(file)">
              <VideoPause v-if="is_previewing(file)" />
              <VideoPlay v-else />
            </el-icon>
            <el-icon :size="iconSize" class="icons" title="Edit" @click="editFile(file)">
              <EditPen />
            </el-icon>
            <el-icon :size="iconSize" class="icons" title="Delete" @click="deleteFile(file)">
              <Delete />
            </el-icon>
          </span>
        </div>
      </FileCart>
    </div>
    <!-- el-table no tiene eventos de drag por fila: se delegan desde el contenedor (ver row_file) -->
    <div v-show="(fileListViewMode == 'Table')" @dragover="ondragover_table" @dragleave="ondragleave_table"
      @drop="ondrop_table">
      <el-table :data="shown_files" style="width: 100%" :row-class-name="row_class">
        <el-table-column sortable prop="original_name" label="Name" min-width="260" show-overflow-tooltip />
        <el-table-column sortable prop="duration_fixed" label="Duration" width="100" />
        <el-table-column sortable prop="beats" label="Beats" width="80">
          <template #default="scope">{{ scope.row.kind == 'shot' ? 'shot' : scope.row.beats }}</template>
        </el-table-column>
        <el-table-column sortable prop="bpm" label="BPM" width="90">
          <template #default="scope">
            <span :class="{ out_tempo: out_of_tempo(scope.row) }" :title="not_drawable_title(scope.row)">{{
              scope.row.kind == 'shot' ? '' : fmt_bpm(scope.row.bpm) }}</span>
          </template>
        </el-table-column>
        <el-table-column sortable prop="music_key" label="Key" width="80">
          <template #default="scope">{{ key_label(scope.row.music_key) }}</template>
        </el-table-column>
        <el-table-column sortable label="Track Group" prop="track_group" width="130">
          <template #default="scope">
            <span v-if="trg_of(scope.row)" class="chip" :style="{ background: trg_of(scope.row).color }">{{
                trg_of(scope.row).name
              }}</span>
          </template>
        </el-table-column>
        <!-- se ordena por el nombre del primer tag -->
        <el-table-column sortable label="Tags" :sort-by="(row) => row.tag_objs[0]?.name ?? ''" width="170">
          <template #default="scope">
            <span class="chip_list">
              <span v-for="tag in scope.row.tag_objs" :key="tag.id" class="chip" :style="{ background: tag.color }">{{
                tag.name }}</span>
            </span>
          </template>
        </el-table-column>
        <!-- anclaje efectivo de los disparos one-shot: solo se marca "end" (start es lo normal) -->
        <el-table-column label="Anchor" sortable :sort-by="(row) => file_anchor(row)" width="90">
          <template #default="scope">
            <span v-if="file_anchor(scope.row) == 'end'" class="anchor_mark" :title="anchor_title(scope.row)">⇥END</span>
          </template>
        </el-table-column>
        <!-- sin v-if en la columna: el-table mezcla las celdas si una columna aparece después -->
        <el-table-column label="State" sortable width="90">
          <template #default="scope">
            <span class="chip playing_chip" v-if="store.loading == false"
              v-show="audio_players[scope.row.id]?.state == 'started'">PLAYING</span>
          </template>

        </el-table-column>
        <el-table-column label="Actions" width="120" align="right">
          <template #default="scope">
            <span class="row_actions">
              <el-icon v-if="scope.row.isLoaded" :size="iconSize" class="icons" :title="preview_title(scope.row)"
                @click="togglePreview(scope.row)">
                <VideoPause v-if="is_previewing(scope.row)" />
                <VideoPlay v-else />
              </el-icon>
              <el-icon :size="iconSize" class="icons" title="Edit" @click="editFile(scope.row)">
                <EditPen />
              </el-icon>
              <el-icon :size="iconSize" class="icons" title="Delete" @click="deleteFile(scope.row)">
                <Delete />
              </el-icon>
            </span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>


  <el-dialog v-if="curr_edit_file != null" v-model="dialogVisible" :title="curr_edit_file.original_name" width="min(980px, 96vw)"
    class="hw_dialog" align-center draggable>
    <div class="edit_body">
      <!-- pantalla de onda a todo el ancho, con la grilla y los cursores (WaveScreen.vue). La grilla de un loop
        sigue al input Beats mientras se edita, antes de guardar (beats_draft) -->
      <WaveScreen :file="curr_edit_file" :beats="beats_draft" :active="dialogVisible" />
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
          <LedButton size="small" led="green" :lit="is_previewing(curr_edit_file)"
            :text="is_previewing(curr_edit_file) ? 'STOP' : 'PLAY'" :disabled="!curr_edit_file.isLoaded"
            :title="preview_title(curr_edit_file)" @click="togglePreview(curr_edit_file)" />
          <LedButton size="small" text="DELETE" class="danger" @click="deleteFile(curr_edit_file)" />
        </span>
        <LedButton size="small" text="CLOSE" @click="dialogVisible = false" />
      </div>
    </template>
  </el-dialog>
</template>
<script setup>

import { ref, watch, computed } from "vue"
import {
  store, audio_players, files_by_id, trg_of, toggle_file_tag, save_file, save_file_debounced, delete_project_file, WEIGHT_MAX,
  REPEAT_OPTIONS, file_anchor
} from "../helpers/composable"
import LedButton from "./hw/LedButton.vue"
import Fader from "./hw/Fader.vue"
import RangePads from "./hw/RangePads.vue"
import Knob from "./hw/Knob.vue"
import Lcd from "./hw/Lcd.vue"
import Led from "./hw/Led.vue"
import FileCart from "./FileCart.vue"
import WaveScreen from "./WaveScreen.vue"
import { TrackCtrl, calculate_timing } from "../helpers/TrackCtrl"
import { update_file, error_text } from "../helpers/api"
import { ElMessageBox, ElMessage } from 'element-plus'
import { KEY_TONICS, KEY_OPTIONS, key_label, key_matches } from "../helpers/music_key"

import * as toneLib from "../helpers/toneLib"
import { fader_to_db, db_to_fader, db_label, FILE_VOL_MAX_DB, VOL_OFF_DB } from "../helpers/mixer"

const fileListViewMode = ref("Table")

// filtro por tonalidad: tónica elegida (trae mayor y menor) y si se suman los atonales
const key_filter = ref({ tonic: "", atonal: true })
const shown_files = computed(() => store.files.filter(f => key_matches(f.music_key, key_filter.value.tonic, key_filter.value.atonal)))

// archivo no disponible (oculto por el admin o dueño bloqueado): queda en el proyecto pero el motor
// no lo sortea. Se muestra atenuado (cartucho y fila de la tabla).
const unavailable_title = "Unavailable: hidden by an admin or its owner is blocked. It is not played."
// la clase fid_<id> identifica el archivo de cada fila para el drag&drop (la tabla se puede ordenar)
function row_class({ row }) {
  let cls = [`fid_${row.id}`]
  if (!drawable(row)) cls.push("unavailable_row")
  if (drag_id.value === row.id) cls.push("drag_over_row")
  if (is_previewing(row)) cls.push("previewing_row")
  return cls.join(" ")
}

// --- tempo (ver file_timing en TrackCtrl.js) ---
// loop que habría que correr más que la tolerancia del proyecto: tampoco se sortea
function out_of_tempo(file) {
  return file.kind != "shot" && file.in_tempo === false
}
function drawable(file) {
  return file.available !== false && !out_of_tempo(file)
}
function not_drawable_title(file) {
  if (file.available === false) return unavailable_title
  if (out_of_tempo(file)) {
    // timing_basis y no tempo / tempo_tol: esos cambian en vivo mientras se arrastra el knob (ver TrackCtrl.js)
    let { tempo, tol } = TrackCtrl.timing_basis
    return `Out of tempo: at ${fmt_bpm(file.bpm)} BPM it is more than ±${tol}% away from `
      + `${tempo} BPM (also at half or double time). It is not played.`
  }
  return undefined
}
function fmt_bpm(bpm) {
  let n = Number(bpm)
  return n > 0 ? String(Math.round(n * 10) / 10) : "–"
}
function timing_text(file) {
  if (file.kind == "shot") return "shot"
  return `${file.beats ?? "?"} beats · ${fmt_bpm(file.bpm)} BPM`
}
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

const dialogVisible = ref(false)
const curr_edit_file = ref(null)

async function editFile(file) {
  beats_draft.value = null
  curr_edit_file.value = file
  dialogVisible.value = true
}

// pedido de edición desde otro componente (store.edit_file_id, ver composable.js)
watch(() => store.edit_file_id, (id) => {
  if (id == null) return
  if (files_by_id[id]) editFile(files_by_id[id])
  store.edit_file_id = null
})
// tags que se pueden agregar al archivo del diálogo de edición

// pista del archivo en el proyecto: tocar la que ya tiene lo deja sin pista
async function set_track_group(file, id) {
  if (file.track_group === id) id = null
  file.track_group = id
  await save_file(file)
}
async function toggleTag(file, id) {
  toggle_file_tag(file, id)
  await save_file(file)
}
function weight_title(file) {
  let w = file.props.weight
  return w == 0 ? "Weight 0: never drawn"
    : `Chance of being drawn, relative to the other files of its track (0 = never, ${WEIGHT_MAX} = max)`
}

// --- anclaje de los disparos one-shot (ver file_anchor en composable.js) ---
const ANCHOR_TEXT = {
  start: "Start: the file starts at the trigger point",
  end: "End: the file ends at the trigger point (riser, reverse crash)",
}
const ANCHOR_HELP = "Where a one-shot track places the file relative to its trigger point (Tag change or phrase "
  + "start). Loop tracks ignore it."
function anchor_title(file) {
  return ANCHOR_TEXT[file_anchor(file)]
}

function repeat_label(r) {
  if (!r) return ""
  return r[0] == r[1] ? "×" + r[0] : "×" + r[0] + "–" + r[1]
}

// volumen, peso y Repeat del diálogo: guardado diferido (con la rueda o las flechas cambian de a pasos)
function onChange(file) {
  save_file_debounced(file)
}

async function ondrop(e, file) {
  drag_id.value = null
  e.preventDefault()
  let msg_type = e.dataTransfer.getData("msg_type")
  if (msg_type == "track_group") {
    let id = e.dataTransfer.getData("id")
    file.track_group = id
    await save_file(file)
  } else if (msg_type == "tag") {
    // un archivo puede tener varios tags: soltar un tag que ya tiene lo quita
    await toggleTag(file, e.dataTransfer.getData("id"))
  }
}
// cartucho o fila resaltados mientras se les arrastra encima un pad de Track Group o Tag
const drag_id = ref(null)

function ondragover(e, file) {
  // un pad de FX (looper/fx, FxPad.vue) solo se suelta en las tiras: acá no se resalta ni se acepta
  if (e.dataTransfer.types.includes("looper/fx")) return
  drag_id.value = file.id
  e.preventDefault()
}
function ondragleave(e, file) {
  // dragleave también salta al pasar sobre un hijo del cartucho: solo se limpia si se sale del todo
  if (!e.currentTarget.contains(e.relatedTarget) && drag_id.value === file.id) drag_id.value = null
  e.preventDefault()
}

// vista Table: archivo de la fila bajo el puntero, según su clase fid_<id> (ver row_class)
function row_file(e) {
  let tr = e.target.closest?.("tr.el-table__row")
  let cls = tr && [...tr.classList].find(c => c.startsWith("fid_"))
  return cls ? files_by_id[cls.slice(4)] : null
}
function ondragover_table(e) {
  let file = row_file(e)
  if (file) ondragover(e, file)
  else drag_id.value = null
}
function ondragleave_table(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) drag_id.value = null
}
function ondrop_table(e) {
  let file = row_file(e)
  if (file) ondrop(e, file)
  else drag_id.value = null
}

// el archivo es el que está sonando en el preview
function is_previewing(file) {
  return toneLib.previewing(file.id)
}

// el botón de preview es play o stop según si ese archivo ya suena en el preview
// (lo que suena en el motor no se corta desde acá)
function togglePreview(file) {
  if (is_previewing(file)) toneLib.playerStop()
  else toneLib.playFile(file)
}

function preview_title(file) {
  return is_previewing(file) ? "Stop preview" : "Preview"
}



// un archivo propio se borra del todo (audio y en todos los proyectos que lo usan); uno importado
// solo se quita de este proyecto
function deleteFile(file) {
  ElMessageBox.confirm(
    file.own ? 'Will permanently delete the file (also from every project that uses it). Continue?'
      : 'Will remove the file from this project. Continue?',
    'Warning',
    {
      confirmButtonText: 'OK',
      cancelButtonText: 'Cancel',
      type: 'warning',
    }
  )
    .then(async () => {
      if (!await delete_project_file(file)) return
      if (curr_edit_file.value?.id === file.id) dialogVisible.value = false
      ElMessage({
        type: 'success',
        message: file.own ? 'Delete completed' : 'Removed from project',
      })
    })
    .catch((e) => {
      console.log(e)

    })
}

const iconSize = 18

</script>
<style scoped>
.view_switch {
  margin-bottom: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
}

.key_filter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.key_select {
  width: 96px;
}

.actions {
  display: flex;
  gap: 0;
}

.row_actions {
  display: inline-flex;
  gap: 2px;
}

.icons {
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--muted);
}

.icons:hover {
  color: var(--text);
  background: var(--border);
}

.box {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
}

/* cartucho de plástico negro */
.cart {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 10px 8px;
  border-radius: 6px 6px 4px 4px;
  border: 1px solid #0a0a0b;
  background: var(--hw_tex_plastic) center / cover, #18181a;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  transition: box-shadow 0.15s, transform 0.15s;
}

.cart:hover {
  transform: translateY(-1px);
}

.cart.playing {
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.55), 0 0 0 1px var(--hw_green), 0 0 12px rgba(60, 230, 120, 0.25);
}

/* destino de un pad arrastrado */
.cart.drag_over {
  box-shadow: 0 0 0 2px var(--hw_yellow), 0 0 14px rgba(255, 210, 60, 0.35);
}

/* no disponible: fuera del sorteo, cartucho atenuado (las acciones siguen usables) */
.cart.unavailable .label,
.cart.unavailable .grip {
  opacity: 0.4;
  filter: grayscale(1);
}

.unavailable_mark {
  font-weight: 700;
  text-transform: uppercase;
}

.el-table :deep(.unavailable_row) {
  opacity: 0.45;
}

/* fila que suena en el preview (botón play del renglón) */
/* variables de Element Plus para el fondo de la fila, así también vale con el hover */
.el-table :deep(.previewing_row) {
  --el-table-tr-bg-color: rgba(53, 224, 122, 0.14);
  --el-table-row-hover-bg-color: rgba(53, 224, 122, 0.2);
}

.el-table :deep(.previewing_row) > td.el-table__cell:first-child {
  box-shadow: inset 3px 0 0 var(--hw_green);
}

.el-table :deep(.drag_over_row) > td.el-table__cell {
  box-shadow: inset 0 2px 0 var(--hw_yellow), inset 0 -2px 0 var(--hw_yellow);
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

/* estrías de agarre en el borde superior, con el LED a la derecha */
.grip {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: 18px;
  margin: 0 -10px;
  padding: 0 10px;
  background: repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.07) 0 2px, transparent 2px 6px);
  border-bottom: 1px solid #000;
}

/* etiqueta de papel pegada en el cartucho */
.label {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 10px 9px 18px;
  border-radius: 2px;
  background: linear-gradient(180deg, #ece7d8, #dcd6c4);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  color: #1e1f22;
}

/* bandas de color del Track Group (arriba) y de los Tags (abajo, repartidos) en el borde de la etiqueta */
.bands {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 8px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(0, 0, 0, 0.12);
}

.bands > span {
  flex: 1;
}

.tag_bands {
  display: flex;
  flex-direction: column;
}

.tag_bands span {
  flex: 1;
}

.name {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
  font-size: 13px;
}

.specs {
  margin: 0;
  font-size: 11px;
  opacity: 0.7;
}

.tags {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tags .chip {
  padding: 0 8px;
  font-size: 10px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}

.tags .chip.empty {
  background: transparent;
  color: rgba(0, 0, 0, 0.4);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
}

.cart_foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.cart_foot .icons {
  color: var(--hw_silk);
  opacity: 0.6;
}

.cart_foot .icons:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.08);
}

.playing_chip {
  background: var(--accent);
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

.anchor_mark {
  font-weight: 700;
  letter-spacing: 0.5px;
}


.dialog_footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}

.dialog_actions {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
</style>
