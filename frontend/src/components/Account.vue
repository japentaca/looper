<template>
  <!-- cuenta propia: bio pública y cambio de clave (se abre desde la barra superior) -->
  <el-dialog v-model="visible" title="Account" width="440px" align-center @open="on_open" @closed="on_closed">
    <div class="who">
      <b>{{ store.u_info.name }}</b>
      <span class="email">{{ store.u_info.email }}</span>
    </div>

    <div class="section_title">Bio (public)</div>
    <el-input v-model="bio" type="textarea" :rows="3" maxlength="280" show-word-limit />
    <el-alert v-if="bio_msg.text" :type="bio_msg.type" :title="bio_msg.text" :closable="false" show-icon
      class="msg" />
    <el-button class="action_btn" :loading="bio_busy" @click="doSaveBio">SAVE BIO</el-button>

    <div class="section_title">Change password</div>
    <el-form :model="pw" label-position="top" @submit.prevent="doChangePassword">
      <el-form-item label="Current password">
        <el-input v-model="pw.current" type="password" show-password autocomplete="current-password" />
      </el-form-item>
      <el-form-item label="New password">
        <el-input v-model="pw.new1" type="password" show-password autocomplete="new-password"
          placeholder="8–72 characters" />
      </el-form-item>
      <el-form-item label="Repeat new password">
        <el-input v-model="pw.new2" type="password" show-password autocomplete="new-password"
          @keyup.enter="doChangePassword" />
      </el-form-item>
    </el-form>
    <el-alert v-if="pw_msg.text" :type="pw_msg.type" :title="pw_msg.text" :closable="false" show-icon class="msg" />
    <el-button class="action_btn" :loading="pw_busy" @click="doChangePassword">CHANGE PASSWORD</el-button>

    <template #footer>
      <el-button type="primary" @click="visible = false">CLOSE</el-button>
    </template>
  </el-dialog>
</template>

<script setup>

import { reactive, ref } from "vue"
import { store } from "../helpers/composable"
import { change_password, save_profile, error_text } from "../helpers/api"

const visible = defineModel({ type: Boolean, default: false })

const bio = ref("")
const bio_busy = ref(false)
const bio_msg = reactive({ type: "success", text: "" })

const pw = reactive({ current: "", new1: "", new2: "" })
const pw_busy = ref(false)
const pw_msg = reactive({ type: "success", text: "" })

function on_open() {
  bio.value = store.u_info.bio ?? ""
  bio_msg.text = ""
  pw_msg.text = ""
}
// las claves no quedan en memoria al cerrar
function on_closed() {
  Object.assign(pw, { current: "", new1: "", new2: "" })
}

async function doSaveBio() {
  if (bio_busy.value) return
  bio_busy.value = true
  bio_msg.text = ""
  try {
    let res = await save_profile({ bio: bio.value })
    if (res.stat) {
      store.u_info.bio = bio.value.trim() || null
      Object.assign(bio_msg, { type: "success", text: "Bio guardada" })
    } else {
      Object.assign(bio_msg, { type: "error", text: res.text })
    }
  } catch (e) {
    Object.assign(bio_msg, { type: "error", text: error_text(e) })
  } finally {
    bio_busy.value = false
  }
}

async function doChangePassword() {
  if (pw_busy.value) return
  pw_msg.text = ""
  if (pw.new1 !== pw.new2) return Object.assign(pw_msg, { type: "error", text: "Las claves nuevas no coinciden" })
  pw_busy.value = true
  try {
    let res = await change_password({ current_password: pw.current, new_password: pw.new1 })
    if (res.stat) {
      Object.assign(pw, { current: "", new1: "", new2: "" })
      Object.assign(pw_msg, { type: "success", text: res.text })
    } else {
      Object.assign(pw_msg, { type: "error", text: res.text })
    }
  } catch (e) {
    Object.assign(pw_msg, { type: "error", text: error_text(e) })
  } finally {
    pw_busy.value = false
  }
}

</script>

<style scoped>
.who {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}

.email {
  color: var(--muted);
  font-size: 12px;
}

.section_title {
  margin: 18px 0 8px;
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.6px;
  text-transform: uppercase;
}

.msg {
  margin-top: 10px;
}

.action_btn {
  margin-top: 10px;
  width: 100%;
}
</style>
