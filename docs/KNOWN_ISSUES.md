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
- ✅ Resuelto (oct 2026): `utils.convert_file` armaba un comando de shell interpolando rutas sin
  comillas (fallaba con espacios en `storage_path`). Ahora ffmpeg/ffprobe se ejecutan con
  `execFile` y array de argumentos, y vienen de `ffmpeg-static`/`ffprobe-static`.
- 🟡 `PUT /change_password` no cierra las otras sesiones abiertas del usuario, y el
  `reset_password` del admin (`PUT /admin/users/:id`) tampoco cierra ninguna (connect-redis no
  indexa sesiones por usuario). Si la clave se filtró, bloquear al usuario (corta todas sus
  sesiones en el request siguiente) y después desbloquearlo. Arreglo posible: guardar en `users`
  un contador o fecha de cambio de clave, copiarlo a la sesión al loguearse y compararlo en el
  chequeo por request.

## Backend

- 🟡 Normalización de loudness (oct 2026): los archivos subidos antes se normalizan con
  `backend/normalize_existing.js`, que los recodifica mp3 → mp3 (pérdida generacional mínima, V0).
  Los volúmenes de pista (`project_files.props.volume`) ajustados a oído antes de normalizar pueden
  quedar desbalanceados. Los archivos muy picudos quedan por debajo de -18 LUFS por el tope de
  -1 dBTP, y el encoder mp3 puede pasar ese tope en algunas décimas (más en material muy
  impulsivo); los muy bajos (más de 30 dB por debajo) quedan cortos por el tope de ganancia. Los de
  menos de ~0,4 s no se pueden medir y quedan sin tocar. Como `GET /file/:id` se sirve `immutable`, el
  front pide `/api/file/<id>?v=<AUDIO_VERSION>` (`file_url` en `helpers/api.js`): al reprocesar los
  mp3 del servidor hay que subir ese número y desplegar, o los navegadores siguen con el archivo viejo.
- 🟡 `files.loudness` / `files.peak` (fase 5 del editor) se miden una vez: si se vuelve a correr
  `normalize_existing.js` (recodifica los mp3) quedan desactualizadas. Hay que ponerlas en `null` para esos
  archivos y reiniciar el backend (las vuelve a medir en segundo plano). `import_manifest.js` no las mide:
  quedan `null` hasta el próximo reinicio. Se miden sobre el archivo entero, no sobre la región del proyecto.
- 🟡 `users.bytes_used` es correcto (recalculado desde `sum(files.size)` en oct 2026, sumado en `upload` y
  descontado en `DELETE /files/:id`), pero es solo informativo: la cuota es en segundos de audio
  (`max_seconds` contra `sum(files.duration)`). `max_bytes_uploaded` no se usa (legado: una base nueva ya no la crea).
- 🟡 El límite de los endpoints públicos (`looper_public:<ip>`, 120 requests por minuto, tarea 4.1)
  es por IP: visitantes detrás de la misma IP (una red con NAT) lo comparten. Si Redis no responde,
  los endpoints públicos responden 500 (no se abren sin límite). Depende de que `req.ip` sea la IP
  real del visitante (nginx con `real_ip` de Cloudflare, `trust proxy` = loopback).
- 🟡 Denuncias (`POST /report`, tarea 4.4): las filas de `reports` no se borran cuando se borra el
  archivo (`DELETE /files/:id`) o el proyecto (`DELETE /projects/:id`) denunciado: quedan apuntando a
  un id inexistente (`GET /admin/reports` las tolera: vienen con `target: null`). Si dos envíos simultáneos del mismo
  usuario sobre lo mismo llegan juntos, se guarda una sola fila pero los dos cuentan para el límite
  diario de Redis.
- 🟡 `GET /admin/reports` (tarea 5.1) no pagina: devuelve las 500 más nuevas del estado pedido. Con
  más denuncias, las viejas no se ven (filtrar por `open` para no perder las pendientes; la pestaña
  *Reports* de `Admin.vue` arranca en *Open*). En esa pestaña, el estado del dueño de cada target no se
  actualiza al bloquearlo o desbloquearlo desde *Users*: hay que tocar RELOAD.

