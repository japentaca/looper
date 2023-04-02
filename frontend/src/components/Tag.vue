<template>
  <div :draggable="!editing" class="tag" @dragstart="startDrag($event, props.index)">
    <el-color-picker @change="onColorChange" v-model="store.tags[props.index].color" />
    <span v-if="editing == false" @dblclick="setEditing(true)">{{
      store.tags[props.index].name
    }}
    </span>
    <span>
      <el-input v-on:keyup.escape="escapePressed()" ref="nameInput" @blur="onBlur" v-show="editing == true"
        v-model="store.tags[props.index].name" placeholder="Please input" />
    </span>
    <el-icon :size="14" class="icons" @click="deleteTag(props.index)">
      <Delete />
    </el-icon>


  </div>
</template>
<script setup>
import { ref } from 'vue';
import { store, tags_by_id, rebuildIndexes, save_tags } from "../helpers/composable"
import { save_fileData } from '../helpers/api';
import { genFileId } from 'element-plus';
const props = defineProps(["index"])
const editing = ref(false)
let prevName = ""

const nameInput = ref(null)

function setEditing(valor) {
  //console.log("set editing", valor)
  editing.value = valor
  store.loading = valor
  if (valor) {
    prevName = store.tags[props.index].name
    nameInput.value.focus()
  }
}
function escapePressed() {
  //console.log("escape pressed")
  store.tags[props.index].name = prevName
  editing.value = false
  store.loading = false
}

async function onBlur(e) {
  //console.log("on blur", editing.value)
  //console.log("es igual a valor anterior", store.tags[props.index].name == prevName)
  if (store.tags[props.index].name !== prevName) {
    await save_tags()
  }
  setEditing(false)

}




function startDrag(evt, index) {
  //console.log(index)
  evt.dataTransfer.dropEffect = 'move'
  evt.dataTransfer.effectAllowed = 'move'
  evt.dataTransfer.setData('msg_type', "tag")
  evt.dataTransfer.setData('id', store.tags[index].id)

}
async function onColorChange(a) {
  //console.log("on color change", a)
  await save_tags()

  //console.log(store.tags[props.index])
}
async function deleteTag(index) {
  let id = store.tags[index].id
  store.tags.splice(index, 1)
  store.files.map(async (file) => {
    if (file.tag == id) {
      file.tag = null
      file.tag_obj = null
      await save_fileData({ file: file })
    }
  })
  await save_tags()
  rebuildIndexes()


}

</script>
<style scoped>
.icons {
  display: flex;
  justify-content: space-around
}


.icons:hover {
  background-color: red;
}

.tag {
  margin-bottom: 5px;
  padding: 5px;
  background-color: v-bind("store.tags[props.index].color");
  border-style: outset;
  border-radius: 5px;
  font-size: 12px;
  display: flex;
  justify-content: space-around
}
</style>