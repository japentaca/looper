# AGENTS.md — Looper

Instrucciones para agentes de código (OpenCode, VS Code/Copilot, Claude Code, Cursor, Codex,
harnesses con DeepSeek u otros modelos). Es la **fuente única de verdad** para LLMs: si otra
herramienta necesita su propio archivo (`CLAUDE.md`, etc.), ese archivo solo debe apuntar acá.

## Qué es

Looper es un reproductor de loops aleatorio. Cada usuario sube archivos de audio (mp3/wav/ogg/flac/m4a/aiff, de hasta 1 minuto; se recodifican a mp3), los
agrupa en **Track Groups** (cada grupo = una pista que suena en paralelo) y los etiqueta con
**Tags** (secciones musicales). Al darle START, en cada pista se elige un loop al azar compatible
con el Tag activo; el Tag cambia al azar cada 2^n beats (tiempos). Todo se sincroniza con un tempo (BPM).

Proyecto personal, programado a mano entre 2022 y 2024, sin tests. A partir de ahora se mantiene
con LLMs.

## Stack

| Parte | Tecnología |
|---|---|
| Backend | Node.js (ESM), Express 4, knex + better-sqlite3, express-session + Redis (ioredis, connect-redis), bcrypt, express-fileupload, ffmpeg/ffprobe (paquetes `ffmpeg-static`/`ffprobe-static`) |
| Frontend | Vue 3 (`<script setup>`), Vite 5, vue-router 4 (historial HTML5), Element Plus, Tone.js 14 (motor de audio), signalsmith-stretch 1.3.2 (WASM, MIT: transpose y STRETCH del editor, offline en un Worker), axios, @vueuse/core |
| Datos | SQLite (archivo en `storage/db.sqlite`), audios en `storage/audio/<user_id>/<file_id>.mp3` |

## Estructura

