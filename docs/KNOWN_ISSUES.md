# Problemas conocidos y deuda técnica

Relevamiento hecho en octubre de 2026 sobre la rama `vuelta_a_knex` (commit `34c0cad`), leyendo el
código, sin ejecutarlo. Las referencias son a archivo y función/ruta, no a números de línea.
**Al arreglar algo, borrarlo de esta lista (o marcarlo como resuelto) en el mismo commit.**

Severidad: 🔴 seguridad o pérdida de datos · 🟠 bug funcional · 🟡 deuda técnica / prolijidad.

## Seguridad

- 🔴 **`GET /get_file` no valida el token.** `sessions.find(sess => sess.token = req.query.token)`
  asigna en lugar de comparar, así que siempre toma la primera sesión de Redis y sirve archivos de
  ese usuario a cualquiera. Además el token vive en `sess.u_info.token`, no en `sess.token`, y
  `sessionStore.all` carga todas las sesiones en cada request. Lo correcto sería resolver
  `HGET "TOKEN:" <token>` → session id (ya se guarda en el login) o firmar URLs.
- 🔴 **Path traversal en `get_file`.** `req.query.file` se concatena a la ruta sin sanitizar
  (`../` permite salir del directorio del usuario, siempre con extensión `.mp3`).
- 🔴 **Credenciales por defecto en `Login.vue`**: el formulario viene precargado con un email y
  clave reales (y la clave está en el historial de git). Quitar los valores y cambiar la clave.
  El input de password tampoco usa `type="password"`.
- 🟠 Secreto de sesión fijo (`secret: 'session_secret'` en `index.js`): moverlo a `.env`.
- 🟠 `utils.convert_file` arma un comando de shell interpolando rutas sin comillas: falla con
  espacios en `storage_path` y es frágil ante rutas controladas por terceros. Usar `execFile` con
  array de argumentos.

## Backend

- 🟡 `users.bytes_used` es correcto (recalculado desde `sum(files.size)` en oct 2026 y descontado en `delete_file`),
  pero no se usa para nada; tampoco `max_bytes_uploaded`. Si se implementa una cuota, validarlo en `upload`.

## Frontend — motor de reproducción (`Tracks.vue`)

- 🟡 `files.props.oneShot` (por archivo) quedó obsoleto: el modo one-shot es por pista
  (`user_track_groups.props.mode`, oct 2026). Se quitó el checkbox de `Files.vue` y el default en
  `composable.js`; los valores viejos siguen en la base (no se borraron) y se reenvían tal cual al
  guardar el archivo, pero nada los lee. **No reutilizarlo.**
- 🟡 Las pistas one-shot no encienden su pad en la barra lateral (`SidebarItem.vue` mira
  `curr_file.isPlaying` y una one-shot no tiene `curr_file`). Además `start_file` pone
  `isPlaying = true` en el archivo disparado y nadie lo baja cuando termina solo (tampoco en loops
  reemplazados por otro): el flag no es confiable para saber si un archivo suena.
- 🟡 `user_track_groups.silences` y la tabla `sets` no se usan (`silences` ya no se devuelve en `get_user_info` ni se guarda: al guardar los
  track groups queda en null; en la base actual estaba vacía en todas las filas). Los silencios por
  pista se implementaron en `user_track_groups.props.rest` (oct 2026); `silences` queda como columna
  muerta y **no se debe reutilizar**.

## Frontend — corridas largas (instalación)

Revisión de fase 6 (oct 2026), leyendo el código de Tracks.vue, mixer.js y Tone 14.7. Lo que no se
pudo medir queda para la prueba larga de `docs/INSTALACION.md`.

- ✅ Revisado: `Tone.Draw.schedule` guarda cada evento en un `Timeline` y lo saca (`shift`) cuando
  llega su tiempo, lo ejecute o no (los vencidos se descartan): no se acumulan **mientras la página
  se dibuja**. Con la pestaña oculta `requestAnimationFrame` se frena y los eventos (2 por beat, más
  los disparos one-shot) se juntan hasta que vuelve a verse; en kiosko la pestaña está siempre
  visible. No medido con la pestaña oculta varias horas.
- ✅ Revisado: `beat.n` crece sin límite pero es un número (sin memoria extra) y el LCD ya lo
  trunca; a 160 BPM son ~115 000 beats en 12 h, lejos de cualquier problema de precisión. No se cambió.
- ✅ Revisado: el `scheduleRepeat` del beat y el listener `statechange` del contexto se crean una
  vez por montaje del componente (no por START) y se quitan en `onBeforeUnmount` (antes no se
  quitaban; solo importaba con HMR en desarrollo). El único `Tone.Loop` por START (drift) se elimina
  en STOP. START/STOP repetidos no acumulan eventos en el transporte.
- ✅ Corregido: cada recarga de `store_get_user_info` (después de una subida o un re-login) creaba
  un `Tone.Player` nuevo por archivo y dejaba el anterior (con su buffer) en memoria. Ahora se
  libera el anterior (si está sonando, al terminar).
- 🟡 Timelines internos de Tone que crecen sin tope, pero solo con acciones del usuario (no
  durante una corrida desatendida): el `bpm` del transporte (`TickParam`, memoria infinita) suma un
  evento por cada cambio de tempo, y el estado del reloj del transporte suma eventos en cada
  START/STOP. Los estados de los players (`memory = 100`) y la automatización de los `Param`
  (`memory = 1000`, rampas del drift) tienen tope. No medido en una corrida larga.
- 🟡 Una recarga de `store_get_user_info` con el transporte corriendo deja a los tracks apuntando a
  los objetos de archivo viejos y `stop_file` actúa sobre el player nuevo: el loop que sonaba sigue
  hasta terminar su buffer. Es previo a la fase 6; en una instalación no se sube nada.
- 🟡 La sesión de Looper es una cookie de sesión del navegador (sin `maxAge`): se pierde al cerrar
  Chrome salvo que el perfil "continúe donde lo dejó" (ver `docs/INSTALACION.md`). En Redis vence a
  las 24 h sin requests; el chequeo de sesión cada 10 min la mantiene viva.
- 🟡 Pendiente de medir: memoria de la pestaña en 8–12 h (prueba larga de `docs/INSTALACION.md`).

## Frontend — general

- 🟠 Si `GET /get_file` no encuentra una sesión, el handler lanza dentro del callback de
  `sessionStore.all` y la request queda colgada: el audio no dispara `onerror` y la app no queda
  lista. Se resuelve junto con el arreglo de seguridad de `get_file`.

## Entorno

- ✅ Resuelto (oct 2026): `better-sqlite3@9` no tenía binarios para Node 24; se actualizó a `^12`
  y `.nvmrc` pasó a Node 24. Backend probado: arranca, migra y responde.
- 🟡 Si Redis no tiene clave pero `.env` define `redis_password`, ioredis loguea un warning
  (inofensivo). Dejar `redis_password` vacío en ese caso.
