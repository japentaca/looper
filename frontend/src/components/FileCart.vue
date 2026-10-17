<template>
  <div class="cart" :class="{ playing: sounding }">
    <slot :sounding="sounding" :armed="armed" />
  </div>
</template>
<script setup>
// Cartucho de un archivo en la vista Box de Files.vue. Solo encierra el contenido (markup, handlers y estilos
// siguen en Files.vue, que lo pasa por el slot) y calcula acá adentro si el archivo suena: el motor cambia de
// archivo a cada rato y, si lo leyera Files.vue, cada cambio de loop re-renderizaría la lista entera (todos
// los cartuchos y la tabla). Así solo se re-renderizan los cartuchos que empiezan o dejan de sonar.
import { computed } from "vue"
import { TrackCtrl } from "../helpers/TrackCtrl"
import * as toneLib from "../helpers/toneLib"

const props = defineProps({
  file: { type: Object, required: true }
})

// el preview en sync espera el próximo compás (o beat) para arrancar: el LED titila
const armed = computed(() => toneLib.preview_armed(props.file.id))
// suena en el motor (algún track lo tiene) o en el preview (o espera arrancar)
const sounding = computed(() => toneLib.previewing(props.file.id)
  || (TrackCtrl.isPlaying && TrackCtrl.tracks.some(t => t.curr_file?.id == props.file.id && t.curr_file.isPlaying)))
</script>