## Frontend — motor de reproducción (`Tracks.vue`)

- 🟡 `files.props.oneShot` (por archivo) quedó obsoleto: el modo one-shot es por pista
  (`user_track_groups.props.mode`, oct 2026). Se quitó el checkbox de `Files.vue` y el default en
  `composable.js`; los valores viejos quedaron en `project_files.props` (copiados por la migración),
  pero nada los lee y `save_file` solo guarda `volume` (el backend también filtra con lista blanca),
  así que desaparecen al guardar el archivo. **No reutilizarlo.**
- ✅ Resuelto (oct 2026): las pistas one-shot no encendían su pad en la barra lateral y el flag
  `isPlaying` de cada archivo no bajaba cuando el archivo terminaba solo. Ahora lo baja el `onstop`
  del `Tone.Player` y el pad se enciende si suena cualquier archivo de su Track Group.
- 🟡 `user_track_groups.silences` y la tabla `sets` no se usan (legado: una base nueva ya no las crea; `silences` ya no se devuelve en `get_user_info` ni se guarda: al guardar los
  track groups queda en null; en la base actual estaba vacía en todas las filas). Los silencios por
  pista se implementaron en `user_track_groups.props.rest` (oct 2026); `silences` queda como columna
  muerta y **no se debe reutilizar**.

- ✅ Resuelto (oct 2026): al cambiar de Tag quedaba un silencio de 50–100 ms en las pistas que
  cambiaban de loop (se notaba más con varias a la vez): el loop viejo se cortaba con `stop(-1)`
  (en el momento del callback, que corre hasta `lookAhead` antes del beat) y el nuevo arrancaba
  en `time`. Ahora los dos usan `time`. RESET sigue cortando en el momento (es una acción manual).

- 🟡 Tempo por resample (`playbackRate`): acelerar o frenar un loop cambia también su tono (6 % ≈ un
  semitono). Con varias pistas melódicas a distinto bpm pueden desafinar entre sí; para eso se
  baja la tolerancia (knob Tol). Un stretch que conserve el tono (GrainPlayer, SoundTouch) quedó
  para más adelante.
- 🟡 La `duration` de los archivos subidos antes del cambio de tempo se midió sobre el mp3, que suma
  el relleno del encoder (~50 ms). La migración guardó como `bpm` el tempo del proyecto, pero si el
  dueño después les cambia los beats o el tipo, `PUT /files/:id` recalcula el bpm con esa duración
  y queda ~0,6 % por debajo (en 7 s): suenan levemente más agudos. Los subidos después miden la
  duración sobre el archivo original y no tienen el problema.
- 🟡 Región del editor (fase 3, `helpers/region.js`; ver "Editor: región" en `ARCHITECTURE.md`), limitaciones
  aceptadas: con `nudge` y sin start/stop el loop suena desde el nudge hasta el final del buffer, así que
  la tirada termina con un hueco de ~nudge (el beat del archivo sale del bpm, que se dedujo con la duración
  entera); recortar el stop al último beat no lo evita (la región en beats llega hasta `beats`). El fade del
  motor es en tiempo real (`fadeIn` / `fadeOut` del player) y el del preview en sync está horneado en la copia
  (lo escala el `playbackRate`: unos % de diferencia). El SNAP de shots mira solo el canal izquierdo. Las
  ediciones valen desde el próximo arranque: un loop sonando termina su vuelta con la región vieja.
