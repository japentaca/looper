<template>
  <!-- admin de usuarios (solo role = admin; App.vue no lo monta para los demás). El backend vuelve a
    chequear el rol en cada request con require_admin -->
  <el-dialog v-model="visible" title="Admin" width="860px" align-center @open="load">
    <el-tabs v-model="tab">
      <el-tab-pane :label="`Pending (${pending.length})`" name="pending">
        <el-table :data="pending" size="small" max-height="420" v-loading="busy" empty-text="No pending requests">
          <el-table-column prop="name" label="Name" min-width="120" />
          <el-table-column prop="email" label="Email" min-width="180" />
          <el-table-column prop="bio" label="Bio" min-width="200" show-overflow-tooltip />
          <el-table-column label="Date" width="100">
            <template #default="{ row }">{{ fmt_date(row.ts) }}</template>
          </el-table-column>
          <el-table-column label="" width="170" align="right">
            <template #default="{ row }">
              <el-button size="small" type="success" @click="do_action(row, 'admit')">Admit</el-button>
              <el-button size="small" type="danger" @click="confirm_action(row, 'reject')">Reject</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane :label="`Users (${others.length})`" name="users">
        <el-table :data="others" size="small" max-height="420" v-loading="busy" empty-text="No users">
          <el-table-column prop="name" label="Name" min-width="120" />
          <el-table-column prop="email" label="Email" min-width="180" />
          <el-table-column label="Status" width="130">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status == 'active' ? 'success' : 'danger'">{{ row.status }}</el-tag>
              <span v-if="row.role == 'admin'" class="role">admin</span>
            </template>
          </el-table-column>
          <el-table-column label="Quota" width="90">
            <template #default="{ row }">{{ fmt_quota(row.max_seconds) }}</template>
          </el-table-column>
          <el-table-column label="" width="250" align="right">
            <template #default="{ row }">
              <template v-if="row.role != 'admin'">
                <el-button v-if="row.status == 'active'" size="small" type="danger"
                  @click="confirm_action(row, 'block')">Block</el-button>
                <el-button v-else size="small" type="success" @click="do_action(row, 'unblock')">Unblock</el-button>
              </template>
              <el-button size="small" @click="do_reset(row)">Reset pw</el-button>
              <el-button size="small" @click="do_quota(row)">Quota</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-alert v-if="msg.text" :type="msg.type" :title="msg.text" :closable="false" show-icon class="msg" />

    <template #footer>
      <el-button @click="load">RELOAD</el-button>
      <el-button type="primary" @click="visible = false">CLOSE</el-button>
    </template>
  </el-dialog>
</template>

<script setup>

import { computed, reactive, ref } from "vue"
import { ElMessageBox } from "element-plus"
import { admin_get_users, admin_update_user, error_text } from "../helpers/api"

const visible = defineModel({ type: Boolean, default: false })

const tab = ref("pending")
const users = ref([])
const busy = ref(false)
const msg = reactive({ type: "success", text: "" })

const pending = computed(() => users.value.filter(u => u.status == "pending"))
const others = computed(() => users.value.filter(u => u.status != "pending"))

const ACTION_TEXT = { admit: "admitido", reject: "rechazado", block: "bloqueado", unblock: "desbloqueado" }

function set_msg(type, text) {
  Object.assign(msg, { type, text })
}

// trae todos los usuarios (sin filtro) y los separa en pendientes y el resto
async function load() {
  if (busy.value) return
  busy.value = true
  msg.text = ""
  try {
    let res = await admin_get_users()
    if (res.stat) users.value = res.data
    else set_msg("error", res.text)
  } catch (e) {
    set_msg("error", error_text(e))
  } finally {
    busy.value = false
  }
}

// aplica una acción y reemplaza la fila con el usuario que devuelve el backend
async function send_action(row, data, ok_text) {
  msg.text = ""
  try {
    let res = await admin_update_user(row.id, data)
    if (!res.stat) return set_msg("error", res.text)
    let i = users.value.findIndex(u => u.id == row.id)
    if (i >= 0) users.value[i] = res.data
    set_msg("success", ok_text)
  } catch (e) {
    set_msg("error", error_text(e))
  }
}

function do_action(row, action) {
  return send_action(row, { action }, `${row.name}: ${ACTION_TEXT[action]}`)
}

// rechazar y bloquear piden confirmación
async function confirm_action(row, action) {
  try {
    await ElMessageBox.confirm(
      action == "reject"
        ? `¿Rechazar la solicitud de ${row.name}? Queda bloqueada (email y nombre reservados).`
        : `¿Bloquear a ${row.name}? Su sesión se corta en el próximo request.`,
      "Admin", { confirmButtonText: "OK", cancelButtonText: "Cancel", type: "warning" })
  } catch {
    return // cancelado
  }
  await do_action(row, action)
}

// reset de clave: la define el admin y se la pasa al usuario por otro canal
async function do_reset(row) {
  let value
  try {
    ({ value } = await ElMessageBox.prompt(`Nueva clave para ${row.name} (8 a 72 caracteres)`, "Reset password", {
      confirmButtonText: "OK", cancelButtonText: "Cancel", inputType: "password",
      inputValidator: v => (typeof v == "string" && v.length >= 8) || "Mínimo 8 caracteres",
    }))
  } catch {
    return
  }
  await send_action(row, { action: "reset_password", password: value }, `${row.name}: clave cambiada`)
}

// cuota en minutos (se guarda en segundos); vacío = default del servidor
async function do_quota(row) {
  let value
  try {
    ({ value } = await ElMessageBox.prompt(`Cuota de audio de ${row.name}, en minutos (vacío = default)`, "Quota", {
      confirmButtonText: "OK", cancelButtonText: "Cancel",
      inputValue: row.max_seconds == null ? "" : String(row.max_seconds / 60),
      inputValidator: v => !v || !v.trim() || (Number(v) >= 0 && Number.isFinite(Number(v))) || "Número de minutos >= 0",
    }))
  } catch {
    return
  }
  let max_seconds = value && value.trim() ? Math.round(Number(value) * 60) : null
  await send_action(row, { action: "set_max_seconds", max_seconds }, `${row.name}: cuota ${fmt_quota(max_seconds)}`)
}

function fmt_quota(s) {
  if (s == null) return "default"
  let m = Math.floor(s / 60), r = s % 60
  return r ? `${m}:${String(r).padStart(2, "0")}` : `${m} min`
}

function fmt_date(ts) {
  return ts ? String(ts).slice(0, 10) : ""
}

</script>

<style scoped>
.role {
  margin-left: 6px;
  color: var(--accent);
  font-size: 11px;
}

.msg {
  margin-top: 12px;
}
</style>
