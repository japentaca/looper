<template>
  <!-- cuota de audio restante (u_info.quota: la calcula el backend con el default de .env resuelto) -->
  <div v-if="quota" class="quota" :class="{ empty: quota_left <= 0 }">
    <template v-if="quota_left > 0">
      Te quedan <b>{{ fmt_seconds(quota_left) }}</b> de audio (de {{ fmt_seconds(quota.max_seconds) }})
    </template>
    <template v-else>Llegaste a tu cuota de {{ fmt_seconds(quota.max_seconds) }} de audio</template>
  </div>

  <!-- el-upload solo para elegir archivos (drag o diálogo): la lista y el envío los maneja este componente -->
  <el-upload ref="uploader" drag multiple :auto-upload="false" :show-file-list="false" :accept="ACCEPT"
    :disabled="busy" :on-change="onFileChosen">
    <el-icon class="el-icon--upload">
      <upload-filled />
    </el-icon>
    <div class="el-upload__text">
      Drop files here or <em>Select files</em>
    </div>
    <template #tip>
      <div class="el-upload__tip">
        {{ FORMATS_TEXT }} · máximo 1 minuto y {{ MAX_UPLOAD_MB }} MB por archivo. Se convierten a MP3.
      </div>
    </template>
  </el-upload>

  <div v-if="items.length > 0" class="queue">
    <div class="row head">
      <span class="name">File</span>
      <span class="num">Type</span>
      <span class="num">Beats</span>
      <span class="num">Key</span>
      <span class="num">Anchor</span>
      <span class="state"></span>
    </div>
    <div v-for="item in items" :key="item.uid" class="row" :class="item.status">
      <span class="name" :title="item.name">
        {{ item.name }}
        <small class="meta">
          {{ fmt_mb(item.size) }}<template v-if="item.duration != null"> · {{ fmt_seconds(item.duration) }}</template>
        </small>
        <small v-if="item_problem(item)" class="err">No se va a subir: {{ item_problem(item) }}</small>
        <small v-else-if="item.error" class="err">No se subió: {{ item.error }}</small>
        <small v-if="item.unreadable" class="warn">
          El navegador no pudo leerlo (duración y beats sin sugerencia): lo revisa el servidor al subirlo
        </small>
        <small v-if="over_quota.has(item.uid)" class="warn">
          Probablemente no entre en tu cuota (te quedan {{ fmt_seconds(quota_left) }} para lo que está en la lista)
        </small>
      </span>
      <el-select v-model="item.kind" class="num" size="small" :disabled="busy || item.status == 'done'">
        <el-option label="Loop" value="loop" />
        <el-option label="Shot" value="shot" />
      </el-select>
      <span class="num">
        <el-input-number v-if="item.kind == 'loop'" v-model="item.beats" class="num" size="small" :min="1"
          :max="1024" :precision="0" :step="1" :controls="false" placeholder="—"
          :disabled="busy || item.status == 'done'" />
        <small v-if="item.kind == 'loop' && item_bpm(item)" class="meta">
          {{ item_bpm(item) }} BPM<span v-if="is_detected(item)" class="auto"
            :title="`Detectado en el audio (confianza ${Math.round(item.detected.confidence * 100)} %)`"> · auto</span>
        </small>
      </span>
      <span class="num">
        <el-select v-model="item.music_key" class="num" size="small" filterable placeholder="—"
          :disabled="busy || item.status == 'done'">
          <el-option v-for="o in KEY_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <small v-if="item.music_key && item.music_key === item.key_auto" class="meta auto"
          title="Sugerida por el nombre del archivo">auto</small>
      </span>
      <el-select v-model="item.anchor" class="num" size="small" :disabled="busy || item.status == 'done'">
        <el-option label="Start" value="start" />
        <el-option label="End" value="end" />
      </el-select>
      <span class="state">
        <template v-if="item.status == 'uploading'">{{ item.progress < 100 ? item.progress + '%' : 'MP3…' }}</template>
        <template v-else-if="item.status == 'done'">OK</template>
        <el-button v-else size="small" text :disabled="busy" @click="removeItem(item)">✕</el-button>
      </span>
    </div>
    <div class="hint">
      Loop: se ajusta al tempo del proyecto; poné cuántos beats dura (el BPM sale de ahí). Viene una
      sugerencia según la duración o, si se detecta el pulso en el audio, marcada "auto". Shot: sample suelto, suena a su velocidad original (solo en pistas one-shot).
      Key: tonalidad (sirve para filtrar); "atonal" para percusión o ruidos. Si el nombre la trae, viene marcada "auto".
      Anchor (pistas one-shot): Start = el archivo empieza en el punto de disparo; End = termina en él (riser, crash invertido).
    </div>
  </div>

  <el-button class="upload_btn" type="success" v-if="pending_items.length > 0" :loading="busy"
    :disabled="quota_left <= 0 || sendable_items.length == 0" @click="doUpload">UPLOAD ({{ sendable_items.length }})</el-button>