- 🟡 Anchor de los shots (fase 4, `shot_anchor` / `shot_preroll` de `region.js`; ver "Editor: anchor" en
  `ARCHITECTURE.md`), limitaciones aceptadas: un shot con pre-roll desde `PREROLL_ON_BEAT` (0,1 s; los de menos
  van por el camino del beat arrancando antes, `preroll_path`) va por el camino de los "end" (`preroll_step`): no
  usa `scatter`, no dispara en el primer beat de START ni en el cambio de RESET (no se anticipan) y se decide por
  adelantado con el tempo de ese momento. Un anchor guardado
  que queda fuera de la región no se reescribe (se toca en el borde; el editor avisa). La detección de golpes
  del SNAP (`onsets`) es por umbral simple: en material denso o con crescendos puede no marcar un golpe o
  marcar de más (sin SNAP se ubica libre).
- 🟡 Ediciones destructivas (fase 6; ver "Editor: ediciones destructivas" en `ARCHITECTURE.md`), limitaciones
  aceptadas: la pila vive solo en memoria (recargar o cerrar la pestaña la pierde sin preguntar; cerrar el editor o
  cambiar de archivo sí pregunta) y se descarta al cambiar de proyecto. Mientras hay cambios, región, anchor, NUDGE
  y FADE quedan fijos. CUT, DUPLICATE y REVERSE no llevan rampa en los bordes (con SNAP a beats en un loop la unión
  puede hacer click; SILENCE y GAIN sí la llevan, 2 ms). El buffer de trabajo está a la frecuencia del
  AudioContext (48 kHz en muchos equipos): la copia se sube así y ffmpeg la pasa a 44,1 kHz (otra conversión, más
  la generación de mp3 V0). El WAV es float de 32 bits (~21 MB por minuto estéreo) para no recortar picos sobre
  0 dBFS: una subida más pesada que con 16 bits. Un loop cuya selección o región no da beats enteros se guarda con
  los beats redondeados (silencio al final si faltan; se corta si sobran). Con el transporte en marcha, el original
  reemplazado sigue en memoria (player y `files_by_id`) hasta el próximo STOP, y un shot suyo que esté sonando ya
  no lo corta RESET. "Derived from" muestra el nombre del original aunque esté oculto por el admin.
- 🟡 Un loop que queda fuera de tolerancia mientras suena (por mover el tempo o la tolerancia) termina
  su vuelta con el `playbackRate` nuevo; recién en el próximo sorteo deja de elegirse.

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
  quitaban; solo importaba con HMR en desarrollo). Ya no se crea ningún `Tone.Loop` por START (el del
  drift se eliminó con el drift; los FX de transición son automatización de nodos agendada desde el
  callback del beat). START/STOP repetidos no acumulan eventos en el transporte.
- ✅ Corregido: cada recarga de `store_get_user_info` (después de una subida o un re-login) creaba
  un `Tone.Player` nuevo por archivo y dejaba el anterior (con su buffer) en memoria. Ahora se
  libera el anterior (si está sonando, al terminar).
- 🟡 Timelines internos de Tone que crecen sin tope, pero solo con acciones del usuario (no
  durante una corrida desatendida): el `bpm` del transporte (`TickParam`, memoria infinita) suma un
  evento por cada cambio de tempo, y el estado del reloj del transporte suma eventos en cada
  START/STOP. Los estados de los players (`memory = 100`) y la automatización de los `Param`
  (`memory = 1000`, rampas de los FX de transición) tienen tope. No medido en una corrida larga.
- 🟡 Una recarga de `store_get_user_info` con el transporte corriendo deja a los tracks apuntando a
  los objetos de archivo viejos y `stop_file` actúa sobre el player nuevo: el loop que sonaba sigue
  hasta terminar su buffer. Pasa después de una subida con `Uploader.vue` o de importar; las copias del editor
  (fase 6) ya no recargan el proyecto (`add_project_file`). En una instalación no se sube nada.
- ✅ Resuelto (oct 2026): la cookie de sesión no tenía `maxAge` y se perdía al cerrar Chrome. Ahora
  dura 30 días y se renueva con cada request (`rolling`); el chequeo cada 10 min la mantiene viva.
