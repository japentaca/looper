<template>
  <!-- admin (solo role = admin; App.vue no lo monta para los demás): usuarios, denuncias y
    estadísticas. El backend vuelve a chequear el rol en cada request con require_admin.
    El admin modera, no edita (política 4): admite/bloquea, oculta un archivo o proyecto puntual -->
  <el-dialog v-model="visible" title="Admin" width="1080px" align-center @open="load" @closed="on_closed">
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

      <el-tab-pane :label="reports_label" name="reports">
        <div class="toolbar">
          <el-radio-group v-model="reports_filter" size="small" @change="load_reports">
            <el-radio-button v-for="f in REPORT_FILTERS" :key="f.value" :value="f.value">{{ f.label }}</el-radio-button>
          </el-radio-group>
          <span class="hint">Closing a report does not hide anything: hiding is a separate action.</span>
        </div>
        <el-table :data="reports" size="small" max-height="400" v-loading="reports_busy" empty-text="No reports">
          <el-table-column label="Date" width="92">
            <template #default="{ row }">{{ fmt_date(row.ts) }}</template>
          </el-table-column>
          <el-table-column label="Target" min-width="190">
            <template #default="{ row }">
              <el-tag size="small" :type="row.target_type == 'file' ? 'info' : 'primary'" class="type">
                {{ row.target_type }}
              </el-tag>
              <template v-if="!row.target"><span class="gone">deleted</span></template>
              <template v-else-if="row.target_type == 'project'">
                <!-- /p/<id> solo muestra el proyecto si es público y no está oculto -->
                <a class="target_link" :href="project_href(row.target_id)" target="_blank" rel="noopener"
                  :title="project_link_title(row.target)">{{ row.target.name }}</a>
              </template>
              <template v-else>
                <el-icon :size="16" class="icons" :class="{ is_loading: is_preview_loading(row) }"
                  :title="is_previewing(row) || is_preview_loading(row) ? 'Stop preview' : 'Preview'"
                  @click="toggle_preview(row)">
                  <Loading v-if="is_preview_loading(row)" />
                  <VideoPause v-else-if="is_previewing(row)" />
                  <VideoPlay v-else />
                </el-icon>
                <span class="target_name">{{ row.target.name }}</span>
              </template>
              <el-tag v-if="row.target?.hidden" size="small" type="warning" class="flag">hidden</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="Owner" width="120">
            <template #default="{ row }">
              <template v-if="row.target?.owner">
                {{ row.target.owner.name }}
                <el-tag v-if="row.target.owner.status != 'active'" size="small" type="danger" class="flag">
                  {{ row.target.owner.status }}
                </el-tag>
              </template>
            </template>
          </el-table-column>
          <el-table-column prop="reason" label="Reason" min-width="150" show-overflow-tooltip />
          <el-table-column label="Reporter" width="100">
            <template #default="{ row }">{{ row.reporter.name ?? "(deleted)" }}</template>
          </el-table-column>
          <el-table-column label="Status" width="88">
            <template #default="{ row }">
              <el-tag size="small" :type="REPORT_STATUS_TYPE[row.status]">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="" width="250" align="right">
            <template #default="{ row }">
              <template v-if="row.target">
                <el-button v-if="!row.target.hidden" size="small" type="warning"
                  @click="confirm_hidden(row, true)">Hide</el-button>
                <el-button v-else size="small" @click="set_hidden(row, false)">Unhide</el-button>
              </template>
              <template v-if="row.status == 'open'">
                <el-button size="small" type="success" @click="set_report_status(row, 'resolved')">Resolve</el-button>
                <el-button size="small" @click="set_report_status(row, 'dismissed')">Dismiss</el-button>
              </template>
              <el-button v-else size="small" @click="set_report_status(row, 'open')">Reopen</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="Stats" name="stats">
        <div v-loading="stats_busy" class="stats">
          <template v-if="stats">
            <el-descriptions :column="2" size="small" border>
              <el-descriptions-item :label="`Audio traffic (${stats.traffic.month}, UTC)`">
                {{ fmt_bytes(stats.traffic.bytes) }} · {{ stats.traffic.requests }} requests
              </el-descriptions-item>
              <el-descriptions-item label="Disk (storage)">
                {{ fmt_bytes(stats.disk.free_bytes) }} free of {{ fmt_bytes(stats.disk.total_bytes) }}
                <el-tag size="small" :type="stats.disk.uploads_allowed ? 'success' : 'danger'" class="flag">
                  {{ stats.disk.uploads_allowed ? "uploads on" : "uploads off" }}
                </el-tag>
                <span class="hint">(min {{ stats.disk.min_free_gb }} GB)</span>
              </el-descriptions-item>
              <el-descriptions-item label="Users">
                {{ stats.users.active }} active · {{ stats.users.pending }} pending · {{ stats.users.blocked }} blocked
              </el-descriptions-item>
              <el-descriptions-item label="Open reports">{{ stats.reports.open }}</el-descriptions-item>
              <el-descriptions-item label="Files">
                {{ stats.files.total }} · {{ stats.files.hidden }} hidden
              </el-descriptions-item>
              <el-descriptions-item label="Projects">
                {{ stats.projects.total }} · {{ stats.projects.public }} public · {{ stats.projects.hidden }} hidden
              </el-descriptions-item>
            </el-descriptions>
          </template>
        </div>
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
import { useRouter } from "vue-router"
import { ElMessageBox } from "element-plus"
import {
  admin_get_users, admin_update_user, admin_get_reports, admin_update_report, admin_set_file_hidden,
  admin_set_project_hidden, admin_get_stats, error_text, file_url
} from "../helpers/api"
import { store, files_by_id, audio_players } from "../helpers/composable"
import * as toneLib from "../helpers/toneLib"

