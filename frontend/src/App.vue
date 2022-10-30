<template>
  <div class="common-layout">
    <el-container>
      <el-header class="header">

        <el-button type="success" @click="store.loginVisible = true">Login</el-button>
      </el-header>
      <el-container>
        <el-aside width="200px">
          <ul>
            <li>dfdf</li>

          </ul>
        </el-aside>
        <el-main>Main</el-main>
      </el-container>
    </el-container>

    <Login :visible="store.loginVisible" />



  </div>
</template>
<script setup>
import { ref, onMounted } from "vue"
import Login from "./components/Login.vue"
import { store } from "./store"
import { get_user_info } from "./helpers/api";

const dialogLoginVisible = ref(false)
onMounted(async () => {

  let ui = await get_user_info()
  console.log("get user info", ui)

})

</script>
<style scoped>
.header {
  border-style: outset;
  border-width: 2px;

}
</style>