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
      <span class="num">BPM</span>
      <span class="num">Beats</span>
      <span class="state"></span>
    </div>
    <div v-for="item in items" :key="item.uid" class="row" :class="item.status">
      <span class="name" :title="item.name">
        {{ item.name }}
        <small class="meta">
          {{ fmt_mb(item.size) }}<template v-if="item.duration != null"> · {{ fmt_seconds(item.duration) }}</template>
        </small>
        <small v-if="item.duration != null && item.duration > MAX_SECONDS_FILE + 0.1" class="warn">
          dura más de 1 minuto: el servidor lo va a rechazar
        </small>
        <small v-if="item.error" class="err">{{ item.error }}</small>
      </span>
      <el-input-number v-model="item.bpm" class="num" size="small" :min="20" :max="400" :precision="2"
        :step="1" :controls="false" placeholder="—" :disabled="busy || item.status == 'done'" />
      <el-input-number v-model="item.beats" class="num" size="small" :min="1" :max="1024" :precision="0"
        :step="1" :controls="false" placeholder="—" :disabled="busy || item.status == 'done'" />
      <span class="state">
        <template v-if="item.status == 'uploading'">{{ item.progress < 100 ? item.progress + '%' : 'MP3…' }}</template>
        <template v-else-if="item.status == 'done'">OK</template>
        <el-button v-else size="small" text :disabled="busy" @click="removeItem(item)">✕</el-button>
      </span>
    </div>
    <div class="hint">BPM y beats son opcionales (se pueden dejar vacíos).</div>
  </div>

  <el-button class="upload_btn" type="success" v-if="pending_items.length > 0" :loading="busy"
    :disabled="quota_left <= 0" @click="doUpload">UPLOAD ({{ pending_items.length }})</el-button>
</template>

<script setup>
import { ref, computed } from 'vue'
import { UploadFilled } from '@element-plus/icons-vue'
import { store, store_get_user_info } from '../helpers/composable'
import { upload_file, error_text } from '../helpers/api'
import { ElMessage } from 'element-plus'

// mismos valores que el backend (routes/api.js): UPLOAD_MAX_MB, formatos y duración máxima
const MAX_UPLOAD_MB = 80
const MAX_SECONDS_FILE = 60
const EXTENSIONS = ["mp3", "wav", "ogg", "flac", "m4a", "aiff", "aif"]
const ACCEPT = EXTENSIONS.map(e => "." + e).join(",")
const FORMATS_TEXT = "mp3 / wav / ogg / flac / m4a / aiff"

const uploader = ref(null)
// archivos elegidos: { uid, raw, name, size, duration, bpm, beats, status, progress, error }
// status: "ready" | "uploading" | "done" | "error"
const items = ref([])
const busy = ref(false)

const quota = computed(() => store.u_info?.quota ?? null)
const quota_left = computed(() => quota.value ? quota.value.max_seconds - quota.value.used_seconds : Infinity)
const pending_items = computed(() => items.value.filter(i => i.status == "ready" || i.status == "error"))

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
  if (raw.size > 1024 * 1024 * MAX_UPLOAD_MB) return reject(`${name} supera los ${MAX_UPLOAD_MB} MB`)
  if (store.files.some(f => f.original_name == name)) return reject(`${name}: ya subiste un archivo con ese nombre`)
  if (items.value.some(i => i.name == name && i.status != "done")) return reject(`${name} ya está en la lista`)

  items.value.push({
    uid: upload_file_item.uid, raw: raw, name: name, size: raw.size, duration: null,
    bpm: null, beats: null, status: "ready", progress: 0, error: ""
  })
  // la reactividad pasa por el elemento del array (no por el objeto suelto)
  read_duration(items.value[items.value.length - 1])
}

// duración estimada en el navegador, solo informativa (si el navegador no decodifica el formato,
// por ejemplo aiff en algunos, queda sin dato y decide el backend)
function read_duration(item) {
  let url = URL.createObjectURL(item.raw)
  let audio = new Audio()
  let done = () => {
    URL.revokeObjectURL(url)
    audio.removeAttribute("src")
  }
  audio.preload = "metadata"
  audio.onloadedmetadata = () => {
    if (Number.isFinite(audio.duration)) item.duration = audio.duration
    done()
  }
  audio.onerror = done
  audio.src = url
}

function removeItem(item) {
  items.value = items.value.filter(i => i !== item)
}

// el backend acepta un archivo por request y una subida en curso por usuario: se envían de a uno
async function doUpload() {
  if (busy.value) return
  busy.value = true
  let ok = 0
  try {
    for (let item of pending_items.value) {
      item.status = "uploading"
      item.progress = 0
      item.error = ""
      try {
        let res = await upload_file(item.raw, { bpm: item.bpm, beats: item.beats }, p => { item.progress = p })
        if (res?.stat) {
          item.status = "done"
          ok++
          // la cuota se actualiza ya con la duración real (get_user_info la recalcula después)
          if (quota.value && res.data?.duration) quota.value.used_seconds += Number(res.data.duration)
        } else {
          item.status = "error"
          item.error = res?.text || "No se pudo subir"
        }
      } catch (e) {
        item.status = "error"
        item.error = error_text(e)
      }
    }
  } finally {
    busy.value = false
  }
  let failed = items.value.filter(i => i.status == "error").length
  // los subidos salen de la lista; los rechazados quedan con su error para corregir o quitar
  items.value = items.value.filter(i => i.status != "done")
  if (ok > 0) {
    ElMessage({ type: 'success', message: ok == 1 ? "Archivo subido" : `${ok} archivos subidos` })
    store_get_user_info()
  }
  if (failed > 0) reject(failed == 1 ? "Un archivo no se pudo subir" : `${failed} archivos no se pudieron subir`)
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
  grid-template-columns: minmax(0, 1fr) 84px 84px 52px;
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

.warn {
  color: var(--hw_yellow);
}

.err {
  color: var(--danger);
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
    grid-template-columns: minmax(0, 1fr) 64px 64px 40px;
    gap: 6px;
  }
}
</style>