</template>

<script setup>
import { ref, computed } from 'vue'
import { UploadFilled } from '@element-plus/icons-vue'
import { store, store_get_user_info } from '../helpers/composable'
import { upload_file, error_text } from '../helpers/api'
import { TrackCtrl, suggest_timing } from '../helpers/TrackCtrl'
import { detect_beats } from '../helpers/bpm_detect'
import { suggest_key, KEY_OPTIONS } from '../helpers/music_key'
import { ElMessage } from 'element-plus'

// mismos valores que el backend (routes/api.js): UPLOAD_MAX_MB, formatos, duración máxima y rango de BPM
const MAX_UPLOAD_MB = 80
const MAX_SECONDS_FILE = 60
const BPM_MIN = 20
const BPM_MAX = 400
const EXTENSIONS = ["mp3", "wav", "ogg", "flac", "m4a", "aiff", "aif"]
const ACCEPT = EXTENSIONS.map(e => "." + e).join(",")
const FORMATS_TEXT = "mp3 / wav / ogg / flac / m4a / aiff"

const uploader = ref(null)
// archivos elegidos: { uid, raw, name, size, duration, kind, beats, beats_auto, detected, music_key, key_auto,
// anchor, status, progress, error, unreadable }
// beats_auto = los beats que sugirió la app (si beats sigue igual, el usuario no los tocó);
// detected = { beats, bpm, confidence } de detect_beats; music_key = tonalidad ("" = sin dato) y key_auto
// la que sugirió el nombre (suggest_key); anchor = "start" | "end" (anclaje de los disparos one-shot)
// status: "ready" | "uploading" | "done" | "error"; unreadable = el navegador no pudo leer su duración
const items = ref([])
const busy = ref(false)

const quota = computed(() => store.u_info?.quota ?? null)
const quota_left = computed(() => quota.value ? quota.value.max_seconds - quota.value.used_seconds : Infinity)
const pending_items = computed(() => items.value.filter(i => i.status == "ready" || i.status == "error"))
// los que se mandan con UPLOAD: los pendientes sin un problema que el backend rechazaría (item_problem)
const sendable_items = computed(() => pending_items.value.filter(i => !item_problem(i)))
// uid de los que, en el orden de subida, ya no entrarían en la cuota que queda (con la duración que
// estimó el navegador: es un aviso, la cuenta exacta la hace el backend)
const over_quota = computed(() => {
  let left = quota_left.value
  let out = new Set()
  for (let i of sendable_items.value) {
    if (i.duration == null) continue
    left -= i.duration
    if (left < 0) out.add(i.uid)
  }
  return out
})

function fmt_seconds(s) {
  s = Math.max(0, Math.floor(s))
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0")
}
function fmt_mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + " MB"
}
function extension(name) {
  let i = name.lastIndexOf(".")
  return i < 0 ? "" : name.slice(i + 1).toLowerCase()
}

