<template>
  <div class="region_editor">
    <WaveScreen :file="file" :beats="beats" :active="active" :view="view" :loop_region="is_shot ? null : region"
      :editable="editable && !!view" :selected="last_marker" @marker="on_marker" @touch="m => last_marker = m" />
    <div v-if="view" class="region_bar">
      <!-- largo de la región: en loops, los beats que ocupa (aviso si no es entera: el motor la redondea) -->
      <span class="region_len" :class="{ warn: fractional }" :title="len_title">{{ len_text }}</span>
      <LedButton v-if="editable" size="small" text="SNAP" led="yellow" :lit="snap" :title="snap_title + ' (G)'"
        @click="toggle_snap" />
      <!-- NUDGE (solo loops): corre la grilla entera; AUTO = primer golpe -->
      <div v-if="!is_shot" class="hw_plate mini" :title="NUDGE_TITLE">
        <span class="silk">Nudge</span>
        <Knob v-if="editable" :model-value="file.props.nudge ?? 0" :min="0" :max="NUDGE_MAX" :size="40"
          @update:model-value="v => set_prop(file, 'nudge', v)" @change="save_props" />
        <Lcd small :digits="3" :value="file.props.nudge ?? 0" unit="ms" />
        <LedButton v-if="editable" size="small" text="AUTO" :disabled="!chans" :title="AUTO_TITLE" @click="auto_nudge" />
      </div>
      <div class="hw_plate mini" :title="FADE_TITLE">
        <span class="silk">Fade</span>
        <Knob v-if="editable" :model-value="file.props.fade ?? 0" :min="0" :max="FADE_MAX" :size="40"
          @update:model-value="v => set_prop(file, 'fade', v)" @change="save_props" />
        <Lcd small :digits="2" :value="file.props.fade ?? 0" unit="ms" />
      </div>
      <WaveLoupe :samples="start_loupe.samples" :marks="start_loupe.marks" label="START" :title="start_loupe.title" />
      <WaveLoupe :samples="seam_loupe" :marks="[0.5]" label="SEAM" :title="SEAM_TITLE" />
    </div>
  </div>
</template>
<script setup>
// Región del archivo en el proyecto (docs/PLAN_EDITOR.md, fase 3; decisión 6): monta la pantalla de onda
// (WaveScreen.vue) con las manijas start/stop y, debajo, el largo de la región, SNAP, NUDGE + AUTO, FADE y
// las lupas de inicio y de costura. Todo vive en project_files.props (ver helpers/region.js) y se guarda como
// volume / weight / repeat (save_file_debounced), al soltar: no en cada píxel del arrastre ni del knob.
// Atajos (solo con el editor abierto; reglas de foco de editor_key_ok en utils.js): G = SNAP, ← / → mueven
// el último marcador tocado (un beat con SNAP, 1 ms sin SNAP; Shift invierte). En store.read_only se ve
// todo y no se edita. Los cambios valen desde el próximo arranque del archivo en el motor o en el preview.
import { ref, computed, watch, onBeforeUnmount } from "vue"
import { store, audio_players, save_file_debounced } from "../helpers/composable"
import { TrackCtrl, calculate_timing } from "../helpers/TrackCtrl"
import {
  NUDGE_MAX, FADE_MAX, MIN_LOOP_BEATS, MIN_SHOT_SECS, file_bpm, loop_region, shot_region, region_beats,
  beat_to_sec, sec_to_beat, snap_beat, move_marker, arrow_beat, region_to_save, zero_cross, zero_cross_dir,
  first_hit, nudge_for_hit, mono_window, seam_window
} from "../helpers/region"
import { editor_key_ok, ARROW_TAKERS } from "../helpers/utils"
import WaveScreen from "./WaveScreen.vue"
import WaveLoupe from "./WaveLoupe.vue"
import LedButton from "./hw/LedButton.vue"
import Knob from "./hw/Knob.vue"
import Lcd from "./hw/Lcd.vue"

const props = defineProps({
  file: { type: Object, required: true },
  // beats del input del diálogo mientras se editan (antes de guardar); null = los del archivo
  beats: { type: Number, default: null },
  // diálogo abierto
  active: { type: Boolean, default: false },
})

const NUDGE_TITLE = "Nudge (ms): shifts the whole beat grid to the right (encoder silence at the start)"
const AUTO_TITLE = "Set the nudge to the first hit (amplitude threshold)"
const FADE_TITLE = "Fade in / out (ms) of the region: avoids clicks at the seam"
const SEAM_TITLE = "Seam: the end of the region joined to its start (what plays when it repeats); a click shows as a jump"
const START_ZOOM = 0.3 // s que muestra la lupa de inicio (el nudge llega a 250 ms)
const SEAM_HALF = 0.03 // s a cada lado de la costura
const ZERO_RADIUS = 0.005 // s: el SNAP de un shot busca un cruce por cero a no más de esto
const SNAP_KEY = "looper_editor_snap"

