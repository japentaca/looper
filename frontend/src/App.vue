<template>
  <div class="app">
    <!-- barra superior: placa de marca, LED de estado, LCD del preview y sesión -->
    <header class="topbar">
      <div class="nameplate">
        <span class="logo">LOOPER</span>
        <span class="model">Random loop player</span>
      </div>

      <!-- LED de estado: amarillo cargando, verde listo, rojo si se perdió la sesión (sigue sonando,
        pero los cambios no se guardan) -->
      <div class="status" :title="status_title">
        <Led :color="status_color" :lit="store.isLogged == true" />
        <span class="silk">{{ status_text }}</span>
        <span v-if="loading_audio" class="silk load_count">{{ store.load_progress.done }}/{{ store.load_progress.total
          }}</span>
      </div>

      <!-- vúmetro master estéreo (salida general, incluye el preview) -->
      <div class="master">
        <span class="silk">Master</span>
        <div class="master_lr">
          <span class="silk ch">L</span>
          <LedMeter horizontal :segments="20" :value="levels.master[0].level" :peak="levels.master[0].peak" />
          <span class="silk ch">R</span>
          <LedMeter horizontal :segments="20" :value="levels.master[1].level" :peak="levels.master[1].peak" />
        </div>
      </div>

      <!-- proyecto activo (LCD) y botones de los diálogos de proyectos y de importar del catálogo -->
      <!-- sin proyecto abierto (se canceló el aviso de memoria) el botón sigue, para abrir otro -->
      <div v-if="store.isLogged == true" class="project">
        <span class="silk">Project</span>
        <Lcd small :digits="0">
          <template v-if="store.project">
            <span class="project_name" :title="store.project.name">{{ store.project.name }}</span>
            <span class="project_vis">{{ store.project.visibility == 'public' ? 'PUB' : 'PRV' }}</span>
          </template>
          <span v-else class="project_name">NO PROJECT</span>
        </Lcd>
        <LedButton size="small" text="PROJECTS" @click="projectsVisible = true" />
        <LedButton size="small" text="IMPORT" :disabled="!store.project" @click="importVisible = true" />
      </div>

      <div v-if="store.curr_file.isPreviewing" class="preview">
        <Lcd small :digits="0">
          <span class="preview_text"><b>Preview</b> {{ store.curr_file.original_name }}</span>
        </Lcd>
        <LedButton size="small" text="STOP" @click="playerStop()" />
      </div>

      <span class="spacer"></span>
      <span v-if="store.isLogged == true" class="silk user">{{ store.u_info.name }}</span>
      <!-- la galería pública se abre en otra pestaña, para no cortar lo que está sonando -->
      <LedButton size="small" text="GALLERY" @click="open_gallery()" />
      <LedButton v-if="store.isLogged == false" size="small" text="LOGIN" @click="store.loginVisible = true" />
      <LedButton v-if="is_admin" size="small" text="ADMIN" @click="adminVisible = true" />
      <LedButton v-if="store.isLogged == true" size="small" text="ACCOUNT" @click="accountVisible = true" />
      <LedButton v-if="store.isLogged == true" size="small" text="LOGOUT" @click="doLogout()" />
      <!-- barra de avance de la carga de audios, sobre el borde inferior de la barra superior -->
      <div v-if="loading_audio" class="load_bar">
        <div class="load_fill" :style="{ width: 100 * store.load_progress.done / store.load_progress.total + '%' }">
        </div>
      </div>
    </header>

    <div class="body">
      <aside class="sidebar">
        <div class="side_title">Tracks</div>
        <div class="pads">
          <SidebarItem v-for="(track_group, index) in store.track_groups" :key="track_group.id" kind="track_group"
            :index="index" />
        </div>
        <el-button class="add_btn" size="small" @click="addTrackGroup">+ Track</el-button>

        <div class="side_title">Tags</div>
        <div class="pads">
          <SidebarItem v-for="(tag, index) in store.tags" :key="tag.id" kind="tag" :index="index" />
        </div>
        <el-button class="add_btn" size="small" @click="addTag">+ Tag</el-button>
      </aside>

      <main class="main">
        <el-scrollbar>
          <div class="content">
            <Tracks />

            <el-collapse v-model="activeCollapsable" class="sections">
              <el-collapse-item title="Upload Files" name="1">
                <uploader />
              </el-collapse-item>
              <el-collapse-item title="Files" name="2">
                <Files />
              </el-collapse-item>
            </el-collapse>
          </div>
        </el-scrollbar>
      </main>
    </div>

    <Login :visible="store.loginVisible" />
    <Account v-if="store.isLogged == true" v-model="accountVisible" />
    <Projects v-if="store.isLogged == true" v-model="projectsVisible" />
    <ImportFiles v-if="store.isLogged == true" v-model="importVisible" />
    <!-- solo para role = admin: a los demás ni se monta (el backend igual lo exige con require_admin) -->
    <Admin v-if="is_admin" v-model="adminVisible" />
  </div>
</template>
<script setup>
import { ref, computed, onMounted } from "vue"
import SidebarItem from "./components/SidebarItem.vue"
import Files from "./components/Files.vue"
import Login from "./components/Login.vue"
import Account from "./components/Account.vue"
import Projects from "./components/Projects.vue"
import ImportFiles from "./components/ImportFiles.vue"
import Admin from "./components/Admin.vue"
import Uploader from "./components/Uploader.vue"
import Tracks from "./components/Tracks.vue"
import Led from "./components/hw/Led.vue"
import Lcd from "./components/hw/Lcd.vue"
import LedButton from "./components/hw/LedButton.vue"
import LedMeter from "./components/hw/LedMeter.vue"
import { levels } from "./helpers/mixer"
import { TrackCtrl } from "./helpers/TrackCtrl"