```
backend/
  index.js           # arranque: dotenv → globals (config, knex, redisClient) → sesión → CORS → /api → migraciones → listen → loudness en segundo plano
  routes/api.js      # TODOS los endpoints REST (un solo router)
  db_migrations.js   # "migraciones" idempotentes caseras (hasTable/hasColumn) + fill_file_loudness (relleno en segundo plano tras el listen)
  utils.js           # probe (ffprobe: ¿es audio?, duración), convert (ffmpeg → mp3 V0, normalizado salvo las copias del editor), measure_ebur128 (loudness/pico), extensión de archivo
  ecosystem.config.cjs # pm2 en el servidor (app `looper`, una instancia fork, sin secretos)
frontend/src/
  main.js            # monta Root.vue (solo <router-view>) con Element Plus y el router
  router.js          # rutas: / (App.vue), /p/:id (views/PublicProject.vue), /gallery (views/Gallery.vue)
  views/             # vistas públicas sin sesión: Gallery.vue (galería), PublicProject.vue (proyecto público en modo lectura: store.read_only, nada se guarda)
  App.vue            # layout: barra superior (placa, LED de estado, LCD de preview, sesión), sidebar de pads + Tracks + Uploader + Files
  components/
    Tracks.vue       # ⚠ MOTOR DE REPRODUCCIÓN (scheduling con Tone.Transport, selección aleatoria)
    Files.vue        # lista de archivos (vista Box = cartuchos con LED, o Table; ambas con play/editar/borrar), drag&drop de TRG/Tag, filtro por tonalidad, switch SYNC; monta FileEditor y confirma los borrados
    FileCart.vue     # cartucho de la vista Box: calcula adentro si el archivo suena (Files.vue no lee el estado del motor; ver ARCHITECTURE)
    FileEditor.vue   # editor de un archivo (diálogo de edición; lo monta Files.vue con v-model + file, emite delete y replaced): RegionEditor, EditOps, tipo/beats/key/anchor (dueño), tonalidad efectiva, "Derived from", DETECT (tonalidad / nota, SET key, TUNE TO), Volume/Loudness/Transpose (+ KEY LOCK)/Weight/Repeat, pads de pista y tags, preview SYNC + MIX/IN CONTEXT/SOLO, atajos Espacio/Q/M/Esc
    WaveScreen.vue   # pantalla de onda del editor (FileEditor.vue): canvas LCD, grilla de loops/shots, cursores del preview y del motor, región con manijas, selección (docs/PLAN_EDITOR.md)
    RegionEditor.vue # región del archivo en el proyecto (editor, fase 3): monta WaveScreen + SNAP, NUDGE/AUTO, FADE, lupas, atajos G y ← / →; guarda en project_files.props. Fase 6: la selección (SNAP) y, con ediciones sin guardar, el buffer de trabajo (solo lectura)
    EditOps.vue      # ediciones destructivas del editor (fase 6): CUT/SILENCE/DUPLICATE/REVERSE/GAIN, STRETCH (fase 7, loops), UNDO/REDO, SAVE AS COPY / SAVE SEL AS COPY (render, WAV, subida), atajos Supr/Ctrl+D/R/Ctrl+Z/Ctrl+Y
    WaveLoupe.vue    # lupa chica del editor (tramo de audio ampliado con marcas): inicio y costura de la región
    SidebarItem.vue  # pad de la sidebar (editable, draggable, se ilumina si suena/está activo); kind="track_group"|"tag" (KINDS)
    TagDialog.vue    # diálogo de edición de un Tag (nombre, color, peso en el sorteo); lo abre el lápiz del pad
    FxPad.vue        # pad de un tipo de FX de transición en la sidebar; se arrastra (looper/fx) a una tira de Tracks
    FxDialog.vue     # diálogo de edición de una instancia de FX de una pista (lead, prob, cond, parámetros, quitar)
    Uploader.vue     # subida de archivos (el-upload)
    Login.vue        # diálogo de login y registro (con la licencia); muestra los mensajes del backend
    Account.vue      # diálogo de cuenta propia: bio y cambio de clave
    Projects.vue     # diálogo de proyectos: abrir, crear, renombrar, borrar, visibilidad
    OpenProject.vue  # pregunta al entrar (recarga o login) si se abre el último proyecto, otro o ninguno
    ImportFiles.vue  # diálogo de importar del catálogo al proyecto activo (filtros, preview, memoria; no lista lo que ya está en el proyecto)
    ReportDialog.vue # diálogo de denuncia (POST /report) de un archivo o proyecto; solo con sesión
    PublicBar.vue    # barra superior de las vistas públicas (placa, links a galería y a la app)
    Admin.vue        # diálogo de admin de usuarios (solo role = admin): admitir/rechazar, bloquear, reset, cuota
    hw/              # controles de "aparato físico" en SVG/CSS: Knob (prop disabled: atenuado y sin respuesta), Fader, Lcd, ToggleSwitch, LedButton, Led, LedMeter, GrLed (LED de reducción de ganancia), StepLeds, RangePads (rango [min, max] sobre una lista de valores)
  helpers/
    composable.js    # store global reactivo + carga de audio (Tone.Player por archivo; source_buffer = el original, set_play_buffer = el que toca el motor) + índices por id + add_project_file (copias del editor sin recargar)
    TrackCtrl.js     # estado de transporte (tempo, compás, current_TAG, tracks) y cálculo de beats/compases
    toneLib.js       # preview de un archivo suelto (del proyecto o del catálogo por url): libre o en sync con el motor (SYNC, MIX / IN CONTEXT / SOLO); con ediciones sin guardar, el buffer de trabajo; transpuesto (pitch.js)
    preview_sync.js  # funciones puras del preview en sync: arranque en la grilla, repetición de shots, cursor (tests en preview_sync.test.js)
    mixer.js         # canal por track group (Tone.Channel: mute/solo) + vúmetros (por pista y master) + FX de transición + dinámica del master (worklet, con Tone.Limiter de respaldo)
    fx.js            # catálogo de FX de transición (FX_TYPES), opciones de lead/cond, new_fx y normalización
    engine_oneshot.js # motor (parte de Tracks.vue): pistas one-shot (oneshot_step, disparos con pre-roll según el anchor, cancelaciones en STOP/RESET)
    engine_fx.js     # motor (parte de Tracks.vue): agenda de los FX de transición hacia el fin de cada tirada (fx_step, end_run)
    master_dsp.js    # DSP puro del master (crossover LR4 de 3 bandas, compresor por banda, limitador con lookahead); sin Tone ni window, ver docs/PLAN_MASTER.md
    master_dsp.test.js # tests Vitest del DSP del master (npm test)
    wave.js          # funciones puras de WaveScreen.vue: picos min/max por columna, líneas de la grilla, rótulo ×2/×½ (tests en wave.test.js)
    region.js        # funciones puras de la región (start/stop, nudge, fade): play_window del motor y el preview, snap, cruce por cero, AUTO, lupas (tests en region.test.js)
    edit_ops.js      # funciones puras de las ediciones destructivas: operaciones sobre canales, posiciones a través de ellas, archivo virtual, plan de la copia, WAV (tests en edit_ops.test.js)
    edit_session.js  # sesión de edición destructiva del editor: selección, pila UNDO/REDO, buffer de trabajo (lo toca el preview), archivo virtual, STRETCH (asíncrono)
    transpose.js     # funciones puras de la fase 7: props transpose / key_lock, transpose efectivo (KEY LOCK), tonalidad efectiva, rango y factor del STRETCH (tests en transpose.test.js)
    pitch.js         # pre-render del transpose: buffer transpuesto de cada archivo para el motor (cache por id, recalcula tras calculate_timing) y buffer del preview
    stretch_queue.js # cola de renders offline con Signalsmith (un Worker, un trabajo a la vez, urgentes adelante)
    stretch.worker.js # Worker del render (lo crea stretch_queue.js con ?worker)
    stretch_core.js  # render offline con el WASM de Signalsmith (seek / process / flush, latencia compensada); sin Tone ni window (tests con el WASM real en stretch_core.test.js)
    stretch_scope.js # AudioWorkletGlobalScope simulado para sacar el WASM del paquete (se importa antes que "signalsmith-stretch")
    master_dsp.worklet.js # AudioWorkletProcessor "looper-master" (adapta master_dsp.js; lo carga mixer.js con ?worker&url; el import va en la 1.ª línea)
    master_dsp.worklet.test.js # humo del worklet con el AudioWorkletGlobalScope simulado (npm test)
    loudness.js      # editor: lecturas de loudness/pico con el volumen del proyecto y cálculo de MATCH (puro; loudness.test.js)
    detect.js        # detectores puros del editor (fase 8): tonalidad (cromagrama + Krumhansl), nota (YIN), cálculos de TUNE TO (tests con señales sintéticas en detect.test.js)
    detect_job.js    # arma la señal a analizar (original, región del proyecto, mono) y la manda al Worker de los detectores
    detect.worker.js # Worker de los detectores (lo crea detect_job.js con ?worker)
    api.js           # wrappers de endpoints
    request.js       # instancia axios (baseURL = VITE_APP_BACKEND, withCredentials)
    file_ui.js       # helpers que comparten la lista (Files.vue) y el editor (FileEditor.vue): fuera de tempo, bpm, toggleTag, ANCHOR_TEXT, tonalidad efectiva (key_view), play/stop y títulos del preview y de SYNC
    utils.js         # helpers chicos compartidos: fmt_date, mb, url_autostart, use_msg (aviso de los diálogos), editor_key_ok (foco de los atajos del editor)
deploy/
  deploy.sh          # despliegue al VPS desde la máquina de desarrollo (bash deploy/deploy.sh): ssh → pull, npm ci, build_prd, restart
  .env.deploy.example # datos de conexión (copiar a .env.deploy, gitignored; sin IPs ni secretos en git)
  nginx/             # plantilla del server block de looper.jape.com.ar
storage/             # (gitignored) db.sqlite + audio/. Datos reales del usuario: NO tocar.
docs/                # documentación para humanos y LLMs (ver abajo)
```