const editable = computed(() => !store.read_only)
const is_shot = computed(() => props.file.kind == "shot")
const duration = computed(() => Number(props.file.duration) || 0)

// --- SNAP: recordado en este navegador (localStorage puede no estar o fallar: queda prendido) ---
function read_snap() {
  try { return localStorage.getItem(SNAP_KEY) !== "0" } catch { return true }
}
const snap = ref(read_snap())
function toggle_snap() {
  snap.value = !snap.value
  try { localStorage.setItem(SNAP_KEY, snap.value ? "1" : "0") } catch { /* solo en memoria */ }
}
const snap_title = computed(() => is_shot.value
  ? "Snap: markers stick to the nearest zero crossing (hold Shift while dragging to invert)"
  : "Snap: markers stick to the beat lines (hold Shift while dragging to invert)")

// --- grilla de un loop: beats (los del input mientras se editan), largo del beat y nudge ---
const beats_now = computed(() => props.beats ?? Number(props.file.beats))
// bpm con que suena: el del archivo o, con beats sin guardar, deducido de beats y duración (como el backend)
const spb = computed(() => {
  let f = props.file
  let bpm = props.beats == null || props.beats == f.beats ? file_bpm(f)
    : file_bpm({ beats: props.beats, duration: f.duration })
  return bpm > 0 ? 60 / bpm : 0
})
const nudge_s = computed(() => is_shot.value ? 0 : (props.file.props.nudge ?? 0) / 1000)
// tope de los marcadores: los beats del loop o la duración del shot
const max_unit = computed(() => is_shot.value ? duration.value : beats_now.value)

// región mientras se arrastra (en beats o segundos), o null
const draft = ref(null)
// último marcador tocado ("start" | "stop"): lo mueven las flechas
const last_marker = ref(null)
watch(() => props.file, () => {
  draft.value = null
  last_marker.value = null
})

// región en las unidades del archivo (loop: beats; shot: s): la que se arrastra, la guardada o el archivo entero.
// null si no se puede editar (sin duración, o loop sin datos de tempo)
const region = computed(() => {
  if (!(duration.value > 0)) return null
  if (is_shot.value) return draft.value ?? shot_region(props.file.props, duration.value) ?? { start: 0, stop: duration.value }
  if (!(beats_now.value > 0) || !(spb.value > 0)) return null
  return draft.value ?? loop_region(props.file.props, beats_now.value) ?? { start: 0, stop: beats_now.value }
})
function to_sec(v) {
  return is_shot.value ? v : beat_to_sec(v, spb.value, nudge_s.value)
}
// lo que muestra la pantalla, en segundos (ver WaveScreen.vue)
const view = computed(() => {
  let r = region.value
  if (!r) return null
  return { start: to_sec(r.start), stop: to_sec(r.stop), nudge: nudge_s.value, spb: is_shot.value ? 0 : spb.value }
})

// --- largo de la región ---
function fmt(n, dec) {
  return String(Math.round(n * 10 ** dec) / 10 ** dec)
}
const fractional = computed(() => {
  let r = region.value
  if (!r || is_shot.value) return false
  let len = r.stop - r.start
  return Math.abs(len - Math.round(len)) > 1e-3
})
const len_text = computed(() => {
  let r = region.value
  let len = r.stop - r.start
  return is_shot.value ? `REGION ${fmt(len, 3)} S` : `REGION ${fmt(len, 2)} BEATS${fractional.value ? " ⚠" : ""}`
})
const len_title = computed(() => {
  let r = region.value
  if (is_shot.value) return "Length of the region (what the engine plays)"
  if (fractional.value) {
    let n = region_beats(r.start, r.stop)
    return `Not a whole number of beats: the engine plays it as ${n} beats (shorter leaves a gap, longer gets cut)`
  }
  return "Beats the region takes in the engine (the BPM does not change)"
})

// --- audio del archivo (para el SNAP de shots, AUTO y las lupas) ---
// canales (máximo 2) del buffer ya cargado, o null. audio_players no es reactivo: se relee al terminar la carga
const chans = computed(() => {
  void props.file.isLoaded
  void TrackCtrl.isReady
  let tb = audio_players[props.file.id]?.buffer
  let buf = tb?.loaded ? tb.get() : null
  if (!buf) return null
  let out = []
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) out.push(buf.getChannelData(c))
  return { data: out, sr: buf.sampleRate }
})
// cruce por cero más cercano a t (s), o en la dirección dir (canal izquierdo); sin audio, t
function zero_t(t, dir = 0) {
  let a = chans.value
  if (!a) return t
  let data = a.data[0]
  let i = Math.min(Math.max(0, t), duration.value) * a.sr
  let radius = Math.round(ZERO_RADIUS * a.sr)
  let k = dir ? zero_cross_dir(data, i, dir, radius) : zero_cross(data, i, radius)
  return k / a.sr
}

