// Navegación a un ancla del manual (/manual#<id>) desde el índice y los términos (Term.vue).
// Pasa por el router para que el scroll lo haga scrollBehavior (router.js); con force, volver a tocar el
// ancla actual vuelve a hacer el scroll (sin force el router la ignora por duplicada) y no repite la entrada del historial.
export function go_anchor(router, id) {
  let hash = "#" + id
  router.push({ hash, force: true, replace: router.currentRoute.value.hash === hash })
}
