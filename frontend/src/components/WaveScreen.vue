<template>
  <div ref="box" class="wave_screen" :class="{ selectable: selectable && has_buffer }" role="img" tabindex="-1"
    :aria-label="`Waveform of ${file.original_name}`" @pointerdown="on_select_down">
    <canvas ref="cv" class="wave_canvas"></canvas>
    <!-- selección de las ediciones destructivas (fase 6): rango resaltado con sus bordes -->
    <div v-if="has_buffer && sel_marks" class="selection" :style="{ left: sel_marks.start + '%', width: sel_marks.width + '%' }">
      <span class="sel_edge start" :class="{ selected: selected === 'sel_start' }"></span>
      <span class="sel_edge stop" :class="{ selected: selected === 'sel_stop' }"></span>
    </div>
    <!-- región: lo de afuera atenuado y las manijas start/stop (arrastrables si editable); en shots, el anchor
      (lengüeta abajo; out = el guardado quedó fuera de la región y se toca en el borde) -->
    <template v-if="has_buffer && marks">
      <div class="dim" :style="{ left: 0, width: marks.start + '%' }"></div>
      <div class="dim" :style="{ left: marks.stop + '%', right: 0 }"></div>
      <div v-for="m in handles" :key="m" class="handle"
        :class="[m, { editable, selected: selected === m, out: m == 'anchor' && view.anchor_out }]"
        :style="{ left: marks[m] + '%' }" :title="editable ? HANDLE_TITLE[m] : m == 'anchor' ? ANCHOR_TITLE : undefined"
        @pointerdown="on_handle_down(m, $event)">
        <span class="grip"></span>
      </div>
    </template>
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
// Pantalla de onda del editor (FileEditor.vue; docs/PLAN_EDITOR.md, fase 1). Canvas con
// estética de LCD: picos min/max por píxel del buffer ya cargado en el Tone.Player del archivo (un carril
// por canal, L/R si es estéreo), la grilla (beats del loop o tempo del proyecto en un shot) y dos cursores:
// el del preview (toneLib) y el del motor cuando el archivo suena en su pista. Como FileCart y los
// medidores, lee el estado del motor y del preview acá adentro: FileEditor.vue no se re-renderiza por eso, y
// los cursores se mueven tocando el DOM en cada frame, sin reactividad. El clic en la onda no hace nada.
// Fase 3: muestra la región que le pasa RegionEditor.vue (`view`, en segundos: afuera atenuado, grilla
// corrida por el nudge) y sus manijas; al arrastrarlas emite "marker" con el tiempo bajo el puntero (la
// conversión a beats, el SNAP y el guardado son de RegionEditor). Fase 4: en shots, además la manija del
// anchor (el punto que cae en el beat) y la grilla al tempo del proyecto desde ese punto. Fase 6: arrastrar sobre la
// onda fuera de las manijas emite "select" (la selección de las ediciones destructivas; el SNAP y el estado son
// de RegionEditor / edit_session.js) y la muestra (`selection`); con `buffer` dibuja el buffer de trabajo en vez del
// del player (cambios sin guardar: `file` es entonces el archivo virtual de ese buffer) y no muestra el cursor
// del motor (el motor toca el original).
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue"
import * as Tone from "tone"
import { audio_players, engine_starts } from "../helpers/composable"
import { TrackCtrl, file_timing } from "../helpers/TrackCtrl"
import * as toneLib from "../helpers/toneLib"
import { compute_peaks, grid_lines, rate_label } from "../helpers/wave"
import { region_beats, shot_anchor } from "../helpers/region"

