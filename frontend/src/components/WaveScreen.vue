<template>
  <div ref="box" class="wave_screen" role="img" :aria-label="`Waveform of ${file.original_name}`">
    <canvas ref="cv" class="wave_canvas"></canvas>
    <template v-if="has_buffer">
      <span class="lcd_text caption">{{ caption }}</span>
      <span v-if="rate_text" class="lcd_text rate" :title="RATE_TITLE">{{ rate_text }}</span>
      <template v-if="stereo">
        <span class="lcd_text lane l">L</span>
        <span class="lcd_text lane r">R</span>
      </template>
    </template>
    <div v-else class="lcd_text status">{{ file.loadError ? "LOAD ERROR" : "LOADING…" }}</div>
    <!-- cursores: los mueve el requestAnimationFrame directo en el DOM (sin pasar por Vue) -->
    <div ref="cur_preview" class="cursor preview"></div>
    <div ref="cur_engine" class="cursor engine"></div>
    <span class="lcd_text legend">
      <span v-show="preview_on" class="key preview">PREVIEW</span>
      <span v-show="engine_on" class="key engine">TRACK</span>
    </span>
  </div>
</template>
<script setup>
// Pantalla de onda del editor (diálogo de edición de Files.vue; docs/PLAN_EDITOR.md, fase 1). Canvas con
// estética de LCD: picos min/max por píxel del buffer ya cargado en el Tone.Player del archivo (un carril
// por canal, L/R si es estéreo), la grilla (beats del loop o tempo del proyecto en un shot) y dos cursores:
// el del preview (toneLib) y el del motor cuando el archivo suena en su pista. Como FileCart y los
// medidores, lee el estado del motor y del preview acá adentro: Files.vue no se re-renderiza por eso, y
// los cursores se mueven tocando el DOM en cada frame, sin reactividad. El clic no hace nada (MVP).
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue"
import * as Tone from "tone"
import { audio_players, engine_starts } from "../helpers/composable"
import { TrackCtrl, file_timing } from "../helpers/TrackCtrl"
import * as toneLib from "../helpers/toneLib"
import { compute_peaks, grid_lines, rate_label } from "../helpers/wave"

const props = defineProps({
  file: { type: Object, required: true },
  // beats a mostrar en la grilla de un loop: el valor del input del diálogo mientras se edita (antes de
  // guardar); null = los del archivo
  beats: { type: Number, default: null },
  // diálogo abierto: sin esto no se anima (el diálogo cerrado queda montado, oculto)
  active: { type: Boolean, default: false },
})

const RATE_TITLE = "The engine plays this loop at double or half time to fit the project tempo"
const box = ref(null)
const cv = ref(null)
const cur_preview = ref(null)
const cur_engine = ref(null)
// hay buffer dibujado (si no, "loading"); y si es estéreo (rótulos L/R). Los escribe draw()
const has_buffer = ref(false)
const stereo = ref(false)

const shown_beats = computed(() => props.beats ?? props.file.beats)
const is_shot = computed(() => props.file.kind == "shot")

// líneas de la grilla (helpers/wave.js). El tempo solo se lee en un shot: mover el knob Tempo no
// redibuja la pantalla de un loop
const lines = computed(() => grid_lines({
  kind: is_shot.value ? "shot" : "loop",
  duration: props.file.duration,
  beats: shown_beats.value,
  beats_x_bar: TrackCtrl.beats_x_bar,
  tempo: is_shot.value ? TrackCtrl.tempo : 0,
  anchor: props.file.anchor,
}))

const caption = computed(() => is_shot.value
  ? `GRID ${TrackCtrl.tempo} BPM · ${props.file.anchor == "end" ? "⇥END" : "START⇤"}`
  : `${shown_beats.value ?? "?"} BEATS`)

// rótulo si el motor lo toca a ×2 o ×½ (play_beats ≠ beats). Con los beats del archivo se usa lo que
// calculó calculate_timing; con un valor del input sin guardar se calcula igual que lo hará el motor
// (bpm deducido de beats y duración, como el backend), con el tempo y la tolerancia del último cálculo
const rate_text = computed(() => {
  let f = props.file
  if (is_shot.value) return ""
  let beats = shown_beats.value
  let t = beats == f.beats ? { play_beats: f.play_beats, in_tempo: f.in_tempo }
    : file_timing({ kind: "loop", duration: f.duration, beats, bpm: 0 }, TrackCtrl.timing_basis.tempo, TrackCtrl.timing_basis.tol)
  if (t.in_tempo === false) return "" // fuera de tempo no se sortea (el diálogo ya lo dice)
  return rate_label(beats, t.play_beats)
})

