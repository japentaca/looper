<template>
  <!-- edición de una instancia de FX de transición de una pista (trg.props.fx). Se abre con el clic en
    su chip de la tira (Tracks.vue). Edita la instancia en vivo (sin copia) y guarda las pistas con
    save_trackGroups_debounced() en cada cambio. El motor lee la instancia en cada disparo, así que los
    cambios valen desde la próxima tirada (una rampa ya agendada no cambia) -->
  <el-dialog v-model="visible" :title="title" width="min(560px, 96vw)" class="hw_dialog" align-center
    append-to-body>
    <div v-if="inst" class="fx_body">
      <!-- anticipación: cuánto antes del fin de la tirada arranca el efecto -->
      <div class="row">
        <span class="silk row_label">Lead</span>
        <div class="btns">
          <LedButton v-for="o in LEAD_OPTIONS" :key="o.value" size="small" led="green" :text="o.label"
            :lit="inst.lead === o.value" :title="lead_title(o.value)" @click="set('lead', o.value)" />
        </div>
      </div>
      <!-- condición del fin (TAG: el fin de la tirada es un corte por cambio de Tag) -->
      <div class="row">
        <span class="silk row_label">When</span>
        <div class="btns">
          <LedButton v-for="o in COND_OPTIONS" :key="o.value" size="small" led="green" :text="COND_TEXT[o.value]"
            :lit="inst.cond === o.value" :title="COND_TITLE[o.value]" @click="set('cond', o.value)" />
        </div>
      </div>

      <div class="plates">
        <!-- probabilidad de dispararse en cada fin -->
        <div class="hw_plate" :title="'Chance of firing at each end: ' + pct(inst.prob) + '%'">
          <span class="silk">Prob</span>
          <Knob :model-value="inst.prob" :min="0" :max="1" :step="0.05" :size="56"
            @update:model-value="v => set('prob', Math.round(v * 100) / 100)" />
          <Lcd small :digits="3" :value="pct(inst.prob)" unit="%" />
        </div>
        <!-- parámetros propios del tipo (rangos de FX_TYPES). Las frecuencias van en escala logarítmica:
          el knob trabaja en posición 0..1 (hz_to_pos / pos_to_hz) -->
        <div v-for="(r, key) in def.params" :key="key" class="hw_plate" :title="r.label + ' ' + inst[key] + ' ' + r.unit">
          <span class="silk">{{ r.label }}</span>
          <Knob v-if="r.unit == 'Hz'" :model-value="hz_to_pos(inst[key], r)" :min="0" :max="1" :step="0.005"
            :size="56" @update:model-value="v => set(key, pos_to_hz(v, r))" />
          <Knob v-else :model-value="inst[key]" :min="r.min" :max="r.max" :step="r.step" :size="56"
            @update:model-value="v => set(key, v)" />
          <Lcd small :digits="r.unit == 'Hz' ? 4 : 3" :value="inst[key]" :unit="r.unit" />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="footer">
        <el-button type="danger" plain @click="remove">REMOVE</el-button>
        <el-button @click="visible = false">CLOSE</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, watch } from "vue"
import Knob from "./hw/Knob.vue"
import Lcd from "./hw/Lcd.vue"
import LedButton from "./hw/LedButton.vue"
import { store, save_trackGroups_debounced } from "../helpers/composable"
import { TrackCtrl } from "../helpers/TrackCtrl"
import { FX_TYPES, LEAD_OPTIONS, COND_OPTIONS, lead_beats } from "../helpers/fx"

const visible = defineModel({ type: Boolean, default: false })
const props = defineProps({
  trg_id: { type: String, default: null }, // id de la pista (store.track_groups)
  fx_id: { type: String, default: null }, // id de la instancia en trg.props.fx
})

const COND_TEXT = { any: "ANY", rest: "BEFORE REST", tag: "TAG CHANGE" }
const COND_TITLE = {
  any: "At every end of the run",
  rest: "Only when a rest follows",
  tag: "Only when a tag change cuts the loop",
}

// pista e instancia se buscan por id (pueden desaparecer: pista borrada, instancia quitada)
const trg = computed(() => store.track_groups.find(t => t.id === props.trg_id) ?? null)
const inst = computed(() => (trg.value?.props?.fx ?? []).find(f => f.id === props.fx_id) ?? null)
const def = computed(() => FX_TYPES[inst.value?.type] ?? { label: "FX", params: {} })
const title = computed(() => def.value.label + (trg.value ? " · " + trg.value.name : ""))

// si la instancia deja de existir con el diálogo abierto, se cierra
watch(inst, (v) => { if (!v) visible.value = false })

function set(key, v) {
  if (!inst.value || inst.value[key] === v) return
  inst.value[key] = v
  save_trackGroups_debounced()
}

function remove() {
  let list = trg.value?.props?.fx
  let i = Array.isArray(list) ? list.findIndex(f => f.id === props.fx_id) : -1
  if (i >= 0) {
    list.splice(i, 1)
    save_trackGroups_debounced()
  }
  visible.value = false
}

function pct(v) {
  return Math.round((v ?? 0) * 100)
}

function lead_title(lead) {
  let n = lead_beats(lead, TrackCtrl.beats_x_bar)
  return "Starts " + n + " beat" + (n > 1 ? "s" : "") + " before the end"
}

// escala logarítmica de frecuencia: pos 0..1 ↔ min..max Hz. Se redondea a 1 Hz por debajo de 1 kHz
// y a 10 Hz por encima (no al step del rango: con 10 Hz fijos, la rueda del knob no se movería
// cerca de 100 Hz, donde un paso de posición son ~2 Hz)
function pos_to_hz(pos, r) {
  let hz = r.min * Math.pow(r.max / r.min, pos)
  hz = hz < 1000 ? Math.round(hz) : Math.round(hz / 10) * 10
  return Math.min(r.max, Math.max(r.min, hz))
}
function hz_to_pos(hz, r) {
  let v = Math.min(r.max, Math.max(r.min, Number(hz) || r.min))
  return Math.log(v / r.min) / Math.log(r.max / r.min)
}
</script>

<style scoped>
.fx_body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.row_label {
  width: 44px;
  flex: none;
}

.btns {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.plates {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.footer {
  display: flex;
  justify-content: space-between;
}
</style>
