<template>
  <!-- proyecto público (/p/:id) en modo lectura: START/STOP, tempo y mixer local (volumen, mute, solo).
    Nada se guarda (store.read_only, ver composable.js). Funciona con o sin sesión; si el visitante es
    el dueño igual es modo lectura, con un link para abrirlo en el editor -->
  <div class="page">
    <PublicBar>
      <Lcd v-if="info" small :digits="0">
        <span class="project_name" :title="info.name">{{ info.name }}</span>
        <span class="project_vis">READ ONLY</span>
      </Lcd>
      <!-- LED de estado: amarillo cargando los audios, verde listo -->
      <div v-if="info" class="status">
        <Led :color="TrackCtrl.isReady ? 'green' : 'yellow'" :lit="true" />
        <span class="silk">{{ TrackCtrl.isReady ? "Ready" : "Loading" }}</span>
        <span v-if="!TrackCtrl.isReady && store.load_progress.total > 0" class="silk dim">{{ store.load_progress.done
          }}/{{ store.load_progress.total }}</span>
      </div>
      <a v-if="is_owner" class="silk link" href="/" title="Abrir este proyecto en el editor"
        @click="remember_project(info.id)">OPEN IN EDITOR</a>
      <!-- denunciar: solo con sesión y si el proyecto no es del visitante -->
      <button v-if="info && logged && !is_owner" class="silk link report" title="Report this project"
        @click="report_visible = true">REPORT</button>
    </PublicBar>

    <main v-loading="loading" class="main">
      <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon />

      <section v-if="info" class="hw_panel info">
        <div class="row">
          <span class="silk">Creator</span>
          <span class="value">{{ info.creator.name }}</span>
          <span class="silk">Loops</span>
          <span class="value">{{ info.files }}</span>
        </div>
        <p v-if="info.creator.bio" class="bio">{{ info.creator.bio }}</p>
        <div v-if="store.tags.length" class="row">
          <span class="silk">Tags</span>
          <span v-for="tag in store.tags" :key="tag.id" class="chip" :style="{ background: tag.color }">{{
            tag.name }}</span>
        </div>
        <p class="hint">Read-only: you can play, change the tempo and mix the tracks, but nothing is saved.</p>
      </section>

      <Tracks v-if="info" class="tracks" />
    </main>
    <ReportDialog v-model="report_visible" :target="info ? { type: 'project', id: info.id, name: info.name } : null" />
  </div>
</template>

<script setup>
import { ref, watch, onBeforeUnmount } from "vue"
import { useRoute } from "vue-router"
import PublicBar from "../components/PublicBar.vue"
import Tracks from "../components/Tracks.vue"
import Lcd from "../components/hw/Lcd.vue"
import Led from "../components/hw/Led.vue"
import ReportDialog from "../components/ReportDialog.vue"
import { get_user_info } from "../helpers/api"
import {
  store, load_public_project, unload_public_project, remember_project
} from "../helpers/composable"
import { TrackCtrl, stop_transport } from "../helpers/TrackCtrl"

const route = useRoute()

// datos para mostrar (lo que suena vive en el store): { id, name, creator: { name, bio }, files }
const info = ref(null)
const loading = ref(false)
const error = ref("")
const is_owner = ref(false)
const logged = ref(false)
const report_visible = ref(false)

// el router reusa este componente si cambia solo el :id, por eso se observa el parámetro.
// Antes de cargar otro proyecto se hace STOP (el motor quedaría sonando con los archivos del anterior)
let load_n = 0
// instalación (?autostart=1, docs/INSTALACION.md): si la carga falla por algo pasajero (sin red,
// backend caído o reiniciando, 429) se reintenta sola con backoff (5 s, 10 s, 20 s... tope 60 s, sin
// límite), porque en un kiosko no hay nadie para recargar. Un 404 (privado, oculto, borrado) no se reintenta.
const AUTOSTART = new URLSearchParams(window.location.search).get("autostart") == "1"
const RETRY_MAX_DELAY_MS = 60000
let retry_timer = null
let retry_tries = 0
function is_retryable(status) {
  return status == 0 || status == 429 || status >= 500
}
async function load(id, retry = false) {
  let n = ++load_n
  clearTimeout(retry_timer)
  retry_timer = null
  if (!retry) retry_tries = 0
  stop_transport()
  TrackCtrl.current_TAG.tag = null
  info.value = null
  error.value = ""
  is_owner.value = false
  logged.value = false
  report_visible.value = false
  loading.value = true
  let res = await load_public_project(id)
  if (n != load_n) return // llegó otro :id mientras cargaba
  loading.value = false
  if (!res.ok) {
    if (res.status == 404) error.value = "Project not found (it may have been removed or is no longer available)."
    else if (res.status == 429) error.value = "Too many requests: try again in a minute."
    else error.value = res.text
    if (AUTOSTART && is_retryable(res.status)) {
      let delay = Math.min(RETRY_MAX_DELAY_MS, 5000 * Math.pow(2, retry_tries++))
      error.value = error.value.replace(/[.\s]*$/, ".") + ` Retrying in ${Math.round(delay / 1000)} s...`
      retry_timer = setTimeout(() => { if (n == load_n) load(id, true) }, delay)
    }
    return
  }
  info.value = {
    id: store.project.id, name: store.project.name, creator: res.creator, files: store.files.length
  }
  check_owner(id, n)
}

// si hay sesión y el proyecto es del visitante, se ofrece abrirlo en el editor; si es ajeno, se puede
// denunciar. Solo lectura (GET):
// sin sesión get_user_info responde { stat: false } con 200
async function check_owner(id, n) {
  try {
    let res = await get_user_info()
    if (n != load_n || !res.stat) return
    logged.value = true
    is_owner.value = (res.u_info.projects ?? []).some(p => p.id === id)
  } catch {
    // sin conexión: no se muestra el link
  }
}

watch(() => route.params.id, id => { if (id) load(id) }, { immediate: true })

// al salir (p.ej. a la galería con router-link) se detiene el motor y se liberan los players. Se hace
// en el beforeUnmount del padre, que corre antes de desmontar Tracks.vue (que no detiene el transporte)
onBeforeUnmount(() => {
  load_n++
  clearTimeout(retry_timer)
  unload_public_project()
})
</script>

<style scoped>
.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.main {
  flex: 1;
  min-height: 120px;
  overflow: auto;
  padding: 20px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.project_name {
  display: inline-block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

.project_vis {
  margin-left: 8px;
  font-size: 9px;
  letter-spacing: 1.5px;
  opacity: 0.75;
}

.status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dim {
  opacity: 0.6;
}

.link {
  text-decoration: none;
}

.link:hover {
  color: var(--accent);
}

.report {
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
}

.report:hover {
  color: var(--danger);
}

.info {
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.value {
  margin-right: 14px;
}

.bio {
  margin: 0;
  color: var(--hw_silk);
  opacity: 0.8;
  white-space: pre-line;
}

.hint {
  margin: 0;
  font-size: 12px;
  opacity: 0.7;
}
</style>
