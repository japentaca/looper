# Arquitectura

## Visión general

```
Navegador (Vue + Tone.js)                     Backend (Express, :31200)            Infra
┌──────────────────────────┐   axios (cookie)  ┌─────────────────────────┐
│ App.vue / componentes    │ ────────────────► │ /api/* (routes/api.js)  │ ──► SQLite (knex)
│ store (composable.js)    │                   │ express-session         │ ──► Redis (sesiones)
│ Tone.Player × archivo    │ ◄──────────────── │ /api/get_file?token=... │ ──► storage/audio/*.mp3
│ Tone.Transport (Tracks)  │   mp3 por GET     │ /api/upload → ffmpeg    │ ──► ffmpeg (wav→mp3)
└──────────────────────────┘                   └─────────────────────────┘
```

- El frontend en dev corre en `http://localhost:31201` y el backend en el puerto `service_port`.
  CORS se configura con `cors_origin` en `.env` (por defecto `http://localhost:31201`), con `credentials: true`.
- En producción el frontend apunta a `https://jape.com.ar/looper` (`frontend/.env.prd`); el backend
  se sirve detrás de un proxy en ese path. La configuración del servidor de producción no está en el repo.

## Backend

`backend/index.js` arma todo con variables globales:

| Global | Qué es |
|---|---|
| `global.config` | contenido parseado de `backend/.env` (ver `backend/.env.example`) |
| `global.knex` | instancia knex sobre better-sqlite3 (`db_file`) |
| `global.redisClient` | cliente ioredis (también usado como store de sesión, prefijo `looper_s:`) |

Orden de arranque: dotenv → knex → express (`express.json()`) → sesión (Redis) → CORS → router `/api`
→ `await do_migrations()` → `listen`.

Todos los endpoints están en `backend/routes/api.js` (ver `docs/API.md`). El middleware
`express-fileupload` se aplica a todo el router con `useTempFiles: true`, límite de 40 MB por archivo y `abortOnLimit` (responde 413). El mismo límite está en `Uploader.vue` (`MAX_UPLOAD_MB`): cambiar ambos juntos.

### Autenticación

1. `POST /api/login` compara la clave con bcrypt contra `users.password`.
2. Si es válida: `req.session.isLogged = true`, `req.session.u_info` = fila del usuario sin
   password + un `token` (uuid v4) nuevo. Además se guarda `HSET "TOKEN:" <token> <session_id>`
   en Redis (hoy nadie lo lee).
3. Las llamadas axios usan la cookie de sesión (`withCredentials`).
4. El audio lo descarga Tone.js por URL, sin cookie, por eso se pasa `token` en query a
   `GET /api/get_file`. La validación de ese token está rota (ver `KNOWN_ISSUES.md`).

No hay registro ni cambio de clave: los usuarios se insertan a mano.

### Subida de archivos

`POST /api/upload` (multipart): por cada archivo genera un `file_id` (uuid), lo mueve a
`storage_path/<user_id>/<file_id>.mp3` (si es `.wav` lo convierte con ffmpeg a mp3 44.1 kHz
estéreo 192 kbps) y, solo si quedó en disco, inserta la fila en `files` con el tamaño real y
actualiza `users.bytes_used`, todo en una transacción. Si algún archivo falla responde 500 con
`{ stat: false, text }` (el `Uploader.vue` lo muestra como error).
**El nombre en disco siempre es `<file_id>.mp3`**; el nombre original queda en `files.original_name`.

## Modelo de datos (SQLite)

Esquema real de `storage/db.sqlite` (oct 2026). Todos los ids son uuid v4 en texto.

