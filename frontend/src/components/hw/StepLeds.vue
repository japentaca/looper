<template>
  <div class="steps">
    <span v-for="(on, i) in leds" :key="i" class="step" :class="{ lit: on, first: on && pos == 1 }"></span>
  </div>
</template>
<script setup>
// Fila de 16 LEDs de paso (como un step sequencer): marca la posición dentro del loop.
// Cada LED cubre beats/16 beats; con loops de 32+ beats un LED abarca varios beats y con
// loops cortos (4, 8) cada beat enciende un grupo de LEDs. El beat 1 se ve en rojo.
// pos va de 1 a beats; 0 = apagado.
import { computed } from "vue"

const COUNT = 16

const props = defineProps({
  pos: { type: Number, default: 0 },
  beats: { type: Number, default: 0 }
})

const leds = computed(() => {
  let k = props.pos - 1 // el beat actual ocupa [k, k+1) en beats
  return Array.from({ length: COUNT }, (_, i) => {
    if (!props.beats || props.pos < 1) return false
    // el LED i cubre [i*beats/16, (i+1)*beats/16): se enciende si se superpone con el beat actual
    return k < (i + 1) * props.beats / COUNT && k + 1 > i * props.beats / COUNT
  })
})
</script>
<style scoped>
.steps {
  display: flex;
  gap: 1px;
  padding: 2px;
  border-radius: 2px;
  background: #050506;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 255, 255, 0.06);
}

.step {
  width: 4px;
  height: 6px;
  border-radius: 1px;
  background: #16301f;
}

/* separación cada 4 LEDs, como las marcas de tiempo de una caja de ritmos */
.step:nth-child(4n):not(:last-child) {
  margin-right: 3px;
}

.step.lit {
  background: var(--hw_green);
  box-shadow: 0 0 4px rgba(60, 230, 120, 0.55);
}

.step.first {
  background: var(--hw_red);
  box-shadow: 0 0 4px rgba(255, 70, 40, 0.6);
}
</style>
