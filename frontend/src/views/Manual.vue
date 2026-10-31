<template>
  <!-- manual de uso (/manual): una sola página con todas las secciones (Ctrl+F, imprimir a PDF) y un índice
    lateral con anclas (/manual#<id>). Secciones e ids en manual/sections.js; plan en docs/PLAN_MANUAL.md.
    Jerarquía: h1 el manual, h2 cada nivel, h3 cada sección; adentro de una sección, h4 -->
  <div class="manual_page">
    <div class="no_print">
      <PublicBar :manual_link="false">
        <span class="silk">User manual</span>
      </PublicBar>
    </div>

    <div class="layout">
      <!-- índice: columna fija en escritorio; en celular, un panel que abre el botón INDEX de abajo a la derecha -->
      <nav class="index" :class="{ open: index_open }" aria-label="Índice del manual">
        <div v-for="lv in groups" :key="lv.id" class="group">
          <div class="silk group_title">{{ lv.title }}</div>
          <a v-for="s in lv.sections" :key="s.id" class="entry" :class="{ current: s.id === current }"
            :href="'#' + s.id" :aria-current="s.id === current ? 'location' : null" @click.prevent="go(s.id)">
            <Led :lit="s.id === current" />
            <span v-if="s.num !== null" class="num">{{ s.num }}</span>
            <span class="entry_title">{{ s.title }}</span>
          </a>
        </div>
      </nav>
      <div v-if="index_open" class="backdrop" @click="index_open = false"></div>
      <button type="button" class="index_toggle" :class="{ open: index_open }" :aria-expanded="index_open"
        @click="index_open = !index_open">INDEX</button>

      <main ref="content" class="content">
        <h1 class="manual_title">Manual de Looper</h1>
        <div v-for="lv in groups" :key="lv.id" class="level">
          <h2 class="level_title">{{ lv.title }}</h2>
          <section v-for="s in lv.sections" :id="s.id" :key="s.id" class="manual_section">
            <h3 class="section_title">
              <span v-if="s.num !== null" class="num">{{ s.num }}</span>{{ s.title }}
            </h3>
            <component :is="s.component" />
          </section>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import PublicBar from "../components/PublicBar.vue"
import Led from "../components/hw/Led.vue"
import { LEVELS, SECTIONS } from "../manual/sections"
import { go_anchor } from "../manual/nav"

const router = useRouter()

// secciones agrupadas por nivel, en el orden de sections.js
const groups = computed(() => LEVELS.map(lv => ({ ...lv, sections: SECTIONS.filter(s => s.level === lv.id) })))

const index_open = ref(false) // panel del índice abierto (solo en celular)
const current = ref(SECTIONS[0].id) // sección que se está leyendo (se ilumina en el índice)
const content = ref(null)

function go(id) {
  index_open.value = false
  go_anchor(router, id)
}

// la sección actual es la última cuyo título ya pasó cerca del borde de arriba; al llegar al final de la
// página, la última (si es corta nunca llega arriba)
const TOP_LINE = 90
let raf = 0
function update_current() {
  raf = 0
  if (!content.value) return
  let els = content.value.querySelectorAll(".manual_section")
  if (!els.length) return
  let id = els[0].id
  for (let el of els) {
    if (el.getBoundingClientRect().top > TOP_LINE) break
    id = el.id
  }
  let doc = document.documentElement
  if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) id = els[els.length - 1].id
  current.value = id
}
function on_scroll() {
  if (!raf) raf = requestAnimationFrame(update_current)
}

onMounted(() => {
  window.addEventListener("scroll", on_scroll, { passive: true })
  window.addEventListener("resize", on_scroll, { passive: true })
  update_current()
})
onBeforeUnmount(() => {
  window.removeEventListener("scroll", on_scroll)
  window.removeEventListener("resize", on_scroll)
  if (raf) cancelAnimationFrame(raf)
})
</script>

<style scoped>
.manual_page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.layout {
  flex: 1;
  display: flex;
  align-items: flex-start;
}

/* índice lateral: sección del chasis como la sidebar de la app, fija mientras se scrollea */
.index {
  flex: none;
  position: sticky;
  top: 0;
  width: 260px;
  max-height: 100vh;
  box-sizing: border-box;
  padding: 14px 12px 24px;
  overflow: auto;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.03), rgba(0, 0, 0, 0.2)),
    var(--hw_tex_chassis) center / cover,
    var(--hw_chassis_dark);
  border-right: 1px solid #0c0c0d;
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.06);
}

.group + .group {
  margin-top: 16px;
}

