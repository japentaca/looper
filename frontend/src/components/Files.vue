<template>
  <div class="box">
    <div v-for="(file, index) in store.u_info.files" class="file" @dragover="ondragover($event, index)"
      @dragleave="ondragleave($event, index)" @drop="ondrop($event, index)">
      <p class="tag_data">{{ file.original_name }} </p>
      <p class="tag_data">TRG:<span v-if="tgs_by_id[file.track_group]"
          v-bind:style="{ 'background-color': tgs_by_id[file.track_group].color }">{{
              tgs_by_id[file.track_group].name
          }}</span></p>
      <p class="tag_data">TAG:<span v-if="tags_by_id[file.tag]"
          v-bind:style="{ 'background-color': tags_by_id[file.tag].color }">{{
              tags_by_id[file.tag].name
          }}</span></p>
      <p class="tag_data">{{ file.duration }}</p>
      <el-icon :size="iconSize" class="icons" @click="deleteFile(file)">
        <Delete />
      </el-icon>
      <el-icon v-if="file.isLoaded" :size="iconSize" class="icons" @click="playFile(file)">
        <VideoPlay />
      </el-icon>

    </div>
  </div>
</template>
<script setup>

import { ref, watch } from "vue"
import { store, audio_buffers, tgs_by_id, tags_by_id } from "../helpers/composable"
import { delete_file, save_fileData } from "../helpers/api"
import { ElMessageBox, ElMessage } from 'element-plus'

import * as toneLib from "../helpers/toneLib"

const dragoverColor = ref("#AA0000")
const colorNormal = ref("blanchedalmond")
const currentColor = ref(colorNormal.value)

async function ondrop(e, index) {
  //console.log("drop", e, index)
  let msg_type = e.dataTransfer.getData("msg_type")
  console.log("msg_type", msg_type)
  if (msg_type == "track_group") {
    store.u_info.files[index].track_group = e.dataTransfer.getData("id")
    await save_fileData({ file: store.u_info.files[index] })
  } else if (msg_type == "tag") {

    store.u_info.files[index].tag = e.dataTransfer.getData("id")
    await save_fileData({ file: store.u_info.files[index] })

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

      console.log(audio_buffers[file.id])
      audio_buffers[file.id].dispose()
      //delete store.audio_buffers[file.id]
      store.u_info.files.splice(file.index, 1)
      for (let i = 0; i < store.u_info.files.length; i++) {
        store.u_info.files[i].index = i
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

  await toneLib.playFile(file)

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
}

.file:hover {
  background-color: rgb(201, 165, 3);
}

.box :first-child {
  align-self: center;
}
</style>