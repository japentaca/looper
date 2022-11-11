<template>
  <div class="box">
    <div v-for="(file, index) in store.files" class="file" @dragover="ondragover($event, index)"
      @dragleave="ondragleave($event, index)" @drop="ondrop($event, index)">

      <el-tooltip effect="dark" :content=file.original_name placement="top-start">
        <p class="tag_data">{{ file.original_name_short }} </p>
      </el-tooltip>
      <p v-if="file.isLoaded" class="tag_data">{{ file.duration_fixed }}<span> Beats:{{ file.beats }}</span></p>
      <p class="tag_data">TRG:<span v-if="file.track_group_obj"
          v-bind:style="{ 'background-color': file.track_group_obj.color }">{{
              file.track_group_obj.name
          }}</span></p>
      <p class="tag_data">TAG:<span v-if="file.tag_obj" v-bind:style="{ 'background-color': file.tag_obj.color }">{{
          file.tag_obj.name
      }}</span></p>
      <el-checkbox @change="onChange(file)" v-model="file.props.oneShot" label="OneShot" size="small" />
      <p style="background-color:#8899AA">
        <el-icon :size="iconSize" class="icons" @click="deleteFile(file)">
          <Delete />
        </el-icon>
        <el-icon v-if="file.isLoaded" :size="iconSize" class="icons" @click="playFile(file)">
          <VideoPlay />
        </el-icon>
      </p>
    </div>
  </div>
</template>
<script setup>

import { ref, watch } from "vue"
import { store, audio_players, track_groups_by_id, tags_by_id } from "../helpers/composable"
import { delete_file, save_fileData } from "../helpers/api"
import { ElMessageBox, ElMessage } from 'element-plus'

import * as toneLib from "../helpers/toneLib"

const dragoverColor = ref("#AA0000")
const colorNormal = ref("blanchedalmond")
const currentColor = ref(colorNormal.value)

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
  () => store.curr_file.isPlaying,
  (value) => {
    console.log("store curr_file", store.curr_file.original_name, value)
  }
)
async function playFile(file) {

  //await toneLib.playFile(file)
  audio_players[file.id].start()


}
const iconSize = ref(18)

</script>
<style scoped>
.tag_data {
  padding: 0px;
  margin: 0px
}

.icons {

  padding: 2px;
}


.icons:hover {
  background-color: red;
}

.box {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr;
  gap: 9px 1em;


}

.file {
  transition: background-color 1s;
  border-style: outset;
  padding-left: 2px;
  margin-left: 1px;
  background-color: blanchedalmond;
  border-radius: 5px;
}

.file:hover {
  background-color: rgb(201, 165, 3);
}

.box :first-child {
  align-self: center;
}
</style>