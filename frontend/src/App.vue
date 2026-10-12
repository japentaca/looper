<template>
  <div class="common-layout">
    <el-container>
      <el-header>
        <el-row :gutter="20">
          <el-col :span="6">
            <el-button v-if="store.isLogged == false" type="success" @click="store.loginVisible = true">Login
            </el-button>
            <el-button v-if="store.isLogged == true" type="danger" @click="doLogout()">Logout</el-button>
          </el-col>
          <el-col :span="6">
            <div v-if="store.isLogged == true">User:{{ store.u_info.name }}</div>
          </el-col>
          <el-col :span="6">
            <div v-if="store.curr_file.isPreviewing" class="curr_file">Playing:{{ store.curr_file.original_name }}
              <el-icon :size="22" class="icons" @click="playerStop()">

                <VideoPause />
              </el-icon>
            </div>
          </el-col>
        </el-row>
      </el-header>

      <el-container>
        <el-aside>
          <div>TRACK GROUPS</div>
          <SidebarItem v-for="(track_group, index) in store.track_groups" :key="track_group.id" class="file"
            kind="track_group" :index="index" />
          <el-button @click="addTrackGroup">+</el-button>
          <el-divider />
          <div>TAGS</div>
          <SidebarItem v-for="(tag, index) in store.tags" :key="tag.id" class="file" kind="tag" :index="index" />
          <el-button @click="addTag">+</el-button>
        </el-aside>

        <el-main>
          <el-scrollbar>
            <Tracks />

            <el-collapse v-model="activeCollapsable">
              <el-collapse-item title="Upload Files" name="1">
                <uploader />
              </el-collapse-item>
              <el-collapse-item title="Files" name="2">

                <Files />

              </el-collapse-item>
            </el-collapse>

          </el-scrollbar>
        </el-main>

      </el-container>

    </el-container>
    <el-footer>Footer</el-footer>

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
.curr_file {
  background-color: blanchedalmond;
  border-style: outset;
  border-radius: 8px;
}

header {
  border-style: outset;
  border-width: 2px;
  background-color: rgb(9, 126, 132);
}



footer {

  border-style: outset;
  border-width: 2px;
  background-color: rgb(132, 108, 9);
}

aside {
  width: 200px;
  background: #ccc;
  overflow: auto;
  min-height: 0;

}

main {
  position: relative;
  overflow: scroll;

}
</style>