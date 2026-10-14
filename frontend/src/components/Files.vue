<template>
  <div>
    <div class="view_switch">
      <el-radio-group v-model="fileListViewMode" size="small">
        <el-radio-button label="Box" />
        <el-radio-button label="Table" />

      </el-radio-group>
    </div>
    <div v-show="(fileListViewMode == 'Box')" class="box">
      <!-- cada archivo es un cartucho: etiqueta de papel con bandas de color del Track Group y de sus Tags -->
      <div v-for="(file, index) in store.files" :key="file.id" class="cart"
        :class="{ playing: is_sounding(file), drag_over: drag_index === index, unavailable: !drawable(file) }"
        :title="not_drawable_title(file)" @dragover="ondragover($event, index)"
        @dragleave="ondragleave($event, index)" @drop="ondrop($event, index)">
        <div class="grip">
          <Led color="green" :lit="is_sounding(file)" />
        </div>
        <div class="label">
          <div class="bands">
            <span :style="{ background: file.track_group_obj?.color ?? 'transparent' }"></span>
            <span class="tag_bands">
              <span v-for="tag in file.tag_objs" :key="tag.id" :style="{ background: tag.color }"></span>
            </span>
          </div>
          <el-tooltip effect="dark" :content="file.original_name" placement="top-start">
            <p class="name">{{ file.original_name }}</p>
          </el-tooltip>
          <p class="specs">
            <template v-if="file.isLoaded">{{ file.duration_fixed }} s · {{ timing_text(file) }}</template>
            <template v-else>loading…</template>
            <span v-if="file.available === false" class="unavailable_mark"> · unavailable</span>
            <span v-else-if="out_of_tempo(file)" class="unavailable_mark"> · out of tempo</span>
          </p>
          <p class="tags">
            <span class="chip" :class="{ empty: !file.track_group_obj }"
              :style="{ background: file.track_group_obj?.color }">{{ file.track_group_obj?.name ?? "no group" }}</span>
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
      </div>
    </div>
    <div v-show="(fileListViewMode == 'Table')">
      <el-table :data="store.files" style="width: 100%" :row-class-name="row_class">
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
        <el-table-column sortable label="Track Group" prop="track_group" width="130">
          <template #default="scope">
            <span v-if="scope.row.track_group != null" class="chip" :style="{ background: scope.row.track_group_obj.color }">{{
                scope.row.track_group_obj.name
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


  <el-dialog v-if="curr_edit_file != null" v-model="dialogVisible" :title="curr_edit_file.original_name" width="540px"
    align-center draggable>
    <div class="edit_body">
      <div class="edit_left">
        <div class="edit_info">
          <span class="info_label">Duración</span>
          <span v-if="curr_edit_file.isLoaded">{{ curr_edit_file.duration_fixed }} s</span>
          <span v-else class="muted">cargando…</span>

          <!-- tipo y beats: solo el dueño los cambia (PUT /files/:id); el bpm lo deduce el backend -->
          <span class="info_label">Tipo</span>
          <span v-if="curr_edit_file.own && !store.read_only">
            <el-radio-group :model-value="curr_edit_file.kind" size="small" :disabled="saving_timing"
              @change="v => save_timing(curr_edit_file, { kind: v })">
              <el-radio-button label="loop">Loop</el-radio-button>
              <el-radio-button label="shot">Shot</el-radio-button>
            </el-radio-group>
          </span>
          <span v-else>{{ curr_edit_file.kind == 'shot' ? 'Shot' : 'Loop' }}</span>

          <template v-if="curr_edit_file.kind != 'shot'">
            <span class="info_label">Beats</span>
            <span class="timing_row">
              <el-input-number v-if="curr_edit_file.own && !store.read_only" :model-value="curr_edit_file.beats"
                size="small" :min="1" :max="1024" :precision="0" :step="1" :disabled="saving_timing"
                @change="v => v && save_timing(curr_edit_file, { beats: v })" />
              <span v-else>{{ curr_edit_file.beats }}</span>
              <span>{{ fmt_bpm(curr_edit_file.bpm) }} BPM</span>
              <span v-if="out_of_tempo(curr_edit_file)" class="out_tempo"
                :title="not_drawable_title(curr_edit_file)">out of tempo</span>
            </span>
          </template>

          <span class="info_label">Track group</span>
          <span>
            <span v-if="curr_edit_file.track_group_obj" class="chip"
              :style="{ background: curr_edit_file.track_group_obj.color }">{{ curr_edit_file.track_group_obj.name }}</span>
            <span v-else class="muted">sin asignar</span>
          </span>

          <span class="info_label">Tags</span>
          <span class="chip_list">
            <span v-for="tag in curr_edit_file.tag_objs" :key="tag.id" class="chip" :style="{ background: tag.color }">{{
              tag.name }}<span class="chip_remove" title="Quitar tag" @click="toggleTag(curr_edit_file, tag.id)">✕</span></span>
            <el-select v-if="unassigned_tags.length > 0" class="add_tag" :model-value="null" placeholder="+ tag"
              size="small" @change="(id) => toggleTag(curr_edit_file, id)">
              <el-option v-for="tag in unassigned_tags" :key="tag.id" :label="tag.name" :value="tag.id" />
            </el-select>
            <span v-else-if="curr_edit_file.tag_objs.length == 0" class="muted">no hay tags creados</span>
          </span>
        </div>
      </div>

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
    </div>

    <template #footer>
      <div class="dialog_footer">
        <span class="dialog_actions">
          <el-icon v-if="curr_edit_file.isLoaded" :size="iconSize" class="icons" :title="preview_title(curr_edit_file)"
            @click="togglePreview(curr_edit_file)">
            <VideoPause v-if="is_previewing(curr_edit_file)" />
            <VideoPlay v-else />
          </el-icon>
          <el-icon :size="iconSize" class="icons" @click="deleteFile(curr_edit_file)">
            <Delete />
          </el-icon>
        </span>
        <el-button type="primary" @click="dialogVisible = false">CLOSE</el-button>
      </div>
    </template>
  </el-dialog>
</template>
<script setup>

import { ref, watch, computed } from "vue"
import { store, audio_players, track_groups_by_id, toggle_file_tag, save_file, delete_project_file } from "../helpers/composable"
import Fader from "./hw/Fader.vue"
import Lcd from "./hw/Lcd.vue"
import Led from "./hw/Led.vue"
import { TrackCtrl, calculate_timing } from "../helpers/TrackCtrl"
import { update_file, error_text } from "../helpers/api"
import { ElMessageBox, ElMessage } from 'element-plus'

import * as toneLib from "../helpers/toneLib"
import { fader_to_db, db_to_fader, db_label, FILE_VOL_MAX_DB, VOL_OFF_DB } from "../helpers/mixer"

const fileListViewMode = ref("Table")

// archivo no disponible (oculto por el admin o dueño bloqueado): queda en el proyecto pero el motor
// no lo sortea. Se muestra atenuado (cartucho y fila de la tabla).
const unavailable_title = "Unavailable: hidden by an admin or its owner is blocked. It is not played."
function row_class({ row }) {
  return drawable(row) ? "" : "unavailable_row"
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
    return `Out of tempo: at ${fmt_bpm(file.bpm)} BPM it is more than ±${TrackCtrl.tempo_tol}% away from `
      + `${TrackCtrl.tempo} BPM (also at half or double time). It is not played.`
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
// cambia tipo o beats de un archivo propio. El backend recalcula el bpm; con la respuesta se
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
    calculate_timing()
  } catch (e) {
    ElMessage({ type: 'error', message: error_text(e) })
  } finally {
    saving_timing.value = false
  }
}


// marcas en dB ubicadas según la curva; abajo del todo = silencio
const volume_marks = [0, -6, -12, -24, -36].map(v => ({ value: db_to_fader(v, FILE_VOL_MAX_DB), label: v }))
  .concat({ value: 0, label: "-∞" })

const dialogVisible = ref(false)
const curr_edit_file = ref(null)

async function editFile(file) {
  //console.log("editFile", file)
  curr_edit_file.value = file
  dialogVisible.value = true
}
// tags que se pueden agregar al archivo del diálogo de edición
const unassigned_tags = computed(() => store.tags.filter(t => !curr_edit_file.value?.tags.includes(t.id)))

async function toggleTag(file, id) {
  toggle_file_tag(file, id)
  await save_file(file)
}
async function onChange(file) {
  console.log("change,file", file)
  await save_file(file)
}

async function ondrop(e, index) {
  drag_index.value = null
  console.log("drop", e, index)
  let msg_type = e.dataTransfer.getData("msg_type")
  console.log("msg_type", msg_type)
  if (msg_type == "track_group") {
    let id = e.dataTransfer.getData("id")
    console.log("drop trg", id)
    store.files[index].track_group = id
    store.files[index].track_group_obj = track_groups_by_id[id]
    await save_file(store.files[index])
  } else if (msg_type == "tag") {
    // un archivo puede tener varios tags: soltar un tag que ya tiene lo quita
    await toggleTag(store.files[index], e.dataTransfer.getData("id"))

  }
  e.preventDefault()


}
// cartucho resaltado mientras se le arrastra encima un pad de Track Group o Tag
const drag_index = ref(null)

async function ondragover(e, index) {
  drag_index.value = index
  e.preventDefault()
}
async function ondragleave(e, index) {
  // dragleave también salta al pasar sobre un hijo del cartucho: solo se limpia si se sale del todo
  if (!e.currentTarget.contains(e.relatedTarget) && drag_index.value === index) drag_index.value = null
  e.preventDefault()
}

// el archivo es el que está sonando en el preview
function is_previewing(file) {
  return store.curr_file.isPreviewing && store.curr_file.id == file.id
}

// el botón de preview es play o stop según si ese archivo ya suena en el preview
// (lo que suena en el motor no se corta desde acá)
function togglePreview(file) {
  if (is_previewing(file)) toneLib.playerStop()
  else playFile(file)
}

function preview_title(file) {
  return is_previewing(file) ? "Stop preview" : "Preview"
}

// el archivo suena en el motor (algún track lo tiene) o en el preview
function is_sounding(file) {
  if (is_previewing(file)) return true
  return TrackCtrl.isPlaying && TrackCtrl.tracks.some(t => t.curr_file?.id == file.id && t.curr_file.isPlaying)
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

watch(
  () => store.curr_file.isPreviewing,
  (value) => {
    //console.log("store curr_file is playing", store.curr_file.original_name, value)
  }
)
async function playFile(file) {

  await toneLib.playFile(file)
  //audio_players[file.id].start()


}
const iconSize = ref(18)

</script>
<style scoped>
.view_switch {
  margin-bottom: 12px;
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
  font-size: 11px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--muted);
}

.muted {
  color: var(--muted);
}

.chip_list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.chip_remove {
  margin-left: 6px;
  cursor: pointer;
  opacity: 0.55;
}

.chip_remove:hover {
  opacity: 1;
}

.add_tag {
  width: 96px;
}

.edit_body {
  display: flex;
  align-items: flex-start;
  gap: 20px;
}

.edit_left {
  flex: 1;
  min-width: 0;
}


.dialog_footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dialog_actions {
  display: flex;
  gap: 4px;
}
</style>
