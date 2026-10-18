<template>
  <div class="edit_ops">
    <!-- selección y estado de la pila -->
    <span class="ops_lcd" :title="SEL_TITLE">{{ sel_text }}</span>
    <span class="ops_lcd state" :class="{ edited: edit.dirty }" :title="state_title">{{ state_text }}</span>

    <!-- operaciones sobre la selección (o todo el archivo donde tiene sentido) -->
    <span class="group">
      <LedButton size="small" text="CUT" :disabled="!ok('cut')" :title="op_title('cut')" @click="run('cut')" />
      <LedButton size="small" text="SILENCE" :disabled="!ok('silence')" :title="op_title('silence')" @click="run('silence')" />
      <LedButton size="small" text="DUPLICATE" :disabled="!ok('duplicate')" :title="op_title('duplicate')"
        @click="run('duplicate')" />
      <LedButton size="small" text="REVERSE" :disabled="!ok('reverse')" :title="op_title('reverse')" @click="run('reverse')" />
    </span>
    <div class="hw_plate mini" :title="GAIN_TITLE">
      <span class="silk">Gain</span>
      <Knob v-model="gain_db" :min="GAIN_MIN" :max="GAIN_MAX" :step="0.5" :size="40" :disabled="busy" />
      <Lcd small :digits="4" :value="gain_db > 0 ? '+' + gain_db : gain_db" unit="dB" />
      <LedButton size="small" text="GAIN" :disabled="!ok('gain') || gain_db == 0" :title="op_title('gain')"
        @click="run('gain')" />
    </div>
    <!-- STRETCH (fase 7): el loop entero a otro tempo sin cambiar el tono (Signalsmith); por defecto, el del proyecto -->
    <div v-if="file.kind != 'shot'" class="hw_plate mini" :title="stretch_title">
      <span class="silk">Stretch</span>
      <Knob v-model="stretch_bpm" :min="stretch_range.min" :max="stretch_range.max" :step="1" :size="40"
        :disabled="busy || !tempo_range" />
      <Lcd small :digits="3" :value="stretch_bpm" unit="BPM" />
      <LedButton size="small" text="STRETCH" :lit="edit.busy" :blink="edit.busy" :disabled="busy || !stretch_info.ok"
        :title="stretch_title" @click="do_stretch" />
    </div>
    <span class="group">
      <LedButton size="small" text="UNDO" :disabled="busy || edit.undo_n == 0" title="Undo the last edit (Ctrl+Z)"
        @click="undo" />
      <LedButton size="small" text="REDO" :disabled="busy || edit.redo_n == 0" title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
        @click="redo" />
    </span>
    <span class="group">
      <LedButton size="small" led="green" :lit="saving == 'copy'" :blink="saving == 'copy'" text="SAVE AS COPY"
        :disabled="busy || !can_copy" :title="copy_title" @click="save('copy')" />
      <LedButton size="small" led="green" :lit="saving == 'region'" :blink="saving == 'region'" text="SAVE SEL AS COPY"
        :disabled="busy || !edit.sel" :title="SEL_COPY_TITLE" @click="save('region')" />
    </span>
  </div>
</template>
<script setup>
// Ediciones destructivas del editor (docs/PLAN_EDITOR.md, fase 6; decisión 9): la barra con la selección, CUT /
// SILENCE / DUPLICATE / REVERSE / GAIN, UNDO / REDO y SAVE AS COPY / SAVE SEL(ECTION) AS COPY, más sus atajos (Supr o
// Backspace = CUT, Ctrl+D = DUPLICATE, R = REVERSE, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y). La pila y el buffer de
// trabajo viven en helpers/edit_session.js; las cuentas, en helpers/edit_ops.js. La selección se marca en la
// pantalla de onda (RegionEditor.vue). FileEditor.vue no la monta en store.read_only.
// Guardar: el render sale directo del buffer de trabajo (no hay procesamiento de Tone que aplicar: volumen y fade
// quedan como props del proyecto), se codifica a WAV float y se sube por POST /upload con parent_id, sin
// normalizar (se guarda lo que se escuchó). SAVE AS COPY reemplaza al archivo en el proyecto (emite "replaced" con
// la copia: el editor pasa a mostrarla); SAVE SEL AS COPY agrega la selección al lado, con la misma pista y tags.
// STRETCH (fase 7): el loop entero al BPM del knob (por defecto el del proyecto) sin cambiar el tono; el render va al
// Worker de Signalsmith y mientras tanto la barra queda ocupada. En la copia los beats se conservan y el backend
// deduce el BPM nuevo de beats y duración.
import { ref, computed, watch, onBeforeUnmount } from "vue"
import { ElMessage, ElMessageBox } from "element-plus"
import { store, add_project_file } from "../helpers/composable"
import { TrackCtrl } from "../helpers/TrackCtrl"
import { upload_file, error_text } from "../helpers/api"
import * as toneLib from "../helpers/toneLib"
import { is_previewing } from "../helpers/file_ui"
import { editor_key_ok } from "../helpers/utils"
import { bake_region, file_bpm, loop_region, shot_region, parse_nudge } from "../helpers/region"
import { stretch_bpm_range, STRETCH_BPM_MIN, STRETCH_BPM_MAX } from "../helpers/transpose"
import {
  GAIN_MIN, GAIN_MAX, copy_plan, selection_plan, copy_props, copy_name, strip_ext, encode_wav, peak, gain_to_db
} from "../helpers/edit_ops"
import {
  edit, can_do, edit_do, edit_undo, edit_redo, work_file, current_chans, stretch_check, edit_stretch
} from "../helpers/edit_session"
import LedButton from "./hw/LedButton.vue"
import Knob from "./hw/Knob.vue"
import Lcd from "./hw/Lcd.vue"

