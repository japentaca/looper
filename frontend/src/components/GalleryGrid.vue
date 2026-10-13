<template>
  <!-- grilla de proyectos públicos (GET /public/projects, paginado). La usan la vista /gallery y el
    diálogo GALLERY de la app. Con `reload` el link a /p/<id> es una navegación completa (desde la app,
    para no montar el modo lectura sobre el store del editor) -->
  <div>
    <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon class="msg" />
    <p v-else-if="!loading && items.length == 0" class="empty">No public projects yet.</p>

    <div v-loading="loading" class="grid">
      <div v-for="p in items" :key="p.id" class="card_wrap">
        <component :is="reload ? 'a' : RouterLink" class="card hw_panel" v-bind="link_props(p)">
          <Lcd small :digits="0">
            <span class="card_name" :title="p.name">{{ p.name }}</span>
          </Lcd>
          <div class="meta">
            <span class="silk">by {{ p.creator.name }}</span>
            <span class="silk">{{ p.tempo ? p.tempo + ' BPM' : '' }}</span>
          </div>
          <div class="meta">
            <span class="silk">{{ p.files }} {{ p.files == 1 ? 'loop' : 'loops' }}</span>
            <span class="silk">{{ fmt_date(p.ts) }}</span>
          </div>
        </component>
        <!-- denunciar: solo con sesión y en proyectos ajenos (fuera del link, para no navegar) -->
        <button v-if="logged && !own_ids.has(p.id)" class="report silk" title="Report this project"
          @click="open_report(p)">REPORT</button>
      </div>
    </div>

    <el-pagination v-if="total > per_page" class="pager" layout="prev, pager, next" :total="total"
      :page-size="per_page" :current-page="page" @current-change="load" />

    <ReportDialog v-model="report_visible" :target="report_target" />
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue"
import { RouterLink } from "vue-router"
import Lcd from "./hw/Lcd.vue"
import ReportDialog from "./ReportDialog.vue"
import { get_public_projects, get_user_info, error_text } from "../helpers/api"

const props = defineProps({
  reload: { type: Boolean, default: false },
})

const PER_PAGE = 24

const items = ref([])
const total = ref(0)
const page = ref(1)
const per_page = ref(PER_PAGE)
const loading = ref(false)
const error = ref("")

async function load(p = 1) {
  loading.value = true
  error.value = ""
  try {
    let res = await get_public_projects({ page: p, per_page: PER_PAGE })
    items.value = res.data.items
    total.value = res.data.total
    page.value = res.data.page
    per_page.value = res.data.per_page
  } catch (e) {
    error.value = e?.response?.status == 429 ? "Too many requests: try again in a minute." : error_text(e)
  } finally {
    loading.value = false
  }
}

function link_props(p) {
  let path = "p/" + encodeURIComponent(p.id)
  return props.reload ? { href: import.meta.env.BASE_URL + path } : { to: "/" + path }
}

function fmt_date(ts) {
  return ts ? String(ts).slice(0, 10) : ""
}

// sesión del visitante (opcional): con sesión se puede denunciar un proyecto ajeno. Solo lectura
// (GET): sin sesión get_user_info responde { stat: false } con 200
const logged = ref(false)
const own_ids = ref(new Set())
async function check_session() {
  try {
    let res = await get_user_info()
    logged.value = !!res.stat
    own_ids.value = new Set(res.stat ? (res.u_info.projects ?? []).map(p => p.id) : [])
  } catch {
    // sin conexión: no se muestra el botón
  }
}

const report_visible = ref(false)
const report_target = ref(null)
function open_report(p) {
  report_target.value = { type: "project", id: p.id, name: p.name }
  report_visible.value = true
}

onMounted(() => {
  load(1)
  check_session()
})
</script>

<style scoped>
.grid {
  min-height: 120px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.card_wrap {
  position: relative;
  display: flex;
}

.card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 22px;
  text-decoration: none;
}

.card:hover {
  outline: 1px solid var(--accent);
}

.report {
  position: absolute;
  right: 26px;
  bottom: 4px;
  padding: 0 4px;
  border: none;
  background: none;
  font-size: 9px;
  opacity: 0.55;
  cursor: pointer;
}

.report:hover {
  opacity: 1;
  color: var(--danger);
}

.card_name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.empty {
  color: var(--muted);
}

.msg {
  margin-bottom: 16px;
}

.pager {
  margin-top: 20px;
  justify-content: center;
}
</style>
