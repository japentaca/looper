<template>
  <!-- proyectos del usuario: abrir, crear, renombrar y borrar (se abre desde la barra superior). Chasis del
    aparato (hw_dialog) con una bahía hundida donde cada proyecto es un cartucho con etiqueta de papel -->
  <el-dialog v-model="visible" title="Projects" width="min(760px, 96vw)" class="hw_dialog" align-center
    @open="on_open">
    <div class="create">
      <span class="silk">New</span>
      <el-input v-model="new_name" maxlength="64" placeholder="New project name" :disabled="busy"
        @keyup.enter="do_create" />
      <LedButton size="small" text="CREATE" :disabled="busy || !TrackCtrl.isReady" @click="do_create" />
    </div>

    <div class="bay" v-loading="busy" element-loading-background="rgba(0, 0, 0, 0.35)">
      <p v-if="!store.projects.length" class="empty silk">No projects</p>
      <div v-for="row in store.projects" :key="row.id" class="cart" :class="{ active: is_active(row) }">
        <div class="grip">
          <Led color="green" :lit="is_active(row)" />
        </div>
        <div class="label">
          <p class="name">
            {{ row.name }}
            <el-tag v-if="row.hidden" size="small" type="danger" class="hidden_tag"
              title="Oculto por el admin: no aparece en la galería pública">hidden</el-tag>
          </p>
          <p class="specs">
            <span :class="{ mem_warn: project_memory_warn(row) }" :title="memory_title(row)">
              {{ fmt_memory(project_memory(row)) }}</span>
            · {{ row.files_count ?? 0 }} {{ row.files_count == 1 ? "file" : "files" }}
            <template v-if="row.ts"> · {{ fmt_date(row.ts) }}</template>
          </p>
        </div>
        <div class="actions">
          <LedButton size="small" :text="is_active(row) ? 'LOADED' : 'OPEN'"
            :disabled="busy || is_active(row) || !TrackCtrl.isReady" @click="do_open(row)" />
          <LedButton size="small" text="RENAME" :disabled="busy" @click="do_rename(row)" />
          <LedButton size="small" text="DELETE" class="danger" :disabled="busy || !TrackCtrl.isReady"
            @click="do_delete(row)" />
        </div>
      </div>
    </div>

    <p class="hint">
      Public projects can be opened by anyone with the link (read only). Deleting a project removes its
      tracks, tags and file list, and also your audio files that no other project uses.
    </p>
    <el-alert v-if="msg.text" :type="msg.type" :title="msg.text" :closable="false" show-icon class="msg" />

    <template #footer>
      <LedButton size="small" text="CLOSE" @click="visible = false" />
    </template>
  </el-dialog>
</template>

<script setup>

import { ref } from "vue"
import { ElMessageBox } from "element-plus"
import Led from "./hw/Led.vue"
import LedButton from "./hw/LedButton.vue"
import {
  store, refresh_projects, switch_project, flush_pending_saves, store_get_user_info,
  project_memory, project_memory_warn, project_memory_title, fmt_memory
} from "../helpers/composable"
import { fmt_date, use_msg } from "../helpers/utils"
import { TrackCtrl, stop_transport } from "../helpers/TrackCtrl"
import { create_project, update_project, delete_project, error_text } from "../helpers/api"

const visible = defineModel({ type: Boolean, default: false })

const new_name = ref("")
const busy = ref(false)
const { msg, set_msg } = use_msg()

function is_active(row) {
  return row.id === store.project?.id
}

// memoria estimada al abrir el proyecto (audio decodificado de todos sus archivos)
function memory_title(row) {
  let n = row.files_count ?? 0
  return project_memory_title(row, `${n} ${n == 1 ? "file" : "files"}`)
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
      `Delete project "${row.name}"? Its tracks, tags and file list are removed, and so are your audio files that no other project uses.`
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
    let n = res.data?.deleted_files || 0
    set_msg("success", `Proyecto "${row.name}" borrado` + (n ? ` (y ${n} archivo${n == 1 ? "" : "s"} sin uso)` : ""))
  })
}

</script>

<style scoped>
.create {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

/* bahía hundida en el chasis donde van los cartuchos */
.bay {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow-y: auto;
  padding: 10px;
  border-radius: 4px;
  border: 1px solid #0a0a0b;
  background: rgba(0, 0, 0, 0.38);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.7), 0 1px 0 rgba(255, 255, 255, 0.06);
}

.empty {
  margin: 16px;
  text-align: center;
  opacity: 0.6;
}

/* cartucho de plástico negro, acostado: estrías con el LED a la izquierda, etiqueta y botones */
.cart {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px 6px 0;
  border-radius: 4px 6px 6px 4px;
  border: 1px solid #0a0a0b;
  background: var(--hw_tex_plastic) center / cover, #18181a;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.cart.active {
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.55), 0 0 0 1px var(--hw_green), 0 0 12px rgba(60, 230, 120, 0.25);
}

.grip {
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  margin: -6px 0;
  flex: none;
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.07) 0 2px, transparent 2px 6px);
  border-right: 1px solid #000;
}

/* etiqueta de papel pegada en el cartucho */
.label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 10px;
  border-radius: 2px;
  background: linear-gradient(180deg, #ece7d8, #dcd6c4);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  color: #1e1f22;
}

.name {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
  font-size: 13px;
}

.specs {
  margin: 0;
  font-size: 11px;
  opacity: 0.7;
}

/* sobre el papel el amarillo no se lee: aviso de memoria en rojo */
.mem_warn {
  color: #b3261e;
  font-weight: 700;
}

.hidden_tag {
  margin-left: 8px;
}

.actions {
  display: flex;
  gap: 8px;
  flex: none;
}

/* mismo ancho para OPEN y LOADED, así las etiquetas quedan alineadas */
.actions :deep(.cap) {
  min-width: 72px;
}

/* campo del nombre hundido en el chasis, como la bahía */
.create :deep(.el-input__wrapper) {
  background: rgba(0, 0, 0, 0.38);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.7), 0 1px 0 rgba(255, 255, 255, 0.06);
}

/* DELETE con la tinta de la tecla en rojo */
.danger :deep(.cap) {
  color: #8f1d12;
}

.hint {
  margin: 12px 0 0;
  color: var(--hw_silk);
  opacity: 0.6;
  font-size: 11px;
  line-height: 1.5;
}

.msg {
  margin-top: 10px;
}

@media (max-width: 560px) {
  .cart {
    flex-wrap: wrap;
  }

  .actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
