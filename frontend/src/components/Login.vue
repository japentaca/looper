<template>
  <el-dialog v-model="store.loginVisible" title="Login" width="380px" align-center>
    <el-form :model="form" label-position="top" @submit.prevent="doLogin">
      <el-form-item label="Email">
        <el-input v-model="form.email" />
      </el-form-item>
      <el-form-item label="Password">
        <el-input v-model="form.password" type="password" show-password @keyup.enter="doLogin" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button class="login_btn" type="success" size="large" @click="doLogin">LOGIN</el-button>
    </template>
  </el-dialog>
</template>

<script setup>

import { reactive } from "vue"
import { store, store_get_user_info } from "../helpers/composable"
import { login } from "../helpers/api"
import { ElMessage } from 'element-plus'
const form = reactive({
  email: "",
  password: ""
})

async function doLogin() {
  let res = await login(form)
  console.log("res login", res)
  if (res.stat) {
    store.loginVisible = false
    store.isLogged = true
    store.u_info = res.data.u_info

    await store_get_user_info()
  } else {
    ElMessage({ type: 'error', message: res.text })
  }

}





</script>

<style scoped>
.login_btn {
  width: 100%;
}
</style>