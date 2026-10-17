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

// aviso de un diálogo (el-alert): msg = { type, text }; set_msg(type, text) lo reemplaza
export function use_msg(type = "success") {
  const msg = reactive({ type, text: "" })
  function set_msg(type, text) {
    Object.assign(msg, { type, text })
  }
  return { msg, set_msg }
}