- 🟡 Pendiente de medir: memoria de la pestaña en 8–12 h (prueba larga de `docs/INSTALACION.md`).
- 🟡 Instalación con el link público (`/p/<id>?autostart=1`, tarea 4.5): lo que se edita en la app
  no llega al kiosko hasta que se recarga la página, y si el admin oculta el proyecto
  o se borra, el kiosko sigue sonando con lo que ya cargó (en la próxima recarga da "Project
  not found", que no se reintenta). El reintento automático de la carga solo cubre fallas de la API
  (sin respuesta, 5xx, 429) con la página ya bajada: si Chrome no puede bajar la página (sin red al
  lanzarlo) queda en su página de error, por eso `INSTALACION.md` recomienda lanzarlo con demora.

## Frontend — general

- 🟡 Dinámica del master (`master_dsp.worklet.js`, ver "Dinámica del master" en `ARCHITECTURE.md`):
  el limitador no mide true-peak (el techo de −1 dBFS es por muestra; entre muestras puede pasarse por
  décimas de dB). En contexto no seguro (`http://` que no sea localhost) no hay AudioWorklet y suena el
  `Tone.Limiter` de respaldo, que deja pasar picos sobre −1 dBFS (knee de 30 dB). Un cuelgue del
  worklet sin error (`onprocessorerror` / `{ t: "error" }`) no se detecta: el master quedaría mudo.
  Otras limitaciones aceptadas: el lookahead suma ~3 ms de latencia a todo el master; el knob Master
  está antes de la dinámica, así que con COMP prendido también cambia cuánto comprime; el makeup de
  GLUE es fijo (`4 dB·amount`), así que en un proyecto de nivel bajo (~−20 dBFS RMS en el bus, lo
  normal con archivos a −6 dB) COMP prendido casi no comprime pero suena ~2 dB más fuerte (sesga la
  comparación on/off); sin worklet (respaldo) el botón COMP queda deshabilitado aunque el proyecto lo
  tenga prendido (no tiene efecto: el compresor no existe en ese camino) y el `title` del grupo dice
  "Requires a secure context (https)" también mientras carga o si falló. En el build de producción
  `esbuild.drop` quita los `console.log`: el mensaje "Master: dinámica en AudioWorklet" solo se ve en dev.
- 🟡 Modo lectura (`/p/:id`, tarea 4.3): si el `:id` cambia mientras el proyecto anterior todavía
  se está cargando (dos navegaciones seguidas dentro de la vista), las dos cargas escriben el store
  en paralelo; la vista descarta el resultado viejo (`load_n`), pero los players y pistas del store
  pueden quedar mezclados hasta la próxima carga. Recargar la página lo arregla. En el uso normal
  (galería → proyecto) no pasa.
- 🟡 `load_project(id)` por sí sola no detiene el transporte: para cambiar de proyecto usar
  `switch_project(id)` (hace STOP), como `Projects.vue`.
- 🟡 Importar del catálogo (`ImportFiles.vue`) recarga el proyecto entero con `load_project` (igual
  que después de una subida): vuelve a descargar (de la caché) y decodificar todos los audios, no
  solo los nuevos, y con el transporte en marcha tiene los mismos efectos que la recarga después de
  una subida (ver "Frontend — corridas largas").
- 🟡 El aviso de memoria al abrir un proyecto (tarea 3.9) es una estimación: supone 44 100 Hz
  estéreo (un AudioContext a 48 kHz ocupa ~9 % más; un archivo mono, la mitad) y
  `navigator.deviceMemory` solo existe en Chromium, redondeada y con tope de 8 GB (el límite nunca
  pasa de 2 GB); en Firefox/Safari se usa un valor fijo (4 GB → 1 GB). No pregunta en la recarga del
  mismo proyecto (después de cada subida) ni con `?autostart=1`.
- 🟡 Los archivos con `available = false` (ocultos o de un dueño bloqueado) ya no se sortean (tarea
  3.8), pero se siguen descargando y decodificando (tienen su `Tone.Player`, ocupan memoria) y se
  pueden escuchar con el preview de `Files.vue`. `available` se lee al cargar el proyecto: un archivo
  ocultado con el transporte en marcha sigue sorteándose hasta recargar el proyecto y hacer START.
- 🟡 Detección de beats al subir (`helpers/bpm_detect.js`, oct 2026): es una sugerencia y puede
  errar. Ambigüedad de octava: un loop con bombo en 1 y 3 y caja en 2 y 4 puede salir a la mitad o al
  doble (87 / 174, 90 / 180); ante la duda gana la cantidad más cercana al tempo del proyecto (para
  reproducir importa poco: `file_timing` prueba ×2 y ×½, aunque ×½ solo con beats pares). Supone
  que el loop empieza en un beat y dura beats enteros: un archivo con silencio al principio o
  cortado fuera de compás confunde la grilla. Loops sin percusión (pads, notas largas) o con swing
  fuerte suelen dar `null` (queda la sugerencia por duración). Probado solo con señales sintéticas
  (clicks y baterías a 90–174 BPM de 4, 8 y 16 beats, también pasadas por mp3), no con un corpus real.
  Decodifica cada archivo otra vez en el navegador (además del `<audio>` para la duración): con
  muchos archivos grandes, la lista tarda en completar las marcas "auto".
- ✅ Resuelto (oct 2026): `files.beats` chocaba con un campo calculado del front (`calculateBars()`
  lo pisaba con duración / tempo). Ahora `beats` lo carga el creador, el backend deduce `bpm` y el
  front calcula aparte `play_rate` / `play_beats` / `in_tempo` (`calculate_timing`, ver "Tempo" en
  `ARCHITECTURE.md`). Catálogo, Files e importar muestran los mismos beats.
- ✅ Resuelto (oct 2026): la request de audio que quedaba colgada si `get_file` no encontraba
  sesión (ahora `GET /file/:id` responde 404).

## Entorno

- ✅ Resuelto (oct 2026): `better-sqlite3@9` no tenía binarios para Node 24; se actualizó a `^12`
  y `.nvmrc` pasó a Node 24. Backend probado: arranca, migra y responde.
- 🟡 Producción detrás de Cloudflare: `POST /api/upload` responde recién después de convertir a
  MP3, y la conversión espera en una cola de concurrencia 1 (1 vCPU). Si la subida más la espera
  pasan de 100 s, Cloudflare corta con 524 aunque nginx (`proxy_read_timeout` 300 s en
  `deploy/nginx/looper.jape.com.ar.conf`) siga esperando: el usuario ve un error y el archivo
  puede quedar guardado igual (no verificado; recargar la lista para ver). Con pocas subidas simultáneas no debería pasar; si pasa, la salida es
  responder antes de convertir (estado "procesando") en vez de alargar timeouts.
- 🟡 Despliegue (`deploy/deploy.sh`): el build nuevo reemplaza a `frontend/dist` entero, así que los
  chunks del build anterior desaparecen. Una pestaña abierta desde antes del despliegue que todavía no
  cargó una vista con `import()` (galería, proyecto público) falla al navegar a ella hasta recargar
  la página. Las requests a `/api` no se ven afectadas (salvo el corte del reinicio, unos segundos).
- 🟡 Producción sin backups: las migraciones corren solas al reiniciar y no tienen vuelta atrás. Antes
  de desplegar un cambio en `db_migrations.js` hay que respaldar la base a mano (`docs/DEPLOY.md`,
  "Respaldo de la base"); el respaldo queda en el mismo disco. Los backups siguen fuera del plan.
- 🟡 Con el usuario ACL de Redis del servidor (sin permiso para `INFO`), ioredis loguea al conectarse
  "Skipping the ready check because INFO command fails: NOPERM". Es inofensivo. Si se usa un
  comando de Redis nuevo, hay que sumarlo al ACL (`docs/DEPLOY.md`, paso 3).
- 🟡 Si Redis no tiene clave pero `.env` define `redis_password`, ioredis loguea un warning
  (inofensivo). Dejar `redis_password` vacío en ese caso.
