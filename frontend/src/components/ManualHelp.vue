<template>
  <!-- "?" chico en el encabezado de un diálogo: abre /manual#<section> en otra pestaña (no corta lo que suena).
    @mousedown.stop: en un diálogo draggable el encabezado es la manija, y el clic en el "?" no tiene que arrastrar -->
  <a class="manual_help" :href="manual_link(section)" target="_blank" rel="noopener" title="Manual (otra pestaña)"
    aria-label="Manual" @mousedown.stop>?</a>
</template>

<script setup>
import { manual_link } from "../helpers/utils"

defineProps({
  // id de la sección del manual (manual/sections.js)
  section: { type: String, required: true },
})
</script>

<style scoped>
/* tecla de goma redonda, como las de LedButton */
.manual_help {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: 10px;
  border: 1px solid #0c0c0d;
  border-radius: 50%;
  background: linear-gradient(180deg, var(--hw_rubber_hi), var(--hw_rubber));
  box-shadow: 0 2px 0 #0e0e0f, inset 0 1px 0 rgba(255, 255, 255, 0.18);
  color: var(--hw_rubber_ink);
  font-family: var(--font_mono);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  text-decoration: none;
  vertical-align: middle;
  cursor: pointer;
}

.manual_help:hover,
.manual_help:focus-visible {
  color: var(--accent);
}

.manual_help:active {
  transform: translateY(1px);
  box-shadow: 0 1px 0 #0e0e0f, inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
</style>
