<template>
  <div>
    <div class="view_switch">
      <el-radio-group v-model="fileListViewMode" size="small">
        <el-radio-button label="Box" />
        <el-radio-button label="Table" />

      </el-radio-group>
      <!-- switch SYNC del preview: global, el mismo del editor (toneLib.preview_opts, recordado en este navegador) -->
      <LedButton size="small" text="SYNC" led="yellow" :lit="toneLib.preview_opts.sync"
        :title="sync_title() + ' (Q in the editor)'" @click="toneLib.toggle_preview_sync()" />
      <!-- filtro por tonalidad (solo lo que se muestra; el motor sortea todos) -->
      <span class="key_filter">
        <span class="silk">Key</span>
        <el-select v-model="key_filter.tonic" size="small" class="key_select" placeholder="any" clearable filterable>
          <el-option v-for="t in KEY_TONICS" :key="t" :label="t" :value="t" />
        </el-select>
        <el-checkbox v-model="key_filter.atonal" size="small" :disabled="!key_filter.tonic">+ atonal</el-checkbox>
        <span v-if="key_filter.tonic" class="muted">{{ shown_files.length }} / {{ store.files.length }}</span>
      </span>
    </div>
    <div v-show="(fileListViewMode == 'Box')" class="box">
      <!-- cada archivo es un cartucho: etiqueta de papel con bandas de color del Track Group y de sus Tags.
        FileCart calcula si suena (clase playing y el LED vía slot): Files.vue no lee el estado del motor -->
      <FileCart v-for="file in shown_files" :key="file.id" v-slot="{ sounding, armed }" :file="file"
        :class="{ drag_over: drag_id === file.id, unavailable: !drawable(file) }"
        :title="not_drawable_title(file)" @dragover="ondragover($event, file)"
        @dragleave="ondragleave($event, file)" @drop="ondrop($event, file)">
        <div class="grip">
          <Led color="green" :lit="sounding && !armed" :blink="armed" />
        </div>
        <div class="label">
          <div class="bands">
            <span :style="{ background: trg_of(file)?.color ?? 'transparent' }"></span>
            <span class="tag_bands">
              <span v-for="tag in file.tag_objs" :key="tag.id" :style="{ background: tag.color }"></span>
            </span>
          </div>
          <el-tooltip effect="dark" :content="file.original_name" placement="top-start">
            <p class="name">{{ file.original_name }}</p>
          </el-tooltip>
          <p class="specs">
            <template v-if="file.isLoaded">{{ file.duration_fixed }} s · {{ timing_text(file) }}<template
                v-if="file.music_key"> · {{ file.music_key }}</template></template>
            <template v-else>loading…</template>
            <span v-if="list_anchor(file)" class="anchor_mark" :title="list_anchor(file).title"> · ⇥{{ list_anchor(file).text }}</span>
            <span v-if="file.available === false" class="unavailable_mark"> · unavailable</span>
            <span v-else-if="out_of_tempo(file)" class="unavailable_mark"> · out of tempo</span>
          </p>
          <p class="tags">
            <span class="chip" :class="{ empty: !trg_of(file) }"
              :style="{ background: trg_of(file)?.color }">{{ trg_of(file)?.name ?? "no group" }}</span>
            <span v-for="tag in file.tag_objs" :key="tag.id" class="chip" :style="{ background: tag.color }">{{
              tag.name }}</span>
            <span v-if="file.tag_objs.length == 0" class="chip empty">no tag</span>
          </p>
        </div>
        <div class="cart_foot">
          <span class="actions">
            <el-icon v-if="file.isLoaded" :size="iconSize" class="icons" :class="{ armed: is_armed(file) }"
              :title="preview_title(file)" @click="togglePreview(file)">
              <VideoPause v-if="is_previewing(file)" />
              <VideoPlay v-else />
            </el-icon>
            <el-icon :size="iconSize" class="icons" title="Edit" @click="editFile(file)">
              <EditPen />
            </el-icon>
            <el-icon :size="iconSize" class="icons" title="Delete" @click="deleteFile(file)">
              <Delete />
            </el-icon>
          </span>
        </div>
      </FileCart>
    </div>
    <!-- el-table no tiene eventos de drag por fila: se delegan desde el contenedor (ver row_file) -->
    <div v-show="(fileListViewMode == 'Table')" @dragover="ondragover_table" @dragleave="ondragleave_table"
      @drop="ondrop_table">
      <el-table :data="shown_files" style="width: 100%" :row-class-name="row_class">
        <el-table-column sortable prop="original_name" label="Name" min-width="260" show-overflow-tooltip />
        <el-table-column sortable prop="duration_fixed" label="Duration" width="100" />
        <el-table-column sortable prop="beats" label="Beats" width="80">
          <template #default="scope">{{ scope.row.kind == 'shot' ? 'shot' : scope.row.beats }}</template>
        </el-table-column>
        <el-table-column sortable prop="bpm" label="BPM" width="90">
          <template #default="scope">
            <span :class="{ out_tempo: out_of_tempo(scope.row) }" :title="not_drawable_title(scope.row)">{{
              scope.row.kind == 'shot' ? '' : fmt_bpm(scope.row.bpm) }}</span>
          </template>
        </el-table-column>
        <el-table-column sortable prop="music_key" label="Key" width="80">
          <template #default="scope">{{ key_label(scope.row.music_key) }}</template>
        </el-table-column>
        <el-table-column sortable label="Track Group" prop="track_group" width="130">
          <template #default="scope">
            <span v-if="trg_of(scope.row)" class="chip" :style="{ background: trg_of(scope.row).color }">{{
                trg_of(scope.row).name
              }}</span>
          </template>
        </el-table-column>
        <!-- se ordena por el nombre del primer tag -->
        <el-table-column sortable label="Tags" :sort-by="(row) => row.tag_objs[0]?.name ?? ''" width="170">
          <template #default="scope">
            <span class="chip_list">
              <span v-for="tag in scope.row.tag_objs" :key="tag.id" class="chip" :style="{ background: tag.color }">{{
                tag.name }}</span>
            </span>
          </template>
        </el-table-column>
        <!-- anclaje efectivo de los disparos one-shot (el del proyecto o el del catálogo, list_anchor): start es lo
          normal y no se marca; "end" o el pre-roll de un punto intermedio -->
        <el-table-column label="Anchor" sortable :sort-by="(row) => list_anchor(row)?.key ?? ''" width="90">
          <template #default="scope">
            <span v-if="list_anchor(scope.row)" class="anchor_mark" :title="list_anchor(scope.row).title">⇥{{
              list_anchor(scope.row).text.toUpperCase() }}</span>
          </template>
        </el-table-column>
        <!-- sin v-if en la columna: el-table mezcla las celdas si una columna aparece después -->
        <el-table-column label="State" sortable width="90">
          <template #default="scope">
            <span class="chip playing_chip" v-if="store.loading == false"
              v-show="audio_players[scope.row.id]?.state == 'started'">PLAYING</span>
          </template>

        </el-table-column>
        <el-table-column label="Actions" width="120" align="right">
          <template #default="scope">
            <span class="row_actions">
              <el-icon v-if="scope.row.isLoaded" :size="iconSize" class="icons" :class="{ armed: is_armed(scope.row) }"
                :title="preview_title(scope.row)" @click="togglePreview(scope.row)">
                <VideoPause v-if="is_previewing(scope.row)" />
                <VideoPlay v-else />
              </el-icon>
              <el-icon :size="iconSize" class="icons" title="Edit" @click="editFile(scope.row)">
                <EditPen />
              </el-icon>
              <el-icon :size="iconSize" class="icons" title="Delete" @click="deleteFile(scope.row)">
                <Delete />
              </el-icon>
            </span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>


  <!-- editor del archivo (diálogo de edición): lápiz del cartucho o de la fila, o store.edit_file_id -->
  <FileEditor v-model="dialogVisible" :file="curr_edit_file" @delete="deleteFile" />
