<template>
  <div class="meter" :class="{ horizontal }"
    :style="horizontal ? { width: segments * 6 + 'px' } : { height: segments * 9 + 'px' }">
    <!-- el segmento 1 queda abajo (o a la izquierda): se llena desde ahí -->
    <span v-for="i in segments" :key="i" class="seg" :class="[zone(i), { lit: i <= lit || i == peak_seg }]"></span>
  </div>
</template>
<script setup>
// Medidor vertical de LEDs rectangulares: verde, amarillo en el último cuarto y rojo en el último segmento.
// value va de 0 a 1. peak (0..1, opcional) enciende un solo segmento suelto: el pico retenido.
import { computed } from "vue"

const props = defineProps({
  value: { type: Number, default: 0 },
  peak: { type: Number, default: 0 },
  segments: { type: Number, default: 16 },
  horizontal: { type: Boolean, default: false }
})

function to_seg(v) {
  return Math.round(Math.min(1, Math.max(0, v)) * props.segments)
}
const lit = computed(() => to_seg(props.value))
const peak_seg = computed(() => to_seg(props.peak))

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

.meter.horizontal {
  flex-direction: row;
  width: auto;
  height: 6px;
  padding: 2px;
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