// --- buffer y picos ---
// AudioBuffer del player del archivo, o null si todavía no cargó (o falló). Ojo: al cargar el proyecto
// file.isLoaded se prende antes de que el player quede en audio_players (ver install_project): por eso se
// redibuja también cuando TrackCtrl.isReady pasa a true
function audio_buffer() {
  let tb = audio_players[props.file.id]?.buffer
  return tb?.loaded ? tb.get() ?? null : null
}
// picos por AudioBuffer, del último ancho dibujado: { columns, chans: [Float32Array] }. WeakMap: se van
// con el buffer cuando se libera el player
const peaks_cache = new WeakMap()
function peaks_of(buf, columns) {
  let hit = peaks_cache.get(buf)
  if (hit && hit.columns == columns) return hit.chans
  let chans = []
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(compute_peaks(buf.getChannelData(c), columns))
  peaks_cache.set(buf, { columns, chans })
  return chans
}

// --- dibujo ---
let css_w = 0
let colors = { ink: "#1c2410" }
function read_colors() {
  let cs = getComputedStyle(box.value)
  colors = { ink: cs.getPropertyValue("--hw_lcd_ink").trim() || "#1c2410" }
}

function draw() {
  let canvas = cv.value
  if (!canvas || !canvas.width || !canvas.height || !css_w) return
  let w = canvas.width
  let h = canvas.height
  let dpr = w / css_w
  let ctx = canvas.getContext("2d")
  ctx.clearRect(0, 0, w, h)
  let buf = audio_buffer()
  has_buffer.value = !!buf
  stereo.value = !!buf && buf.numberOfChannels >= 2
  if (!buf) return
  ctx.fillStyle = colors.ink
  // carriles: uno por canal (máximo 2), separados por una línea tenue
  let chans = peaks_of(buf, w)
  let lane_h = h / chans.length
  chans.forEach((peaks, i) => {
    let top = i * lane_h
    let mid = top + lane_h / 2
    let half = lane_h / 2 * 0.92
    ctx.globalAlpha = 0.18
    ctx.fillRect(0, Math.round(mid), w, 1) // línea del cero
    if (i > 0) ctx.fillRect(0, Math.round(top), w, Math.max(1, Math.round(dpr)))
    ctx.globalAlpha = 0.8
    for (let x = 0; x < w; x++) {
      let y1 = mid - peaks[x * 2 + 1] * half
      let y2 = mid - peaks[x * 2] * half
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1))
    }
  })
  draw_grid(ctx, w, h, dpr)
  ctx.globalAlpha = 1
}

// grilla encima de la onda: compás más marcado que el beat. Si las líneas quedan a menos de MIN_GAP px
// (CSS) no se dibujan las de beat (y si tampoco entran los compases, solo el anchor). En un shot las
// líneas son de trazos: no son beats del archivo sino el tempo del proyecto desde el anchor
const MIN_GAP = 4
function draw_grid(ctx, w, h, dpr) {
  let d = Number(props.file.duration)
  let ls = lines.value
  if (!(d > 0) || ls.length == 0) return
  let beat_gap = ls.length > 1 ? Math.abs(ls[1].t - ls[0].t) / d * css_w : Infinity
  let bpb = Math.max(1, parseInt(TrackCtrl.beats_x_bar) || 4)
  let show_beats = beat_gap >= MIN_GAP
  let show_bars = beat_gap * bpb >= MIN_GAP
  ctx.setLineDash(is_shot.value ? [4 * dpr, 3 * dpr] : [])
  for (let l of ls) {
    if (!(l.anchor || (l.bar ? show_bars : show_beats))) continue
    let lw = Math.max(1, Math.round((l.bar ? 2 : 1) * dpr))
    // a píxel entero del dispositivo y dentro del canvas (las de los bordes no quedan cortadas a la mitad)
    let x = Math.min(w - lw, Math.max(0, Math.round(l.t / d * w - lw / 2)))
    ctx.globalAlpha = l.bar ? 0.6 : 0.25
    ctx.strokeStyle = colors.ink
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(x + lw / 2, 0)
    ctx.lineTo(x + lw / 2, h)
    ctx.stroke()
    if (l.anchor) {
      // triangulito arriba: el punto de disparo del shot
      let s = 5 * dpr
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.moveTo(x + lw / 2 - s, 0)
      ctx.lineTo(x + lw / 2 + s, 0)
      ctx.lineTo(x + lw / 2, s * 1.4)
      ctx.closePath()
      ctx.fill()
    }
  }
  ctx.setLineDash([])
}

