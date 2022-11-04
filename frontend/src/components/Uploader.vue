<template>
  <el-upload v-model:file-list="fileList" ref="uploader" class="upload-demo" :with-credentials=true accept="audio/mp3"
    drag :action=uploadPath :autoUpload="false" multiple :on-success="onSuccess" :on-change="onListChanged">
    <el-icon class="el-icon--upload">
      <upload-filled />
    </el-icon>
    <div class="el-upload__text">
      Drop file here or <em>Select files</em>
    </div>
    <template #tip>
      <div class="el-upload__tip">
        mp3 files with a size less than 2mb
      </div>
    </template>

  </el-upload>
  <!--el-progress v-if="progress > 0" :percentage="progress" /-->
  <el-button @click="doUpload" v-if="fileList.length > 0">UPLOAD</el-button>

</template>

<script setup>
import { ref, computed } from 'vue';
import { UploadFilled } from '@element-plus/icons-vue'
import { store_get_user_info } from '../helpers/composable';
const uploadPath = ref(import.meta.env.VITE_APP_BACKEND + "/api/upload")
const uploader = ref(null)
const fileList = ref([])


function onSuccess(a) {
  console.log("sucess", a)
  uploader.value.clearFiles()
  store_get_user_info()

}

async function doUpload() {
  await uploader.value.submit()
}
function onListChanged(item) {

  if (item.size > 1024 * 1024 * 40) { //30 mb
    //console.log("item excedido ", item)
    uploader.value.handleRemove(item)
  }
}


</script>

<style>

</style>