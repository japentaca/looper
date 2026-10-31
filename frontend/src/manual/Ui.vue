<template>
  <!-- rótulo de la UI citado tal cual aparece: <Ui>START</Ui> (serigrafía sobre chasis) o <Ui lcd>120</Ui>
    (valor de un display de 7 segmentos) -->
  <span class="ui" :class="{ lcd }"><slot /></span>
</template>

<script setup>
defineProps({
  // valor de un LCD con la fuente DSEG7 (que solo tiene dígitos y pocos signos: . : - y algunas letras)
  lcd: { type: Boolean, default: false },
})
</script>

<style scoped>
.ui {
  display: inline-block;
  padding: 0 6px;
  border: 1px solid #0c0c0d;
  border-radius: 3px;
  background: var(--hw_chassis_dark);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  color: var(--hw_silk);
  font-size: 0.8em;
  font-weight: 700;
  letter-spacing: 1.2px;
  line-height: 1.6;
  text-transform: uppercase;
  white-space: nowrap;
}

.ui.lcd {
  padding: 0 5px;
  border: 2px solid #0b0b0c;
  background: linear-gradient(180deg, var(--hw_lcd_bg_hi), var(--hw_lcd_bg));
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.45);
  color: var(--hw_lcd_ink);
  font-family: "DSEG7", var(--font_mono);
  letter-spacing: 1px;
}

@media print {
  .ui {
    background: none;
    border-color: #555;
    box-shadow: none;
    color: #111;
  }
}
</style>
