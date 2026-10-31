// helpers chicos compartidos por varios componentes (sin dependencias del resto de helpers)
import { reactive } from "vue"

// fecha "AAAA-MM-DD" de un timestamp de la base ("" si no hay)
export function fmt_date(ts) {
  return ts ? String(ts).slice(0, 10) : ""
}

// bytes → MB redondeados (base 1024)
export function mb(bytes) {
  return Math.round(bytes / 1024 ** 2)
}

// modo instalación: ?autostart=1 en la URL actual (docs/INSTALACION.md)
export function url_autostart() {
  return new URLSearchParams(window.location.search).get("autostart") == "1"
}

// link de un proyecto (botón LINK): ?play=1 en la URL actual. Al terminar de cargar, el diálogo de carga
// muestra PLAY (el navegador no deja sonar sin un gesto). A diferencia de ?autostart=1 sí avisa de la memoria
export function url_play() {
  return new URLSearchParams(window.location.search).get("play") == "1"
}

// link para abrir el proyecto `id` en la vista pública y tocarlo (todos los proyectos son públicos salvo los
// ocultos por el admin)
export function project_link(id) {
  return `${window.location.origin}/p/${id}?play=1`
}

// link a una sección del manual (/manual#<id>; los ids son fijos, ver manual/sections.js). Lo usan los "?" de
// los diálogos (ManualHelp.vue), que lo abren en otra pestaña para no cortar lo que suena
export function manual_link(id) {
  return `/manual#${id}`
}

// aviso de un diálogo (el-alert): msg = { type, text }; set_msg(type, text) lo reemplaza
export function use_msg(type = "success") {
  const msg = reactive({ type, text: "" })
  function set_msg(type, text) {
    Object.assign(msg, { type, text })
  }
  return { msg, set_msg }
}

// --- atajos de teclado del editor (docs/PLAN_EDITOR.md, decisión 11; FileEditor.vue y RegionEditor.vue) ---
// Solo con el editor abierto y el foco en el editor (o en ninguna parte); nunca con otro diálogo encima
// (confirmación de borrado, etc.) ni con el foco en un campo de texto (input, select...). `takers` = controles
// que usan esa tecla y no se la roban: Espacio no en botones ni controles hw (Knob, Fader, RangePads,
// ToggleSwitch, que lo usan para activarse); las flechas no en los controles hw (las letras, en ninguno)
const TEXT_FIELDS = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], .el-select'
export const SPACE_TAKERS = 'button, a[href], [role="slider"], [role="switch"], [role="button"]'
export const ARROW_TAKERS = '[role="slider"], [role="switch"], [role="radio"], [role="radiogroup"]'
export function editor_key_ok(e, takers = null) {
  let t = e.target instanceof Element ? e.target : document.body
  let dlg = document.querySelector(".editor_dialog")
  if (!dlg || !(dlg.contains(t) || t.contains(dlg))) return false
  if (t.closest(TEXT_FIELDS)) return false
  return !(takers && t.closest(takers))
}