// --- edición de los marcadores ---
// largo mínimo: con SNAP en un loop, un beat
function min_len(snap_on) {
  return is_shot.value ? MIN_SHOT_SECS : snap_on ? 1 : MIN_LOOP_BEATS
}
function on_marker({ which, t, shift, done }) {
  let r = region.value
  if (!editable.value || !r) return
  // soltar sin haber arrastrado (clic para elegir el marcador de las flechas): no se mueve ni se re-pega
  if (done && !draft.value) return
  let snap_on = snap.value !== shift
  let v = is_shot.value ? (snap_on ? zero_t(t) : t) : snap_beat(sec_to_beat(t, spb.value, nudge_s.value), snap_on)
  draft.value = move_marker(r, which, v, max_unit.value, min_len(snap_on))
  if (done) commit_region()
}
// guarda la región que se arrastró (o movió con las flechas): el archivo entero no se guarda. Recalcula el
// tempo (los beats efectivos del loop) y guarda con el mismo debounce que el resto de las props
function commit_region() {
  let r = draft.value
  draft.value = null
  if (!r) return
  let f = props.file
  let key = is_shot.value ? "region_secs" : "region_beats"
  let save = region_to_save(r, max_unit.value)
  if (save) set_prop(f, key, save)
  else delete f.props[key]
  calculate_timing()
  save_file_debounced(f)
}
function set_prop(f, key, v) {
  f.props[key] = v
}
function save_props() {
  save_file_debounced(props.file)
}

// AUTO: nudge al primer golpe (umbral de amplitud, ver first_hit)
function auto_nudge() {
  let a = chans.value
  if (!a) return
  set_prop(props.file, "nudge", nudge_for_hit(first_hit(a.data, a.sr)))
  save_props()
}

// --- lupas ---
// inicio: los primeros START_ZOOM s con la línea del beat 0 (tras el nudge) en un loop; en un shot, alrededor
// del inicio de la región, con su línea
const start_loupe = computed(() => {
  let a = chans.value
  let v = view.value
  if (!a || !v) return { samples: null, marks: [], title: "" }
  let from = is_shot.value ? Math.max(0, v.start - 0.05) : 0
  let mark = is_shot.value ? v.start : v.nudge
  return {
    samples: mono_window(a.data, a.sr, from, START_ZOOM),
    marks: [(mark - from) / START_ZOOM],
    title: is_shot.value ? "Start of the region (zoomed)" : `First ${START_ZOOM * 1000} ms (zoomed) with beat 0 after the nudge`,
  }
})
// costura: el final de lo que suena de la región pegado a su inicio, con el fade (en un loop, lo que pasa de
// los beats de la tirada no suena: se corta ahí, como en el motor)
const seam_loupe = computed(() => {
  let a = chans.value
  let v = view.value
  let r = region.value
  if (!a || !v) return null
  let len = v.stop - v.start
  if (!is_shot.value) len = Math.min(r.stop - r.start, region_beats(r.start, r.stop)) * spb.value
  return seam_window(a.data, a.sr, { from: v.start, len, fade: (props.file.props.fade ?? 0) / 1000, half: SEAM_HALF })
})

// --- atajos: G = SNAP, ← / → = mueve el último marcador tocado ---
function on_key(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key == "g" || e.key == "G") {
    if (!editor_key_ok(e)) return
    e.preventDefault()
    if (!e.repeat) toggle_snap()
    return
  }
  if (e.key != "ArrowLeft" && e.key != "ArrowRight") return
  let r = region.value
  let which = last_marker.value
  if (!r || !which || !editor_key_ok(e, ARROW_TAKERS)) return
  e.preventDefault()
  let dir = e.key == "ArrowRight" ? 1 : -1
  let snap_on = snap.value !== e.shiftKey
  let v = is_shot.value
    ? (snap_on ? zero_t(r[which] + dir * 0.001, dir) : r[which] + dir * 0.001)
    : arrow_beat(r[which], dir, snap_on, spb.value)
  draft.value = move_marker(r, which, v, max_unit.value, min_len(snap_on))
  commit_region()
}
// solo con el editor abierto y si se puede editar
const listening = computed(() => props.active && editable.value)
watch(listening, on => {
  if (on) window.addEventListener("keydown", on_key)
  else window.removeEventListener("keydown", on_key)
}, { immediate: true })
onBeforeUnmount(() => window.removeEventListener("keydown", on_key))
</script>
<style scoped>
.region_editor {
  flex: 1 1 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.region_bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}

/* largo de la región: rótulo tipo LCD */
.region_len {
  min-width: 150px;
  padding: 4px 8px;
  border-radius: 3px;
  border: 2px solid #0b0b0c;
  background: linear-gradient(180deg, var(--hw_lcd_bg_hi), var(--hw_lcd_bg));
  color: var(--hw_lcd_ink);
  font-family: var(--font_mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
}

.region_len.warn {
  color: #7a1a0c;
}

/* placa chica: knob y LCD en fila */
.hw_plate.mini {
  flex-direction: row;
  padding: 6px 10px;
  gap: 8px;
}
</style>
