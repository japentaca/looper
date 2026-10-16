<template>
  <div class="range_pads" :class="{ disabled, small }">
    <div class="pads">
      <button v-for="(o, i) in opts" :key="o.value" type="button" class="pad" :class="{ on: in_range(i) }"
        :disabled="disabled" :title="o.label" @pointerdown="on_down($event, i)" @pointerenter="on_enter(i)"
        @keydown="on_key($event, i)">
        <Led :lit="in_range(i)" :color="is_end(i) ? 'red' : 'green'" />
        <span class="pad_text">{{ o.label }}</span>
      </button>
    </div>
    <span v-if="label" class="silk">{{ label }}</span>
  </div>
</template>
<script setup>
// Selector de rango [min, max] sobre una lista de valores discretos: fila de pads con LED.
// options = lista de valores (números/strings) o de { value, label }; puede cambiar en cualquier momento.
// v-model = [min, max] con valores de options (en el orden de la lista; min <= max por posición).
// Uso: clic = un solo valor; arrastrar sobre los pads = rango; Shift+clic = lleva hasta ahí el extremo más cercano.
// Teclado: flechas mueven el rango, Shift+flechas mueven solo el extremo derecho.
// Los LEDs de los extremos se ven en rojo; los del medio, en verde.
import { computed, onBeforeUnmount } from "vue"
import Led from "./Led.vue"

const props = defineProps({
  options: { type: Array, default: () => [] },
  modelValue: { type: Array, default: () => [] },
  label: { type: String, default: "" },
  disabled: { type: Boolean, default: false },
  small: { type: Boolean, default: false } // pads chicos, para las tiras de canal
})
const emit = defineEmits(["update:modelValue", "change"])

const opts = computed(() => props.options.map(o =>
  (o !== null && typeof o === "object") ? { value: o.value, label: String(o.label ?? o.value) } : { value: o, label: String(o) }))

// índices [desde, hasta] del v-model; -1 si el valor no está en options
const range = computed(() => {
  let a = opts.value.findIndex(o => o.value === props.modelValue[0])
  let b = opts.value.findIndex(o => o.value === props.modelValue[1])
  if (a < 0 && b < 0) return [-1, -1]
  if (a < 0) a = b
  if (b < 0) b = a
  return [Math.min(a, b), Math.max(a, b)]
})

const in_range = (i) => i >= range.value[0] && i <= range.value[1]
const is_end = (i) => i === range.value[0] || i === range.value[1]

function set_range(a, b) {
  let lo = Math.max(0, Math.min(a, b)), hi = Math.min(opts.value.length - 1, Math.max(a, b))
  if (lo === range.value[0] && hi === range.value[1]) return
  let v = [opts.value[lo].value, opts.value[hi].value]
  emit("update:modelValue", v)
  emit("change", v)
}

// arrastre: el pad donde se apretó queda como ancla y el rango va hasta el pad bajo el puntero
let anchor = -1

function on_down(e, i) {
  if (props.disabled || e.button > 0) return
  e.preventDefault()
  // en táctil el navegador captura el puntero en el primer pad: se libera para recibir pointerenter en los demás
  if (e.target.hasPointerCapture?.(e.pointerId)) e.target.releasePointerCapture(e.pointerId)
  if (e.shiftKey && range.value[0] >= 0) {
    // el extremo más lejano queda fijo y el más cercano se mueve al pad
    anchor = Math.abs(i - range.value[0]) <= Math.abs(i - range.value[1]) ? range.value[1] : range.value[0]
  } else {
    anchor = i
  }
  set_range(anchor, i)
  e.currentTarget.focus()
  window.addEventListener("pointerup", on_up)
  window.addEventListener("pointercancel", on_up)
}

function on_enter(i) {
  if (anchor >= 0) set_range(anchor, i)
}

function on_up() {
  anchor = -1
  window.removeEventListener("pointerup", on_up)
  window.removeEventListener("pointercancel", on_up)
}

onBeforeUnmount(on_up)

function on_key(e, i) {
  let [lo, hi] = range.value
  if (lo < 0) lo = hi = i
  let d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0
  if (!d) return
  e.preventDefault()
  if (e.shiftKey) {
    set_range(lo, Math.max(lo, hi + d))
  } else if (lo + d >= 0 && hi + d < opts.value.length) {
    set_range(lo + d, hi + d)
  }
}
</script>
<style scoped>
.range_pads {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.pads {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 4px;
  background: #050506;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 255, 255, 0.25);
  touch-action: none;
}

.pad {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 30px;
  height: 40px;
  padding: 0 4px;
  border: 1px solid #0c0c0d;
  border-radius: 4px;
  background: linear-gradient(180deg, var(--hw_rubber_hi), var(--hw_rubber));
  box-shadow: 0 2px 0 #0e0e0f, inset 0 1px 0 rgba(255, 255, 255, 0.18);
  color: var(--hw_rubber_ink);
  font-family: var(--font_mono);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
  transition: transform 0.05s, box-shadow 0.05s;
}

.pad.on {
  transform: translateY(1px);
  box-shadow: 0 1px 0 #0e0e0f, inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.pad:focus-visible {
  outline: 2px solid var(--hw_red);
  outline-offset: 2px;
}

.pad:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.small .pads {
  gap: 2px;
  padding: 2px;
}

.small .pad {
  min-width: 0;
  width: 13px;
  height: 28px;
  padding: 0;
  gap: 3px;
  font-size: 9px;
  letter-spacing: -0.5px;
}

.pad_text {
  line-height: 1;
}
</style>
