<template>

  <div :draggable="!editing" class="tag" @dragstart="startDrag($event, props.index)">
    <el-color-picker @change="onColorChange" v-model="store.tags[props.index].color" />
    <span v-if="editing == false" @dblclick="setEditing(true)">{{
        store.tags[props.index].name
    }}
    </span>
    <span>
      <el-input v-on:keyup.escape="escapePressed()" ref="nameInput" @change="onChange" @blur="onBlur"
        v-show="editing == true" v-model="store.tags[props.index].name" placeholder="Please input" />
    </span>
    <el-icon :size="14" class="icons" @click="deleteTag(props.index)">
      <Delete />
    </el-icon>


  </div>


</template>
<script setup>
import { ref } from 'vue';
import { store } from "../helpers/composable"
const props = defineProps(["index"])
const editing = ref(false)
let prevName = ""

const nameInput = ref(null)

function setEditing(valor) {
  editing.value = valor
  store.loading = valor
  if (valor) {
    prevName = store.tags[props.index].name
    nameInput.value.focus()
  }
}
function escapePressed() {
  store.tags[props.index].name = prevName
  editing.value = false
  store.loading = false
}

function onBlur(e) {
  setEditing(false)

}
function onChange(e) {
  setEditing(false)
}

function saveData() {
  console.log("save data")
}

function startDrag(evt, index) {
  //console.log(index)
  evt.dataTransfer.dropEffect = 'move'
  evt.dataTransfer.effectAllowed = 'move'
  evt.dataTransfer.setData('msg_type', "tag")
  evt.dataTransfer.setData('id', store.tags[index].id)

}
function onColorChange(a) {
  //console.log(store.tags[props.index])
}
function deleteTag(index) {
  store.tags.splice(index, 1)

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