const props = defineProps({
  file: { type: Object, required: true },
  // beats a mostrar en la grilla de un loop: el valor del input del diálogo mientras se edita (antes de
  // guardar); null = los del archivo
  beats: { type: Number, default: null },
  // diálogo abierto: sin esto no se anima (el diálogo cerrado queda montado, oculto)
  active: { type: Boolean, default: false },
  // región a mostrar, en segundos del archivo: { start, stop, nudge (beat 0 de la grilla de un loop), spb
  // (largo del beat del archivo; 0 = repartir la grilla sobre la duración), y en shots anchor (efectivo, s),
  // anchor_out (el guardado quedó fuera de la región) y anchor_custom (guardado en el proyecto; si no, el
  // default del catálogo) }; null = sin región (fase 1)
  view: { type: Object, default: null },
  // región de un loop en beats ({ start, stop }) o null: para el rótulo ×2 / ×½ con los beats efectivos
  loop_region: { type: Object, default: null },
  // manijas arrastrables (fuera de store.read_only)
  editable: { type: Boolean, default: false },
  // último marcador tocado ("start" | "stop" | "anchor" | "sel_start" | "sel_stop" | null): se resalta (lo mueven
  // las flechas)
  selected: { type: String, default: null },
  // AudioBuffer de trabajo (ediciones destructivas sin guardar) o null = el del player del archivo
  buffer: { type: Object, default: null },
  // se puede marcar una selección arrastrando sobre la onda
  selectable: { type: Boolean, default: false },
  // selección { start, stop } (s del buffer que se muestra) o null
  selection: { type: Object, default: null },
})
// marker: { which, t (s del archivo bajo el puntero; puede salir de [0, duración] si el puntero sale de la
// pantalla), shift, done (soltó) }; touch: which (pointerdown en una manija); select: { t0 (donde empezó el
// arrastre), t (bajo el puntero, sin recortar), shift, done, click (soltó sin arrastrar) }
const emit = defineEmits(["marker", "touch", "select"])

const RATE_TITLE = "The engine plays this loop at double or half time to fit the project tempo"
const HANDLE_TITLE = {
  start: "Region start: drag (Shift inverts SNAP); ← / → move it",
  stop: "Region stop: drag (Shift inverts SNAP); ← / → move it",
  anchor: "Anchor: this point falls on the beat. Drag (SNAP: hits and region edges; Shift inverts); ← / → move it",
}
const ANCHOR_TITLE = "Anchor: this point falls on the beat"
const box = ref(null)
const cv = ref(null)
const cur_preview = ref(null)
const cur_engine = ref(null)
// hay buffer dibujado (si no, "loading"); y si es estéreo (rótulos L/R). Los escribe draw()
const has_buffer = ref(false)
const stereo = ref(false)

const shown_beats = computed(() => props.beats ?? props.file.beats)
const is_shot = computed(() => props.file.kind == "shot")

// anchor efectivo de un shot (s): el de la región que se ve (también mientras se arrastra) o, sin región, el
// del archivo (shot_anchor de region.js)
const anchor_t = computed(() => is_shot.value ? props.view?.anchor ?? shot_anchor(props.file)?.at ?? 0 : 0)

// líneas de la grilla (helpers/wave.js). El tempo solo se lee en un shot: mover el knob Tempo no
// redibuja la pantalla de un loop. En un shot, desde el anchor efectivo
const lines = computed(() => grid_lines({
  kind: is_shot.value ? "shot" : "loop",
  duration: props.file.duration,
  beats: shown_beats.value,
  beats_x_bar: TrackCtrl.beats_x_bar,
  tempo: is_shot.value ? TrackCtrl.tempo : 0,
  anchor_t: anchor_t.value,
  nudge: is_shot.value ? 0 : props.view?.nudge ?? 0,
  spb: is_shot.value ? 0 : props.view?.spb ?? 0,
}))

// posiciones de las manijas en % del ancho (las que caen fuera del archivo, en el borde)
const marks = computed(() => {
  let v = props.view
  let d = Number(props.file.duration)
  if (!v || !(d > 0)) return null
  const pct = t => Math.min(100, Math.max(0, t / d * 100))
  return { start: pct(v.start), stop: pct(v.stop), anchor: v.anchor == null ? null : pct(v.anchor) }
})
// selección en % del ancho: { start, width }
const sel_marks = computed(() => {
  let s = props.selection
  let d = Number(props.file.duration)
  if (!s || !(d > 0)) return null
  let a = Math.min(100, Math.max(0, s.start / d * 100))
  let b = Math.min(100, Math.max(0, s.stop / d * 100))
  return b > a ? { start: a, width: b - a } : null
})
// manijas que se muestran: start/stop y, en shots, el anchor
const handles = computed(() => is_shot.value && marks.value?.anchor != null ? ["start", "stop", "anchor"] : ["start", "stop"])

