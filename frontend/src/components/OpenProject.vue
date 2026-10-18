<template>
  <!-- al entrar (recarga o login) se pregunta antes de abrir el último proyecto usado (store.open_prompt):
    abrirlo, elegir otro (emite "choose" y App.vue abre PROJECTS) o cancelar (queda NO PROJECT) -->
  <el-dialog :model-value="!!p" title="Open project" width="min(440px, 96vw)" class="hw_dialog" align-center
    :close-on-click-modal="false" @close="answer('cancel')">
    <template v-if="p">
      <p class="question">Open your last project?</p>
      <div class="label">
        <p class="name">{{ p.name }}</p>
        <p class="specs">
          <span :class="{ mem_warn: project_memory_warn(p) }" :title="project_memory_title(p)">
            RAM {{ fmt_memory(project_memory(p)) }}</span>
          · {{ p.files_count ?? 0 }} {{ p.files_count == 1 ? "file" : "files" }}
          <template v-if="p.ts"> · {{ fmt_date(p.ts) }}</template>
        </p>
      </div>
    </template>

    <template #footer>
      <div class="footer">
        <LedButton size="small" text="CANCEL" @click="answer('cancel')" />
        <LedButton size="small" text="OTHER..." @click="answer('choose')" />
        <LedButton size="small" text="OPEN" @click="answer('open')" />
      </div>
    </template>
  </el-dialog>
</template>

<script setup>

import { computed } from "vue"
import LedButton from "./hw/LedButton.vue"
import {
  store, switch_project, project_memory, project_memory_warn, project_memory_title, fmt_memory
} from "../helpers/composable"
import { fmt_date } from "../helpers/utils"

const emit = defineEmits(["choose"])

const p = computed(() => store.open_prompt)

// el @close del diálogo también llega acá (X, Esc o después de cerrarlo por código): solo cuenta la
// primera respuesta mientras haya pregunta
async function answer(action) {
  let row = store.open_prompt
  if (!row) return
  store.open_prompt = null
  if (action === "open") await switch_project(row.id)
  else if (action === "choose") emit("choose")
}

</script>

<style scoped>
.question {
  margin: 0 0 12px;
  color: var(--hw_silk);
  font-size: 13px;
}

/* etiqueta de papel como la de los cartuchos de Projects */
.label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 12px;
  border-radius: 2px;
  background: linear-gradient(180deg, #ece7d8, #dcd6c4);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  color: #1e1f22;
}

.name {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
  font-size: 14px;
}

.specs {
  margin: 0;
  font-size: 11px;
  opacity: 0.7;
}

/* sobre el papel el amarillo no se lee: aviso de memoria en rojo */
.mem_warn {
  color: #b3261e;
  font-weight: 700;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