function reject(text) {
  ElMessage({ type: 'error', message: text })
}

// cada archivo elegido pasa por los chequeos baratos del cliente; el backend vuelve a validar todo
function onFileChosen(upload_file_item) {
  let raw = upload_file_item.raw
  // el-upload guarda su propia lista aunque no la muestre: se vacía para no acumular
  uploader.value?.clearFiles()
  if (!raw) return
  let name = raw.name
  if (!EXTENSIONS.includes(extension(name))) return reject(`${name}: formato no aceptado (${FORMATS_TEXT})`)
  if (raw.size == 0) return reject(`${name} está vacío (0 bytes)`)
  if (raw.size > 1024 * 1024 * MAX_UPLOAD_MB) return reject(`${name} supera los ${MAX_UPLOAD_MB} MB`)
  if (store.files.some(f => f.original_name == name)) return reject(`${name}: ya subiste un archivo con ese nombre`)
  if (items.value.some(i => i.name == name && i.status != "done")) return reject(`${name} ya está en la lista`)

  let key = suggest_key(name) ?? ""
  items.value.push({
    uid: upload_file_item.uid, raw: raw, name: name, size: raw.size, duration: null,
    kind: "loop", beats: null, beats_auto: null, detected: null, music_key: key, key_auto: key, anchor: "start",
    status: "ready", progress: 0, error: "", unreadable: false
  })
  // la reactividad pasa por el elemento del array (no por el objeto suelto)
  read_duration(items.value[items.value.length - 1])
}

// duración estimada en el navegador, informativa y para sugerir tipo y beats (si el navegador no
// decodifica el formato, por ejemplo aiff en algunos, queda sin dato: sin beats, el backend usa el
// tempo del proyecto)
function read_duration(item) {
  let url = URL.createObjectURL(item.raw)
  let audio = new Audio()
  let done = () => {
    // sin onerror: soltar el src no tiene que marcarlo como ilegible
    audio.onerror = null
    URL.revokeObjectURL(url)
    audio.removeAttribute("src")
  }
  audio.preload = "metadata"
  audio.onloadedmetadata = () => {
    if (!Number.isFinite(audio.duration)) item.unreadable = true
    else {
      item.duration = audio.duration
      // sugerencia de tipo y beats con el tempo del proyecto (si el usuario todavía no cargó beats);
      // si parece un loop, después se intenta detectar los beats en el audio
      if (item.beats == null) {
        Object.assign(item, suggest_timing(item.duration, TrackCtrl.tempo))
        item.beats_auto = item.beats
        if (item.kind == "loop" && item.duration <= MAX_SECONDS_FILE + 0.1) queue_detect(item)
      }
    }
    done()
  }
  audio.onerror = () => {
    item.unreadable = true
    done()
  }
  audio.src = url
}

// detección de beats en el audio (helpers/bpm_detect.js), de a un archivo por vez para no cargar el
// navegador. Solo reemplaza la sugerencia por duración si el usuario no tocó tipo ni beats
let detect_chain = Promise.resolve()
function queue_detect(item) {
  detect_chain = detect_chain.then(() => detect_item(item)).catch(e => console.warn("detect_beats", e))
}
async function detect_item(item) {
  if (!items.value.includes(item) || item.status != "ready") return
  // OfflineAudioContext decodifica sin necesitar un gesto del usuario (no toca el contexto de Tone)
  let buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await item.raw.arrayBuffer())
  let res = await detect_beats(buffer, { duration: item.duration, tempo: TrackCtrl.tempo })
  if (!res || item.status != "ready" || item.kind != "loop" || item.beats !== item.beats_auto) return
  item.beats = res.beats
  item.beats_auto = res.beats
  item.detected = res
}
function is_detected(item) {
  return item.detected != null && item.beats === item.detected.beats
}

