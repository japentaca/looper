<template>
  <div class="knob" :class="{ disabled }" :style="{ width: size + 'px' }">
    <svg :width="size" :height="size" viewBox="0 0 100 100" :tabindex="disabled ? -1 : 0" role="slider" :aria-valuemin="min"
      :aria-valuemax="max" :aria-valuenow="modelValue" :aria-label="label" :aria-disabled="disabled" @pointerdown="onDown"
      @wheel="onWheel" @keydown="onKey">
      <defs>
        <radialGradient :id="uid + '_cap'" cx="40%" cy="35%" r="70%">
          <stop offset="0" stop-color="#5a5c60" />
          <stop offset="0.6" stop-color="#2c2d30" />
          <stop offset="1" stop-color="#18191b" />
        </radialGradient>
        <linearGradient :id="uid + '_skirt'" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3b3c40" />
          <stop offset="1" stop-color="#0d0d0e" />
        </linearGradient>
      </defs>
      <!-- marcas de escala serigrafiadas -->
      <line v-for="t in ticks" :key="t" x1="50" y1="3" x2="50" y2="9" class="tick"
        :transform="`rotate(${t} 50 50)`" />
      <!-- falda y tapa de la perilla -->
      <circle cx="50" cy="52" r="36" :fill="`url(#${uid}_skirt)`" />
      <circle cx="50" cy="50" r="35" :fill="`url(#${uid}_skirt)`" stroke="#000" stroke-width="1" />
      <circle cx="50" cy="50" r="27" :fill="`url(#${uid}_cap)`" />
      <!-- indicador -->
      <g :transform="`rotate(${angle} 50 50)`">
        <line x1="50" y1="18" x2="50" y2="34" class="pointer" />
      </g>
    </svg>
    <span v-if="label" class="silk">{{ label }}</span>
  </div>
</template>
<script setup>
// Perilla rotativa: se arrastra en vertical, con la rueda o con las flechas.
// Emite update:modelValue mientras se mueve y "change" al soltar (como el-slider).
// Con disabled se ve atenuada y no responde (ni toma foco).
import { computed } from "vue"

const props = defineProps({
  modelValue: { type: Number, required: true },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  size: { type: Number, default: 72 },
  label: { type: String, default: "" },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(["update:modelValue", "change"])

const uid = "knob_" + Math.random().toString(36).slice(2, 8)
const ARC = 270 // recorrido total en grados (de -135 a +135)
const ticks = Array.from({ length: 11 }, (_, i) => -ARC / 2 + (ARC / 10) * i)

const angle = computed(() => {
  let ratio = (props.modelValue - props.min) / (props.max - props.min)
  return -ARC / 2 + ARC * Math.min(1, Math.max(0, ratio))
})

function clamp(v) {
  v = Math.round(v / props.step) * props.step
  return Math.min(props.max, Math.max(props.min, v))
}

function set_value(v, commit) {
  v = clamp(v)
  if (v !== props.modelValue) emit("update:modelValue", v)
  if (commit) emit("change", v)
}

// arrastre: 200 px recorren todo el rango; con Shift, ajuste fino
function onDown(e) {
  if (props.disabled) return
  let el = e.currentTarget
  el.setPointerCapture(e.pointerId)
  let start_y = e.clientY
  let start_v = props.modelValue
  let last = start_v
  const move = (ev) => {
    let px = ev.shiftKey ? 800 : 200
    last = clamp(start_v + ((start_y - ev.clientY) / px) * (props.max - props.min))
    set_value(last, false)
  }
  const up = () => {
    el.removeEventListener("pointermove", move)
    el.removeEventListener("pointerup", up)
    el.removeEventListener("pointercancel", up)
    if (last !== start_v) emit("change", last)
  }
  el.addEventListener("pointermove", move)
  el.addEventListener("pointerup", up)
  el.addEventListener("pointercancel", up)
}

function onWheel(e) {
  if (props.disabled) return
  e.preventDefault()
  set_value(props.modelValue + (e.deltaY < 0 ? props.step : -props.step), true)
}

function onKey(e) {
  if (props.disabled) return
  let delta = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key]
  if (!delta) return
  e.preventDefault()
  set_value(props.modelValue + delta * props.step, true)
}
</script>
<style scoped>
.knob {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

svg {
  display: block;
  cursor: ns-resize;
  touch-action: none;
  outline: none;
  filter: drop-shadow(0 3px 3px rgba(0, 0, 0, 0.55));
}

.knob.disabled svg {
  cursor: not-allowed;
  opacity: 0.45;
}

svg:focus-visible {
  filter: drop-shadow(0 0 4px var(--hw_red));
}

.tick {
  stroke: var(--hw_silk);
  stroke-width: 2;
  stroke-linecap: round;
  opacity: 0.8;
}

.pointer {
  stroke: var(--hw_silk);
  stroke-width: 4;
  stroke-linecap: round;
}
</style>
