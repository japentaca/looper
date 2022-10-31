<template>
  <div class="box">
    <div v-for="(file, index) in store.u_info.files" class="file">
      <el-icon class="icon-delete" @click="deleteFile(file)">
        <Delete />
      </el-icon>
      {{ file.original_name }} {{ index }}
    </div>



  </div>
</template>
<script setup>


import { store, store_get_user_info } from "../composable"
import { delete_file } from "../helpers/api"
import { ElMessageBox, ElMessage } from 'element-plus'
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
      await delete_file(file)
      await store_get_user_info()
      ElMessage({
        type: 'success',
        message: 'Delete completed',
      })
    })
    .catch(() => {

    })
}

</script>
<style scoped>
.icon-delete {
  padding: 6px;
}

.box {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px 2em;

}

.file {
  transition: background-color 1s;
  border-style: outset;
  padding: 6px;
  margin: 5px;
  background-color: blanchedalmond;
}

.file:hover {
  background-color: rgb(201, 165, 3);
}

.box :first-child {
  align-self: center;
}
</style>