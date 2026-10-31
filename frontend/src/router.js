import { createRouter, createWebHistory } from "vue-router"
import App from "./App.vue"

// Rutas del frontend (historial HTML5: en producción nginx necesita try_files hacia index.html,
// ver docs/ARCHITECTURE.md). Las query strings (?autostart=1) se conservan tal cual.
//  /         la app (sesión, proyectos, edición)
//  /p/:id    proyecto público en modo lectura (START/STOP y mixer local, sin guardar)
//  /gallery  galería de proyectos públicos
//  /manual   manual de uso (una página con anclas: /manual#<id>, ids en manual/sections.js)
// Entre "/" y las vistas públicas se navega con <a href> (recarga completa): así el store y el
// motor de la app privada no se mezclan con los de una vista pública.
const routes = [
  { path: "/", name: "app", component: App },
  { path: "/p/:id", name: "public_project", component: () => import("./views/PublicProject.vue") },
  { path: "/gallery", name: "gallery", component: () => import("./views/Gallery.vue") },
  { path: "/manual", name: "manual", component: () => import("./views/Manual.vue") },
  // cualquier otra ruta va a la app
  { path: "/:pathMatch(.*)*", redirect: "/" },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior,
})

// scroll al navegar: atrás/adelante vuelve a donde estaba; con #ancla (/manual#editor_region) va a ese
// elemento, un poco abajo del borde; un término del glosario que todavía no tenga ancla propia (#g_<término>)
// cae en el glosario; si no, arriba de todo
function scrollBehavior(to, from, saved) {
  if (saved) return saved
  if (to.hash) {
    let hash = to.hash
    if (!exists(hash) && hash.startsWith("#g_")) hash = "#glossary"
    if (exists(hash)) return { el: hash, top: 12, behavior: from.path === to.path ? "smooth" : "auto" }
  }
  if (from.path === to.path) return false
  return { top: 0 }
}

// un hash que no es un selector válido (link escrito a mano) no rompe la navegación
function exists(hash) {
  try {
    return !!document.querySelector(hash)
  } catch {
    return false
  }
}
