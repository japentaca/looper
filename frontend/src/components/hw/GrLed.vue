<template>
  <Led :color="db > red ? 'red' : 'yellow'" :lit="db > 1" :title="name + ' GR ' + db.toFixed(1) + ' dB'" />
</template>
<script setup>
// LED de reducción de ganancia: amarillo > 1 dB, rojo > red dB. Lee src[k] (reactivo, p. ej. levels.comp_gr y
// el índice de la banda, o levels y "gr") acá adentro: el valor cambia en cada frame y así solo se re-renderiza
// este LED, no el componente padre entero
import { computed } from "vue"
import Led from "./Led.vue"

const props = defineProps({
  src: { type: [Object, Array], required: true },
  k: { type: [String, Number], required: true },
  red: { type: Number, default: 3 },
  name: { type: String, default: "" }
})

const db = computed(() => props.src[props.k] ?? 0)
</script>
