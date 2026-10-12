<template>
  <div class="toggle">
    <div class="row">
      <span class="silk side" :class="{ on: modelValue == options[0].value }" @click="pick(0)">{{ options[0].label
      }}</span>
      <svg width="52" height="52" viewBox="0 0 52 52" tabindex="0" role="switch" :aria-label="label"
        :aria-checked="index == 1" @click="pick(1 - index)" @keydown.space.prevent="pick(1 - index)"
        @keydown.enter.prevent="pick(1 - index)" @keydown.left.prevent="pick(0)" @keydown.right.prevent="pick(1)">
        <defs>
          <radialGradient :id="uid + '_nut'" cx="40%" cy="35%" r="75%">
            <stop offset="0" stop-color="#f2f2f2" />
            <stop offset="0.55" stop-color="#9a9da3" />
            <stop offset="1" stop-color="#4a4c50" />
          </radialGradient>
          <linearGradient :id="uid + '_bat'" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#7d8086" />
            <stop offset="0.45" stop-color="#f4f4f4" />
            <stop offset="1" stop-color="#6b6e74" />
          </linearGradient>
        </defs>
        <!-- arandela hexagonal y tuerca -->
        <polygon points="26,8 41.6,17 41.6,35 26,44 10.4,35 10.4,17" fill="#1a1b1d" stroke="#000" />
        <circle cx="26" cy="26" r="11" :fill="`url(#${uid}_nut)`" stroke="#222" />
        <!-- palanca: rota hacia la opción elegida -->
        <g class="bat" :style="{ transform: `rotate(${index == 0 ? -32 : 32}deg)` }">
          <path d="M23.5 26 L22 6 Q26 2 30 6 L28.5 26 Z" :fill="`url(#${uid}_bat)`" stroke="#333" stroke-width="0.6" />
        </g>
      </svg>
      <span class="silk side" :class="{ on: modelValue == options[1].value }" @click="pick(1)">{{ options[1].label
      }}</span>
    </div>
    <span v-if="label" class="silk">{{ label }}</span>
  </div>
</template>
<script setup>
// Interruptor de palanca de dos posiciones. options = [{ value, label }, { value, label }]
import { computed } from "vue"

const props = defineProps({
  modelValue: { type: [String, Number], required: true },
  options: { type: Array, required: true },
  label: { type: String, default: "" }
})
const emit = defineEmits(["update:modelValue", "change"])

const uid = "tgl_" + Math.random().toString(36).slice(2, 8)
const index = computed(() => (props.modelValue == props.options[1].value ? 1 : 0))

function pick(i) {
  let v = props.options[i].value
  if (v == props.modelValue) return
  emit("update:modelValue", v)
  emit("change", v)
}
</script>
<style scoped>
.toggle {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
}

svg {
  display: block;
  cursor: pointer;
  outline: none;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.6));
}

svg:focus-visible {
  filter: drop-shadow(0 0 4px var(--hw_red));
}

.bat {
  transform-origin: 26px 26px;
  transition: transform 0.08s ease-out;
}

.side {
  cursor: pointer;
  opacity: 0.45;
}

.side.on {
  opacity: 1;
}
</style>
