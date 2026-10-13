import { store } from "./composable"
import { reactive } from "vue"

// --- delay global (ver mixer.js) ---
// tipos: pingpong = ping-pong estéreo, stereo = la misma repetición en los dos canales,
// dotted = L con la división y R con 1.5 × la división, tape = cada repetición más oscura
export const DELAY_TYPES = ["pingpong", "stereo", "dotted", "tape"]
// divisiones (notación de Tone) → duración en beats (negras). El tiempo del delay se calcula con el tempo.
export const DELAY_DIVISIONS = { "16n": 0.25, "8t": 1 / 3, "8n": 0.5, "8n.": 0.75, "4n": 1, "4n.": 1.5, "2n": 2 }
export const DELAY_FEEDBACK_MAX = 0.9 // el feedback nunca llega a 1 (las repeticiones siempre se apagan)
export const DELAY_LEVEL_MIN = -24 // nivel de retorno del delay en dB (DELAY_LEVEL_MIN..DELAY_LEVEL_MAX)
export const DELAY_LEVEL_MAX = 6
export function delay_default() {
  return { type: "pingpong", division: "8n.", feedback: 0.4, level: 0 }
}
export const TEMPO_DEFAULT = 138
export const BEATS_X_BAR_DEFAULT = "4"
// rango del cambio de Tag: exponentes [min, max] de 2^n beats (faders Min/Max, de TAG_RANGE_MIN a TAG_RANGE_MAX)
export const TAG_RANGE_MIN = 5
export const TAG_RANGE_MAX = 9
export const TAG_RANGE_DEFAULT = [6, 7]

// tempo, compás, rango de cambio de Tag y delay son la config global del usuario: se guardan en
// users.props (save_user_props_debounced en composable.js) y se aplican al cargar el usuario
export const TrackCtrl = reactive({
  tempo: TEMPO_DEFAULT,
  beats_x_bar: BEATS_X_BAR_DEFAULT,
  tag_range: [...TAG_RANGE_DEFAULT],
  delay: delay_default(),
  isPlaying: false,
  isReady: false,
  // estado del motor (lo escribe Tracks.vue; los pads de la barra lateral lo leen)
  current_TAG: {
    duration: 0,
    tag: null,
    curr_bar: 0,
    old_tag: null,
    remaining_beats: 0
  },
  tracks: []
})
export function calculateBars() {

  for (let i = 0; i < store.files.length; i++) {
    let f = store.files[i]
    if (f.duration !== 0) {
      let bars = parseFloat(f.duration) / (((60 / TrackCtrl.tempo)) * parseInt(TrackCtrl.beats_x_bar))
      f.bars = bars.toFixed(2)
      f.beats = parseInt((parseFloat(f.duration) / (((60 / TrackCtrl.tempo)))).toFixed(0))
      //console.log(f.bars, f.beats)
    }

  }

}