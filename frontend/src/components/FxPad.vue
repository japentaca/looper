<template>
  <!-- pad de un tipo de FX de transición (catálogo fijo de helpers/fx.js): se arrastra a una tira de
    Tracks.vue, que crea una instancia con los valores por defecto. Sin color, borrar ni renombrar -->
  <div draggable="true" class="pad" :title="def.label + ': arrastrar a una pista'" @dragstart="start_drag">
    <span class="pad_chip">{{ def.chip }}</span>
    <span class="pad_name">{{ def.label }}</span>
  </div>
</template>
<script setup>
import { computed } from "vue"
import { FX_TYPES } from "../helpers/fx"

const props = defineProps({
  type: { type: String, required: true }, // clave de FX_TYPES
})
const def = computed(() => FX_TYPES[props.type])

// solo la marca looper/fx con el tipo: sin msg_type ni id, así Files.vue y los pads de pistas/Tags
// no reaccionan (solo las tiras de Tracks.vue aceptan looper/fx)
function start_drag(e) {
  e.dataTransfer.effectAllowed = "copy"
  e.dataTransfer.setData("looper/fx", props.type)
}
</script>
<style scoped>
/* mismo pad de goma que SidebarItem.vue, con la franja inferior del color de acento */
.pad {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  aspect-ratio: 1;
  padding: 26px 8px 10px;
  border-radius: 7px;
  border: 1px solid #0c0c0d;
  background:
    linear-gradient(0deg, color-mix(in srgb, var(--hw_yellow) 45%, #2a2b2e) 0 4px, transparent 4px),
    radial-gradient(ellipse at 50% 35%, #55575b, #3b3c40 70%);
  box-shadow: 0 3px 0 #0e0e0f, 0 4px 8px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  color: var(--hw_silk);
  cursor: grab;
  transition: box-shadow 0.08s, transform 0.05s;
}

.pad:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #0e0e0f, 0 2px 4px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

/* letra del chip que la instancia tendrá en la tira */
.pad_chip {
  position: absolute;
  top: 7px;
  left: 8px;
  font-family: var(--font_mono);
  font-size: 11px;
  font-weight: 700;
  opacity: 0.6;
  user-select: none;
}

.pad_name {
  max-width: 100%;
  overflow: hidden;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  word-break: break-word;
  user-select: none;
}
</style>
