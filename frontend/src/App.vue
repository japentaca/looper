<template>
  <div class="common-layout">
    <el-container>
      <el-header class="header">
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
            <div v-if="store.curr_file.isPlaying" class="curr_file">Playing:{{ store.curr_file.original_name }}
              <el-icon :size="1
              " class="icons" @click="playerStop()">
                <VideoPause />
              </el-icon>
            </div>
          </el-col>
        </el-row>
      </el-header>

      <el-container>
        <el-aside width="200px">
          <div>TRACK GROUPS</div>
          <Track_group v-for="(track_group, index) in store.track_groups" class="file" :name="track_group.name"
            :color="track_group.color" :index=index>
          </Track_group>
          <el-button @click="addTrackGroup">+</el-button>
          <el-divider />
          <div>TAGS</div>
          <Tag v-for="(tag, index) in store.tags" class="file" :name="tag.name" :color="tag.color" :index=index>
          </Tag>
          <el-button @click="addTag">+</el-button>
        </el-aside>
        <el-main>

          <Tracks />

          <el-collapse v-model="activeCollapsable">
            <el-collapse-item title="Upload Files" name="1">
              <uploader />
            </el-collapse-item>
            <el-collapse-item title="Files" name="2">
              <el-scrollbar height="700px">
                <Files />
              </el-scrollbar>
            </el-collapse-item>
          </el-collapse>


        </el-main>
      </el-container>
    </el-container>

    <Login :visible="store.loginVisible" />



  </div>
</template>
<script setup>
import { ref, onMounted, reactive } from "vue"
import Track_group from "./components/Track_group"
import Tag from "./components/Tag.vue"
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
const dialogLoginVisible = ref(false)
onMounted(async () => {
  if (!store.alreadyMounted) {
    store.alreadyMounted = true
    let t = await store_get_user_info()
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

.header {
  border-style: outset;
  border-width: 2px;

}
</style>