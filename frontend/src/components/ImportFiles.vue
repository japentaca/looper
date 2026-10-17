<template>
  <!-- importar archivos del catálogo al proyecto activo (se abre desde la barra superior). Chasis del aparato
    (hw_dialog); el catálogo no trae los archivos que ya están en el proyecto (exclude_project) -->
  <el-dialog v-model="visible" title="Import from catalog" width="min(960px, 96vw)" class="hw_dialog" align-center
    @open="on_open" @closed="on_closed">
    <div class="filters">
      <el-input v-model="filters.q" class="f_text" maxlength="64" clearable placeholder="Name contains…"
        @keyup.enter="search(1)" @clear="search(1)" />
      <el-input v-model="filters.creator" class="f_text" maxlength="64" clearable placeholder="Creator (exact)"
        @keyup.enter="search(1)" @clear="search(1)" />
      <span class="silk">Type</span>
      <el-select v-model="filters.kind" class="f_kind" placeholder="any" clearable @change="search(1)">
        <el-option label="loop" value="loop" />
        <el-option label="shot" value="shot" />
      </el-select>
      <span class="silk">BPM</span>
      <el-input-number v-model="filters.bpm" class="f_num" :min="20" :max="400" :step="1" :precision="2"
        controls-position="right" placeholder="any" :disabled="is_shot" />
      <span class="silk">±</span>
      <el-input-number v-model="filters.bpm_tol" class="f_tol" :min="0" :max="50" :step="1" :precision="2"
        controls-position="right" :disabled="is_shot || filters.bpm == null" />
      <LedButton size="small" text="= TEMPO" title="Usar el tempo del proyecto" :disabled="is_shot" @click="use_tempo" />
      <span class="silk">Beats</span>
      <el-input-number v-model="filters.beats" class="f_num" :min="1" :max="1024" :step="1" step-strictly
        controls-position="right" placeholder="any" :disabled="is_shot" />
      <span class="silk">Key</span>
      <el-select v-model="filters.key" class="f_key" placeholder="any" clearable filterable @change="search(1)">
        <el-option v-for="t in KEY_TONICS" :key="t" :label="t" :value="t" />
      </el-select>
      <el-checkbox v-model="filters.atonal" title="Incluir los archivos atonales (percusión, ruidos)"
        @change="search(1)">+ atonal</el-checkbox>
      <LedButton size="small" text="SEARCH" :disabled="loading" @click="search(1)" />
      <LedButton size="small" text="CLEAR" :disabled="loading" @click="clear_filters" />
    </div>

    <div class="bay">
    <el-table :data="items" size="small" height="380" v-loading="loading" empty-text="No files"
      :row-class-name="row_class">
      <el-table-column label="" width="40">
        <template #default="{ row }">
          <el-checkbox :model-value="selected.has(row.id) || in_project(row)" :disabled="in_project(row) || busy"
            @change="v => toggle_select(row, v)" />
        </template>
      </el-table-column>
      <el-table-column label="" width="40">
        <template #default="{ row }">
          <el-icon :size="18" class="icons" :class="{ is_loading: is_preview_loading(row) }"
            :title="is_previewing(row) || is_preview_loading(row) ? 'Stop preview' : 'Preview'"
            @click="toggle_preview(row)">
            <Loading v-if="is_preview_loading(row)" />
            <VideoPause v-else-if="is_previewing(row)" />
            <VideoPlay v-else />
          </el-icon>
        </template>
      </el-table-column>
      <el-table-column label="Name" min-width="220">
        <template #default="{ row }">
          <span class="name" :title="row.original_name">{{ row.original_name }}</span>
          <el-tag v-if="in_project(row)" size="small" type="success" class="mark">in project</el-tag>
          <el-tag v-else-if="row.own" size="small" type="info" class="mark">mine</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="BPM" width="70" align="right">
        <template #default="{ row }">{{ row.kind == "shot" ? "shot" : row.bpm ?? "–" }}<span v-if="row.anchor == 'end'"
            class="anchor_mark" title="Anchor END: in one-shot tracks the file ends at the trigger point"> ⇥</span></template>
      </el-table-column>
      <el-table-column label="Beats" width="64" align="right">
        <template #default="{ row }">{{ row.beats ?? "–" }}</template>
      </el-table-column>
      <el-table-column label="Key" width="64">
        <template #default="{ row }">{{ key_label(row.music_key) }}</template>
      </el-table-column>
      <el-table-column label="Dur." width="70" align="right">
        <template #default="{ row }">{{ fmt_seconds(row.duration) }}</template>
      </el-table-column>
      <el-table-column label="Creator" width="130">
        <template #default="{ row }">
          <el-tooltip :disabled="!row.creator?.bio" :content="row.creator?.bio ?? ''" placement="top">
            <span class="creator" @click="filter_creator(row)">{{ row.creator?.name }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="Uses" width="56" align="right" prop="uses" />
      <el-table-column label="Date" width="92">
        <template #default="{ row }">{{ fmt_date(row.ts) }}</template>
      </el-table-column>
      <el-table-column label="" width="40">
        <template #default="{ row }">
          <el-icon v-if="!row.own" :size="16" class="icons report" title="Report this file"
            @click="open_report(row)">
            <Warning />
          </el-icon>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <div class="pager">
      <span class="silk">{{ total }} not in project</span>
      <el-pagination small layout="prev, pager, next" :total="total" :page-size="PER_PAGE"
        :current-page="page" :disabled="loading" @current-change="search" />
    </div>

    <!-- memoria estimada del proyecto activo más lo seleccionado (misma cuenta que el aviso al abrir),
      como un medidor de LEDs: amarillo pasado el 75 % y rojo al llegar al límite recomendado -->
    <div class="memory" :class="{ over: over_limit }">
      <span class="silk">Memory</span>
      <LedMeter horizontal :segments="40" :value="memory.total / memory.limit" />
      <span class="memory_text">
        {{ mb(memory.current) }} MB<template v-if="selected.size"> + {{ mb(memory.selected) }} MB
          ({{ selected.size }} selected)</template>
        = <b>{{ mb(memory.total) }} MB</b> of ~{{ mb(memory.limit) }} MB
      </span>
    </div>

    <el-alert v-if="msg.text" :type="msg.type" :title="msg.text" :closable="false" show-icon class="msg" />

    <template #footer>
      <div class="footer">
        <LedButton size="small" text="CLEAR SELECTION" :disabled="busy || selected.size == 0" @click="selected.clear()" />
        <span class="footer_right">
          <LedButton size="small" text="CLOSE" @click="visible = false" />
          <LedButton size="small" led="green" :lit="busy" :disabled="!can_import" @click="do_import"
            :text="'IMPORT' + (selected.size ? ` (${selected.size})` : '')" />
        </span>
      </div>
    </template>
    <ReportDialog v-model="report_visible" :target="report_target" />
  </el-dialog>
</template>

<script setup>

import { reactive, ref, computed, watch } from "vue"
import { ElMessageBox } from "element-plus"
import {
  store, files_by_id, audio_players, load_project, estimate_files_memory, memory_warning_limit
} from "../helpers/composable"
import { TrackCtrl } from "../helpers/TrackCtrl"
import { get_catalog, save_project_files, error_text, file_url } from "../helpers/api"
import * as toneLib from "../helpers/toneLib"
import ReportDialog from "./ReportDialog.vue"
import LedButton from "./hw/LedButton.vue"
import LedMeter from "./hw/LedMeter.vue"
import { KEY_TONICS, key_label } from "../helpers/music_key"

const visible = defineModel({ type: Boolean, default: false })

const PER_PAGE = 25
const BPM_TOL_DEFAULT = 2

// kind = loop | shot ("" = cualquiera); key = tónica (trae mayor y menor); atonal = incluir los atonales
// (con key se suman a ese filtro; sin key, desmarcado los saca)
const FILTERS_DEFAULT = { q: "", creator: "", kind: "", bpm: null, bpm_tol: BPM_TOL_DEFAULT, beats: null, key: "", atonal: true }
const filters = reactive({ ...FILTERS_DEFAULT })
// un shot no tiene BPM ni beats: esos filtros no aplican
const is_shot = computed(() => filters.kind == "shot")
const items = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const busy = ref(false)
const msg = reactive({ type: "success", text: "" })
// archivos elegidos para importar (id → item del catálogo); se mantienen al cambiar de página o de filtro
const selected = reactive(new Map())

function set_msg(type, text) {
  Object.assign(msg, { type, text })
}

// ya está en el proyecto activo (no se puede volver a importar: va una sola vez por proyecto)
const project_ids = computed(() => new Set(store.files.map(f => f.id)))
function in_project(row) {
  return project_ids.value.has(row.id)
}
function row_class({ row }) {
  return in_project(row) ? "in_project_row" : ""
}

// al cambiar de proyecto la selección deja de tener sentido
watch(() => store.project?.id, () => selected.clear())

function toggle_select(row, on) {
  if (on && !in_project(row)) selected.set(row.id, row)
  else selected.delete(row.id)
}

// solo se mandan los filtros con valor (el backend ignora los vacíos, pero así la URL queda limpia)
function catalog_params(p) {
  let params = { page: p, per_page: PER_PAGE }
  // lo que ya está en el proyecto activo no se lista (solo mete ruido: no se puede volver a importar)
  if (store.project?.id) params.exclude_project = store.project.id
  let q = filters.q.trim()
  let creator = filters.creator.trim()
  if (q) params.q = q
  if (creator) params.creator = creator
  if (filters.kind) params.kind = filters.kind
  if (filters.bpm != null && !is_shot.value) {
    params.bpm = filters.bpm
    if (filters.bpm_tol != null) params.bpm_tol = filters.bpm_tol
  }
  if (filters.beats != null && !is_shot.value) params.beats = filters.beats
  if (filters.key) {
    params.key = filters.key
    params.atonal = filters.atonal ? 1 : 0
  } else if (!filters.atonal) params.atonal = 0
  return params
}

async function search(p = 1) {
  loading.value = true
  set_msg("success", "")
  try {
    let res = await get_catalog(catalog_params(p))
    if (!res.stat) return set_msg("error", res.text)
    items.value = res.data.items
    total.value = res.data.total
    page.value = res.data.page
  } catch (e) {
    set_msg("error", error_text(e))
  } finally {
    loading.value = false
  }
}

function clear_filters() {
  Object.assign(filters, FILTERS_DEFAULT)
  search(1)
}
function use_tempo() {
  filters.bpm = TrackCtrl.tempo
  search(1)
}
function filter_creator(row) {
  if (!row.creator?.name) return
  filters.creator = row.creator.name
  search(1)
}

// al abrir se vuelve a pedir la página actual (los usos y lo que ya está en el proyecto pueden haber cambiado)
async function on_open() {
  await search(page.value)
}
// al cerrar se corta el preview si es de un archivo del catálogo que no está cargado en el proyecto
function on_closed() {
  let cf = store.curr_file
  if (cf.isPreviewLoading || (cf.isPreviewing && !files_by_id[cf.id])) toneLib.playerStop()
}

// --- preview (toneLib.js): si el archivo ya está cargado en el proyecto se usa su buffer; si no,
// se descarga solo ese archivo ---
function is_previewing(row) {
  return store.curr_file.isPreviewing == true && store.curr_file.id == row.id
}
function is_preview_loading(row) {
  return store.curr_file.isPreviewLoading == true && store.curr_file.id == row.id
}
async function toggle_preview(row) {
  if (is_previewing(row) || is_preview_loading(row)) return toneLib.playerStop()
  let loaded = files_by_id[row.id]
  try {
    if (loaded?.isLoaded && audio_players[row.id]) await toneLib.playFile(loaded)
    else await toneLib.playUrl(row, file_url(row.id))
  } catch {
    set_msg("error", `No se pudo escuchar "${row.original_name}"`)
  }
}

// --- memoria: proyecto activo + lo seleccionado, con la misma estimación que el aviso al abrir ---
const memory = computed(() => {
  let current = estimate_files_memory(store.files)
  let sel = estimate_files_memory([...selected.values()])
  return { current, selected: sel, total: current + sel, limit: memory_warning_limit() }
})
const over_limit = computed(() => memory.value.total > memory.value.limit)
function mb(bytes) {
  return Math.round(bytes / 1024 ** 2)
}

const can_import = computed(() => !busy.value && selected.size > 0 && !!store.project && TrackCtrl.isReady)

// importa lo seleccionado al proyecto activo y lo recarga (como después de una subida) para crear
// los players de los archivos nuevos
async function do_import() {
  if (!can_import.value) return
  let pid = store.project.id
  let ids = [...selected.keys()].filter(id => !project_ids.value.has(id))
  if (ids.length == 0) return selected.clear()
  if (over_limit.value) {
    try {
      await ElMessageBox.confirm(
        `The project would need about ${mb(memory.value.total)} MB of memory (this device: ~${mb(memory.value.limit)} MB `
        + "recommended). The browser may slow down or reload the page. Import anyway?",
        "Large project", { confirmButtonText: "Import anyway", cancelButtonText: "Cancel", type: "warning" })
    } catch {
      return
    }
  }
  busy.value = true
  set_msg("success", "")
  try {
    let res = await save_project_files(pid, { add: ids })
    if (!res.stat) return set_msg("error", res.text)
    selected.clear()
    // si mientras tanto se cambió de proyecto, no se recarga (los archivos quedaron en el otro)
    if (store.project?.id === pid) await load_project(pid)
    set_msg("success", `${ids.length} file(s) imported into "${store.project?.name ?? ""}"`)
    await search(page.value)
  } catch (e) {
    set_msg("error", error_text(e))
  } finally {
    busy.value = false
  }
}

// denuncia de un archivo ajeno del catálogo (el diálogo de importar solo se abre con sesión)
const report_visible = ref(false)
const report_target = ref(null)
function open_report(row) {
  report_target.value = { type: "file", id: row.id, name: row.original_name }
  report_visible.value = true
}

function fmt_seconds(s) {
  let n = Number(s)
  return Number.isFinite(n) && n > 0 ? n.toFixed(1) + " s" : "–"
}
function fmt_date(ts) {
  return ts ? String(ts).slice(0, 10) : ""
}

</script>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.f_text {
  width: 170px;
}

.f_num {
  width: 110px;
}

.f_key {
  width: 84px;
}

.f_kind {
  width: 90px;
}

.f_tol {
  width: 90px;
}

.icons {
  cursor: pointer;
  vertical-align: middle;
}

.icons:hover {
  color: var(--accent);
}

.icons.report:hover {
  color: var(--danger);
}

.is_loading svg {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.name {
  font-weight: 600;
}

.mark {
  margin-left: 6px;
}

/* anclaje "end" (ver file_anchor en composable.js) */
.anchor_mark {
  font-weight: 700;
  cursor: help;
}

.creator {
  cursor: pointer;
  text-decoration: underline dotted;
}

:deep(.in_project_row) {
  opacity: 0.6;
}

/* campos de los filtros hundidos en el chasis, como la bahía */
.filters :deep(.el-input__wrapper),
.filters :deep(.el-select__wrapper) {
  background: rgba(0, 0, 0, 0.38);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.7), 0 1px 0 rgba(255, 255, 255, 0.06);
}

/* tabla en una bahía hundida en el chasis: fondo transparente y encabezados serigrafiados */
.bay {
  border-radius: 4px;
  border: 1px solid #0a0a0b;
  background: rgba(0, 0, 0, 0.38);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.7), 0 1px 0 rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.bay :deep(.el-table) {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: rgba(0, 0, 0, 0.25);
  --el-table-row-hover-bg-color: rgba(255, 255, 255, 0.05);
  --el-table-border-color: rgba(0, 0, 0, 0.5);
  --el-table-text-color: var(--hw_silk);
  --el-table-header-text-color: var(--hw_silk);
  background: transparent;
}

.bay :deep(.el-table th.el-table__cell) {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.6px;
  text-transform: uppercase;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.memory {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}

.memory_text {
  font-size: 11px;
  color: var(--hw_silk);
}

.memory.over .memory_text {
  color: var(--hw_red);
}

.footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}

.footer_right {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.msg {
  margin-top: 10px;
}
</style>
