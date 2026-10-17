<template>
  <div class="led_button">
    <Led v-if="led" :color="led" :lit="lit" :blink="blink" />
    <button type="button" class="cap" :class="[size, { pressed: lit }]" :disabled="disabled" @click="emit('click')">
      <span class="cap_text">{{ text }}</span>
    </button>
    <span v-if="label" class="silk">{{ label }}</span>
  </div>
</template>
<script setup>
// Botón de goma tipo MPC con LED arriba. led = "green" | "red" | "yellow" | "" (sin LED); lit enciende el LED;
// blink lo hace titilar (armado).
import Led from "./Led.vue"

defineProps({
  text: { type: String, default: "" },
  label: { type: String, default: "" },
  led: { type: String, default: "" },
  lit: { type: Boolean, default: false },
  blink: { type: Boolean, default: false },
  size: { type: String, default: "normal" }, // "small" | "normal" | "big"
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(["click"])
</script>
<style scoped>
.led_button {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.cap {
  width: 64px;
  height: 36px;
  padding: 0;
  border: 1px solid #0c0c0d;
  border-radius: 5px;
  background: linear-gradient(180deg, var(--hw_rubber_hi), var(--hw_rubber));
  box-shadow: 0 3px 0 #0e0e0f, 0 4px 6px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.18);
  color: var(--hw_rubber_ink);
  font-family: var(--font_mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.5px;
  cursor: pointer;
  transition: transform 0.05s, box-shadow 0.05s;
}

.cap.small {
  width: auto;
  height: 24px;
  padding: 0 10px;
  font-size: 10px;
}

.cap.big {
  width: 92px;
  height: 52px;
  font-size: 13px;
}

.cap:active:not(:disabled),
.cap.pressed {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #0e0e0f, 0 2px 3px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.cap:focus-visible {
  outline: 2px solid var(--hw_red);
  outline-offset: 2px;
}

.cap:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
</style>
