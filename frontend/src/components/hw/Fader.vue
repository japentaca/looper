<template>
  <div class="fader">
    <div class="body" :style="{ height: length + 'px' }">
      <!-- escala serigrafiada a la izquierda -->
      <div class="scale">
        <span v-for="m in marks" :key="m.value" class="mark" :style="{ bottom: ratio(m.value) * 100 + '%' }">
          <span class="mark_label">{{ m.label }}</span><span class="mark_line"></span>
        </span>
      </div>
      <div ref="track" class="track" tabindex="0" role="slider" :aria-label="label" :aria-valuemin="min"
        :aria-valuemax="max" :aria-valuenow="modelValue" @pointerdown="onDown" @wheel.prevent="onWheel" @keydown="onKey">
        <span class="slot"></span>
        <span class="cap" :style="{ bottom: `calc(11px + ${ratio(modelValue)} * (100% - 22px))` }"></span>
      </div>
    </div>
    <span v-if="label" class="silk">{{ label }}</span>
  </div>
</template>
<script setup>
// Fader vertical: se arrastra (el clic en la ranura salta a esa posición), con la rueda o con las flechas.
// marks = [{ value, label }] para la escala. Emite update:modelValue al mover y "change" al soltar.
import { ref } from "vue"

const props = defineProps({
  modelValue: { type: Number, required: true },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  length: { type: Number, default: 110 },
  marks: { type: Array, default: () => [] },
  label: { type: String, default: "" }
})
const emit = defineEmits(["update:modelValue", "change"])

const track = ref(null)

function ratio(v) {
  return Math.min(1, Math.max(0, (v - props.min) / (props.max - props.min)))
}

function clamp(v) {
  v = Math.round((v - props.min) / props.step) * props.step + props.min
  return Math.min(props.max, Math.max(props.min, v))
}

// valor según la altura del puntero dentro del recorrido útil (descontando media tapa arriba y abajo)
function value_at(client_y) {
  let r = track.value.getBoundingClientRect()
  let inset = 11
  let k = (r.bottom - inset - client_y) / (r.height - inset * 2)
  return clamp(props.min + k * (props.max - props.min))
}

function onDown(e) {
  let el = track.value
  el.setPointerCapture(e.pointerId)
  let start_v = props.modelValue
  let last = value_at(e.clientY)
  if (last !== props.modelValue) emit("update:modelValue", last)
  const move = (ev) => {
    let v = value_at(ev.clientY)
    if (v !== last) {
      last = v
      emit("update:modelValue", v)
    }
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

function set_value(v) {
  v = clamp(v)
  if (v === props.modelValue) return
  emit("update:modelValue", v)
  emit("change", v)
}

function onWheel(e) {
  set_value(props.modelValue + (e.deltaY < 0 ? props.step : -props.step))
}

function onKey(e) {
  let delta = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key]
  if (!delta) return
  e.preventDefault()
  set_value(props.modelValue + delta * props.step)
}
</script>
<style scoped>
.fader {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.body {
  display: flex;
  gap: 4px;
}

.scale {
  position: relative;
  width: 30px;
  margin: 11px 0;
}

.mark {
  position: absolute;
  right: 0;
  display: flex;
  align-items: center;
  gap: 3px;
  transform: translateY(50%);
  color: var(--hw_silk);
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
}

.mark_line {
  width: 5px;
  height: 1px;
  background: currentColor;
}

.track {
  position: relative;
  width: 36px;
  cursor: ns-resize;
  touch-action: none;
  outline: none;
}

.slot {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 50%;
  width: 4px;
  margin-left: -2px;
  border-radius: 2px;
  background: #050506;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 255, 255, 0.25);
}

/* tapa del fader: la posición (bottom) ubica su centro sobre el recorrido útil */
.cap {
  position: absolute;
  left: 2px;
  right: 2px;
  height: 22px;
  transform: translateY(50%);
  border-radius: 3px;
  border: 1px solid #0c0c0d;
  background:
    linear-gradient(180deg, transparent 45%, #f2f0ea 45% 55%, transparent 55%),
    linear-gradient(180deg, #6a6c70 0%, #3a3b3e 48%, #2a2b2e 52%, #4b4d51 100%);
  box-shadow: 0 3px 4px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

.track:focus-visible .cap {
  outline: 2px solid var(--hw_red);
  outline-offset: 1px;
}
</style>