// bpm que da el loop con sus beats (el backend lo recalcula con la duración exacta de ffprobe)
function item_bpm(item) {
  if (!(item.duration > 0) || !(item.beats > 0)) return ""
  return String(Math.round(item.beats * 60 / item.duration * 10) / 10)
}

// motivo por el que un archivo no se manda (el backend lo rechazaría) o "": se muestra en su fila y
// UPLOAD lo saltea hasta que se corrija. Con la duración que estimó el navegador (sin ella, no se juzga)
function item_problem(item) {
  if (item.duration != null && item.duration > MAX_SECONDS_FILE + 0.1) {
    return `dura ${item.duration.toFixed(1)} s y el máximo es 1 minuto; recortalo antes de subirlo`
  }
  let bpm = item.kind == "loop" ? Number(item_bpm(item)) : 0
  if (bpm && (bpm < BPM_MIN || bpm > BPM_MAX)) {
    return `con ${item.beats} beats queda en ${bpm} BPM y tiene que estar entre ${BPM_MIN} y ${BPM_MAX}; ` +
      "corregí los beats o, si es un golpe suelto, elegí Shot"
  }
  return ""
}

function removeItem(item) {
  items.value = items.value.filter(i => i !== item)
}

// el backend acepta un archivo por request y una subida en curso por usuario: se envían de a uno
async function doUpload() {
  if (busy.value) return
  busy.value = true
  let ok = 0
  let failed = []
  try {
    for (let item of sendable_items.value.slice()) {
      item.status = "uploading"
      item.progress = 0
      item.error = ""
      try {
        let res = await upload_file(item.raw, {
          kind: item.kind, beats: item.kind == "loop" ? item.beats : null, music_key: item.music_key ?? "",
          anchor: item.anchor ?? "start", project_id: store.project?.id
        }, p => { item.progress = p })
        if (res?.stat) {
          item.status = "done"
          ok++
          // la cuota se actualiza ya con la duración real (get_user_info la recalcula después)
          if (quota.value && res.data?.duration) quota.value.used_seconds += Number(res.data.duration)
        } else {
          item.status = "error"
          item.error = res?.text || "el servidor no dijo por qué"
          failed.push(item)
        }
      } catch (e) {
        item.status = "error"
        item.error = error_text(e)
        failed.push(item)
      }
    }
  } finally {
    busy.value = false
  }
  // los subidos salen de la lista; los rechazados quedan con su error para corregir o quitar
  items.value = items.value.filter(i => i.status != "done")
  if (ok > 0) {
    ElMessage({ type: 'success', message: ok == 1 ? "Archivo subido" : `${ok} archivos subidos` })
    store_get_user_info()
  }
  if (failed.length == 1) reject(`${failed[0].name} no se pudo subir: ${failed[0].error}`)
  else if (failed.length > 1) reject(`${failed.length} archivos no se pudieron subir: el motivo está en cada fila`)
}
</script>

<style scoped>
.quota {
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 13px;
}

.quota b {
  color: var(--accent);
}

.quota.empty {
  color: var(--danger);
}

.queue {
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel);
  padding: 6px 10px;
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 84px 84px 84px 76px 52px;
  gap: 8px;
  align-items: center;
  padding: 4px 0;
}

.row + .row {
  border-top: 1px solid var(--border);
}

.row.head {
  color: var(--muted);
  font-size: 12px;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name small {
  display: block;
  white-space: normal;
}

.meta {
  color: var(--muted);
}

.auto {
  color: var(--accent);
  cursor: help;
}

.warn {
  color: var(--hw_yellow);
}

.err {
  color: var(--danger);
  font-weight: 600;
}

.num {
  width: 100%;
}

.state {
  text-align: right;
  font-size: 12px;
  color: var(--muted);
}

.row.done .state {
  color: var(--accent);
}

.hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}

.upload_btn {
  margin-top: 10px;
}

@media (max-width: 600px) {
  .row {
    grid-template-columns: minmax(0, 1fr) 64px 64px 64px 64px 40px;
    gap: 6px;
  }
}
</style>