.group_title {
  display: block;
  margin: 0 0 6px 4px;
  white-space: normal;
}

.entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  color: var(--muted);
  font-size: 12px;
  text-decoration: none;
}

.entry:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
}

.entry.current {
  color: var(--text);
  background: rgba(0, 0, 0, 0.25);
}

.entry .num {
  flex: none;
  min-width: 1.6em;
  color: var(--hw_silk);
  font-weight: 700;
  text-align: right;
}

.entry_title {
  min-width: 0;
}

.index_toggle,
.backdrop {
  display: none;
}

/* contenido: columna de lectura */
.content {
  flex: 1;
  min-width: 0;
  max-width: 820px;
  box-sizing: border-box;
  padding: 24px 32px 80px;
  font-size: 14px;
  line-height: 1.65;
}

.manual_title {
  margin: 0 0 8px;
  color: var(--hw_silk);
  font-size: 22px;
  letter-spacing: 3px;
  text-transform: uppercase;
}

/* rótulo de nivel: placa de aluminio con serigrafía oscura */
.level_title {
  margin: 40px 0 8px;
  padding: 6px 14px;
  border-radius: 3px;
  background: var(--hw_tex_metal) center / cover, linear-gradient(180deg, #c4c6ca, #9a9da2);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  color: #26272a;
  font-size: 13px;
  letter-spacing: 2px;
  text-transform: uppercase;
}

.manual_section {
  padding-top: 8px;
}

.section_title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 24px 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
  font-size: 17px;
}

/* número de la sección en el LCD */
.section_title .num {
  flex: none;
  padding: 1px 6px;
  border: 2px solid #0b0b0c;
  border-radius: 3px;
  background: linear-gradient(180deg, var(--hw_lcd_bg_hi), var(--hw_lcd_bg));
  color: var(--hw_lcd_ink);
  font-size: 13px;
  font-weight: 800;
}

/* tipografía del cuerpo de las secciones (componentes de manual/sections/) */
.content :deep(h4) {
  margin: 20px 0 6px;
  font-size: 14px;
  color: var(--hw_silk);
}

.content :deep(p) {
  margin: 8px 0;
}

.content :deep(ul),
.content :deep(ol:not([class])) {
  margin: 8px 0;
  padding-left: 22px;
}

.content :deep(.pending) {
  color: var(--muted);
  font-style: italic;
}

.content :deep(a:not([class])) {
  color: var(--accent);
}

/* celular: el índice pasa a un panel que se abre con el botón INDEX */
@media (max-width: 800px) {
  .index {
    position: fixed;
    z-index: 20;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(300px, 86vw);
    max-height: none;
    transform: translateX(-100%);
    transition: transform 0.2s ease-out;
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.6);
  }

  .index.open {
    transform: none;
  }

  .backdrop {
    display: block;
    position: fixed;
    z-index: 19;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
  }

  .index_toggle {
    display: block;
    position: fixed;
    z-index: 21;
    right: 16px;
    bottom: 16px;
    height: 36px;
    padding: 0 14px;
    border: 1px solid #0c0c0d;
    border-radius: 5px;
    background: linear-gradient(180deg, var(--hw_rubber_hi), var(--hw_rubber));
    box-shadow: 0 3px 0 #0e0e0f, 0 4px 10px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.18);
    color: var(--hw_rubber_ink);
    font-family: var(--font_mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.5px;
    cursor: pointer;
  }

  .index_toggle.open {
    transform: translateY(2px);
    box-shadow: 0 1px 0 #0e0e0f, 0 2px 3px rgba(0, 0, 0, 0.5);
  }

  .content {
    padding: 16px 16px 80px;
  }
}

/* impresión (PDF desde el navegador): sin barra ni índice, texto oscuro sobre blanco */
@media print {
  .no_print,
  .index,
  .index_toggle,
  .backdrop {
    display: none !important;
  }

  .manual_page,
  .content {
    background: #fff;
    color: #111;
  }

  .content {
    max-width: none;
    padding: 0;
  }

  .manual_title,
  .content :deep(h4) {
    color: #111;
  }

  .level_title {
    background: none;
    box-shadow: none;
    border-bottom: 2px solid #111;
    border-radius: 0;
    color: #111;
    break-after: avoid;
  }

  .section_title {
    border-bottom-color: #999;
    break-after: avoid;
  }

  .section_title .num {
    background: none;
    border-color: #111;
  }

  .content :deep(img) {
    max-width: 100%;
    break-inside: avoid;
  }

  .content :deep(.pending) {
    color: #555;
  }

  .content :deep(a:not([class])) {
    color: #111;
  }
}
</style>