## Documentación (leer según la tarea)

- `docs/ARCHITECTURE.md` — flujo de datos, autenticación, modelo de datos (esquema SQLite real),
  algoritmo del motor de reproducción.
- `docs/API.md` — referencia de endpoints.
- `docs/INSTALACION.md` — correrlo como instalación: Chrome en kiosko con el link público
  `/p/<id>?autostart=1` (sin login), recuperación y prueba larga.
- `docs/PLAN_PUBLICACION.md` — plan acordado para publicar en un VPS multiusuario (decisiones,
  esquema, endpoints y fases). Leer antes de trabajar en usuarios, proyectos, subidas o despliegue.
- `docs/DEPLOY.md` — despliegue en el VPS: preparación inicial del servidor, despliegue habitual con
  `deploy/deploy.sh`, respaldo de la base, rollback, verificación y lecciones (pm2, nginx, Cloudflare).
- `docs/LIBRERIAS.md` — cómo incorporar una librería de loops entera en producción (manifiesto,
  `import_manifest.js`, tonalidad, pistas y tags del proyecto). Seguirla cuando el dueño traiga una.
- `docs/PLAN_MASTER.md` — diseño (ya implementado) de la dinámica del master en AudioWorklet: fundamentos
  del DSP, tests y desvíos. Lo vigente está en "Dinámica del master" de `ARCHITECTURE.md`.