// en un shot: el anchor guardado en el proyecto (en segundos) o el default del catálogo
const caption = computed(() => {
  if (!is_shot.value) return `${shown_beats.value ?? "?"} BEATS`
  let a = props.view?.anchor_custom ? `ANCHOR ${Math.round(anchor_t.value * 1000) / 1000} S`
    : props.file.anchor == "end" ? "⇥END" : "START⇤"
  return `GRID ${TrackCtrl.tempo} BPM · ${a}`
})

// rótulo si el motor lo toca a ×2 o ×½ (play_beats ≠ beats efectivos: los de la región, si tiene). Se
// calcula igual que lo hará el motor (file_timing), con la región que se ve (también mientras se arrastra) y
// el tempo y la tolerancia del último cálculo. Con un valor del input Beats sin guardar, el bpm se deduce de
// beats y duración, como el backend
const rate_text = computed(() => {
  let f = props.file
  if (is_shot.value) return ""
  let beats = shown_beats.value
  let r = props.loop_region
  let t = file_timing({
    kind: "loop", duration: f.duration, beats, bpm: beats == f.beats ? f.bpm : 0,
    props: r ? { region_beats: [r.start, r.stop] } : {},
  }, TrackCtrl.timing_basis.tempo, TrackCtrl.timing_basis.tol)
  if (t.in_tempo === false) return "" // fuera de tempo no se sortea (el diálogo ya lo dice)
  return rate_label(r ? region_beats(r.start, r.stop) : beats, t.play_beats)
})

// --- arrastre de las manijas ---
// tiempo del archivo bajo el puntero (sin recortar: fuera de la pantalla da < 0 o > duración)
function t_at(ev) {
  let r = box.value.getBoundingClientRect()
  return r.width > 0 ? (ev.clientX - r.left) / r.width * Number(props.file.duration) : 0
}
function on_handle_down(which, e) {
  if (!props.editable || e.button > 0) return
  e.preventDefault()
  // el foco pasa a la pantalla (dentro del editor): las flechas mueven el marcador y no un knob que lo tenía
  box.value.focus({ preventScroll: true })
  emit("touch", which)
  let el = e.currentTarget
  // captura en lo que se tocó (la lengüeta del anchor, que es lo único de esa manija que recibe el puntero):
  // move / up suben hasta la manija
  e.target.setPointerCapture(e.pointerId)
  // agarre: lo que el puntero quedó corrido de la línea de la manija (como mucho unos píxeles)
  let d = Number(props.file.duration)
  let max_grab = css_w > 0 ? 8 / css_w * d : 0
  let grab = Math.min(max_grab, Math.max(-max_grab, t_at(e) - props.view[which]))
  const send = (ev, done) => emit("marker", { which, t: t_at(ev) - grab, shift: ev.shiftKey, done })
  const move = (ev) => send(ev, false)
  const up = (ev) => {
    el.removeEventListener("pointermove", move)
    el.removeEventListener("pointerup", up)
    el.removeEventListener("pointercancel", up)
    send(ev, true)
  }
  el.addEventListener("pointermove", move)
  el.addEventListener("pointerup", up)
  el.addEventListener("pointercancel", up)
}

// --- selección: arrastre sobre la onda (fuera de las manijas) ---
const CLICK_PX = 3 // menos que esto de recorrido = clic (quita la selección)
function on_select_down(e) {
  if (!props.selectable || !has_buffer.value || e.button > 0 || e.target.closest(".handle")) return
  e.preventDefault()
  box.value.focus({ preventScroll: true })
  let el = box.value
  el.setPointerCapture(e.pointerId)
  let x0 = e.clientX
  let t0 = Math.min(Number(props.file.duration), Math.max(0, t_at(e)))
  let moved = false
  const send = (ev, done) => emit("select", { t0, t: t_at(ev), shift: ev.shiftKey, done, click: done && !moved })
  const move = (ev) => {
    if (!moved && Math.abs(ev.clientX - x0) < CLICK_PX) return
    moved = true
    send(ev, false)
  }
  const up = (ev) => {
    el.removeEventListener("pointermove", move)
    el.removeEventListener("pointerup", up)
    el.removeEventListener("pointercancel", up)
    send(ev, true)
  }
  el.addEventListener("pointermove", move)
  el.addEventListener("pointerup", up)
  el.addEventListener("pointercancel", up)
}

