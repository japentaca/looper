<template>
  <!-- captura del manual con marco de aparato y anotaciones numeradas encima (no quemadas en la imagen):
    <ManualShot src="/manual/overview.webp" alt="..." :callouts="[{ n: 1, x: 12, y: 6, text: '...' }]" />
    x / y en % del ancho y el alto de la imagen (el centro del número); con text, la leyenda se arma sola
    abajo; con to (id de una sección), la leyenda termina con un link a esa sección. El slot (opcional) agrega
    texto libre debajo de la leyenda. max_width (px) achica las capturas chicas (un diálogo) para que no se
    estiren. Sin src se ve un marco vacío -->
  <figure class="shot" :style="max_width ? { maxWidth: max_width + 'px' } : null">
    <div class="hw_panel frame">
      <div class="screen" :class="{ missing: !src }">
        <img v-if="src" :src="src" :alt="alt" loading="lazy" decoding="async" />
        <div v-else class="placeholder" role="img" :aria-label="alt">
          <span class="silk">Screenshot pending</span>
        </div>
        <span v-for="c in callouts" :key="c.n" class="badge callout" :style="{ left: c.x + '%', top: c.y + '%' }"
          :title="c.text || ''">{{ c.n }}</span>
      </div>
    </div>
    <figcaption v-if="caption || legend.length || $slots.default">
      <div v-if="caption" class="caption">{{ caption }}</div>
      <ol v-if="legend.length" class="legend">
        <li v-for="c in legend" :key="c.n">
          <span class="badge">{{ c.n }}</span>
          <span>{{ c.text }}<template v-if="c.to && section_label(c.to)"> <a class="go" :href="'#' + c.to"
                @click.prevent="go_anchor(router, c.to)">→ {{ section_label(c.to) }}</a></template></span>
        </li>
      </ol>
      <slot />
    </figcaption>
  </figure>
</template>

<script setup>
import { computed, inject } from "vue"
import { useRouter } from "vue-router"
import { go_anchor } from "./nav"

const props = defineProps({
  src: { type: String, default: "" }, // p. ej. "/manual/overview.webp" (frontend/public/manual/)
  alt: { type: String, required: true },
  // [{ n, x, y, text? }]: número, posición en % sobre la imagen y texto de la leyenda
  callouts: { type: Array, default: () => [] },
  caption: { type: String, default: "" },
  max_width: { type: Number, default: 0 },
})

const router = useRouter()
const legend = computed(() => props.callouts.filter(c => c.text))
// secciones del manual (las da Manual.vue con provide; acá no se importa sections.js para no armar un ciclo)
const sections = inject("manual_sections", [])
function section_label(id) {
  let s = sections.find(s => s.id === id)
  return s ? (s.num !== null ? s.num + " · " : "") + s.title : ""
}
</script>

<style scoped>
.shot {
  margin: 18px 0;
}

.frame {
  padding: 18px;
}

/* pantalla hundida en el chasis; la imagen manda el alto */
.screen {
  position: relative;
  border: 3px solid #0b0b0c;
  border-radius: 4px;
  background: var(--bg);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.6), 0 1px 0 rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.screen img {
  display: block;
  width: 100%;
  height: auto;
}

.placeholder {
  aspect-ratio: 16 / 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.025) 0 12px, transparent 12px 24px), var(--panel);
}

.placeholder .silk {
  opacity: 0.6;
}

/* número de anotación: pad rojo encendido, como los LEDs de la app */
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 22px;
  height: 22px;
  border: 1px solid #000;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #ffb3a5, var(--hw_red) 60%);
  box-shadow: 0 0 6px 2px rgba(255, 70, 40, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.35);
  color: #1a0805;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  user-select: none;
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}

.callout {
  position: absolute;
  transform: translate(-50%, -50%);
}

figcaption {
  margin-top: 10px;
  color: var(--muted);
}

.caption {
  font-style: italic;
}

.legend {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 6px;
}

.legend li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: var(--text);
}

.go {
  margin-left: 6px;
  color: var(--accent);
  white-space: nowrap;
}

.legend .badge {
  width: 18px;
  height: 18px;
  font-size: 10px;
}

@media (max-width: 600px) {
  .frame {
    padding: 10px;
  }

  .callout {
    width: 18px;
    height: 18px;
    font-size: 10px;
  }
}

@media print {
  .shot {
    break-inside: avoid;
  }

  .frame {
    padding: 0;
    background: none;
    border: 0;
    box-shadow: none;
  }

  .screen {
    border-color: #999;
    box-shadow: none;
  }

  figcaption,
  .legend li,
  .go {
    color: #111;
  }
}
</style>
