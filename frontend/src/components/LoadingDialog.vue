<template>
  <!-- diálogo de carga de un proyecto (lo montan App.vue y views/PublicProject.vue): anillo de LEDs con el
    avance mientras se bajan y decodifican los audios. Con `play` (link ?play=1), al terminar queda armado
    con PLAY: el clic es el gesto que pide el navegador para sonar y recién ahí arranca el motor -->
  <el-dialog :model-value="visible" :title="armed ? 'Ready' : 'Loading'" width="min(320px, 92vw)"
    class="hw_dialog loading_dialog" align-center append-to-body :show-close="false" :close-on-click-modal="false"
    :close-on-press-escape="false">
    <div class="body">
      <div class="ring" :class="{ armed }">
        <span v-for="i in RING" :key="i" class="seg" :class="seg_class(i - 1)"
          :style="{ transform: `rotate(${(i - 1) * 360 / RING}deg) translateY(-${RADIUS}px)` }"></span>
        <div class="center">
          <Lcd small :value="pct" :digits="3" unit="%" />
        </div>
      </div>
      <p class="name" :title="store.project?.name">{{ store.project?.name }}</p>
      <p class="silk specs">
        {{ store.load_progress.done }}/{{ store.load_progress.total }} files · RAM {{ ram }}
      </p>
    </div>
    <template v-if="armed" #footer>
      <div class="footer">
        <LedButton size="small" text="CLOSE" @click="played = true" />
        <LedButton size="big" text="PLAY" led="green" :lit="true" blink @click="do_play" />
      </div>
    </template>
  </el-dialog>
</template>
<script setup>
// El anillo es como el de LEDs de un encoder: se van encendiendo en verde según los archivos cargados y un
// LED amarillo gira encima, para que se note que sigue trabajando aunque un archivo grande tarde. Solo se
// muestra al abrir un proyecto (store.load_progress.dialog), no en las recargas del mismo (subidas)
import * as Tone from "tone"
import { ref, computed, watch, onBeforeUnmount } from "vue"
import Lcd from "./hw/Lcd.vue"
import LedButton from "./hw/LedButton.vue"
import { store, estimate_files_memory, fmt_memory } from "../helpers/composable"
import { TrackCtrl } from "../helpers/TrackCtrl"

const props = defineProps({
  play: { type: Boolean, default: false } // al terminar de cargar, quedar armado con PLAY
})

const RING = 24
const RADIUS = 52
const SPIN_MS = 60

const loading = computed(() => store.load_progress.dialog && store.load_progress.total > 0 && !TrackCtrl.isReady)
// PLAY o CLOSE ya apretados (se rearma en la próxima carga)
const played = ref(false)
const armed = computed(() => props.play && !played.value && !loading.value && TrackCtrl.isReady
  && !!store.project && store.files.length > 0)
const visible = computed(() => loading.value || armed.value)

const frac = computed(() => {
  let { done, total } = store.load_progress
  return total > 0 ? Math.min(1, done / total) : (armed.value ? 1 : 0)
})
const pct = computed(() => Math.round(100 * frac.value))
const ram = computed(() => fmt_memory(estimate_files_memory(store.files)))

// LED que gira mientras carga
const head = ref(0)
let spin_timer = null
watch(loading, (on) => {
  clearInterval(spin_timer)
  spin_timer = null
  if (!on) return
  played.value = false
  spin_timer = setInterval(() => { head.value = (head.value + 1) % RING }, SPIN_MS)
}, { immediate: true })
onBeforeUnmount(() => clearInterval(spin_timer))

function seg_class(i) {
  let lit = armed.value || i < Math.round(frac.value * RING)
  // cola de 3 LEDs detrás del que gira
  let d = (head.value - i + RING) % RING
  return { lit, spin: loading.value && d == 0, tail: loading.value && (d == 1 || d == 2) }
}

// el clic es un gesto: Tone.start() reanuda el AudioContext ahora (dentro del evento); el START lo hace Tracks.vue
function do_play() {
  Tone.start().catch(() => { })
  played.value = true
  store.play_request++
}
</script>
<style scoped>
.body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

/* bisel hundido alrededor del anillo, como el de un encoder */
.ring {
  position: relative;
  width: 132px;
  height: 132px;
  margin: 6px 0 4px;
  border-radius: 50%;
  background: radial-gradient(circle, #1a1b1d 55%, #0b0b0c 72%, #222326 74%);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 255, 255, 0.06);
}

.seg {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 5px;
  height: 10px;
  margin: -5px 0 0 -2.5px;
  border-radius: 1px;
  background: #16301f;
  transition: background 0.15s;
}

.seg.lit {
  background: var(--hw_green);
  box-shadow: 0 0 4px rgba(60, 230, 120, 0.55);
}

.seg.spin {
  background: var(--hw_yellow);
  box-shadow: 0 0 6px 1px rgba(255, 210, 60, 0.7);
  transition: none;
}

.seg.tail {
  background: #8a7322;
  transition: none;
}

/* armado: el anillo entero late despacio esperando el PLAY */
.ring.armed .seg {
  animation: ring_breathe 1.6s ease-in-out infinite;
}

@keyframes ring_breathe {
  50% {
    opacity: 0.45;
  }
}

.center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.name {
  margin: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: var(--hw_silk);
}

.specs {
  margin: 0;
  opacity: 0.7;
}

.footer {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
}
</style>