const props = defineProps({
  file: { type: Object, required: true }, // archivo del proyecto que se edita
  active: { type: Boolean, default: false }, // editor abierto (atajos)
})
const emit = defineEmits(["replaced"])

// mismos límites que el backend: 1 minuto por archivo
const MAX_SECONDS = 60
const NAME_MAX = 120
const SEL_TITLE = "Selection: drag on the waveform outside the markers (SNAP: beats in loops, zero crossings in shots; "
  + "Shift inverts). A click or Esc clears it; ← / → move its last touched edge"
const GAIN_TITLE = "Gain (dB) to apply with GAIN to the selection, or to the whole file without one"
const SEL_COPY_TITLE = "Save the selection as a new copy next to this file (same track and tags; this file stays)"
const OP_TEXT = {
  cut: "CUT (Del / Backspace): removes the selection (shortens the file)",
  silence: "SILENCE: the selection to silence (same length)",
  duplicate: "DUPLICATE (Ctrl+D): repeats the selection right after it (or the whole file without one)",
  reverse: "REVERSE (R): reverses the selection (or the whole file)",
  gain: "GAIN: applies the knob's dB to the selection (or the whole file)",
}

const gain_db = ref(-3)
// "copy" | "region" mientras se guarda; null si no
const saving = ref(null)
const loaded = computed(() => !!props.file.isLoaded)
const busy = computed(() => !!saving.value || !loaded.value || edit.busy)

function ok(type) {
  return !busy.value && can_do(type)
}
function op_title(type) {
  if (!loaded.value) return OP_TEXT[type] + " (loading…)"
  if (!can_do(type)) {
    if (type == "cut" && edit.sel) return OP_TEXT[type] + ". The selection is the whole file"
    if (type == "cut" || type == "silence") return OP_TEXT[type] + ". Select a range first"
    if (type == "duplicate") return OP_TEXT[type] + ". Too long (2 minutes max while editing)"
  }
  return OP_TEXT[type]
}

// --- rótulos ---
function fmt(n, dec) {
  return String(Math.round(n * 10 ** dec) / 10 ** dec)
}
const spb = computed(() => {
  let bpm = props.file.kind == "shot" ? 0 : file_bpm(props.file)
  return bpm > 0 ? 60 / bpm : 0
})
const sel_text = computed(() => {
  let s = edit.sel
  if (!s) return "NO SELECTION"
  let len = s.stop - s.start
  return spb.value > 0 ? `SEL ${fmt(len / spb.value, 2)} BEATS` : `SEL ${fmt(len, 3)} S`
})
const state_text = computed(() => edit.busy ? "STRETCHING…"
  : edit.dirty ? `EDITED · ${edit.undo_n} STEP${edit.undo_n == 1 ? "" : "S"}` : "ORIGINAL")
const state_title = computed(() => edit.dirty
  ? "Destructive edits not saved yet: the waveform and the preview use the edited audio; the engine still plays "
    + "the original. SAVE AS COPY keeps them (the original is never overwritten)"
  : "No destructive edits")

