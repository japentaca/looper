<template>
  <div class="lcd" :class="{ small }">
    <!-- zona de texto opcional a la izquierda (p. ej. nombre del TAG) -->
    <div v-if="$slots.default" class="text">
      <slot />
    </div>
    <div class="num">
      <span v-if="caption" class="caption">{{ caption }}</span>
      <div class="digits">
        <!-- segmentos apagados ("fantasma") detrás del valor, como en un LCD real -->
        <span class="ghost">{{ "8".repeat(digits) }}</span>
        <span class="value">{{ shown }}</span>
      </div>
      <span v-if="unit" class="unit">{{ unit }}</span>
    </div>
  </div>
</template>
<script setup>
// Display de 7 segmentos (fuente DSEG7). El valor se alinea a la derecha en `digits` posiciones.
import { computed } from "vue"

const props = defineProps({
  value: { type: [String, Number], default: "" },
  digits: { type: Number, default: 3 },
  caption: { type: String, default: "" },
  unit: { type: String, default: "" },
  small: { type: Boolean, default: false }
})

// DSEG usa "!" como dígito vacío del mismo ancho que un número
const shown = computed(() => String(props.value).slice(-props.digits).padStart(props.digits, "!"))
</script>
<style scoped>
.lcd {
  display: inline-flex;
  align-items: stretch;
  gap: 14px;
  padding: 6px 10px 8px;
  border-radius: 4px;
  background: linear-gradient(180deg, var(--hw_lcd_bg_hi), var(--hw_lcd_bg));
  border: 3px solid #0b0b0c;
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.08);
  color: var(--hw_lcd_ink);
}

.num {
  display: inline-grid;
  grid-template-columns: auto auto;
  grid-template-rows: auto auto;
  column-gap: 6px;
  align-items: end;
}

.text {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-width: 0;
  padding-right: 14px;
  border-right: 1px solid rgba(28, 36, 16, 0.25);
  font-weight: 700;
  text-transform: uppercase;
}

.caption {
  grid-column: 1 / -1;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  opacity: 0.75;
}

.digits {
  position: relative;
  font-family: "DSEG7", var(--font_mono);
  font-size: 30px;
  line-height: 1;
  font-weight: 700;
}

.ghost {
  position: absolute;
  inset: 0;
  opacity: 0.09;
}

.value {
  position: relative;
}

.small {
  padding: 3px 6px 4px;
  border-width: 2px;
}

.small .digits {
  font-size: 16px;
}

.small .unit {
  font-size: 9px;
}

.unit {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
}
</style>
