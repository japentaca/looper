<template>
  <div class="meter" :style="{ height: segments * 9 + 'px' }">
    <!-- el segmento 1 queda abajo: se llena de abajo hacia arriba -->
    <span v-for="i in segments" :key="i" class="seg" :class="[zone(i), { lit: i <= lit }]"></span>
  </div>
</template>
<script setup>
// Medidor vertical de LEDs rectangulares: verde, amarillo en el último cuarto y rojo en el último segmento.
// value va de 0 a 1.
import { computed } from "vue"

const props = defineProps({
  value: { type: Number, default: 0 },
  segments: { type: Number, default: 16 }
})

const lit = computed(() => Math.round(Math.min(1, Math.max(0, props.value)) * props.segments))

function zone(i) {
  if (i == props.segments) return "red"
  if (i > props.segments * 0.75) return "yellow"
  return "green"
}
</script>
<style scoped>
.meter {
  display: flex;
  flex-direction: column-reverse;
  gap: 2px;
  width: 14px;
  padding: 3px;
  border-radius: 2px;
  background: #050506;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 255, 255, 0.06);
}

.seg {
  flex: 1;
  border-radius: 1px;
  background: #16301f;
}

.seg.yellow {
  background: #2c2814;
}

.seg.red {
  background: #2a1a18;
}

.seg.green.lit {
  background: var(--hw_green);
  box-shadow: 0 0 4px rgba(60, 230, 120, 0.55);
}

.seg.yellow.lit {
  background: var(--hw_yellow);
  box-shadow: 0 0 4px rgba(255, 210, 60, 0.55);
}

.seg.red.lit {
  background: var(--hw_red);
  box-shadow: 0 0 4px rgba(255, 70, 40, 0.6);
}
</style>
