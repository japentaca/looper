<template>
  <div :draggable="!editing" class="sidebar_item" @dragstart="startDrag($event)">
    <el-color-picker @change="onColorChange" v-model="item.color" />
    <span v-if="editing == false" @dblclick="setEditing(true)">{{ item.name }}</span>
    <span>
      <el-input v-on:keyup.escape="escapePressed()" ref="nameInput" @blur="onBlur" v-show="editing == true"
        v-model="item.name" placeholder="Please input" />
    </span>
    <el-icon :size="14" class="icons" @click="deleteItem">
      <Delete />
    </el-icon>
  </div>
</template>
<script setup>
// Item editable y arrastrable de la barra lateral: sirve para Track Groups (kind="track_group")
// y para Tags (kind="tag"). Lo que cambia entre ambos está en KINDS.
import { ref, computed } from 'vue'
import { save_fileData } from '../helpers/api'
import { store, rebuildIndexes, save_tags, save_trackGroups } from "../helpers/composable"

const KINDS = {
  track_group: { list: () => store.track_groups, save: save_trackGroups, file_field: "track_group", file_obj_field: "track_group_obj" },
  tag: { list: () => store.tags, save: save_tags, file_field: "tag", file_obj_field: "tag_obj" },
}

const props = defineProps(["kind", "index"])
const cfg = KINDS[props.kind]
const item = computed(() => cfg.list()[props.index])
const editing = ref(false)
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
.icons {
  cursor: pointer;
  color: var(--muted);
}

.icons:hover {
  color: var(--danger);
}

.sidebar_item {
  margin-bottom: 6px;
  padding: 6px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--panel_2);
  border: 1px solid var(--border);
  border-left: 4px solid v-bind("item.color");
  border-radius: 8px;
  font-size: 13px;
  cursor: grab;
}

.sidebar_item > span:nth-of-type(1) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