import { store, doLogout, store_get_user_info, rebuildIndexes, save_tags, save_trackGroups, trg_default_props } from "./helpers/composable"

import * as uuid from "uuid"

import { playerStop } from "./helpers/toneLib"


async function addTrackGroup() {
  let id = uuid.v4()
  let trg = { name: "Track", color: randomColor(), id: id, props: trg_default_props() }
  store.track_groups.push(trg)
  rebuildIndexes()
  await save_trackGroups()

}
async function addTag() {
  let id = uuid.v4()
  let tag = { name: "TG ", color: randomColor(), id: id }
  store.tags.push(tag)

  rebuildIndexes()
  await save_tags()

}
function randomColor() {
  let base = 100, rango = 155
  let r = rgbToHex(parseInt(Math.random() * rango) + base, parseInt(Math.random() * rango) + base, parseInt(Math.random() * rango) + base)

  return r

}
const rgbToHex = (r, g, b) => '#' + [r, g, b].map(x => {
  const hex = x.toString(16)
  return hex.length === 1 ? '0' + hex : hex
}).join('')

const status_color = computed(() => store.session_lost ? "red" : (TrackCtrl.isReady ? "green" : "yellow"))
const status_text = computed(() => {
  if (store.session_lost) return "No session"
  return TrackCtrl.isReady ? "Ready" : (store.isLogged ? "Loading" : "Off")
})

const status_title = computed(() => store.session_lost
  ? "Se perdió la sesión con el servidor: la reproducción sigue, pero los cambios no se guardan. "
  + "Volver a entrar con el transporte detenido."
  : "")

// se están descargando/decodificando los audios del usuario
const loading_audio = computed(() => store.isLogged == true && !TrackCtrl.isReady && store.load_progress.total > 0)

const activeCollapsable = ref('2')
const accountVisible = ref(false) // diálogo de cuenta (bio y cambio de clave)
const projectsVisible = ref(false) // diálogo de proyectos (abrir, crear, renombrar, borrar, visibilidad)
const importVisible = ref(false) // diálogo de importar del catálogo al proyecto activo
const adminVisible = ref(false) // diálogo de admin de usuarios
function open_gallery() {
  window.open(import.meta.env.BASE_URL + "gallery", "_blank", "noopener")
}
const is_admin = computed(() => store.isLogged == true && store.u_info.role === "admin")
onMounted(async () => {
  if (!store.alreadyMounted) {
    store.alreadyMounted = true
    await store_get_user_info()
  } else {
    console.log("already mounted!!!!")
  }


})
//alert("queda ver get_available_files")

</script>
<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  flex: none;
  height: 56px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.25)),
    var(--hw_tex_chassis) center / cover,
    var(--hw_chassis_dark);
  border-bottom: 1px solid #0c0c0d;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  position: relative;
  z-index: 1;
}

/* placa de marca de aluminio con letras grabadas */
.nameplate {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 5px 14px 6px;
  border-radius: 3px;
  background: var(--hw_tex_metal) center / cover, linear-gradient(180deg, #c4c6ca, #9a9da2);
  box-shadow: 0 2px 3px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.55);
  color: #232427;
  user-select: none;
}

.logo {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 5px;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.55);
}

.model {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.8px;
  text-transform: uppercase;
  opacity: 0.75;
}

.status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.load_count {
  opacity: 0.6;
}

.load_bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 3px;
  background: rgba(0, 0, 0, 0.5);
}

.load_fill {
  height: 100%;
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent);
  transition: width 0.2s ease-out;
}

.master {
  display: flex;
  align-items: center;
  gap: 8px;
}

.master_lr {
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  gap: 2px 4px;
}

.ch {
  font-size: 8px;
  opacity: 0.6;
}

.spacer {
  flex: 1;
}

.user {
  opacity: 0.8;
}

.project {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.project_name {
  display: inline-block;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  font-size: 12px;
  letter-spacing: 0.5px;
}

.project_vis {
  margin-left: 8px;
  font-size: 9px;
  letter-spacing: 1.5px;
  opacity: 0.75;
}

.preview {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.preview_text {
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  letter-spacing: 0.5px;
}

.preview_text b {
  margin-right: 6px;
  font-size: 9px;
  letter-spacing: 1.5px;
  opacity: 0.75;
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
}

/* barra lateral como sección del chasis con los pads */
.sidebar {
  flex: none;
  width: 220px;
  padding: 12px 14px;
  overflow: auto;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.03), rgba(0, 0, 0, 0.2)),
    var(--hw_tex_chassis) center / cover,
    var(--hw_chassis_dark);
  border-right: 1px solid #0c0c0d;
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.06);
}

.side_title {
  margin: 10px 0 10px;
  color: var(--hw_silk);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.6px;
  text-transform: uppercase;
}

.pads {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.add_btn {
  width: 100%;
  margin-bottom: 16px;
}

.main {
  flex: 1;
  min-width: 0;
}

.content {
  padding: 16px 20px 40px;
}

.sections {
  margin-top: 20px;
  border-color: var(--border);
}
</style>