- `docs/KNOWN_ISSUES.md` — bugs y deuda técnica detectados. **Leer antes de tocar backend/routes
  o Tracks.vue**; muchos comportamientos raros ya están explicados ahí.

## Cómo correr

Requisitos: Node 24 (ver `.nvmrc`; `better-sqlite3` y `bcrypt` son módulos nativos: si se cambia
de versión de Node hay que `npm rebuild`), Redis accesible (ffmpeg y ffprobe
vienen con los paquetes npm `ffmpeg-static`/`ffprobe-static`; `path_to_ffmpeg`/`path_to_ffprobe` en
`.env` son override opcional). El frontend debe
correr en el puerto 31201 (fijo con `strictPort` en `vite.config.js`), que debe coincidir con `cors_origin`
del `backend/.env`; si no coinciden, el login falla por CORS.

En `backend/.env` usar rutas con `/` (Windows las acepta) y terminar `storage_path` con `/`.
Al editar `.env` desde una shell, no imprimir la línea de `redis_password` (puede tener espacios
alrededor del `=`).

```bash
# backend (puerto según .env, por defecto 31200)
cd backend && npm install && cp .env.example .env   # completar valores
node index.js

# frontend (http://localhost:31201)
cd frontend && npm install
echo "VITE_APP_BACKEND=http://localhost:31200" > .env.local
npm run dev
npm run build_prd    # build de producción (usa .env.prd: https://looper.jape.com.ar)
```

`POST /api/register` crea cuentas `pending`; un admin las admite con `PUT /api/admin/users/:id`
(`{ "action": "admit" }`; ver `docs/API.md`), o desde el diálogo ADMIN de la app. También se pueden crear a mano en la tabla `users` (id uuid, email en
minúsculas, name único, `status = 'active'`, `role = 'user'` y el hash de la clave). Para generar el hash, desde `backend/`:
`node -e "console.log(require('bcrypt').hashSync('la_clave', 10))"`.
Con una base vacía, `db_migrations.js` crea el esquema completo al arrancar.

## Verificación (ESLint; tests con Vitest de las funciones puras de helpers/)

Antes de dar una tarea por terminada:

1. Backend: `node --check` sobre cada archivo modificado y arrancar `node index.js` sin errores.
   Lint: `cd backend && npm run lint` (idem en `frontend`). ESLint con flat config, **sin Prettier**:
   solo chequea sin punto y coma, indentación de 2 y errores comunes (en Vue, `flat/essential`).
   Los `error` hay que dejarlos en cero en lo que se toca; las advertencias heredadas se limpian de a poco.
2. Frontend: `cd frontend && npm run build` debe compilar sin errores. Tests: `cd frontend && npm test`
   (Vitest en Node, `vitest run`; por ahora `src/helpers/master_dsp.test.js`, `master_dsp.worklet.test.js`, `wave.test.js`, `preview_sync.test.js`, `region.test.js`, `loudness.test.js`, `edit_ops.test.js`, `transpose.test.js`, `stretch_core.test.js` y `detect.test.js`) deben pasar todos.
3. Si se tocó la reproducción (`Tracks.vue`, `engine_oneshot.js`, `engine_fx.js`, `composable.js`, `TrackCtrl.js`, `toneLib.js`, `preview_sync.js`, `region.js`, `edit_session.js`, `pitch.js`, `stretch_*.js`, `mixer.js`, `master_dsp.js`, `master_dsp.worklet.js`):
   describir qué se debe probar a mano en el navegador (el audio no se puede verificar en CI).
