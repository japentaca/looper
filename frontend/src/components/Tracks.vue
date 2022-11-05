<template>
  <div>
    TRACK CONTROL
    <el-button>START</el-button>
    Beats x Bar
    <el-radio-group v-model="TrackCtrl.props.bpb">
      <el-radio label="3" border>3</el-radio>
      <el-radio label="4" border>4 </el-radio>
    </el-radio-group>
    <div>

      TEMPO
      <el-slider class="slider" @change="onSliderchange" v-model="TrackCtrl.props.tempo" :min="10" :max="160" />
      <span>{{
          store.tempo
      }} BPM</span>
    </div>
  </div>
</template>
<script setup>
import { ref } from "vue"
import { store, TrackCtrl } from "../helpers/composable"

function onSliderchange(value) {

  TrackCtrl.calculateBars()
}

</script>



<style scoped>
.slider {
  width: 300px;
}
</style>