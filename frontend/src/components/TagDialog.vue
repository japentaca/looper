<template>
  <!-- edición de un Tag: nombre, color y peso en el sorteo. Se abre con el lápiz (o doble clic) del pad.
    Trabaja sobre una copia: SAVE la aplica al Tag y guarda la colección; CANCEL la descarta -->
  <el-dialog v-model="visible" title="Edit tag" width="420px" align-center append-to-body @open="on_open">
    <div class="body">
      <div class="fields">
        <label class="field">
          <span class="field_label">Name</span>
          <el-input ref="name_input" v-model="draft.name" maxlength="64" placeholder="Name" @keyup.enter="do_save" />
        </label>
        <label class="field">
          <span class="field_label">Color</span>
          <el-color-picker v-model="draft.color" />
        </label>
      </div>
      <!-- peso del Tag en el sorteo del próximo Tag (0 = no sale nunca; ver pick_weighted en composable.js) -->
      <div class="hw_plate" :title="weight_title">
        <span class="silk">Weight</span>
        <Knob v-model="draft.weight" :min="0" :max="WEIGHT_MAX" :size="56" />
        <Lcd small :digits="2" :value="draft.weight" />
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">CANCEL</el-button>
      <el-button type="primary" :disabled="!draft.name.trim()" @click="do_save">SAVE</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, computed, nextTick } from "vue"
import Knob from "./hw/Knob.vue"
import Lcd from "./hw/Lcd.vue"
import { store, save_tags, parse_weight, WEIGHT_MAX } from "../helpers/composable"

const visible = defineModel({ type: Boolean, default: false })
const props = defineProps({
  tag_id: { type: String, default: null }, // id de un Tag de store.tags
})
// el Tag de store.tags (se busca por id: el prop no se modifica)
function current_tag() {
  return store.tags.find(t => t.id === props.tag_id)
}

const draft = reactive({ name: "", color: "#888888", weight: 16 })
const name_input = ref(null)

const weight_title = computed(() => draft.weight == 0 ? "Weight 0: this tag is never drawn"
  : `Chance of being the next tag, relative to the other tags (0 = never, ${WEIGHT_MAX} = max)`)

async function on_open() {
  let t = current_tag() ?? {}
  Object.assign(draft, { name: t.name ?? "", color: t.color ?? "#888888", weight: parse_weight(t.weight) })
  await nextTick()
  name_input.value?.focus()
}

async function do_save() {
  let name = draft.name.trim()
  let tag = current_tag()
  if (!name || !tag) return
  Object.assign(tag, { name: name, color: draft.color || tag.color, weight: draft.weight })
  visible.value = false
  await save_tags()
}
</script>

<style scoped>
.body {
  display: flex;
  align-items: flex-start;
  gap: 20px;
}

.fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field_label {
  font-size: 12px;
  color: var(--muted);
}
</style>