// SAVE AS COPY: con cambios, o sin cambios si hay región / nudge para hornear (si no, sería una copia igual)
const can_copy = computed(() => {
  if (edit.dirty) return true
  let f = props.file
  if (f.kind == "shot") return !!shot_region(f.props, f.duration)
  return !!loop_region(f.props, f.beats) || parse_nudge(f.props?.nudge) > 0
})
const copy_title = computed(() => "Save as a new copy that replaces this file in the project (track, tags, volume, "
  + "weight, repeat and fade carry over; the region is baked so the copy starts on beat 0). The original stays in the "
  + "catalog" + (can_copy.value ? "" : ". Nothing to save: no edits and no region"))

// --- operaciones ---
// con el preview de este archivo sonando, vuelve a arrancar con el buffer nuevo
function after_change() {
  if (is_previewing(props.file)) toneLib.playFile(props.file)
}
function run(type) {
  if (!ok(type)) return
  if (edit_do(type, { db: gain_db.value })) after_change()
}
function undo() {
  if (!busy.value && edit_undo()) after_change()
}
function redo() {
  if (!busy.value && edit_redo()) after_change()
}

// --- STRETCH (fase 7): tempo sin cambiar el tono ---
// BPM destino; al abrir otro archivo vuelve al tempo del proyecto (dentro del rango posible)
const stretch_bpm = ref(TrackCtrl.tempo)
const stretch_info = computed(() => stretch_check(props.file, stretch_bpm.value))
// rango del knob: hasta ×2 / ×½ del tempo actual (el del buffer de trabajo si ya hubo un STRETCH). Sin datos de tempo,
// uno cualquiera: el knob queda deshabilitado
const tempo_range = computed(() => stretch_bpm_range(file_bpm(work_file(props.file) ?? props.file)))
const stretch_range = computed(() => tempo_range.value ?? { min: STRETCH_BPM_MIN, max: STRETCH_BPM_MAX })
watch(() => props.file.id, () => {
  let r = stretch_range.value
  stretch_bpm.value = Math.min(r.max, Math.max(r.min, TrackCtrl.tempo))
}, { immediate: true })
const STRETCH_TEXT = "STRETCH: changes the tempo of the whole loop to the knob's BPM without changing its pitch (the "
  + "project tempo by default). The beats stay; the copy gets the new BPM"
const stretch_title = computed(() => {
  let s = stretch_info.value
  if (!loaded.value) return STRETCH_TEXT + " (loading…)"
  if (s.ok) return `${STRETCH_TEXT}. Now ${fmt(s.bpm, 2)} BPM → ${stretch_bpm.value} BPM`
  let why = {
    busy: "Rendering…", no_tempo: "The loop has no tempo data", same: "It is already at that tempo",
    range: "Out of range: up to ×2 or ×½ of its tempo", long: "Too long (2 minutes max while editing)",
  }[s.reason]
  return STRETCH_TEXT + (why ? ". " + why : "")
})
async function do_stretch() {
  if (busy.value || !stretch_info.value.ok) return
  try {
    if (await edit_stretch(props.file, stretch_bpm.value)) after_change()
  } catch (e) {
    console.log("Error en STRETCH", e)
    fail("STRETCH failed: " + (e?.message ?? e))
  }
}

