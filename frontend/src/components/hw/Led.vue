<template>
  <span ref="el" class="led" :class="[color, { lit }]"></span>
</template>
<script setup>
// LED redondo. lit = encendido fijo; cada vez que cambia `pulse` hace un destello corto.
import { ref, watch } from "vue"

const props = defineProps({
  color: { type: String, default: "green" }, // "green" | "red" | "yellow"
  lit: { type: Boolean, default: false },
  pulse: { type: [Number, String, null], default: null }
})

const el = ref(null)

watch(() => props.pulse, (v) => {
  if (v === null || !el.value) return
  // reinicia la animación aunque ya estuviera corriendo
  el.value.classList.remove("flash")
  void el.value.offsetWidth
  el.value.classList.add("flash")
})
</script>
<style scoped>
.led {
  --on: var(--hw_green);
  --glow: rgba(60, 230, 120, 0.6);
  --off: #16301f;
  display: inline-block;
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid #000;
  background: var(--off);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.15);
}

.led.red {
  --on: var(--hw_red);
  --glow: rgba(255, 70, 40, 0.65);
  --off: #2a1a18;
}

.led.yellow {
  --on: var(--hw_yellow);
  --glow: rgba(255, 210, 60, 0.6);
  --off: #2c2814;
}

.led.lit {
  background: radial-gradient(circle at 40% 35%, #fff, var(--on) 55%);
  box-shadow: 0 0 6px 2px var(--glow);
}

.led.flash {
  animation: led_flash 0.2s ease-out;
}

@keyframes led_flash {
  from {
    background: radial-gradient(circle at 40% 35%, #fff, var(--on) 55%);
    box-shadow: 0 0 7px 3px var(--glow);
  }

  to {
    background: var(--off);
    box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.15);
  }
}
</style>
