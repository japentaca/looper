<template>
  <el-dialog v-model="store.loginVisible" :title="mode == 'login' ? 'Login' : 'Create account'"
    :width="mode == 'login' ? '380px' : '460px'" align-center @closed="reset_messages">
    <!-- último mensaje del backend (pendiente de aprobación, error, solicitud recibida) -->
    <el-alert v-if="msg.text" :type="msg.type" :title="msg.text" :closable="false" show-icon class="msg" />

    <el-form v-if="mode == 'login'" :model="form" label-position="top" @submit.prevent="doLogin">
      <el-form-item label="Email">
        <el-input v-model="form.email" autocomplete="username" />
      </el-form-item>
      <el-form-item label="Password">
        <el-input v-model="form.password" type="password" show-password autocomplete="current-password"
          @keyup.enter="doLogin" />
      </el-form-item>
    </el-form>

    <el-form v-else :model="reg" label-position="top" @submit.prevent="doRegister">
      <el-form-item label="Email">
        <el-input v-model="reg.email" autocomplete="email" maxlength="254" />
      </el-form-item>
      <el-form-item label="Public name">
        <el-input v-model="reg.name" maxlength="32" show-word-limit placeholder="3–32: letters, numbers, space . - _" />
      </el-form-item>
      <el-form-item label="Password">
        <el-input v-model="reg.password" type="password" show-password autocomplete="new-password"
          placeholder="8–72 characters" />
      </el-form-item>
      <el-form-item label="Repeat password">
        <el-input v-model="reg.password2" type="password" show-password autocomplete="new-password" />
      </el-form-item>
      <el-form-item label="Bio (optional, public)">
        <el-input v-model="reg.bio" type="textarea" :rows="3" maxlength="280" show-word-limit />
      </el-form-item>
      <div class="license">
        <div class="license_title">Licencia: libre uso dentro de Looper</div>
        <p>
          Los audios que subas quedan en el catálogo público de Looper. Cualquier usuario puede
          escucharlos, importarlos en sus proyectos y reproducirlos dentro de Looper, sin pedirte
          permiso ni pagarte. La licencia no cubre usos fuera de Looper.
        </p>
        <el-checkbox v-model="reg.accept_license">Acepto la licencia</el-checkbox>
      </div>
    </el-form>

    <template #footer>
      <template v-if="mode == 'login'">
        <el-button class="wide_btn" type="success" size="large" :loading="busy" @click="doLogin">LOGIN</el-button>
        <el-button class="switch_btn" link @click="set_mode('register')">Create an account</el-button>
      </template>
      <template v-else>
        <el-button class="wide_btn" type="success" size="large" :loading="busy" :disabled="!reg.accept_license"
          @click="doRegister">REGISTER</el-button>
        <el-button class="switch_btn" link @click="set_mode('login')">I already have an account</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup>

import { reactive, ref } from "vue"
import { store, store_get_user_info } from "../helpers/composable"
import { login, register, error_text } from "../helpers/api"
const form = reactive({
  email: "",
  password: ""
})
const reg = reactive({
  email: "",
  name: "",
  password: "",
  password2: "",
  bio: "",
  accept_license: false
})
const mode = ref("login") // "login" | "register"
const busy = ref(false)
const msg = reactive({ type: "error", text: "" })

function show_msg(type, text) {
  msg.type = type
  msg.text = text
}
function reset_messages() {
  msg.text = ""
}
function set_mode(m) {
  mode.value = m
  reset_messages()
}

async function doLogin() {
  if (busy.value) return
  busy.value = true
  reset_messages()
  try {
    let res = await login(form)
    if (res.stat) {
      store.loginVisible = false
      store.isLogged = true
      store.u_info = res.data.u_info
      form.password = ""

      await store_get_user_info()
    } else {
      // cuenta pendiente: aviso, no error (la clave era correcta)
      show_msg(/pendiente/i.test(res.text ?? "") ? "warning" : "error", res.text)
    }
  } catch (e) {
    show_msg("error", error_text(e))
  } finally {
    busy.value = false
  }
}

async function doRegister() {
  if (busy.value) return
  reset_messages()
  if (reg.password !== reg.password2) return show_msg("error", "Las claves no coinciden")
  busy.value = true
  try {
    let res = await register({
      email: reg.email,
      password: reg.password,
      name: reg.name,
      bio: reg.bio,
      accept_license: reg.accept_license
    })
    if (res.stat) {
      // la cuenta queda pendiente de aprobación: se vuelve al login con el aviso a la vista
      form.email = reg.email.trim()
      form.password = ""
      Object.assign(reg, { email: "", name: "", password: "", password2: "", bio: "", accept_license: false })
      mode.value = "login"
      show_msg("success", res.text)
    } else {
      show_msg("error", res.text)
    }
  } catch (e) {
    show_msg("error", error_text(e))
  } finally {
    busy.value = false
  }
}

</script>

<style scoped>
.wide_btn {
  width: 100%;
}

.switch_btn {
  margin: 10px 0 0;
  width: 100%;
}

.msg {
  margin-bottom: 14px;
}

.license {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel_2);
  font-size: 12px;
  color: var(--muted);
}

.license_title {
  color: var(--text);
  font-weight: 700;
}

.license p {
  margin: 6px 0 8px;
  line-height: 1.5;
}
</style>
