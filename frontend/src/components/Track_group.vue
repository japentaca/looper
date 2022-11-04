<template>

  <div :draggable="!editing" class="track_group" @dragstart="startDrag($event, props.index)">
    <el-color-picker @change="onColorChange" v-model="store.track_groups[props.index].color" />
    <span v-if="editing == false" @dblclick="setEditing(true)">{{
        store.track_groups[props.index].name
    }}
    </span>
    <span>
      <el-input v-on:keyup.escape="escapePressed()" ref="nameInput" @change="onChange" @blur="onBlur"
        v-show="editing == true" v-model="store.track_groups[props.index].name" placeholder="Please input" />
    </span>

    <el-icon :size="14" class="icons" @click="deleteTrackGroup(props.index)">
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
    prevName = store.track_groups[props.index].name
    nameInput.value.focus()

  }
}
function escapePressed() {
  store.track_groups[props.index].name = prevName
  editing.value = false
  store.loading = true
}

function onBlur(e) {
  setEditing(false)


}
function onChange(e) {
  setEditing(false)
}
function deleteTrackGroup(index) {
  store.track_groups.splice(index, 1)

}

function saveData() {
  console.log("save data")
}

function startDrag(evt, index) {
  //console.log(index)
  evt.dataTransfer.dropEffect = 'move'
  evt.dataTransfer.effectAllowed = 'move'
  evt.dataTransfer.setData('msg_type', "track_group")
  evt.dataTransfer.setData('id', store.track_groups[index].id)

}
function onColorChange(a) {
  //console.log(store.track_groups[props.index])
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

.track_group {
  margin-bottom: 5px;
  padding: 5px;
  background-color: v-bind("store.track_groups[props.index].color");
  border-style: outset;
  border-radius: 5px;
  font-size: 12px;
  display: flex;
  justify-content: space-around
}
</style>