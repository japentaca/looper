<template>
  <div>
    <div class="view_switch">
      <el-radio-group v-model="fileListViewMode" size="small">
        <el-radio-button label="Box" />
        <el-radio-button label="Table" />

      </el-radio-group>
    </div>
    <div v-show="(fileListViewMode == 'Box')" class="box">
      <!-- cada archivo es un cartucho: etiqueta de papel con bandas de color del Track Group y del Tag -->
      <div v-for="(file, index) in store.files" :key="file.id" class="cart"
        :class="{ playing: is_sounding(file), drag_over: drag_index === index }" @dragover="ondragover($event, index)"
        @dragleave="ondragleave($event, index)" @drop="ondrop($event, index)">
        <div class="grip">
          <Led color="green" :lit="is_sounding(file)" />
        </div>
        <div class="label">
          <div class="bands">
            <span :style="{ background: file.track_group_obj?.color ?? 'transparent' }"></span>
            <span :style="{ background: file.tag_obj?.color ?? 'transparent' }"></span>
          </div>
          <el-tooltip effect="dark" :content="file.original_name" placement="top-start">
            <p class="name">{{ file.original_name }}</p>
          </el-tooltip>
          <p class="specs">
            <template v-if="file.isLoaded">{{ file.duration_fixed }} s · {{ file.beats }} beats</template>
            <template v-else>loading…</template>
          </p>
          <p class="tags">
            <span class="chip" :class="{ empty: !file.track_group_obj }"
              :style="{ background: file.track_group_obj?.color }">{{ file.track_group_obj?.name ?? "no group" }}</span>
            <span class="chip" :class="{ empty: !file.tag_obj }" :style="{ background: file.tag_obj?.color }">{{
              file.tag_obj?.name ?? "no tag" }}</span>
          </p>
        </div>
        <div class="cart_foot">
          <el-checkbox @change="onChange(file)" v-model="file.props.oneShot" label="OneShot" size="small" />
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
      <el-table :data="store.files" style="width: 100%">
        <el-table-column sortable prop="original_name" label="Name" min-width="260" show-overflow-tooltip />
        <el-table-column sortable prop="duration_fixed" label="Duration" width="100" />
        <el-table-column sortable prop="beats" label="Beats" width="80" />
        <el-table-column sortable label="Track Group" prop="track_group" width="130">
          <template #default="scope">
            <span v-if="scope.row.track_group != null" class="chip" :style="{ background: scope.row.track_group_obj.color }">{{
                scope.row.track_group_obj.name
              }}</span>
          </template>
        </el-table-column>
        <el-table-column sortable label="Tag" prop="tag" width="120">
          <template #default="scope">
            <span v-if="scope.row.tag != null" class="chip" :style="{ background: scope.row.tag_obj.color }">{{
              scope.row.tag_obj.name
            }}</span>
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
          <span v-if="curr_edit_file.isLoaded">{{ curr_edit_file.duration_fixed }} s · {{ curr_edit_file.beats }} beats</span>
          <span v-else class="muted">cargando…</span>

          <span class="info_label">Track group</span>
          <span>
            <span v-if="curr_edit_file.track_group_obj" class="chip"
              :style="{ background: curr_edit_file.track_group_obj.color }">{{ curr_edit_file.track_group_obj.name }}</span>
            <span v-else class="muted">sin asignar</span>
          </span>

          <span class="info_label">Tag</span>
          <span>
            <span v-if="curr_edit_file.tag_obj" class="chip" :style="{ background: curr_edit_file.tag_obj.color }">{{
              curr_edit_file.tag_obj.name }}</span>
            <span v-else class="muted">sin asignar</span>
          </span>
        </div>

        <el-checkbox class="one_shot" @change="onChange(curr_edit_file)" v-model="curr_edit_file.props.oneShot"
          label="OneShot" size="small" />
      </div>

      <!-- volumen del archivo (dB) como fader sobre placa de aluminio -->
      <div class="hw_plate volume">
        <span class="silk">Volume</span>
        <Fader v-model="curr_edit_file.props.volume" :min="-50" :max="0" :length="150" :marks="volume_marks"
          @change="onChange(curr_edit_file)" />
        <Lcd small :digits="3" :value="curr_edit_file.props.volume" unit="dB" />
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

import { ref, watch } from "vue"
import { store, audio_players, track_groups_by_id, tags_by_id } from "../helpers/composable"
import { delete_file, save_fileData } from "../helpers/api"
import Fader from "./hw/Fader.vue"
import Lcd from "./hw/Lcd.vue"
import Led from "./hw/Led.vue"
import { TrackCtrl } from "../helpers/TrackCtrl"
import { ElMessageBox, ElMessage } from 'element-plus'

import * as toneLib from "../helpers/toneLib"

const fileListViewMode = ref("Table")


const volume_marks = [0, -10, -20, -30, -40, -50].map(v => ({ value: v, label: v }))

const dialogVisible = ref(false)
const curr_edit_file = ref(null)

async function editFile(file) {
  //console.log("editFile", file)
  curr_edit_file.value = file
  dialogVisible.value = true
}
async function onChange(file) {
  console.log("change,file", file)
  await save_fileData({ file: file })
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
    await save_fileData({ file: store.files[index] })
  } else if (msg_type == "tag") {
    let id = e.dataTransfer.getData("id")
    store.files[index].tag = e.dataTransfer.getData("id")
    store.files[index].tag_obj = tags_by_id[id]
    await save_fileData({ file: store.files[index] })

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



function deleteFile(file) {
  ElMessageBox.confirm(
    'Will permanently delete the file. Continue?',
    'Warning',
    {
      confirmButtonText: 'OK',
      cancelButtonText: 'Cancel',
      type: 'warning',
    }
  )
    .then(async () => {

      console.log(audio_players[file.id])
      audio_players[file.id].dispose()
      //delete store.audio_players[file.id]
      store.files.splice(file.index, 1)
      for (let i = 0; i < store.files.length; i++) {
        store.files[i].index = i
      }
      await delete_file(file)
      ElMessage({
        type: 'success',
        message: 'Delete completed',
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

/* bandas de color del Track Group (arriba) y del Tag (abajo) en el borde de la etiqueta */
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

.bands span {
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
  justify-content: space-between;
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

.edit_body {
  display: flex;
  align-items: flex-start;
  gap: 20px;
}

.edit_left {
  flex: 1;
  min-width: 0;
}

.one_shot {
  margin-top: 18px;
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