| Tabla | Columnas | Notas |
|---|---|---|
| `users` | `id` PK, `password` (hash bcrypt), `email`, `name`, `ts`, `bytes_used`, `max_bytes_uploaded` | `max_bytes_uploaded` no se usa |
| `files` | `id`, `user_id`, `original_name`, `track_group` (id), `tags` (JSON: array de ids de `user_tags`), `size`, `props` (JSON en texto), `tag` (obsoleto) | sin PK; `props = { volume: dB (-50..0, default -6) }` (archivos viejos pueden tener `oneShot: bool`: obsoleto, se ignora; el one-shot es por pista). Un archivo puede tener varios tags. `tag` era el tag único: la migración lo copió a `tags` y quedó como respaldo, ya no se lee ni escribe |
| `user_track_groups` | `id` PK, `user_id`, `name`, `color` (#hex), `props` (JSON en texto), `silences` | Cada track group es una **pista** (la UI lo rotula "Track"). `props = { volume: dB (default 0), mute: bool, solo: bool, rest: 0..1 (default 0), mode: "loop" \| "oneshot" (default "loop"), on_tag_change: bool (default false), density: 0..1 (default 0) }`. `rest` = probabilidad de que la pista descanse al terminar cada loop (solo modo loop); `on_tag_change` y `density` son los disparadores del modo one-shot (ver motor). `silences` es una columna vieja: no se usa, no se devuelve y no se debe reutilizar (los silencios van en `props.rest`) |
| `user_tags` | `id` PK, `user_id`, `name`, `color` | |
| `sets` | `id` PK, `user_id`, `name`, `tracks`, `tags` | tabla prevista, sin uso |

`db_migrations.js` crea todo el esquema de forma idempotente (base nueva o existente). En la base
actual `files` no tiene PK porque se creó a mano. No hay claves foráneas; la integridad se maneja desde el frontend (al borrar
un Tag o Track Group, el front limpia la referencia en cada archivo).

`save_trackGroups` y `save_tags` **reemplazan la colección entera** del usuario (delete + insert).
Solo se guardan las columnas de una lista blanca por tabla (`USER_ROWS_COLUMNS` en `routes/api.js`:
`id, name, color, props` para track groups, `id, name, color` para tags); `props` se serializa a JSON.
Los campos extra que el cliente agrega a los objetos se ignoran.

## Frontend

### Estado

`helpers/composable.js` exporta un `store` reactivo global (no hay Pinia):

- `store.files`: archivos del usuario, enriquecidos en el cliente con `track_group_obj`, `tag_objs`
  (objetos de `store.tags` de cada id de `tags`; se mantienen con `set_file_tags` / `toggle_file_tag`),
  `isLoaded`, `duration`, `duration_fixed`, `beats`, `bars`, `index`, `original_name_short`, etc.
  Estos campos **no** existen en la DB.
  Los tags se asignan arrastrando un pad de Tag sobre un archivo (toggle: si ya lo tiene, lo quita)
  o desde el diálogo de edición de `Files.vue` (✕ en cada chip y un select para agregar).
- `store.track_groups`: al cargar se completa `props` con los defaults (`trg_default_props()` en
  `composable.js`) más lo guardado. Las pistas nuevas (`addTrackGroup` en `App.vue`) nacen con los
  defaults. Los cambios de mixer se guardan con `save_trackGroups_debounced()` (500 ms).
- `store.tags`, `store.u_info`, `store.curr_file` (preview; usa el flag `isPreviewing`, distinto del `isPlaying` que pone el motor en cada archivo), `store.loading`.

Índices auxiliares (objetos planos, no reactivos, se reconstruyen con `rebuildIndexes()`):
`files_by_id`, `track_groups_by_id`, `tags_by_id`, y `audio_players` (id de archivo → `Tone.Player`).

### Carga inicial

`App.vue` `onMounted` → `store_get_user_info()`:
1. `GET /api/get_user_info` trae usuario + archivos + track groups + tags.
2. Arma índices y resuelve `track_group_obj` / `tag_objs` de cada archivo (descarta ids de tags
   que ya no existen).
3. Crea un `Tone.Player` por archivo con URL `get_file?file=<id>&token=<token>` y espera a que
   todos carguen (`Promise.allSettled`).
   Cada player que termina (bien o con error) suma a `store.load_progress.done`; `App.vue` lo
   muestra como barra de avance (cantidad de archivos, no bytes) y contador junto al LED de estado.
4. `calculateBars()` calcula `beats` y `bars` de cada archivo según el tempo.
5. `TrackCtrl.isReady = true` habilita START.

### Motor de reproducción (`components/Tracks.vue`)

Conceptos:
- **Track** = un Track Group (pista); cada track reproduce un archivo a la vez. Hay un track por
  cada track group, tenga o no archivos (sin archivos queda en silencio).
- **Tag activo** (`current_TAG`) = filtra qué archivos pueden sonar. Un archivo puede tener varios
  tags y es compatible con el Tag activo si lo incluye; un archivo sin tags es compatible con cualquier Tag.
  Los Tags que se sortean son la unión de los tags de todos los archivos cargados.
- **Beats de un archivo** = `round(duration / (60 / tempo))` (`TrackCtrl.js`). Los loops deben estar
  cortados a compás para que el encastre sea correcto.

Flujo:
1. `start()`: agrupa archivos por track group (`files_per_TRG`, con un array, quizás vacío, para
   cada track group) y por tag; crea un track por cada track group de `store.track_groups`; elige un Tag (`selectTag`) y calcula archivos disponibles por track
   (`get_available_files_x_tag`); arranca `Tone.Transport`.
2. `Tone.Transport.scheduleRepeat(set_next_step, "4n")`: callback **en cada negra (beat)**.
3. `selectTag()`: Tag al azar; duración = `2^n` con `n` al azar dentro del rango de los faders MIN/MAX
   (5..9), medida en beats (la UI lo rotula "beats"; el contador se decrementa por beat).
4. `set_next_step(time)`:
   - Si al Tag le queda 1 beat: elige nuevo Tag, recalcula disponibles y, si cambió, corta los
     tracks cuyo archivo no incluye el tag nuevo (los que lo incluyen o no tienen tags siguen
     sonando: un loop con tags A y B atraviesa el cambio de A a B).
   - Por cada track con `remaining_beats == 0`: si no tiene archivos disponibles para el Tag, no
     hace nada (silencio); si no, elige al azar un archivo disponible de su track group, lo arranca en `time` (tiempo de audio exacto que da Tone) y fija
     `remaining_beats = beats - 1`. Si no, decrementa (en descanso solo cuenta) y actualiza el progreso.
   - **Descanso (`trg.props.rest`, 0..1)**: después de sortear el archivo, con probabilidad `rest`
     la pista **descansa** en vez de arrancarlo: `resting = true`, `curr_file = null` y
     `remaining_beats = beats - 1` **del archivo sorteado** (mínimo 1 beat). O sea, el descanso dura
     lo mismo que un loop compatible al azar: son beats enteros contados desde un beat del
     transporte, así que al volver la pista sigue alineada al compás igual que si hubiera sonado un
     loop. Si había un archivo, se le hace `stop(time)` en ese mismo beat. Al llegar otra vez a 0 se
     repite la lógica normal (puede volver a descansar, con la misma probabilidad).
     El cambio de Tag no toca a una pista en descanso (no tiene archivo que cortar): termina su
     descanso y después sortea entre los compatibles con el Tag nuevo. RESET y STOP sí cortan el
     descanso. Con `rest = 0` el motor se comporta como antes.
   - **Pistas one-shot (`trg.props.mode == "oneshot"`)**: no participan de la lógica de loops
     (ni `remaining_beats` ni descansos); en cada beat pasan por `oneshot_step(track, time, n,
     tag_start, downbeat)`, que dispara si:
     - `on_tag_change` y empieza un Tag (`tag_start`): `selectTag()` levanta el flag `tag_starting`
       y el primer `set_next_step` siguiente lo consume. Desde `set_next_step` es el mismo beat (el
       mismo `time`) en que se elige el Tag; desde `start()` es el primer beat del transporte y desde
       RESET el beat siguiente. Dispara en cada Tag nuevo, aunque el sorteo repita el mismo Tag.
     - o `density` (0..1): en cada downbeat se tira el dado con esa probabilidad. El downbeat se
       calcula en el callback de audio desde los ticks del transporte en `time`
       (`n = round(ticks / PPQ)`, `n % beats_x_bar == 0`), no desde el estado visual.
     Se pueden combinar (dispara una sola vez si coinciden). El archivo se sortea entre
     `available_files_per_TRG` de la pista, que si el Tag cambió en ese beat ya es la del Tag nuevo.
     Se arranca con `start_file(f, time)` (pasa por el canal: respeta mute/solo y mueve el vúmetro)
     y **suena entero** (no se le agenda `stop`, y el cambio de Tag no lo corta porque la pista no
     tiene `curr_file`). Si ese mismo player ya está `started`, se saltea el disparo (no se reinicia).
     El nombre (`track.last_shot`) y el destello del LED (`track.shot_n`) se actualizan con
     `Tone.Draw.schedule(..., time)`. Si la pista pasa de loop a one-shot con un loop sonando, ese
     loop se corta en el beat siguiente; de one-shot a loop, la pista sortea un loop en el beat
     siguiente (`remaining_beats` quedó en 0). RESET no corta los disparos que suenan (solo elige
     Tag y recalcula los disponibles); STOP sí los corta (todos los archivos de la pista que estén
     `started`, porque puede haber varios superpuestos).
5. Después de `set_next_step`, el mismo callback agenda con `Tone.Draw.schedule(..., time)` la
   actualización de `beat` (`n` = número de beat del transporte, `downbeat` = primer tiempo del
   compás), que hace destellar los LEDs del panel de Tracks cuando el beat suena de verdad y
   alimenta el LCD de posición "compás.tiempo" (`bar_position`; `start()` reinicia `beat.n`). Las
   tiras de canal muestran el beat del loop (`beats - remaining_beats`) en un medidor de LEDs y un LCD.
   En descanso (`curr_file` null) el LED de actividad y los LEDs de paso quedan apagados y el LCD
   en blanco con el rótulo `REST`.
   El TAG actual se muestra en un LCD con `current_TAG.remaining_beats` como cuenta regresiva
   (de `duration` a 1) y un LED que destella en los últimos 4 beats antes del cambio.
   `current_TAG` y `tracks` viven en `TrackCtrl` (los escribe solo `Tracks.vue`): así los pads de la
   barra lateral (`SidebarItem.vue`) se iluminan si su Track Group tiene un archivo sonando
   (`curr_file.isPlaying`) o si su Tag es el activo.
6. Las tiras de canal se arman con la lista computada `strips` (todos los `store.track_groups`, cada
   uno con su track de `TrackCtrl.tracks` si existe), así se ven y se configuran (volumen, mute,
   solo, descanso) también con el transporte detenido y en pistas sin archivos. El `Knob` chico
   "Rest" (0..1, paso 0.05) escribe `trg.props.rest` y guarda con `save_trackGroups_debounced()`;
   el motor lo lee en cada sorteo, así que un cambio vale desde el próximo fin de loop.
   Un `LedButton` LOOP/SHOT (LED amarillo encendido = one-shot) cambia `props.mode`; el motor lo toma
   en el beat siguiente. En modo one-shot la tira oculta el knob Rest y los `StepLeds`, el LCD
   muestra `SHOT`, el LED de actividad (amarillo) destella en cada disparo, debajo se ve el nombre
   del último disparo y aparecen el knob "Dens" (`props.density`, paso 0.05) y el botón "TAG"
   (`props.on_tag_change`). Todo se guarda con `save_trackGroups_debounced()`.
   RESET también recalcula `available_files_per_TRG` para el Tag nuevo (antes seguía usando los
   del Tag anterior hasta el próximo cambio).

Reglas para modificar el motor:
- Todo lo que suene debe programarse con el `time` del callback (no con `Date`/`setTimeout`), si no
  se pierde la sincronía. Lo visual que deba coincidir con el audio va con `Tone.Draw.schedule`
  (usa `requestAnimationFrame`: con la pestaña oculta no se dibuja, pero el audio sigue).
- `Tone.start()` debe llamarse desde un gesto del usuario (política de autoplay del navegador).
- Los volúmenes están en dB (`props.volume`), aplicados al `Tone.Player` antes de `start`.

### Mixer y vúmetros (`helpers/mixer.js`)

- Un `Tone.Channel` por track group (estéreo, `channelCount: 2`) conectado a `Destination`. Los
  canales se crean para **todos** los track groups (un `watch` sobre los ids de `store.track_groups`:
  al cargar, al agregar un pad) con lo guardado en `props`, y se eliminan al borrar el pad (antes se
  le quita el solo para no dejar callados a los demás). `start_file` llama a `route_player(id)`, que saca al player de `Destination` (los players se crean
  con `.toDestination()` en `composable.js`) y lo conecta al canal de su grupo. Se hace una sola vez
  por player (WeakMap player → grupo); si el archivo cambió de grupo se pasa al canal nuevo.
- **Volumen / mute / solo**: viven en `trg.props.volume` (dB), `trg.props.mute` y `trg.props.solo`
  y se guardan en la base (`save_trackGroups_debounced`). `set_volume`, `toggle_mute` y
  `toggle_solo` escriben `props` y lo aplican al `Tone.Channel` (que resuelve el solo entre canales:
  si hay alguno en solo, el resto queda callado; puede haber varios en solo). La tira tiene un
  `Fader` chico (−48..+6 dB) y los botones M / S. El estado vive fuera de `TrackCtrl.tracks` porque
  los tracks se rearman en cada START. El volumen del canal se suma al `props.volume` de cada
  archivo (aplicado al player). El preview (`toneLib.js`) no pasa por los canales.
- **Limitador master**: `Tone.Limiter(-1)` insertado con `Tone.getDestination().chain(limiter)`
  (input de Destination → limiter → output). Todo lo que entra a Destination (canales y preview)
  pasa por él, así la salida no clipea aunque coincidan varios loops fuertes.
- Un `Tone.Meter` por canal, **post-mute** (muestra lo que se escucha), y uno estéreo colgado del
  output de `Tone.getDestination()` (o sea **post-limitador**) para el master de la barra superior
  (incluye el preview).
- `levels` (reactive) tiene `level` y `peak` 0..1 (−48 dB → 0, 0 dB → 1) con pico retenido 800 ms.
  Se actualiza con `requestAnimationFrame` solo mientras suena el transporte o un preview, y al
  parar sigue hasta que los medidores caen a cero.
- El avance dentro del loop ya no usa el `LedMeter`: lo muestra `hw/StepLeds.vue` (16 LEDs de paso).

### Preview

`helpers/toneLib.js` tiene un `mainPlayer` separado para escuchar un archivo suelto desde la lista
(`Files.vue` → `playFile`). Copia el buffer del player del archivo.