// --- guardar como copia ---
function fmt_seconds(s) {
  s = Math.max(0, Math.round(s))
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0")
}
function fail(text) {
  ElMessage({ type: "error", message: text, duration: 6000 })
}
// mode: "copy" (SAVE AS COPY: la región del proyecto horneada, reemplaza al archivo) | "region" (la selección, al lado)
async function save(mode) {
  let f = props.file
  if (busy.value || !store.project) return
  let cur = current_chans(f.id)
  if (!cur) return fail("The audio is not loaded")
  let dur = cur.chans[0].length / cur.sr
  let wf = work_file(f) ?? f
  let plan = mode == "copy" ? copy_plan(wf, dur) : edit.sel ? selection_plan(wf, edit.sel) : null
  if (!plan || !(plan.len > 0.001)) return fail("Nothing to save: the region is empty")
  // límites antes de renderizar y subir (el backend los vuelve a chequear)
  if (plan.total > MAX_SECONDS + 1e-6) {
    return fail(`The copy would last ${fmt_seconds(plan.total)}: the maximum is 1 minute per file`)
  }
  let q = store.u_info?.quota
  if (q && plan.total > q.max_seconds - q.used_seconds) {
    return fail(`Not enough quota: ${fmt_seconds(q.max_seconds - q.used_seconds)} left and the copy lasts ${fmt_seconds(plan.total)}`)
  }
  let chans = bake_region(cur.chans, cur.sr, { from: plan.from, len: plan.len, total: plan.total })
  let pk = peak(chans)
  // nombre (editable) y aviso de pico: no se limita en silencio
  let taken = new Set(store.files.map(x => strip_ext(x.original_name).toLowerCase()))
  let over = pk > 1
  let message = (mode == "copy" ? "The copy replaces this file in the project. " : "The copy is added next to this file. ")
    + `Length ${fmt(plan.total, 2)} s${plan.beats ? ` (${plan.beats} beats, ${fmt(plan.beats * 60 / plan.total, 2)} BPM)` : ""}.`
    + (over ? ` Warning: its peak is +${fmt(gain_to_db(pk), 1)} dBFS (over 0 dB). It is saved as heard, not limited: `
      + "lower it with GAIN first if you do not want that." : "")
  let name
  try {
    let r = await ElMessageBox.prompt(message, mode == "copy" ? "Save as copy" : "Save selection as copy", {
      inputValue: copy_name(f.original_name, taken), confirmButtonText: "Save", cancelButtonText: "Cancel",
      type: over ? "warning" : undefined,
      inputValidator: v => (v.trim().length >= 1 && v.trim().length <= NAME_MAX) || `1 to ${NAME_MAX} characters`,
    })
    name = r.value.trim()
  } catch {
    return
  }
  saving.value = mode
  try {
    let wav = new File([encode_wav(chans, cur.sr)], name + ".wav", { type: "audio/wav" })
    let res = await upload_file(wav, {
      kind: f.kind, beats: plan.beats, music_key: f.music_key ?? "", anchor: f.anchor ?? "start",
      project_id: store.project.id, parent_id: f.id, normalize: false,
      replace_file_id: mode == "copy" ? f.id : undefined, copy_from_file_id: mode == "region" ? f.id : undefined,
      props: copy_props(f.props, plan.anchor),
    })
    if (!res?.stat) return fail(res?.text || "The copy could not be saved")
    // la cuota se actualiza ya (get_user_info la recalcula en la próxima carga)
    if (q && res.data?.duration) q.used_seconds += Number(res.data.duration)
    if (mode == "copy") {
      // el preview del original se corta: el editor pasa a la copia
      if (is_previewing(f)) toneLib.playerStop()
      let nf = await add_project_file(res.data, { replace: f })
      if (nf) emit("replaced", nf)
    } else {
      await add_project_file(res.data, { near: f })
    }
    ElMessage({ type: "success", message: `${res.data.original_name} saved` })
  } catch (e) {
    fail(error_text(e))
  } finally {
    saving.value = null
  }
}

// --- atajos (docs/PLAN_EDITOR.md, decisión 11; reglas de foco de editor_key_ok): Supr / Backspace = CUT, Ctrl+D =
// DUPLICATE, R = REVERSE, Ctrl+Z = UNDO, Ctrl+Shift+Z / Ctrl+Y = REDO. Esc (selección / cerrar) está en FileEditor.vue
function on_key(e) {
  if (e.altKey) return
  let k = e.key?.toLowerCase()
  let ctrl = e.ctrlKey || e.metaKey
  let action = null
  if (ctrl && k == "z") action = e.shiftKey ? redo : undo
  else if (ctrl && !e.shiftKey && k == "y") action = redo
  else if (ctrl && !e.shiftKey && k == "d") action = () => run("duplicate")
  else if (!ctrl && (k == "delete" || k == "backspace")) action = () => run("cut")
  else if (!ctrl && !e.shiftKey && k == "r") action = () => run("reverse")
  if (!action || !editor_key_ok(e)) return
  e.preventDefault()
  if (e.repeat) return
  action()
}
watch(() => props.active, on => {
  if (on) window.addEventListener("keydown", on_key)
  else window.removeEventListener("keydown", on_key)
}, { immediate: true })
onBeforeUnmount(() => window.removeEventListener("keydown", on_key))
</script>
<style scoped>
.edit_ops {
  flex: 1 1 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  padding-top: 10px;
  border-top: 1px solid rgba(228, 225, 216, 0.14);
}

.group {
  display: inline-flex;
  gap: 6px;
  align-items: flex-end;
}

/* rótulos tipo LCD, como el largo de la región (RegionEditor.vue) */
.ops_lcd {
  min-width: 120px;
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

.ops_lcd.state {
  min-width: 0;
  opacity: 0.7;
}

.ops_lcd.state.edited {
  opacity: 1;
  color: #7a1a0c;
}

.hw_plate.mini {
  flex-direction: row;
  padding: 6px 10px;
  gap: 8px;
}
</style>