</template>
<script setup>

import { ref, watch, computed } from "vue"
import { store, audio_players, files_by_id, trg_of, save_file, delete_project_file } from "../helpers/composable"
import LedButton from "./hw/LedButton.vue"
import Led from "./hw/Led.vue"
import FileCart from "./FileCart.vue"
import FileEditor from "./FileEditor.vue"
import { ElMessageBox, ElMessage } from 'element-plus'
import { KEY_TONICS, key_label, key_matches } from "../helpers/music_key"
import {
  out_of_tempo, not_drawable_title, fmt_bpm, toggleTag, list_anchor, is_previewing, is_armed, togglePreview,
  preview_title, sync_title
} from "../helpers/file_ui"

import * as toneLib from "../helpers/toneLib"

const fileListViewMode = ref("Table")

// filtro por tonalidad: tónica elegida (trae mayor y menor) y si se suman los atonales
const key_filter = ref({ tonic: "", atonal: true })
const shown_files = computed(() => store.files.filter(f => key_matches(f.music_key, key_filter.value.tonic, key_filter.value.atonal)))

// la clase fid_<id> identifica el archivo de cada fila para el drag&drop (la tabla se puede ordenar)
function row_class({ row }) {
  let cls = [`fid_${row.id}`]
  if (!drawable(row)) cls.push("unavailable_row")
  if (drag_id.value === row.id) cls.push("drag_over_row")
  if (is_previewing(row)) cls.push("previewing_row")
  return cls.join(" ")
}

