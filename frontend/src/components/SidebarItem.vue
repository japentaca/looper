<template>
  <!-- pad de goma tipo MPC: se ilumina con su color mientras su Track Group suena o su Tag está activo -->
  <div :draggable="!editing" class="pad" :class="{ lit }" @dragstart="startDrag($event)">
    <el-color-picker size="small" @change="onColorChange" v-model="item.color" />
    <el-icon :size="13" class="icons" title="Delete" @click="deleteItem">
      <Delete />
    </el-icon>
    <span v-if="editing == false" class="pad_name" title="Doble clic para renombrar" @dblclick="setEditing(true)">{{
      item.name }}</span>
    <span class="pad_input" v-show="editing == true">
      <el-input v-on:keyup.escape="escapePressed()" ref="nameInput" @blur="onBlur" v-model="item.name" size="small"
        placeholder="Name" />
    </span>
  </div>
</template>
<script setup>
// Item editable y arrastrable de la barra lateral: sirve para Track Groups (kind="track_group")
// y para Tags (kind="tag"). Lo que cambia entre ambos está en KINDS.
import { ref, computed } from 'vue'
import { save_fileData } from '../helpers/api'
import { store, rebuildIndexes, save_tags, save_trackGroups } from "../helpers/composable"
import { TrackCtrl } from "../helpers/TrackCtrl"

const KINDS = {
  track_group: {
    list: () => store.track_groups, save: save_trackGroups, file_field: "track_group", file_obj_field: "track_group_obj",
    // suena si algún track de ese grupo tiene un archivo reproduciéndose
    is_lit: (id) => TrackCtrl.tracks.some(t => t.track_group?.id == id && t.curr_file?.isPlaying)
  },
  tag: {
    list: () => store.tags, save: save_tags, file_field: "tag", file_obj_field: "tag_obj",
    is_lit: (id) => TrackCtrl.current_TAG.tag?.id == id
  },
}

const props = defineProps(["kind", "index"])
const cfg = KINDS[props.kind]
const item = computed(() => cfg.list()[props.index])
const editing = ref(false)
const lit = computed(() => TrackCtrl.isPlaying && cfg.is_lit(item.value.id))
let prevName = ""

const nameInput = ref(null)

function setEditing(valor) {
  editing.value = valor
  store.loading = valor
  if (valor) {
    prevName = item.value.name
    nameInput.value.focus()
  }
}
function escapePressed() {
  item.value.name = prevName
  editing.value = false
  store.loading = false
}

async function onBlur(e) {
  setEditing(false)
  if (item.value.name !== prevName) {
    await cfg.save()
  }
}

function startDrag(evt) {
  evt.dataTransfer.dropEffect = 'move'
  evt.dataTransfer.effectAllowed = 'move'
  evt.dataTransfer.setData('msg_type', props.kind)
  evt.dataTransfer.setData('id', item.value.id)
}
async function onColorChange(a) {
  await cfg.save()
}
async function deleteItem() {
  let id = item.value.id
  cfg.list().splice(props.index, 1)
  // los archivos que tenían este item quedan sin asignar
  store.files.map(async (file) => {
    if (file[cfg.file_field] == id) {
      file[cfg.file_field] = null
      file[cfg.file_obj_field] = null
      await save_fileData({ file: file })
    }
  })
  rebuildIndexes()
  await cfg.save()
}

</script>
<style scoped>
.pad {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  aspect-ratio: 1;
  padding: 26px 8px 10px;
  border-radius: 7px;
  border: 1px solid #0c0c0d;
  /* goma gris con una franja inferior del color del pad (la "ventana" de la luz) */
  background:
    linear-gradient(0deg, color-mix(in srgb, v-bind("item.color") 55%, #2a2b2e) 0 4px, transparent 4px),
    radial-gradient(ellipse at 50% 35%, #55575b, #3b3c40 70%);
  box-shadow: 0 3px 0 #0e0e0f, 0 4px 8px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  color: var(--hw_silk);
  cursor: grab;
  transition: background 0.08s, box-shadow 0.08s, transform 0.05s;
}

.pad:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #0e0e0f, 0 2px 4px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

/* pad encendido: la goma se tiñe y brilla con el color del Track Group / Tag */
.pad.lit {
  background: radial-gradient(ellipse at 50% 40%,
      color-mix(in srgb, v-bind("item.color") 85%, #fff),
      color-mix(in srgb, v-bind("item.color") 70%, #222) 75%);
  box-shadow: 0 3px 0 #0e0e0f, 0 0 16px 2px color-mix(in srgb, v-bind("item.color") 55%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
  color: #111;
}

.pad_name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
  user-select: none;
}

.pad_input {
  display: block;
  width: 100%;
}

/* selector de color en la esquina (el-color-picker no recibe clases ni el atributo de scope: :deep) */
.pad :deep(.el-color-picker) {
  position: absolute;
  top: 4px;
  left: 4px;
}

.icons {
  position: absolute;
  top: 8px;
  right: 7px;
  cursor: pointer;
  color: var(--hw_silk);
  opacity: 0;
  transition: opacity 0.1s;
}

.pad:hover .icons {
  opacity: 0.6;
}

.pad .icons:hover {
  opacity: 1;
  color: var(--danger);
}
</style>
