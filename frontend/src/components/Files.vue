<template>
  <div>
    <div class="view_switch">
      <el-radio-group v-model="fileListViewMode" size="small">
        <el-radio-button label="Box" />
        <el-radio-button label="Table" />

      </el-radio-group>
    </div>
    <div v-show="(fileListViewMode == 'Box')" class="box">
      <div v-for="(file, index) in store.files" :key="file.id" class="file" @dragover="ondragover($event, index)"
        @dragleave="ondragleave($event, index)" @drop="ondrop($event, index)">

        <el-tooltip effect="dark" :content=file.original_name placement="top-start">
          <p class="name">{{ file.original_name_short }}</p>
        </el-tooltip>
        <p v-if="file.isLoaded" class="tag_data">{{ file.duration_fixed }}<span> Beats:{{ file.beats }}</span></p>
        <p class="tag_data">TRG:<span v-if="file.track_group_obj" class="chip" :style="{ background: file.track_group_obj.color }">{{
              file.track_group_obj.name
            }}</span></p>
        <p class="tag_data">TAG:<span v-if="file.tag_obj" class="chip" :style="{ background: file.tag_obj.color }">{{
          file.tag_obj.name
        }}</span></p>
        <el-checkbox @change="onChange(file)" v-model="file.props.oneShot" label="OneShot" size="small" />
        <p class="actions">
          <el-icon :size="iconSize" class="icons" @click="deleteFile(file)">
            <Delete />
          </el-icon>
          <el-icon v-if="file.isLoaded" :size="iconSize" class="icons" @click="playFile(file)">
            <VideoPlay />
          </el-icon>

          <el-icon :size="iconSize" class="icons" @click="editFile(file)">
            <EditPen />
          </el-icon>
        </p>
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
        <el-table-column label="State" sortable v-if="store.loading == false" width="90">
          <template #default="scope">
            <span class="chip playing_chip" v-show="audio_players[scope.row.id].state == 'started'">PLAYING</span>
          </template>

        </el-table-column>
        
      </el-table>
    </div>
  </div>


  <el-dialog v-if="curr_edit_file != null" v-model="dialogVisible" :title="curr_edit_file.original_name" width="440px"
    align-center draggable>
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

    <div class="edit_section">
      <span class="info_label">Volumen</span>
      <el-slider v-model="curr_edit_file.props.volume" :debounce="500" :min="-50" :max="0" label="Volume" size="small"
        @change="onChange(curr_edit_file)" />
    </div>
    <el-checkbox @change="onChange(curr_edit_file)" v-model="curr_edit_file.props.oneShot" label="OneShot" size="small" />

    <template #footer>
      <div class="dialog_footer">
        <span class="dialog_actions">
          <el-icon v-if="curr_edit_file.isLoaded" :size="iconSize" class="icons" @click="playFile(curr_edit_file)">
            <VideoPlay />
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
import { ElMessageBox, ElMessage } from 'element-plus'

import * as toneLib from "../helpers/toneLib"

const fileListViewMode = ref("Table")


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
async function ondragover(e, index) {
  //console.log("dragenter", e,index)
  //e.currentTarget.classList.add('drag-enter');
  //currentColor.value = dragoverColor.value

  e.preventDefault()
}
async function ondragleave(e, index) {
  //console.log("dragleave", e, index)
  //e.currentTarget.classList.remove('drag-enter');
  //currentColor.value = colorNormal.value

  e.preventDefault()
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

.tag_data {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
}

.name {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.actions {
  margin-top: 6px;
  display: flex;
  gap: 4px;
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
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
}

.file {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: var(--panel_2);
  border: 1px solid var(--border);
  border-radius: 8px;
  transition: border-color 0.2s;
}

.file:hover {
  border-color: var(--accent);
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

.edit_section {
  margin: 18px 0 8px;
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
