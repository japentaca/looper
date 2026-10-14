<template>
  <!-- proyectos del usuario: abrir, crear, renombrar, borrar y visibilidad (se abre desde la barra superior) -->
  <el-dialog v-model="visible" title="Projects" width="760px" align-center @open="on_open">
    <div class="create">
      <el-input v-model="new_name" maxlength="64" placeholder="New project name" :disabled="busy"
        @keyup.enter="do_create" />
      <el-button type="primary" :loading="busy" :disabled="!TrackCtrl.isReady" @click="do_create">CREATE</el-button>
    </div>

    <el-table :data="store.projects" size="small" max-height="420" v-loading="busy" empty-text="No projects"
      :row-class-name="row_class">
      <el-table-column label="" width="34">
        <template #default="{ row }">
          <Led color="green" :lit="is_active(row)" />
        </template>
      </el-table-column>
      <el-table-column label="Name" min-width="180">
        <template #default="{ row }">
          <span class="name">{{ row.name }}</span>
          <el-tag v-if="row.hidden" size="small" type="danger" class="hidden_tag"
            title="Oculto por el admin: no aparece en la galería pública">hidden</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="Memory" width="90" align="right">
        <template #default="{ row }">
          <span :class="{ mem_warn: memory(row) > memory_limit }" :title="memory_title(row)">
            {{ fmt_memory(memory(row)) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="Date" width="96">
        <template #default="{ row }">{{ fmt_date(row.ts) }}</template>
      </el-table-column>
      <el-table-column label="" width="210" align="right">
        <template #default="{ row }">
          <el-button size="small" type="success" :disabled="busy || is_active(row) || !TrackCtrl.isReady"
            @click="do_open(row)">Open</el-button>
          <el-button size="small" :disabled="busy" @click="do_rename(row)">Rename</el-button>
          <el-button size="small" type="danger" :disabled="busy || !TrackCtrl.isReady"
            @click="do_delete(row)">Delete</el-button>
        </template>
      </el-table-column>
    </el-table>

    <p class="hint">
      Public projects can be opened by anyone with the link (read only). Deleting a project removes its
      tracks, tags and file list; the audio files stay in the catalog.
    </p>
    <el-alert v-if="msg.text" :type="msg.type" :title="msg.text" :closable="false" show-icon class="msg" />

    <template #footer>
      <el-button type="primary" @click="visible = false">CLOSE</el-button>
    </template>
  </el-dialog>
</template>

<script setup>

import { reactive, ref } from "vue"
import { ElMessageBox } from "element-plus"
import Led from "./hw/Led.vue"
import {
  store, refresh_projects, switch_project, flush_pending_saves, store_get_user_info,
  estimate_seconds_memory, memory_warning_limit, fmt_memory
} from "../helpers/composable"
import { TrackCtrl, stop_transport } from "../helpers/TrackCtrl"
import { create_project, update_project, delete_project, error_text } from "../helpers/api"

const visible = defineModel({ type: Boolean, default: false })

const new_name = ref("")
const busy = ref(false)
const msg = reactive({ type: "success", text: "" })

function set_msg(type, text) {
  Object.assign(msg, { type, text })
}
function is_active(row) {
  return row.id === store.project?.id
}
function row_class({ row }) {
  return is_active(row) ? "active_row" : ""
}
function fmt_date(ts) {
  return ts ? String(ts).slice(0, 10) : ""
}

// memoria estimada al abrir el proyecto (audio decodificado de todos sus archivos); en amarillo si
// supera el límite del aviso "Large project"
const memory_limit = memory_warning_limit()
function memory(row) {
  return estimate_seconds_memory(row.audio_seconds)
}
function memory_title(row) {
  let n = row.files_count ?? 0
  return `Estimated memory to load ${n} ${n == 1 ? "file" : "files"}`
    + (memory(row) > memory_limit ? " (more than recommended for this device)" : "")
}

async function on_open() {
  set_msg("success", "")
  await refresh_projects()
}

// corre una acción con el diálogo bloqueado; los errores del backend van al aviso del diálogo
async function run(fn) {
  if (busy.value) return
  busy.value = true
  set_msg("success", "")
  try {
    await fn()
  } catch (e) {
    set_msg("error", error_text(e))
  } finally {
    busy.value = false
  }
}

// reemplaza la fila de la lista (y el proyecto activo, si es ese) con lo que devolvió el backend
function apply_summary(p) {
  let i = store.projects.findIndex(r => r.id === p.id)
  if (i >= 0) store.projects[i] = p
  if (store.project?.id === p.id) Object.assign(store.project, p)
}

// si suena algo, cambiar de proyecto corta la reproducción: se pregunta antes
async function confirm_stop(action) {
  if (!TrackCtrl.isPlaying) return true
  try {
    await ElMessageBox.confirm(`Playback will stop to ${action}.`, "Stop playback", {
      confirmButtonText: "Stop and continue", cancelButtonText: "Cancel", type: "warning"
    })
    return true
  } catch {
    return false
  }
}

// crea un proyecto vacío y lo abre
async function do_create() {
  let name = new_name.value.trim()
  if (!name) return set_msg("error", "Poné un nombre para el proyecto")
  if (!await confirm_stop("open the new project")) return
  await run(async () => {
    let res = await create_project({ name })
    if (!res.stat) return set_msg("error", res.text)
    new_name.value = ""
    await refresh_projects()
    if (await switch_project(res.data.id)) set_msg("success", `Proyecto "${res.data.name}" creado`)
  })
}

async function do_open(row) {
  if (!await confirm_stop("open another project")) return
  await run(async () => {
    if (await switch_project(row.id)) visible.value = false
  })
}

async function do_rename(row) {
  let name
  try {
    ({ value: name } = await ElMessageBox.prompt("New name", "Rename project", {
      inputValue: row.name, confirmButtonText: "Rename", cancelButtonText: "Cancel",
      inputValidator: v => (v ?? "").trim().length > 0 || "Poné un nombre"
    }))
  } catch {
    return // cancelado
  }
  name = name.trim()
  if (name === row.name) return
  await run(async () => {
    let res = await update_project(row.id, { name })
    if (!res.stat) return set_msg("error", res.text)
    apply_summary(res.data)
  })
}

// borrar el proyecto activo detiene el transporte y abre otro (store_get_user_info elige uno, o crea
// "My project" si no queda ninguno)
async function do_delete(row) {
  let active = is_active(row)
  try {
    await ElMessageBox.confirm(
      `Delete project "${row.name}"? Its tracks, tags and file list are removed; the audio files stay in the catalog.`
      + (active ? " Playback will stop." : ""),
      "Delete project", { confirmButtonText: "Delete", cancelButtonText: "Cancel", type: "warning" })
  } catch {
    return
  }
  await run(async () => {
    if (active) {
      stop_transport()
      // los guardados diferidos pendientes son de este proyecto: se mandan antes de borrarlo
      await flush_pending_saves()
    }
    let res = await delete_project(row.id)
    if (!res.stat) return set_msg("error", res.text)
    if (active) {
      TrackCtrl.current_TAG.tag = null
      await store_get_user_info()
    } else {
      await refresh_projects()
    }
    set_msg("success", `Proyecto "${row.name}" borrado`)
  })
}

</script>

<style scoped>
.create {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}

.name {
  font-weight: 600;
}

.mem_warn {
  color: var(--hw_yellow);
}

.hidden_tag {
  margin-left: 8px;
}

:deep(.active_row) {
  --el-table-tr-bg-color: var(--panel_2);
}

.hint {
  margin: 12px 0 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.5;
}

.msg {
  margin-top: 10px;
}
</style>
