<template>
  <div class="loupe" :title="title">
    <canvas ref="cv" class="loupe_canvas"></canvas>
    <span class="loupe_label">{{ label }}</span>
  </div>
</template>
<script setup>
// Lupa del editor (RegionEditor.vue; docs/PLAN_EDITOR.md, decisión 6): un tramo corto de audio mono ampliado
// en un LCD chico, con líneas verticales en `marks` (fracciones 0..1 del ancho). Sin estado del motor ni
// animación: se redibuja cuando cambian las muestras o las marcas.
import { ref, watch, onMounted } from "vue"
import { compute_peaks } from "../helpers/wave"

const props = defineProps({
  // muestras mono del tramo (Float32Array) o null (sin buffer)
  samples: { type: Object, default: null },
  marks: { type: Array, default: () => [] },
  label: { type: String, default: "" },
  title: { type: String, default: "" },
})

const W = 168 // px CSS
const H = 56
const cv = ref(null)

function draw() {
  let canvas = cv.value
  if (!canvas) return
  // tamaño real del canvas (dentro del borde) en píxeles del dispositivo
  let dpr = window.devicePixelRatio || 1
  let w = Math.round((canvas.clientWidth || W) * dpr)
  let h = Math.round((canvas.clientHeight || H) * dpr)
  if (canvas.width != w || canvas.height != h) {
    canvas.width = w
    canvas.height = h
  }
  let ctx = canvas.getContext("2d")
  ctx.clearRect(0, 0, w, h)
  let ink = getComputedStyle(canvas).getPropertyValue("--hw_lcd_ink").trim() || "#1c2410"
  ctx.fillStyle = ink
  let mid = h / 2
  ctx.globalAlpha = 0.18
  ctx.fillRect(0, Math.round(mid), w, 1) // línea del cero
  let s = props.samples
  if (s && s.length) {
    // picos por columna; con más columnas que muestras, compute_peaks repite la muestra (escalones)
    let peaks = compute_peaks(s, w)
    let half = mid * 0.9
    ctx.globalAlpha = 0.85
    for (let x = 0; x < w; x++) {
      let y1 = mid - peaks[x * 2 + 1] * half
      let y2 = mid - peaks[x * 2] * half
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1))
    }
  }
  ctx.globalAlpha = 0.9
  let lw = Math.max(1, Math.round(dpr))
  for (let m of props.marks) {
    if (!(m >= 0 && m <= 1)) continue
    ctx.fillRect(Math.min(w - lw, Math.round(m * w)), 0, lw, h)
  }
  ctx.globalAlpha = 1
}

onMounted(draw)
watch(() => [props.samples, props.marks], draw)
</script>
<style scoped>
.loupe {
  position: relative;
  width: 168px;
  height: 56px;
  flex: none;
  overflow: hidden;
  border-radius: 3px;
  background: linear-gradient(180deg, var(--hw_lcd_bg_hi), var(--hw_lcd_bg));
  border: 2px solid #0b0b0c;
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.45);
  color: var(--hw_lcd_ink);
}

.loupe_canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.loupe_label {
  position: absolute;
  top: 3px;
  left: 4px;
  font-family: var(--font_mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1px;
  opacity: 0.7;
  pointer-events: none;
}
</style>
