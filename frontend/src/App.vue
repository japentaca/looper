<template>
  <div class="common-layout">
    <el-container>
      <el-header class="header">

        <el-button v-if="store.isLogged == false" type="success" @click="store.loginVisible = true">Login</el-button>
        <el-button v-if="store.isLogged == true" type="danger" @click="doLogout()">Logout</el-button>
        <div v-if="store.isLogged == true">User:{{ store.u_info.name }}</div>
      </el-header>
      <el-container>
        <el-aside width="200px">
          <ul>
            <li>dfdf</li>

          </ul>
        </el-aside>
        <el-main>Main
          <el-collapse>
            <el-collapse-item title="Upload Files" name="1">
              <uploader />
            </el-collapse-item>
            <el-collapse-item title="Files" name="2">
              <Files />

            </el-collapse-item>
          </el-collapse>


        </el-main>
      </el-container>
    </el-container>

    <Login :visible="store.loginVisible" />



  </div>
</template>
<script setup>
import { ref, onMounted } from "vue"
import Files from "./components/Files.vue"
import Login from "./components/Login.vue"
import Uploader from "./components/Uploader.vue"
import { store, doLogout } from "./composable"
import { get_user_info } from "./helpers/api";

const dialogLoginVisible = ref(false)
onMounted(async () => {
  let ui = await get_user_info()
  store.isLogged = ui.stat
  if (ui.stat) store.u_info = ui.u_info
  //console.log("get user info", ui)
})

</script>
<style scoped>
.header {
  border-style: outset;
  border-width: 2px;

}
</style>