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
| `files` | `id`, `user_id`, `original_name`, `track_group` (id), `tag` (id), `size`, `props` (JSON en texto) | sin PK; `props = { volume: dB (-50..0, default -6), oneShot: bool }` |
| `user_track_groups` | `id` PK, `user_id`, `name`, `color` (#hex), `silences` | `silences` no se usa |
| `user_tags` | `id` PK, `user_id`, `name`, `color` | |
| `sets` | `id` PK, `user_id`, `name`, `tracks`, `tags` | tabla prevista, sin uso |

`db_migrations.js` crea todo el esquema de forma idempotente (base nueva o existente). En la base
actual `files` no tiene PK porque se creó a mano. No hay claves foráneas; la integridad se maneja desde el frontend (al borrar
un Tag o Track Group, el front limpia la referencia en cada archivo).

`save_trackGroups` y `save_tags` **reemplazan la colección entera** del usuario (delete + insert).

## Frontend

### Estado

`helpers/composable.js` exporta un `store` reactivo global (no hay Pinia):

- `store.files`: archivos del usuario, enriquecidos en el cliente con `track_group_obj`, `tag_obj`,
  `isLoaded`, `duration`, `duration_fixed`, `beats`, `bars`, `index`, `original_name_short`, etc.
  Estos campos **no** existen en la DB.
- `store.track_groups`, `store.tags`, `store.u_info`, `store.curr_file` (preview; usa el flag `isPreviewing`, distinto del `isPlaying` que pone el motor en cada archivo), `store.loading`.

Índices auxiliares (objetos planos, no reactivos, se reconstruyen con `rebuildIndexes()`):
`files_by_id`, `track_groups_by_id`, `tags_by_id`, y `audio_players` (id de archivo → `Tone.Player`).

### Carga inicial

`App.vue` `onMounted` → `store_get_user_info()`:
1. `GET /api/get_user_info` trae usuario + archivos + track groups + tags.
2. Arma índices y resuelve `track_group_obj` / `tag_obj` de cada archivo.
3. Crea un `Tone.Player` por archivo con URL `get_file?file=<id>&token=<token>` y espera a que
   todos carguen (`Promise.allSettled`).
4. `calculateBars()` calcula `beats` y `bars` de cada archivo según el tempo.
5. `TrackCtrl.isReady = true` habilita START.

### Motor de reproducción (`components/Tracks.vue`)

Conceptos:
- **Track** = un Track Group en uso; cada track reproduce un archivo a la vez.
- **Tag activo** (`current_TAG`) = filtra qué archivos pueden sonar. Un archivo sin tag es compatible
  con cualquier Tag.
- **Beats de un archivo** = `round(duration / (60 / tempo))` (`TrackCtrl.js`). Los loops deben estar
  cortados a compás para que el encastre sea correcto.

Flujo:
1. `start()`: agrupa archivos por track group (`files_per_TRG`) y por tag; crea un track por cada
   track group con archivos; elige un Tag (`selectTag`) y calcula archivos disponibles por track
   (`get_available_files_x_tag`); arranca `Tone.Transport`.
2. `Tone.Transport.scheduleRepeat(set_next_step, "4n")`: callback **en cada negra (beat)**.
3. `selectTag()`: Tag al azar; duración = `2^n` con `n` al azar dentro del rango del slider
   (5..9), medida en beats (la UI lo rotula "beats"; el contador se decrementa por beat).
4. `set_next_step(time)`:
   - Si al Tag le queda 1 beat: elige nuevo Tag, recalcula disponibles y, si cambió, corta los
     tracks cuyo archivo tiene un tag distinto al nuevo (los de tag igual o sin tag siguen sonando).
   - Por cada track con `remaining_beats == 0`: elige al azar un archivo disponible de su track
     group, lo arranca en `time` (tiempo de audio exacto que da Tone) y fija
     `remaining_beats = beats - 1`. Si no, decrementa y actualiza el progreso.

Reglas para modificar el motor:
- Todo lo que suene debe programarse con el `time` del callback (no con `Date`/`setTimeout`), si no
  se pierde la sincronía.
- `Tone.start()` debe llamarse desde un gesto del usuario (política de autoplay del navegador).
- Los volúmenes están en dB (`props.volume`), aplicados al `Tone.Player` antes de `start`.

### Preview

`helpers/toneLib.js` tiene un `mainPlayer` separado para escuchar un archivo suelto desde la lista
(`Files.vue` → `playFile`). Copia el buffer del player del archivo.
