# Problemas conocidos y deuda técnica

Relevamiento hecho en octubre de 2026 sobre la rama `vuelta_a_knex` (commit `34c0cad`), leyendo el
código, sin ejecutarlo. Las referencias son a archivo y función/ruta, no a números de línea.
**Al arreglar algo, borrarlo de esta lista (o marcarlo como resuelto) en el mismo commit.**

Severidad: 🔴 seguridad o pérdida de datos · 🟠 bug funcional · 🟡 deuda técnica / prolijidad.

## Seguridad

- ✅ Resuelto (oct 2026): `get_file` no validaba el token y permitía path traversal. Se reemplazó
  por `GET /file/:id`, público (los archivos son siempre públicos), que valida el uuid y busca el
  dueño en la base. El hash `TOKEN:` que quedó en Redis ya no se usa (se puede borrar).
- ✅ Resuelto (oct 2026): `Login.vue` venía con email y clave reales precargados. Se vació el
  formulario y se cambió la clave (la vieja sigue en el historial público de git, pero ya no sirve).
- ✅ Resuelto (oct 2026): el secreto de sesión estaba fijo en `index.js`; ahora es `session_secret`
  en `.env` (obligatorio: sin él el backend no arranca).
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
- ✅ Resuelto (oct 2026): la cookie de sesión no tenía `maxAge` y se perdía al cerrar Chrome. Ahora
  dura 30 días y se renueva con cada request (`rolling`); el chequeo cada 10 min la mantiene viva.
- 🟡 Pendiente de medir: memoria de la pestaña en 8–12 h (prueba larga de `docs/INSTALACION.md`).

## Frontend — general

- ✅ Resuelto (oct 2026): la request de audio que quedaba colgada si `get_file` no encontraba
  sesión (ahora `GET /file/:id` responde 404).

## Entorno

- ✅ Resuelto (oct 2026): `better-sqlite3@9` no tenía binarios para Node 24; se actualizó a `^12`
  y `.nvmrc` pasó a Node 24. Backend probado: arranca, migra y responde.
- 🟡 Si Redis no tiene clave pero `.env` define `redis_password`, ioredis loguea un warning
  (inofensivo). Dejar `redis_password` vacío en ese caso.