4. Decir explícitamente qué se verificó y qué no.

Los tests nuevos van con Vitest, junto al archivo que prueban (`*.test.js`), importando
`describe/it/expect` de `"vitest"` (sin globals); `npm test` los toma solos.

## Convenciones de código

Imitar el estilo existente al editar:

- JavaScript plano (sin TypeScript), ESM en ambos lados, indentación de 2 espacios, **sin punto y coma**.
- Nombres en `snake_case` para variables, funciones y endpoints (`save_fileData`, `tags_by_id`);
  componentes Vue en PascalCase. Abreviaturas usadas: `trg` = track group, `u_info` = info de usuario.
- Backend: acceso a DB vía `global.knex`, config vía `global.config` (de `.env`), Redis vía
  `global.redisClient`. Respuestas JSON con forma `{ stat: boolean, text?, data? }`.
- Frontend: estado compartido en `store` (reactive) de `helpers/composable.js`, no hay Pinia/Vuex.
  Cada endpoint nuevo lleva su wrapper en `helpers/api.js`.
- Estilo visual: tema oscuro (`<html class="dark">` + `element-plus/theme-chalk/dark/css-vars.css`). Los colores,
  radios y tipografía base son variables CSS en `frontend/src/style.css` (`--bg`, `--panel`, `--border`, `--accent`...);
  los componentes las usan en su `<style scoped>` en vez de colores sueltos.
  La app es un "loop player" con la estética de hardware de un MPC: componentes propios en `components/hw/` (sin librería de
  controles), variables `--hw_*`, clases globales `.hw_panel` (chasis con tornillos), `.hw_plate` (placa de aluminio
  para faders) y `.silk` (serigrafía). El volumen del editor de archivos (`FileEditor.vue`) también es un `Fader`. El LCD usa
  la fuente DSEG7 local (`src/assets/fonts/`, OFL). Las texturas son imágenes en `frontend/public/textures/`
  (`chassis.jpg`, `metal.jpg`, `plastic_black.jpg`) usadas como `background-image` con color sólido de respaldo si faltan.
  Diálogos y tablas siguen con Element Plus; un diálogo con `class="hw_dialog"` toma la textura del chasis
  (editor de archivos, FX de transición, Projects e Import; en Projects cada proyecto es un cartucho como los de Files). Sus botones
  son `LedButton`; en el editor de archivos la pista y los tags se asignan con pads chicos del color de cada uno.
- Idioma: UI mayormente en inglés, mensajes al usuario y comentarios en español. Commits en español,
  cortos y descriptivos.
- Hay mucho `console.log` comentado; no es necesario limpiarlo salvo que la tarea lo pida.

## Reglas para agentes

- **Se trabaja en `main`.** (`vuelta_a_knex` quedó como rama histórica, igual a `main` al momento
  de adoptarse.) No hacer push ni crear ramas/PRs sin que el usuario lo pida.
- No commitear `.env`, `.env.local`, `storage/`, `dist/` ni `node_modules/`. No leer ni volcar
  secretos de `backend/.env` en la salida.
- No modificar ni borrar `storage/` (son los datos y audios reales). Para probar cambios de
  esquema, trabajar sobre una copia de `db.sqlite`.
- Cambios de esquema: agregarlos en `db_migrations.js` de forma idempotente (`hasTable`/`hasColumn`),
  nunca con SQL manual. Recordar que SQLite no soporta todos los `ALTER` de knex.
- Cambios chicos y enfocados. No refactorizar ni actualizar dependencias de forma oportunista;
  proponerlo primero. Si se arregla algo listado en `docs/KNOWN_ISSUES.md`, actualizar ese archivo.
- Si un cambio afecta endpoints, esquema o el motor de reproducción, actualizar `docs/API.md` /
  `docs/ARCHITECTURE.md` en el mismo cambio. La documentación desactualizada es peor que ninguna.
- Todo endpoint nuevo lleva `require_session` (o `require_admin`) como middleware de ruta **y**
  filtra sus queries por `user_id: req.user.id` (lo deja el chequeo de sesión por request, que lee
  `status` y `role` de la base; no usar `req.session.isLogged` ni `req.session.u_info`). Ver
  "Cómo agregar un endpoint" en `docs/API.md`.
