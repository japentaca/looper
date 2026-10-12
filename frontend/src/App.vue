<template>
  <div class="app">
    <header class="topbar">
      <span class="brand">LOOPER</span>
      <div v-if="store.curr_file.isPreviewing" class="preview_chip">
        <el-icon :size="16" class="icons" @click="playerStop()">
          <VideoPause />
        </el-icon>
        <span>Preview: {{ store.curr_file.original_name }}</span>
      </div>
      <span class="spacer"></span>
      <span v-if="store.isLogged == true" class="user">{{ store.u_info.name }}</span>
      <el-button v-if="store.isLogged == false" type="success" size="small" @click="store.loginVisible = true">Login
      </el-button>
      <el-button v-if="store.isLogged == true" size="small" @click="doLogout()">Logout</el-button>
    </header>

    <div class="body">
      <aside class="sidebar">
        <div class="side_title">Track groups</div>
        <SidebarItem v-for="(track_group, index) in store.track_groups" :key="track_group.id" kind="track_group"
          :index="index" />
        <el-button class="add_btn" size="small" @click="addTrackGroup">+ Track group</el-button>

        <div class="side_title">Tags</div>
        <SidebarItem v-for="(tag, index) in store.tags" :key="tag.id" kind="tag" :index="index" />
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
  </div>
</template>
<script setup>
import { ref, onMounted } from "vue"
import SidebarItem from "./components/SidebarItem.vue"
import Files from "./components/Files.vue"
import Login from "./components/Login.vue"
import Uploader from "./components/Uploader.vue"
import Tracks from "./components/Tracks.vue"

import { store, doLogout, store_get_user_info, rebuildIndexes, save_tags, save_trackGroups } from "./helpers/composable"

import * as uuid from "uuid"

import { playerStop } from "./helpers/toneLib"


async function addTrackGroup() {
  let id = uuid.v4()
  let trg = { name: "Track Group", color: randomColor(), id: id }
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

const activeCollapsable = ref('2')
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
  height: 48px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}

.brand {
  font-weight: 700;
  letter-spacing: 3px;
  color: var(--accent);
}

.spacer {
  flex: 1;
}

.user {
  color: var(--muted);
}

.preview_chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--panel_2);
  border: 1px solid var(--accent);
  color: var(--accent);
  font-size: 12px;
}

.icons {
  cursor: pointer;
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.sidebar {
  flex: none;
  width: 220px;
  padding: 12px;
  overflow: auto;
  background: var(--panel);
  border-right: 1px solid var(--border);
}

.side_title {
  margin: 8px 0 8px;
  font-size: 11px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--muted);
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
