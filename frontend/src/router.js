import { createRouter, createWebHistory } from "vue-router"
import App from "./App.vue"

// Rutas del frontend (historial HTML5: en producción nginx necesita try_files hacia index.html,
// ver docs/ARCHITECTURE.md). Las query strings (?autostart=1) se conservan tal cual.
//  /         la app (sesión, proyectos, edición)
//  /p/:id    proyecto público en modo lectura (START/STOP y mixer local, sin guardar)
//  /gallery  galería de proyectos públicos
// Entre "/" y las vistas públicas se navega con <a href> (recarga completa): así el store y el
// motor de la app privada no se mezclan con los de una vista pública.
const routes = [
  { path: "/", name: "app", component: App },
  { path: "/p/:id", name: "public_project", component: () => import("./views/PublicProject.vue") },
  { path: "/gallery", name: "gallery", component: () => import("./views/Gallery.vue") },
  // cualquier otra ruta va a la app
  { path: "/:pathMatch(.*)*", redirect: "/" },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})
