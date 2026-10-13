# AGENTS.md — Looper

Instrucciones para agentes de código (OpenCode, VS Code/Copilot, Claude Code, Cursor, Codex,
harnesses con DeepSeek u otros modelos). Es la **fuente única de verdad** para LLMs: si otra
herramienta necesita su propio archivo (`CLAUDE.md`, etc.), ese archivo solo debe apuntar acá.

## Qué es

Looper es un reproductor de loops aleatorio. Cada usuario sube archivos de audio (mp3/wav), los
agrupa en **Track Groups** (cada grupo = una pista que suena en paralelo) y los etiqueta con
**Tags** (secciones musicales). Al darle START, en cada pista se elige un loop al azar compatible
con el Tag activo; el Tag cambia al azar cada 2^n beats (tiempos). Todo se sincroniza con un tempo (BPM).

Proyecto personal, programado a mano entre 2022 y 2024, sin tests. A partir de ahora se mantiene
con LLMs.

## Stack

| Parte | Tecnología |
|---|---|
| Backend | Node.js (ESM), Express 4, knex + better-sqlite3, express-session + Redis (ioredis, connect-redis), bcrypt, express-fileupload, ffmpeg (wav→mp3) |
| Frontend | Vue 3 (`<script setup>`), Vite 5, Element Plus, Tone.js 14 (motor de audio), axios, @vueuse/core |
| Datos | SQLite (archivo en `storage/db.sqlite`), audios en `storage/audio/<user_id>/<file_id>.mp3` |

## Estructura

```
backend/
  index.js           # arranque: dotenv → globals (config, knex, redisClient) → sesión → CORS → /api → migraciones → listen
  routes/api.js      # TODOS los endpoints REST (un solo router)
  db_migrations.js   # "migraciones" idempotentes caseras (hasTable/hasColumn)
  utils.js           # conversión con ffmpeg, extensión de archivo
frontend/src/
  App.vue            # layout: barra superior (placa, LED de estado, LCD de preview, sesión), sidebar de pads + Tracks + Uploader + Files
  components/
    Tracks.vue       # ⚠ MOTOR DE REPRODUCCIÓN (scheduling con Tone.Transport, selección aleatoria)
    Files.vue        # lista de archivos (vista Box = cartuchos con LED, o Table; ambas con play/editar/borrar), drag&drop de TRG/Tag, diálogo de edición
    SidebarItem.vue  # pad de la sidebar (editable, draggable, se ilumina si suena/está activo); kind="track_group"|"tag" (KINDS)
    Uploader.vue     # subida de archivos (el-upload)
    Login.vue        # diálogo de login y registro (con la licencia); muestra los mensajes del backend
    Account.vue      # diálogo de cuenta propia: bio y cambio de clave
    Admin.vue        # diálogo de admin de usuarios (solo role = admin): admitir/rechazar, bloquear, reset, cuota
    hw/              # controles de "aparato físico" en SVG/CSS: Knob, Fader, Lcd, ToggleSwitch, LedButton, Led, LedMeter, StepLeds
  helpers/
    composable.js    # store global reactivo + carga de audio (Tone.Player por archivo) + índices por id
    TrackCtrl.js     # estado de transporte (tempo, compás, current_TAG, tracks) y cálculo de beats/compases
    toneLib.js       # reproductor de preview (un archivo suelto)
    mixer.js         # canal por track group (Tone.Channel: mute/solo) + vúmetros (por pista y master)
    api.js           # wrappers de endpoints
    request.js       # instancia axios (baseURL = VITE_APP_BACKEND, withCredentials)
storage/             # (gitignored) db.sqlite + audio/. Datos reales del usuario: NO tocar.
docs/                # documentación para humanos y LLMs (ver abajo)
```

## Documentación (leer según la tarea)

- `docs/ARCHITECTURE.md` — flujo de datos, autenticación, modelo de datos (esquema SQLite real),
  algoritmo del motor de reproducción.
- `docs/API.md` — referencia de endpoints.
- `docs/INSTALACION.md` — correrlo como instalación: Chrome en kiosko, `?autostart=1`,
  recuperación y prueba larga.
- `docs/PLAN_PUBLICACION.md` — plan acordado para publicar en un VPS multiusuario (decisiones,
  esquema, endpoints y fases). Leer antes de trabajar en usuarios, proyectos, subidas o despliegue.
- `docs/KNOWN_ISSUES.md` — bugs y deuda técnica detectados. **Leer antes de tocar backend/routes
  o Tracks.vue**; muchos comportamientos raros ya están explicados ahí.

## Cómo correr

Requisitos: Node 24 (ver `.nvmrc`; `better-sqlite3` y `bcrypt` son módulos nativos: si se cambia
de versión de Node hay que `npm rebuild`), Redis accesible, ffmpeg instalado. El frontend debe
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
npm run build_prd    # build de producción (usa .env.prd)
```

`POST /api/register` crea cuentas `pending`; un admin las admite con `PUT /api/admin/users/:id`
(`{ "action": "admit" }`; ver `docs/API.md`), o desde el diálogo ADMIN de la app. También se pueden crear a mano en la tabla `users` (id uuid, email en
minúsculas, name único, `status = 'active'`, `role = 'user'` y el hash de la clave). Para generar el hash, desde `backend/`:
`node -e "console.log(require('bcrypt').hashSync('la_clave', 10))"`.
Con una base vacía, `db_migrations.js` crea el esquema completo al arrancar.

## Verificación (no hay tests; sí hay ESLint)

Antes de dar una tarea por terminada:

1. Backend: `node --check` sobre cada archivo modificado y arrancar `node index.js` sin errores.
   Lint: `cd backend && npm run lint` (idem en `frontend`). ESLint con flat config, **sin Prettier**:
   solo chequea sin punto y coma, indentación de 2 y errores comunes (en Vue, `flat/essential`).
   Los `error` hay que dejarlos en cero en lo que se toca; las advertencias heredadas se limpian de a poco.
2. Frontend: `cd frontend && npm run build` debe compilar sin errores.
3. Si se tocó la reproducción (`Tracks.vue`, `composable.js`, `TrackCtrl.js`, `toneLib.js`, `mixer.js`):
   describir qué se debe probar a mano en el navegador (el audio no se puede verificar en CI).
4. Decir explícitamente qué se verificó y qué no.

Si se agregan tests, preferir Vitest (ya alineado con Vite) y documentar el comando acá.

## Convenciones de código

Imitar el estilo existente al editar:

- JavaScript plano (sin TypeScript), ESM en ambos lados, indentación de 2 espacios, **sin punto y coma**.
- Nombres en `snake_case` para variables, funciones y endpoints (`save_fileData`, `track_groups_by_id`);
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
  para faders) y `.silk` (serigrafía). El volumen del diálogo de edición de Files también es un `Fader`. El LCD usa
  la fuente DSEG7 local (`src/assets/fonts/`, OFL). Las texturas son imágenes en `frontend/public/textures/`
  (`chassis.jpg`, `metal.jpg`, `plastic_black.jpg`) usadas como `background-image` con color sólido de respaldo si faltan.
  Diálogos y tablas siguen con Element Plus.
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
