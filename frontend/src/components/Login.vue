<template>
  <el-dialog v-model="store.loginVisible" title="Login">
    <el-form size="large" :model="form" label-width="120px">
      <el-form-item label="Email">
        <el-input v-model="form.email" />
      </el-form-item>
      <el-form-item label="Password">
        <el-input v-model="form.password" />
      </el-form-item>
    </el-form>
    <el-row :gutter="20">
      <el-col :span="12" :offset="6">
        <el-button @click="doLogin">LOGIN</el-button>

      </el-col>
    </el-row>
  </el-dialog>
</template>

<script setup>

import { reactive } from "@vue/reactivity"
import { store, store_get_user_info } from "../helpers/composable"
import { login } from "../helpers/api"
const form = reactive({
  email: "jntaca@gmail.com",
  password: "jape"
})

async function doLogin() {
  let res = await login(form)
  console.log("res login", res)
  if (res.stat = true) {
    store.loginVisible = false
    store.isLogged = true
    store.u_info = res.data.u_info

    let t = await store_get_user_info()
  }

}





</script>

<style>

</style>