// --- tempo (ver file_timing en TrackCtrl.js) ---
// fuera del sorteo (no disponible o fuera de tempo, ver file_ui.js): se muestra atenuado (cartucho y fila de la tabla)
function drawable(file) {
  return file.available !== false && !out_of_tempo(file)
}
function timing_text(file) {
  if (file.kind == "shot") return "shot"
  return `${file.beats ?? "?"} beats · ${fmt_bpm(file.bpm)} BPM`
}

const dialogVisible = ref(false)
const curr_edit_file = ref(null)

async function editFile(file) {
  curr_edit_file.value = file
  dialogVisible.value = true
}

// pedido de edición desde otro componente (store.edit_file_id, ver composable.js)
watch(() => store.edit_file_id, (id) => {
  if (id == null) return
  if (files_by_id[id]) editFile(files_by_id[id])
  store.edit_file_id = null
})

async function ondrop(e, file) {
  drag_id.value = null
  e.preventDefault()
  let msg_type = e.dataTransfer.getData("msg_type")
  if (msg_type == "track_group") {
    let id = e.dataTransfer.getData("id")
    file.track_group = id
    await save_file(file)
  } else if (msg_type == "tag") {
    // un archivo puede tener varios tags: soltar un tag que ya tiene lo quita
    await toggleTag(file, e.dataTransfer.getData("id"))
  }
}
// cartucho o fila resaltados mientras se les arrastra encima un pad de Track Group o Tag
const drag_id = ref(null)

function ondragover(e, file) {
  // un pad de FX (looper/fx, FxPad.vue) solo se suelta en las tiras: acá no se resalta ni se acepta
  if (e.dataTransfer.types.includes("looper/fx")) return
  drag_id.value = file.id
  e.preventDefault()
}
function ondragleave(e, file) {
  // dragleave también salta al pasar sobre un hijo del cartucho: solo se limpia si se sale del todo
  if (!e.currentTarget.contains(e.relatedTarget) && drag_id.value === file.id) drag_id.value = null
  e.preventDefault()
}

// vista Table: archivo de la fila bajo el puntero, según su clase fid_<id> (ver row_class)
function row_file(e) {
  let tr = e.target.closest?.("tr.el-table__row")
  let cls = tr && [...tr.classList].find(c => c.startsWith("fid_"))
  return cls ? files_by_id[cls.slice(4)] : null
}
function ondragover_table(e) {
  let file = row_file(e)
  if (file) ondragover(e, file)
  else drag_id.value = null
}
function ondragleave_table(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) drag_id.value = null
}
function ondrop_table(e) {
  let file = row_file(e)
  if (file) ondrop(e, file)
  else drag_id.value = null
}




// un archivo propio se borra del todo (audio y en todos los proyectos que lo usan); uno importado
// solo se quita de este proyecto
function deleteFile(file) {
  ElMessageBox.confirm(
    file.own ? 'Will permanently delete the file (also from every project that uses it). Continue?'
      : 'Will remove the file from this project. Continue?',
    'Warning',
    {
      confirmButtonText: 'OK',
      cancelButtonText: 'Cancel',
      type: 'warning',
    }
  )
    .then(async () => {
      if (!await delete_project_file(file)) return
      if (curr_edit_file.value?.id === file.id) dialogVisible.value = false
      ElMessage({
        type: 'success',
        message: file.own ? 'Delete completed' : 'Removed from project',
      })
    })
    .catch((e) => {
      console.log(e)

    })
}