// --- buffer y picos ---
// AudioBuffer del player del archivo, o null si todavía no cargó (o falló). Ojo: al cargar el proyecto
// file.isLoaded se prende antes de que el player quede en audio_players (ver install_project): por eso se
// redibuja también cuando TrackCtrl.isReady pasa a true
function audio_buffer() {
  if (props.buffer) return props.buffer
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
watch([() => props.file, () => props.file.isLoaded, () => TrackCtrl.isReady, lines, () => props.buffer], () => draw())

// --- cursores ---
const preview_on = computed(() => toneLib.previewing(props.file.id))
// suena en su pista: isPlaying lo prende el motor (start_file) y lo baja al cortarlo o al terminar. Con el buffer de
// trabajo no: el motor toca el original y las posiciones no coinciden
const engine_on = computed(() => TrackCtrl.isPlaying && props.file.isPlaying === true && !props.buffer)
const animating = computed(() => props.active && (preview_on.value || engine_on.value))

// posición del motor dentro del buffer (s) desde su último arranque (engine_starts lo anota start_file en
// Tracks.vue, con el offset y el largo de la región). El arranque se agenda con anticipación: hasta que
// llega se sigue con el anterior (la vuelta que todavía suena); sin anterior o pasada la región, null
function engine_position() {
  let s = engine_starts[props.file.id]
  let now = Tone.getContext().currentTime
  if (s && now < s.time) s = s.prev
  if (!s || now < s.time) return null
  let el = (now - s.time) * s.rate
  return s.len != null && el > s.len ? null : (s.offset ?? 0) + el
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

.wave_screen:focus {
  outline: none;
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

/* selección (fase 6): arrastrar sobre la onda; resaltada con la tinta del LCD, bordes marcados */
.wave_screen.selectable {
  cursor: text;
  touch-action: none;
}

.selection {
  position: absolute;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--hw_lcd_ink) 28%, transparent);
  pointer-events: none;
}

.sel_edge {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--hw_lcd_ink);
}

.sel_edge.start {
  left: -1px;
}

.sel_edge.stop {
  right: -1px;
}

.sel_edge.selected {
  background: var(--hw_red);
}

/* región: lo de afuera se atenúa con el color del fondo del LCD */
.dim {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--hw_lcd_bg);
  opacity: 0.62;
  pointer-events: none;
}

/* manija: línea con una lengüeta arriba; el área de agarre es más ancha que la línea */
.handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 14px;
  margin-left: -7px;
  touch-action: none;
}

.handle::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 6px;
  width: 2px;
  background: var(--hw_lcd_ink);
}

.handle .grip {
  position: absolute;
  top: 0;
  width: 9px;
  height: 14px;
  background: var(--hw_lcd_ink);
}

.handle.start .grip {
  left: 7px;
  border-radius: 0 3px 3px 0;
}

.handle.stop .grip {
  right: 7px;
  border-radius: 3px 0 0 3px;
}

.handle.editable {
  cursor: ew-resize;
}

.handle.selected::before,
.handle.selected .grip {
  background: var(--hw_red);
}

/* anchor (shots): línea de trazos y lengüeta triangular abajo (arriba están las de start/stop y el triángulo de
   la grilla); fuera de la región (se toca en el borde) en el color de aviso. Solo la lengüeta recibe el puntero:
   con el anchor en un borde (el default) la manija de start/stop sigue agarrándose de arriba */
.handle.anchor {
  pointer-events: none;
}

.handle.anchor .grip {
  pointer-events: auto;
}

.handle.anchor::before {
  background: repeating-linear-gradient(180deg, var(--hw_lcd_ink) 0 5px, transparent 5px 8px);
}

.handle.anchor .grip {
  top: auto;
  bottom: 0;
  left: 0;
  width: 14px;
  height: 12px;
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
}

.handle.anchor.selected::before {
  background: repeating-linear-gradient(180deg, var(--hw_red) 0 5px, transparent 5px 8px);
}

.handle.anchor.out .grip {
  background: #7a1a0c;
}
</style>