// tamaño del canvas en píxeles del dispositivo (nítido con devicePixelRatio). Con el diálogo cerrado el
// ancho es 0: no se dibuja
function resize(width, height) {
  css_w = width
  let canvas = cv.value
  if (!canvas || !width || !height) return
  let dpr = window.devicePixelRatio || 1
  let w = Math.round(width * dpr)
  let h = Math.round(height * dpr)
  if (canvas.width != w || canvas.height != h) {
    canvas.width = w
    canvas.height = h
  }
  draw()
}

let ro = null
onMounted(() => {
  read_colors()
  ro = new ResizeObserver(entries => {
    let r = entries[entries.length - 1].contentRect
    resize(r.width, r.height)
  })
  ro.observe(box.value)
  hide_cursors()
  if (animating.value) start_anim()
})

// se redibuja al cambiar de archivo, cuando termina de cargar y cuando cambia la grilla
watch([() => props.file, () => props.file.isLoaded, () => TrackCtrl.isReady, lines], () => draw())

// --- cursores ---
const preview_on = computed(() => toneLib.previewing(props.file.id))
// suena en su pista: isPlaying lo prende el motor (start_file) y lo baja al cortarlo o al terminar
const engine_on = computed(() => TrackCtrl.isPlaying && props.file.isPlaying === true)
const animating = computed(() => props.active && (preview_on.value || engine_on.value))

// posición del motor dentro del buffer (s) desde su último arranque (engine_starts lo anota start_file en
// Tracks.vue). El arranque se agenda con anticipación: hasta que llega se sigue con el anterior (la vuelta
// que todavía suena); sin anterior, null
function engine_position() {
  let s = engine_starts[props.file.id]
  let now = Tone.getContext().currentTime
  if (s && now < s.time) s = s.prev
  return s && now >= s.time ? (now - s.time) * s.rate : null
}
function place(el, pos) {
  if (!el) return
  let d = Number(props.file.duration)
  if (pos == null || !(d > 0) || pos > d || !css_w) {
    el.style.display = "none"
    return
  }
  el.style.display = "block"
  el.style.transform = `translateX(${pos / d * css_w}px)`
}
function hide_cursors() {
  place(cur_preview.value, null)
  place(cur_engine.value, null)
}

let raf = 0
function frame() {
  raf = requestAnimationFrame(frame)
  place(cur_preview.value, preview_on.value ? toneLib.preview_position() : null)
  place(cur_engine.value, engine_on.value ? engine_position() : null)
}
function start_anim() {
  if (!raf) raf = requestAnimationFrame(frame)
}
function stop_anim() {
  cancelAnimationFrame(raf)
  raf = 0
  hide_cursors()
}
// solo se anima con el diálogo abierto y algo sonando
watch(animating, on => on ? start_anim() : stop_anim())

onBeforeUnmount(() => {
  stop_anim()
  ro?.disconnect()
})
</script>
<style scoped>
/* LCD con los colores de hw/Lcd.vue; el canvas es transparente encima del fondo */
.wave_screen {
  position: relative;
  flex: 1 1 100%;
  height: 150px;
  overflow: hidden;
  border-radius: 4px;
  background: linear-gradient(180deg, var(--hw_lcd_bg_hi), var(--hw_lcd_bg));
  border: 3px solid #0b0b0c;
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.08);
  color: var(--hw_lcd_ink);
}

.wave_canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.lcd_text {
  position: absolute;
  font-family: var(--font_mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  line-height: 1;
  text-transform: uppercase;
  pointer-events: none;
}

.caption {
  top: 5px;
  left: 18px;
  opacity: 0.75;
}

.rate {
  top: 5px;
  right: 6px;
  padding: 2px 5px;
  border-radius: 2px;
  background: var(--hw_lcd_ink);
  color: var(--hw_lcd_bg_hi);
  text-transform: none;
  pointer-events: auto;
}

.lane {
  left: 5px;
  opacity: 0.6;
}

.lane.l {
  top: 5px;
}

.lane.r {
  top: calc(50% + 4px);
}

.status {
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  letter-spacing: 3px;
  opacity: 0.7;
}

.legend {
  right: 6px;
  bottom: 5px;
  display: flex;
  gap: 8px;
}

.key {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.key::before {
  content: "";
  width: 8px;
  height: 3px;
  background: currentColor;
}

/* cursores: línea vertical que se mueve con transform (ver place en el script) */
.cursor {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -1px;
  width: 2px;
  pointer-events: none;
  will-change: transform;
}

.cursor.preview {
  background: var(--hw_lcd_ink);
}

.cursor.engine {
  background: var(--hw_red);
  box-shadow: 0 0 4px var(--hw_red);
}

.key.engine {
  color: var(--hw_red);
}
</style>