const iconSize = 18

</script>
<style scoped>
.view_switch {
  margin-bottom: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
}

.key_filter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.key_select {
  width: 96px;
}

.actions {
  display: flex;
  gap: 0;
}

.row_actions {
  display: inline-flex;
  gap: 2px;
}

.icons {
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--muted);
}

.icons:hover {
  color: var(--text);
  background: var(--border);
}

.box {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
}

/* cartucho de plástico negro */
.cart {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 10px 8px;
  border-radius: 6px 6px 4px 4px;
  border: 1px solid #0a0a0b;
  background: var(--hw_tex_plastic) center / cover, #18181a;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  transition: box-shadow 0.15s, transform 0.15s;
}

.cart:hover {
  transform: translateY(-1px);
}

.cart.playing {
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.55), 0 0 0 1px var(--hw_green), 0 0 12px rgba(60, 230, 120, 0.25);
}

/* destino de un pad arrastrado */
.cart.drag_over {
  box-shadow: 0 0 0 2px var(--hw_yellow), 0 0 14px rgba(255, 210, 60, 0.35);
}

/* no disponible: fuera del sorteo, cartucho atenuado (las acciones siguen usables) */
.cart.unavailable .label,
.cart.unavailable .grip {
  opacity: 0.4;
  filter: grayscale(1);
}

.unavailable_mark {
  font-weight: 700;
  text-transform: uppercase;
}

.el-table :deep(.unavailable_row) {
  opacity: 0.45;
}

/* fila que suena en el preview (botón play del renglón) */
/* variables de Element Plus para el fondo de la fila, así también vale con el hover */
.el-table :deep(.previewing_row) {
  --el-table-tr-bg-color: rgba(53, 224, 122, 0.14);
  --el-table-row-hover-bg-color: rgba(53, 224, 122, 0.2);
}

.el-table :deep(.previewing_row) > td.el-table__cell:first-child {
  box-shadow: inset 3px 0 0 var(--hw_green);
}

.el-table :deep(.drag_over_row) > td.el-table__cell {
  box-shadow: inset 0 2px 0 var(--hw_yellow), inset 0 -2px 0 var(--hw_yellow);
}

.out_tempo {
  color: var(--danger);
  font-weight: 700;
}

/* estrías de agarre en el borde superior, con el LED a la derecha */
.grip {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: 18px;
  margin: 0 -10px;
  padding: 0 10px;
  background: repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.07) 0 2px, transparent 2px 6px);
  border-bottom: 1px solid #000;
}

/* etiqueta de papel pegada en el cartucho */
.label {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 10px 9px 18px;
  border-radius: 2px;
  background: linear-gradient(180deg, #ece7d8, #dcd6c4);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  color: #1e1f22;
}

/* bandas de color del Track Group (arriba) y de los Tags (abajo, repartidos) en el borde de la etiqueta */
.bands {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 8px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(0, 0, 0, 0.12);
}

.bands > span {
  flex: 1;
}

.tag_bands {
  display: flex;
  flex-direction: column;
}

.tag_bands span {
  flex: 1;
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

.tags {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tags .chip {
  padding: 0 8px;
  font-size: 10px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}

.tags .chip.empty {
  background: transparent;
  color: rgba(0, 0, 0, 0.4);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
}

.cart_foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.cart_foot .icons {
  color: var(--hw_silk);
  opacity: 0.6;
}

.cart_foot .icons:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.08);
}

.playing_chip {
  background: var(--accent);
}

.muted {
  color: var(--muted);
}

.anchor_mark {
  font-weight: 700;
  letter-spacing: 0.5px;
}

/* play de un preview en sync armado (espera el compás): titila */
.icons.armed {
  color: var(--hw_green);
  animation: armed_blink 0.5s steps(1, end) infinite;
}

@keyframes armed_blink {
  50% {
    opacity: 0.25;
  }
}
</style>