const visible = defineModel({ type: Boolean, default: false })
const router = useRouter()

const tab = ref("pending")
const users = ref([])
const busy = ref(false)
const msg = reactive({ type: "success", text: "" })

const pending = computed(() => users.value.filter(u => u.status == "pending"))
const others = computed(() => users.value.filter(u => u.status != "pending"))

const ACTION_TEXT = { admit: "admitido", reject: "rechazado", block: "bloqueado", unblock: "desbloqueado" }

// denuncias: se piden filtradas por estado (el backend devuelve hasta 500, las más nuevas)
const REPORT_FILTERS = [
  { value: "open", label: "Open" }, { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" }, { value: "", label: "All" },
]
const REPORT_STATUS_TYPE = { open: "danger", resolved: "success", dismissed: "info" }
const REPORT_STATUS_TEXT = { open: "reabierta", resolved: "resuelta", dismissed: "descartada" }
const reports = ref([])
const reports_filter = ref("open")
const reports_busy = ref(false)

const stats = ref(null)
const stats_busy = ref(false)

const reports_label = computed(() => stats.value ? `Reports (${stats.value.reports.open})` : "Reports")

function set_msg(type, text) {
  Object.assign(msg, { type, text })
}

// trae usuarios, denuncias y estadísticas en paralelo
async function load() {
  msg.text = ""
  await Promise.all([load_users(), load_reports(), load_stats()])
}

// trae todos los usuarios (sin filtro) y los separa en pendientes y el resto
async function load_users() {
  if (busy.value) return
  busy.value = true
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

async function load_reports() {
  reports_busy.value = true
  let filter = reports_filter.value
  try {
    let res = await admin_get_reports(filter)
    if (filter != reports_filter.value) return // cambió el filtro mientras cargaba
    if (res.stat) reports.value = res.data
    else set_msg("error", res.text)
  } catch (e) {
    set_msg("error", error_text(e))
  } finally {
    reports_busy.value = false
  }
}

// silent: sin mensaje de error (se usa para refrescar los contadores después de una acción)
async function load_stats(silent = false) {
  if (!silent) stats_busy.value = true
  try {
    let res = await admin_get_stats()
    if (res.stat) stats.value = res.data
    else if (!silent) set_msg("error", res.text)
  } catch (e) {
    if (!silent) set_msg("error", error_text(e))
  } finally {
    stats_busy.value = false
  }
}

// cierra (resolved), descarta (dismissed) o reabre (open) una denuncia. Si con el estado nuevo ya
// no entra en el filtro activo, sale de la lista
async function set_report_status(row, status) {
  msg.text = ""
  try {
    let res = await admin_update_report(row.id, status)
    if (!res.stat) return set_msg("error", res.text)
    let i = reports.value.findIndex(r => r.id == row.id)
    if (i >= 0) {
      if (reports_filter.value && reports_filter.value != status) reports.value.splice(i, 1)
      else reports.value[i] = res.data
    }
    set_msg("success", `Denuncia ${REPORT_STATUS_TEXT[status]}`)
    load_stats(true)
  } catch (e) {
    set_msg("error", error_text(e))
  }
}

// ocultar pide confirmación (desocultar no: es volver al estado normal)
async function confirm_hidden(row, hidden) {
  let what = row.target_type == "file"
    ? `el archivo "${row.target.name}"? Sale del catálogo y del sorteo en todos los proyectos que lo usan`
    : `el proyecto "${row.target.name}"? Sale de la galería y su link público da 404`
  try {
    await ElMessageBox.confirm(`¿Ocultar ${what}. Es reversible.`, "Hide", {
      confirmButtonText: "OK", cancelButtonText: "Cancel", type: "warning"
    })
  } catch {
    return // cancelado
  }
  await set_hidden(row, hidden)
}

// oculta o desoculta el target de una denuncia y actualiza todas las denuncias sobre lo mismo
async function set_hidden(row, hidden) {
  msg.text = ""
  try {
    let res = row.target_type == "file"
      ? await admin_set_file_hidden(row.target_id, hidden)
      : await admin_set_project_hidden(row.target_id, hidden)
    if (!res.stat) return set_msg("error", res.text)
    for (let r of reports.value) {
      if (r.target && r.target_type == row.target_type && r.target_id == row.target_id) r.target.hidden = res.data.hidden
    }
    set_msg("success", `${res.data.name}: ${res.data.hidden ? "oculto" : "visible de nuevo"}`)
    load_stats(true)
  } catch (e) {
    set_msg("error", error_text(e))
  }
}

function project_href(id) {
  return router.resolve({ name: "public_project", params: { id } }).href
}

function project_link_title(target) {
  if (target.hidden) return "Open public link (404 while hidden)"
  return "Open public link"
}

// --- preview del archivo denunciado (toneLib.js, como en el catálogo): si está cargado en el
// proyecto activo se usa su buffer; si no, se descarga solo ese archivo (GET /file/:id sirve
// también los ocultos) ---
function is_previewing(row) {
  return store.curr_file.isPreviewing == true && store.curr_file.id == row.target_id
}
function is_preview_loading(row) {
  return store.curr_file.isPreviewLoading == true && store.curr_file.id == row.target_id
}
async function toggle_preview(row) {
  if (is_previewing(row) || is_preview_loading(row)) return toneLib.playerStop()
  let loaded = files_by_id[row.target_id]
  try {
    if (loaded?.isLoaded && audio_players[row.target_id]) await toneLib.playFile(loaded)
    else {
      let file = { id: row.target_id, original_name: row.target.name }
      await toneLib.playUrl(file, file_url(row.target_id))
    }
  } catch {
    set_msg("error", `No se pudo escuchar "${row.target.name}"`)
  }
}

// al cerrar se corta el preview si es de un archivo que no está cargado en el proyecto
function on_closed() {
  let cf = store.curr_file
  if (cf.isPreviewLoading || (cf.isPreviewing && !files_by_id[cf.id])) toneLib.playerStop()
}

// bytes → MB o GB (base 1024)
function fmt_bytes(n) {
  let mb = (n || 0) / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
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
    load_stats(true)
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

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.hint {
  margin-left: 6px;
  color: var(--muted);
  font-size: 12px;
}

.type {
  margin-right: 6px;
}

.flag {
  margin-left: 4px;
}

.gone {
  color: var(--muted);
  font-style: italic;
}

.target_link {
  color: var(--accent);
}

.target_name {
  margin-left: 4px;
}

.icons {
  cursor: pointer;
  vertical-align: middle;
}

.icons:hover {
  color: var(--accent);
}

.is_loading svg {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.stats {
  min-height: 120px;
}
</style>
