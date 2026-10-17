# Arquitectura

## Visión general

```
Navegador (Vue + Tone.js)                     Backend (Express, :31200)            Infra
┌──────────────────────────┐   axios (cookie)  ┌─────────────────────────┐
│ App.vue / componentes    │ ────────────────► │ /api/* (routes/api.js)  │ ──► SQLite (knex)
│ store (composable.js)    │                   │ express-session         │ ──► Redis (sesiones)
│ Tone.Player × archivo    │ ◄──────────────── │ /api/file/:id (público) │ ──► storage/audio/*.mp3
│ Tone.Transport (Tracks)  │   mp3 por GET     │ /api/upload → ffmpeg    │ ──► ffmpeg (→ mp3 V0)
└──────────────────────────┘                   └─────────────────────────┘
```

- El frontend en dev corre en `http://localhost:31201` y el backend en el puerto `service_port`.
  CORS se configura con `cors_origin` en `.env` (por defecto `http://localhost:31201`), con `credentials: true`.
- En producción todo sale de `https://looper.jape.com.ar` (`VITE_APP_BACKEND` de `frontend/.env.prd`,
  que usa `npm run build_prd`): nginx sirve el `dist/` en `/` y pasa `/api` a Node, así que el
  frontend y la API son **mismo origen** (CORS solo cuenta en desarrollo). `request.js` usa esa URL
  como `baseURL` y los wrappers de `api.js` ya llevan `/api/...`; las URLs de audio se arman igual
  (`VITE_APP_BACKEND + "/api/file/" + id`). Por eso `VITE_APP_BACKEND` va **sin** `/api` y sin `/`
  final. La configuración de nginx está en el repo como plantilla: ver "Producción (nginx)" en
  Backend. El proceso del backend lo maneja pm2 ("Producción (pm2)") y se despliega con
  `deploy/deploy.sh` ("Producción (despliegue)").

### Rutas del frontend (tarea 4.2)

`vue-router` 4 con historial HTML5 (`createWebHistory`, URLs sin `#`). `main.js` monta `Root.vue`,
que solo tiene el `<router-view>`; las rutas están en `src/router.js`:

| Ruta | Vista | Sesión |
|---|---|---|
| `/` | `App.vue` (la app de siempre: proyectos, edición, motor) | la de siempre (login) |
| `/p/:id` | `views/PublicProject.vue`: proyecto público en **modo lectura** (tarea 4.3, ver "Modo lectura" en Frontend): START/STOP, tempo y mixer local, nada se guarda (404 → "Project not found") | no (con sesión, igual es modo lectura) |
| `/gallery` | `views/Gallery.vue` (grilla en `components/GalleryGrid.vue`, compartida con el diálogo): `GET /api/public/projects` paginado, cada tarjeta enlaza a `/p/:id` | no |
| cualquier otra | redirige a `/` | |

- `?autostart=1` se conserva: `Tracks.vue` y `composable.js` lo leen de `window.location.search`,
  que el router no toca (`/?autostart=1` sigue funcionando igual).
- Entre `/` y las vistas públicas se navega con `<a href>` (recarga completa), para que el store y el
  motor de la app no se mezclen con los de una vista pública. El botón GALLERY de la app abre la
  galería en un diálogo (`GalleryDialog.vue`); abrir un proyecto desde ahí es una navegación completa a
  `/p/:id` en la misma pestaña (corta lo que suena). Entre galería y proyecto público, `router-link`.
- `App.vue` se importa de forma estática (la app carga como antes); las vistas públicas se cargan
  con `import()` (chunks aparte).
- `base` de Vite queda por defecto (`/`): el build se sirve en la raíz de `looper.jape.com.ar` y los
  assets salen como `/assets/...`. En dev, Vite ya devuelve `index.html` para cualquier ruta.
- **Producción:** nginx tiene que devolver `index.html` para las rutas del frontend, si no
  `/p/<id>` o `/gallery` dan 404 al recargar o al abrir un link directo. Lo hace el
  `try_files $uri $uri/ /index.html` de `location /` en la plantilla
  `deploy/nginx/looper.jape.com.ar.conf` (ver "Producción (nginx)" en Backend). `/api` va en su
  propio `location` (nginx elige el prefijo más largo, el orden no importa), así que un 404 de la
  API nunca cae en `index.html`; tampoco un asset inexistente bajo `/assets/` (da 404).
- `vue-router` está fijado en `~4.5.1`: desde la 4.6 pide Vue 3.5 y el proyecto está en Vue 3.4
  (actualizar Vue es otra tarea).

## Backend

`backend/index.js` arma todo con variables globales:

| Global | Qué es |
|---|---|
| `global.config` | contenido parseado de `backend/.env` (ver `backend/.env.example`) |
| `global.knex` | instancia knex sobre better-sqlite3 (`db_file`) |
| `global.redisClient` | cliente ioredis (también usado como store de sesión, prefijo `looper_s:`). Con `redis_username` en `.env` se autentica con ese usuario ACL; en el servidor es uno propio limitado a `~looper*` (ver `docs/DEPLOY.md`), así que toda clave nueva de Redis tiene que empezar con `looper` |

Orden de arranque: dotenv → knex → express (`express.json()`) → sesión (Redis) → CORS → router `/api`
→ `await do_migrations()` → `listen`.

Todos los endpoints están en `backend/routes/api.js` (ver `docs/API.md`). El middleware
`express-fileupload` se aplica **solo a `POST /upload`**, después de los chequeos previos (ver "Subida de
archivos"), con temporales en `<tmpdir del sistema>/looper_upload`, límite de 80 MB por archivo
(`UPLOAD_MAX_MB`) y `abortOnLimit` (responde 413). El mismo límite está en `Uploader.vue`
(`MAX_UPLOAD_MB`) y tiene que entrar en el `client_max_body_size` de nginx: cambiarlos juntos.

### Producción (nginx)

Plantilla versionada: `deploy/nginx/looper.jape.com.ar.conf`, que en el VPS va a
`/etc/nginx/conf.d/looper.jape.com.ar.conf` (un archivo por sitio; `00-default.conf` corta los Host
desconocidos). Se valida con `nginx -t` antes de `systemctl reload nginx`. Resumen:

- Puerto 80 → 301 a HTTPS. En 443 (`http2 on`), certificado de origen de Cloudflare de
  `/opt/cert/` (los nombres de archivo de la plantilla son placeholder: se copian del server block
  de `jape.com.ar` en la puesta en marcha).
- `root` = `frontend/dist` del clon en el servidor, **`/var/lib/looper/looper`** (usuario de
  sistema `looper`, home `/var/lib/looper`). nginx tiene que poder atravesar esos directorios.
- `location /` con `try_files $uri $uri/ /index.html` (rutas de vue-router). `index.html` sale con
  `Cache-Control: no-cache` y `/assets/` (nombres con hash) con un año de caché, ambos con
  `expires` (no `add_header`, ver abajo).
- `/api/` → `http://127.0.0.1:31200` (el `service_port` de `.env`; si cambia, cambiar los dos
  `proxy_pass`), con `Host`, `X-Forwarded-For $remote_addr` y `X-Forwarded-Proto $scheme`. El
  `real_ip` de Cloudflare ya lo resuelve `conf.d/cloudflare-realip.conf` del servidor, así que
  `$remote_addr` es la IP real del visitante, y Express (`trust proxy` = loopback) la toma como
  `req.ip`. La caché `immutable` de `/api/file/:id` la pone Express; nginx no agrega caché a `/api`.
- Límite de cuerpo: 1 MB en general y **90 MB solo en `location = /api/upload`** (80 MB de la app
  más margen del multipart), con `proxy_read_timeout`/`proxy_send_timeout` de 300 s porque la
  respuesta llega después de la conversión (cola de concurrencia 1). Cloudflare corta igual a los
  100 s sin respuesta (error 524) y no deja pasar cuerpos de más de 100 MB.
- Headers de seguridad a nivel `server`, con `always`: `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: frame-ancestors 'none'` (sin embebido en iframes), HSTS (un año, sin
  `includeSubDomains`) y `Referrer-Policy: strict-origin-when-cross-origin`. Un `add_header` dentro
  de un `location` anula todos los heredados: si se agrega uno, repetir los cuatro.

### Producción (pm2)

El backend corre con pm2 según `backend/ecosystem.config.cjs` (`.cjs` porque el backend es ESM y
pm2 carga el archivo con `require`). Sigue el patrón de `carrillion` en el mismo servidor: usuario de
sistema `looper` con su propio daemon pm2 y el servicio `pm2-looper` (`pm2 startup` + `pm2 save`).

- App `looper`, `script: index.js`, `cwd` = `/var/lib/looper/looper/backend`. El `cwd` importa:
  `dotenv` busca `.env` en el directorio de trabajo, y las rutas relativas de `.env` (si las hay)
  también se resuelven desde ahí.
- **Una instancia en modo fork**, nunca cluster ni varias instancias: el token de subida por usuario
  y la cola de conversión viven en memoria del proceso.
- `NODE_ENV=production` (Express deja de mandar el stack en las páginas de error). El archivo no
  tiene secretos: viven en `backend/.env` del servidor.
- `max_memory_restart: 400M` (el VPS tiene 1,9 GB compartidos con `carrillion`, Redis y nginx). Las
  subidas van a archivos temporales y ffmpeg es otro proceso, así que el tope solo mide Node; un
  reinicio por memoria corta la conversión en curso.
- `exp_backoff_restart_delay` para no reintentar en un bucle cerrado si falla al arrancar (Redis
  caído, falta `session_secret`), y `time: true` para tener fecha en los logs
  (`/var/lib/looper/.pm2/logs/`).
- Se reinicia siempre con `systemctl restart pm2-looper`, nunca con `pm2 update`/`pm2 kill` a mano
  ni corriendo `pm2` como root (ver "Estado del servidor" en `docs/PLAN_PUBLICACION.md`).

### Producción (despliegue)

`bash deploy/deploy.sh [-y]` desde la máquina de desarrollo (Git Bash en Windows o cualquier bash
con `ssh` y `git`). No hay staging: lo que está en `origin/main` de GitHub es lo que se despliega.
La preparación inicial del servidor, el respaldo de la base, el rollback y la verificación están en
`docs/DEPLOY.md`.

- **Conexión:** host (alias de `~/.ssh/config`), puerto y usuario salen de `deploy/.env.deploy`
  (copiar de `deploy/.env.deploy.example`; está en `.gitignore`) o de `~/.ssh/config`. Ningún
  archivo versionado tiene IPs, puertos ni usuarios reales. El usuario de SSH tiene que poder usar
  `sudo` (o ser root: entonces usa `runuser`); si `sudo` pide clave, la pide en la terminal
  (`ssh -t`).
- **Antes de conectar** hace `git fetch` y avisa si hay cambios sin commitear, commits sin pushear,
  `main` local atrasado o otra rama activa; con avisos pregunta antes de seguir (`-y` lo saltea; sin
  terminal y sin `-y`, aborta).
- **En el servidor**, como el usuario `looper` (`sudo -u looper`), en `/var/lib/looper/looper`
  (configurable con `DEPLOY_APP_DIR`): verifica que el clon esté en `main` y sin cambios en archivos
  versionados (si no, aborta sin tocar nada), `git pull --ff-only origin main`, `npm ci --omit=dev`
  en backend (compila `better-sqlite3`/`bcrypt` para Linux; las dependencias de desarrollo son solo
  ESLint), `npm ci` y `npm run build_prd` en frontend. El build va a un directorio temporal en el
  home de `looper` y recién al terminar bien reemplaza a `frontend/dist`: si falla, nginx sigue
  sirviendo el build anterior completo.
- **Reinicio:** `systemctl restart pm2-looper` como root (nunca `pm2 update`/`pm2 kill`, nunca `pm2`
  como root). Después espera hasta 40 s a que `DEPLOY_HEALTH_URL` (por defecto
  `http://127.0.0.1:31200/api/public/projects`, desde el propio servidor) responda sin error; si no hay
  `curl`, se saltea el chequeo.
- Con `set -euo pipefail`: cualquier paso que falla corta el despliegue con código distinto de 0.
  Si falla después del `git pull`, el clon queda en el commit nuevo con el proceso viejo corriendo;
  se corrige el problema y se vuelve a correr el script (es repetible: sin commits nuevos reinstala y
  reinicia igual).
- `.gitattributes` fuerza fin de línea LF en `*.sh` (con `core.autocrlf=true` en Windows, un `.sh`
  con CRLF no corre en bash).

### Autenticación

1. `POST /api/login` pasa el email a minúsculas (sin espacios alrededor), lo busca en `users` y
   compara la clave con bcrypt contra `users.password`. Recién con la clave validada mira `status`:
   `pending` responde `{ stat: false, text: "Tu cuenta está pendiente de aprobación" }` sin crear
   sesión; `blocked` (o cualquier estado que no sea `active`) responde y cuenta exactamente como una
   clave inválida ("Usuario o clave inválida"), para no revelar que la cuenta existe. Los fallos se
   cuentan por IP en Redis (`looper_login_fails:<ip>`): con 10 fallos se bloquea 15 min desde el
   primero. Un login correcto (o `pending` con la clave correcta) borra el contador.
2. Solo con `status = 'active'`: `req.session.regenerate()` (id de sesión nuevo), `req.session.isLogged = true`,
   `req.session.u_info = { id }` (solo el id; los datos se leen de la base en cada `get_user_info`).
   Sesiones viejas pueden tener la fila entera: solo se usa el id.
3. **Chequeo por request** (middleware al principio del router): con sesión, lee `status` y `role`
   de `users`. Si el usuario no existe o no está `active`, `req.session.regenerate()` borra la sesión
   de Redis y el request sigue sin sesión (los endpoints con `require_session` responden 401,
   `get_user_info` responde `{ stat: false }`); con sesión válida deja `req.user = { id, role }`.
   `require_admin` pide además `role = 'admin'` (403 si no). Una consulta indexada por request.
4. Las llamadas axios usan la cookie de sesión (`withCredentials`). Cookie `looper_sid`: `httpOnly`,
   `sameSite: lax`, `secure: "auto"` (solo se marca Secure si el request llegó por HTTPS; detrás de
   nginx lo dice `X-Forwarded-Proto`, con `trust proxy` = loopback), 30 días renovables con cada
   request (`rolling`, `resave: false`). El secreto es `session_secret` de `.env`. `logout` destruye la
   sesión y borra la cookie.
5. El audio lo descarga Tone.js por URL, sin cookie: `GET /api/file/:id` es público (los archivos
   son siempre públicos). Valida que `id` sea un uuid (evita path traversal), busca el dueño en
   `files` (404 si no está) y sirve `storage_path/<user_id>/<id>.mp3` con caché `immutable` de un año. El front arma la URL con
   `file_url(id)` (`helpers/api.js`), que agrega `?v=<AUDIO_VERSION>`: subir ese número invalida la
   caché de todos los navegadores si se reprocesan los mp3 (el backend ignora el query).
   Cada respuesta suma los bytes que salieron por el socket (headers y descargas cortadas incluidos)
   a la tabla `traffic`, para controlar el tope de tráfico del VPS. Si en producción el proxy cachea
   o sirve los mp3 directo, ese tráfico no se cuenta acá.

**Registro:** `POST /api/register` crea la cuenta con `status = 'pending'` (ver `docs/API.md`):
nombre repetido (sin distinguir mayúsculas) avisa; email repetido responde lo mismo que el éxito.
Límite de 10 intentos por IP por hora en Redis (`looper_register:<ip>`). Solo un usuario `active`
obtiene sesión, y el chequeo por request corta las sesiones de los que dejan de estarlo.

**Admin de usuarios:** `GET /api/admin/users?status=` lista usuarios (sin hash de clave) y
`PUT /api/admin/users/:id` aplica una acción: `admit` (`pending` → `active`), `reject`
(`pending` → `blocked`), `block` (`active` → `blocked`), `unblock` (`blocked` → `active`),
`reset_password` (clave que define el admin) y `set_max_seconds` (cuota). Ambos con `require_admin`.
Los cambios de estado no se aplican a usuarios `admin`. Ver `docs/API.md`.

**Acceso público (tarea 4.1):** `GET /api/public/projects` (galería paginada) y
`GET /api/public/project/:id` (config, pistas, tags y archivos disponibles para reproducir) no piden
sesión. Un proyecto es visible si es `public`, no está oculto (`projects.hidden`) y su dueño está
`active`; si no, 404 como un id inexistente. Del dueño solo salen el nombre público y la bio (nunca
email ni id). Ambos pasan por un límite de requests por IP en Redis (`looper_public:<ip>`, 120 por
minuto → 429). El audio sigue saliendo de `GET /api/file/:id`, sin ese límite. Ver `docs/API.md`.

**Denuncias (tarea 4.4):** `POST /api/report` pide sesión (`require_session`; sin sesión, 401). Se
denuncia un archivo disponible del catálogo o un proyecto visible (no oculto, dueño activo), ajeno; lo que no
existe o no está a la vista responde 404 (no revela lo oculto). Una denuncia abierta del
mismo usuario sobre lo mismo no se duplica (responde éxito con `duplicate: true`). Límite por
usuario en Redis (`looper_report:<user_id>`, 20 denuncias nuevas cada 24 h desde la primera → 429).
Cada una queda en la tabla `reports` con `status = 'open'`; la revisión es del admin (moderación,
abajo). En el
frontend, `components/ReportDialog.vue` (motivo de hasta 500 caracteres) se abre desde el catálogo
(`ImportFiles.vue`, en archivos ajenos), la galería y `/p/:id`; en estas dos solo si hay sesión
(`GET /get_user_info`) y el proyecto no es del visitante.

**Moderación (tarea 5.1):** todo con `require_admin` (401 sin sesión, 403 si no es admin). El admin
modera, no edita (política 4):
- `GET /api/admin/reports?status=` lista las denuncias (las 500 más nuevas) con los datos del target
  (nombre del archivo o proyecto, estado `hidden` actual, dueño con nombre público y estado) y el
  nombre del denunciante; una denuncia sobre algo ya borrado viene con `target: null`.
  `PUT /api/admin/reports/:id { status }` la cierra (`resolved`), la descarta (`dismissed`) o la
  reabre (`open`). Cerrar una denuncia no oculta nada: son acciones separadas.
- `PUT /api/admin/files/:id/hidden` y `PUT /api/admin/projects/:id/hidden` `{ hidden: bool }`
  escriben `files.hidden` / `projects.hidden`: reversible y sin cascada. Un archivo oculto sale del
  catálogo, de `GET /public/project/:id` y del sorteo (queda en los proyectos con `available = false`);
  un proyecto oculto sale de la galería y de `/p/:id` (404), y su dueño lo sigue viendo con `hidden`.
  No hay que tocar nada más: esos endpoints ya filtraban por `hidden`.
- `GET /api/admin/stats`: tráfico de audio del mes UTC en curso (suma de `traffic`), disco de
  `storage_path` (libre, total y si las subidas están habilitadas según `disk_min_free_gb`),
  usuarios por estado, archivos (total y ocultos), proyectos (total, públicos y ocultos) y denuncias
  abiertas. Ver `docs/API.md`.

**Cuenta propia:** `PUT /api/change_password` cambia la clave pidiendo la actual (validada con
bcrypt; la nueva, 8 a 72 caracteres como en el registro). Los fallos con la actual se cuentan por
usuario en Redis (`looper_pwchange_fails:<user_id>`, 10 cada 15 min). La sesión actual sigue
abierta y **las otras sesiones del usuario no se cierran** (no hay índice de sesiones por usuario;
ver `KNOWN_ISSUES.md`). `PUT /api/profile` edita la bio (hasta 280). La recuperación de una clave
olvidada la hace el admin con `reset_password` (y le pasa la clave temporal por otro canal).

**UI de cuenta** (diálogos dentro de la app, sin rutas propias). `Login.vue` tiene dos modos: login y
"Create account" (registro con email, nombre público, clave repetida, bio opcional y el texto de la
licencia "libre uso dentro de Looper", con checkbox obligatorio). Los mensajes del backend se
muestran en un `el-alert` dentro del diálogo: "pendiente de aprobación" como aviso, la solicitud de
registro recibida como éxito (vuelve al modo login con el email cargado) y el resto como error;
los requests rechazados (500, sin conexión) muestran el texto con `error_text()` de `helpers/api.js`.
`Account.vue` (botón ACCOUNT de la barra superior, solo con sesión) edita la bio y cambia la clave
(pide la actual y la nueva dos veces; la coincidencia se chequea en el front). Las validaciones de
longitud y formato las hace el backend; el front solo limita los campos (`maxlength`).

**UI de proyectos:** `Projects.vue`, un diálogo que se abre con el botón PROJECTS de la barra
superior (al lado, un LCD con el nombre del proyecto activo). Al abrirse refresca la
lista (`refresh_projects()`) y muestra cada proyecto con un LED en el activo, el aviso `hidden` si el
admin lo ocultó y los botones *Open*,
*Rename* (`ElMessageBox.prompt` → `PUT /projects/:id { name }`) y *Delete*. *Create* crea un
proyecto vacío (`POST /projects`) y lo abre. Abrir (o crear) con el transporte en marcha pide
confirmación y hace STOP antes de cargar (`switch_project`). Borrar pide confirmación; si es el
activo hace STOP, manda los guardados diferidos pendientes, lo borra y llama a
`store_get_user_info()`, que abre otro (o crea `My project` si no queda ninguno). Abrir, crear y
borrar están deshabilitados mientras se cargan los audios (`TrackCtrl.isReady`). El STOP lo hace
`stop_transport()` de `TrackCtrl.js`: `stop()` es local de `Tracks.vue`, que lo registra al montarse
con `register_stop(stop)` (y lo quita al desmontarse).

**Importar del catálogo:** `ImportFiles.vue`, un diálogo que se abre con el botón IMPORT de la barra
superior (al lado de PROJECTS; deshabilitado sin proyecto abierto). Busca en `GET /catalog`
(`get_catalog`, 25 por página) con filtros de texto en el nombre, creador (nombre exacto; también se
filtra haciendo clic en el creador de una fila), BPM ± tolerancia (el botón `= TEMPO` pone el tempo
del proyecto), beats y tonalidad (una tónica, que trae mayor y menor, con "+ atonal" para sumar los
atonales). Cada fila muestra nombre, BPM, beats, tonalidad y duración tal como están en la base
(los de la base: `beats` lo carga el creador), creador (la bio en un tooltip), usos y fecha; las propias van marcadas
*mine*. Lo que ya está en el proyecto activo no se lista (`exclude_project` con el id del proyecto,
así el total y el paginado ya vienen sin eso); si igual aparece una (cruce con `store.files`), sale
marcada *in project* y no se puede elegir. La selección se guarda por id y se mantiene al cambiar de página o de filtro
(se vacía al cambiar de proyecto). Preview con `toneLib.js`: si el archivo ya está cargado en el
proyecto usa su buffer (`playFile`); si no, `playUrl` descarga y decodifica solo ese archivo
(`GET /file/:id`), guarda únicamente el buffer del último preview y descarta uno que termine de
cargar después de otro pedido o de STOP; al cerrar el diálogo se corta un preview de un archivo que
no es del proyecto. Abajo, el **total de memoria** del proyecto: `estimate_files_memory(store.files)`
más lo seleccionado, contra `memory_warning_limit()` (la misma cuenta del aviso al abrir un
proyecto), con una barra que pasa a rojo al superar el límite. *Import* (deshabilitado mientras se
cargan audios) manda `PUT /projects/:id/files { add: [ids] }` al proyecto activo —si el total supera
el límite pregunta antes "Import anyway?"— y después recarga el proyecto con `load_project(id)`, como
después de una subida, para crear los players de los archivos nuevos (sin STOP; ver
`KNOWN_ISSUES.md`).

**UI de admin:** `Admin.vue`, un diálogo que se abre con el botón ADMIN de la barra superior. `App.vue`
muestra el botón y monta el componente solo si `store.u_info.role === 'admin'`; para los demás no
existe en el DOM (y el backend igual exige `require_admin`). Al abrirse trae todos los usuarios
(`GET /admin/users`) y los separa en dos pestañas: *Pending* (admitir / rechazar) y *Users* (activos
y bloqueados: bloquear / desbloquear, reset de clave y cuota). Rechazar y bloquear piden
confirmación; el reset pide la clave nueva (la define el admin) y la cuota se carga en minutos (se
guarda en segundos, vacío = default). Con los usuarios `admin` solo ofrece reset y cuota. Cada acción
reemplaza la fila con el usuario que devuelve el backend; los errores se muestran en un `el-alert`.
Desde la tarea 5.2 suma dos pestañas más (al abrir o con RELOAD trae usuarios, denuncias y
estadísticas en paralelo):
- *Reports (n abiertas)*: denuncias de `GET /admin/reports`, filtradas por estado (*Open* por
  defecto, *Resolved*, *Dismissed* o *All*; el filtro va al backend). Cada fila muestra el target
  con su tipo: un proyecto es un link a `/p/<id>` en otra pestaña (da 404 mientras esté oculto), un archivo tiene un botón de preview (`toneLib`: usa el buffer si el archivo está cargado
  en el proyecto activo, si no descarga solo ese mp3 con `GET /file/:id`, que sirve también los
  ocultos; el preview se corta al cerrar el diálogo, como en el catálogo). Etiquetas *hidden*
  y el estado del dueño si no está `active`; un target borrado se ve como *deleted*.
  Acciones: *Hide* (con confirmación) / *Unhide* del target (`PUT /admin/files|projects/:id/hidden`;
  actualiza todas las denuncias sobre lo mismo) y *Resolve* / *Dismiss* / *Reopen*
  (`PUT /admin/reports/:id`; si con el estado nuevo la denuncia ya no entra en el filtro, sale de la
  lista). Cerrar una denuncia no oculta nada: son acciones separadas.
- *Stats*: `GET /admin/stats` en una tabla: tráfico de audio del mes UTC (MB/GB y requests), disco
  libre/total con el umbral de subidas, usuarios por estado, archivos, proyectos y denuncias
  abiertas. Se vuelve a pedir en silencio después de cada acción para mantener los contadores.

### Subida de archivos

`POST /api/upload` (multipart, **un archivo por request**, con `kind`, `beats` y `bpm` opcionales; ver `API.md`):

1. `require_session` (solo usuarios `active`) y `upload_precheck`, **antes de leer el cuerpo**: una
   subida en curso por usuario (un `Map` en memoria `user_id → token`: el backend corre en un solo
   proceso; el lugar se libera al terminar el handler o, si el handler no llega a empezar, al
   cerrarse la respuesta; el token evita que una subida vieja cortada libere el lugar de otra
   nueva), disco libre de `storage_path` >= `disk_min_free_gb` (`fs.statfs`) y cuota no agotada.
2. `express-fileupload` deja el archivo en un temporal. Se valida la extensión
   (mp3/wav/ogg/flac/m4a/aiff/aif), el proyecto, con `utils.probe` que sea audio y que dure
   ≤ 60 s (+0,1 s de margen). La duración se mide **sobre la entrada** (la del mp3 convertido suma
   ~30 ms de relleno del encoder). Se chequea la cuota con esa duración y otra vez el disco.
3. `utils.convert` a `storage_path/<user_id>/<file_id>.mp3` dentro de una **cola global con
   concurrencia 1** (cadena de promesas en memoria: el VPS tiene 1 vCPU). Todo se recodifica a MP3
   V0, también los mp3, normalizado a -18 LUFS / -1 dBTP con ganancia fija (ver `convert` abajo).
   Se loguea la medición y la ganancia aplicada (no se guardan en la base).
4. Transacción: se recalcula la cuota (`users.max_seconds` o `default_max_seconds` contra
   `sum(files.duration)` del usuario), se inserta la fila en `files` (`duration`, `kind`, `bpm`, `beats`,
   `ts` y `size` real del mp3) y se suma `size` a `users.bytes_used`.

Responde `{ stat: true, text, data: archivo }` o `{ stat: false, text }` con un código por tipo de
rechazo (ver `API.md`). En `finally` se borran los temporales y, si no se registró, el mp3
convertido. **El nombre en disco siempre es `<file_id>.mp3`**; el nombre original queda en
`files.original_name`.

En el front, `Uploader.vue` usa `el-upload` solo para elegir archivos (drag o diálogo, con la lista
de extensiones aceptadas): arma su propia lista con tipo (loop/shot) y beats por archivo (sugeridos con `suggest_timing` según la duración y el tempo del proyecto y, si parece un loop, reemplazados por la detección en el audio de `detect_beats`, ver "Tempo"; muestra el BPM que resulta) y tonalidad (`suggest_key` de `helpers/music_key.js` sobre el nombre, marcada "auto"; editable, se manda siempre, vacía = sin dato) y anclaje (`anchor`, Start/End para todos los archivos, default Start; se manda siempre), hace los
chequeos baratos (extensión, 80 MB, nombre repetido; la duración la estima el navegador solo para
avisar) y **envía de a un archivo, en serie**, con `api.upload_file` (sin timeout, con progreso). Los
rechazos muestran el `text` del backend junto al archivo, que queda en la lista. Arriba muestra la
cuota restante ("Te quedan m:ss") con `u_info.quota`. Cada archivo se sube con el `project_id` del
proyecto activo (queda en el proyecto, sin pista ni tags) y, al terminar, recarga `get_user_info` (y
con eso el proyecto activo).

#### ffmpeg / ffprobe (`utils.js`)

Los binarios vienen de los paquetes npm `ffmpeg-static` y `ffprobe-static` (descargan el binario
de la plataforma al instalar: Windows en desarrollo, Linux x64 en el VPS). `path_to_ffmpeg` y
`path_to_ffprobe` en `.env` son un override opcional. Se ejecutan con `execFile` (sin shell: las
rutas van como argumentos, así que espacios o caracteres raros no rompen nada).

- `probe(file)` → `{ is_audio, duration, format, codec }`: corre `ffprobe -print_format json
  -show_format -show_streams`. `is_audio` es true si hay un stream de audio y una duración > 0.
  Si el archivo no es multimedia o no existe devuelve `is_audio: false` (no lanza); solo lanza si
  ffprobe no se puede ejecutar (error de configuración).
- `convert(in, out)` → MP3 **VBR V0** (`libmp3lame -q:a 0`), 44.1 kHz, estéreo, solo el primer
  stream de audio, **sin metadatos** (`-map_metadata -1`, sin ID3v2 ni carátula) y con cabecera
  Xing/LAME (guarda el retardo del encoder, para que el decodificador recorte el silencio inicial y
  el loop empalme). Lanza si ffmpeg falla. Devuelve `{ input_i, input_tp, gain }`.
  **Normalización de loudness** (dos pasadas de ffmpeg, las dos dentro del mismo trabajo de la cola):
  1. `measure_loudness(in)`: `loudnorm=I=-18:TP=-1:LRA=11:print_format=json` solo como análisis
     (`-f null -`; el JSON sale por stderr). Da `input_i` (LUFS integrado) e `input_tp` (true peak).
     Se mide después de la misma conversión a 44.1 kHz estéreo que se codifica.
  2. `loudness_gain`: ganancia fija `min(-18 - input_i, -1 - input_tp)` dB, limitada a ±30 dB y
     redondeada a centésimas; 0 si la medición no es válida (silencio o archivo de menos de ~0,4 s:
     loudnorm da `-inf`) o `input_i <= -70`.
  3. La ganancia se aplica con `volume=<gain>dB` en la recodificación a mp3. **No** se usa loudnorm
     para aplicar (comprime y, en modo lineal, cae a dinámico si no llega): con ganancia fija la
     forma de onda y la unión del loop no cambian. Los archivos muy picudos quedan por debajo de
     -18 LUFS por el tope de pico, y el encoder mp3 puede pasar el -1 dBTP en algunas décimas de dB.
  Los archivos subidos antes de la normalización se procesan una vez con `backend/normalize_existing.js`
  (ver `docs/DEPLOY.md`).

La duración que da ffprobe de un mp3 ya convertido es ~30 ms mayor que la del original (estimación
por el padding del encoder): la duración "real" de un archivo conviene medirla sobre la entrada.

## Modelo de datos (SQLite)

Esquema real de `storage/db.sqlite` (oct 2026). Todos los ids son uuid v4 en texto. Las columnas y tablas marcadas
**legado** existen solo en las bases creadas antes de que se simplificara `db_migrations.js`: nada las lee ni
las escribe y una base nueva no las crea (tampoco se borran de las existentes).

| Tabla | Columnas | Notas |
|---|---|---|
| `users` | `id` PK, `password` (hash bcrypt), `email` (único, minúsculas), `name` (único, nombre público), `ts`, `bytes_used`, `max_bytes_uploaded` (legado), `props` (legado), `status`, `role`, `bio`, `max_seconds` | `status` = `pending` \| `active` \| `blocked`; `role` = `user` \| `admin`; `bio` = texto breve público (~280); `max_seconds` = cuota de audio en segundos (`null` = `default_max_seconds` de `.env`, default 1200; la usa `/upload`). Índices únicos `users_email_unique` y `users_name_unique` (en SQLite los `NULL` no chocan; el único es sensible a mayúsculas en `name`). Al crear `status`/`role` una migración (ya quitada) dejó a los usuarios existentes `active`/`user` y a `jntaca@gmail.com` `admin` y pasó a minúsculas los emails; en una base nueva el primer admin se pone a mano (`role = 'admin'`). Si hay emails o nombres repetidos, la migración falla y el backend no arranca hasta resolverlos a mano. `max_bytes_uploaded` no se usa. `props` (**obsoleta** desde la fase 3: la migración a proyectos la copió a `projects.props` del primer proyecto del usuario; queda como respaldo; nada la lee ni la escribe: la config sale de `GET /projects/:id` y se guarda con `PUT /projects/:id`; `save_user_props` se eliminó en la tarea 3.6) = era la config global del usuario: `{ tempo: BPM (10..160, default 138), beats_x_bar: "3" \| "4" (default "4"), tag_range: [min, max] exponentes n de 2^n beats del cambio de Tag (5..9, default [6, 7]), delay: { type (default "pingpong"), division (default "8n."), feedback: 0..0.9 (default 0.4), level: dB −24..+6 (default 0) } }` (ver mixer) |
| `files` | `id`, `user_id`, `original_name`, `track_group` (legado), `tags` (legado), `size`, `props` (legado), `tag` (legado), `duration`, `kind`, `bpm`, `beats`, `music_key`, `anchor`, `ts`, `hidden` | sin PK; `hidden` = oculto por el admin (entero 0 \| 1, `NOT NULL DEFAULT 0`: los existentes y los insert que no lo mencionan quedan en 0; lo lee la API de archivos en proyectos para `available` e impedir importarlo; lo escribe el admin con `PUT /admin/files/:id/hidden`, tarea 5.1; catálogo y motor, fases 3–5); `duration` = segundos (float, medida con ffprobe sobre el archivo subido; la cuota suma esto); `kind` = `loop` \| `shot` (`NOT NULL DEFAULT 'loop'`); en los loops `beats` (entero) lo carga el creador y `bpm` (float) lo deduce el backend (`beats × 60 / duration`); en los shots ambos `null`. `music_key` = tonalidad (texto, hasta 8): nota con grafía fija más `m` si es menor (`G`, `C#m`, `Bb`), `atonal` (sin tonalidad: combina con cualquiera) o `null` (sin dato); la normaliza y sugiere por el nombre `utils.js` (`normalize_key`, `suggest_key`; misma lógica en `frontend/src/helpers/music_key.js`); al crear la columna una migración (ya quitada) la completó con la sugerencia del nombre de cada archivo; sirve para filtrar (catálogo y lista de archivos), el motor no la usa. `anchor` = anclaje de un disparo one-shot: `start` (empieza en el punto de disparo) \| `end` (termina en él: riser, crash invertido) (`NOT NULL DEFAULT 'start'`); las pistas de loops lo ignoran; no se pisa por proyecto. Una migración (ya quitada) completó los loops sin beats con la cuenta que antes hacía el front (`round(duration × tempo / 60)`, con el tempo de su primer proyecto) y como `bpm` dejó ese tempo cuando la cuenta daba a menos de 2 % (la `duration` de los archivos viejos se midió sobre el mp3, con el relleno del encoder); con un bpm fuera de 20..400 pasan a shot; `ts` = fecha de alta (ISO sin ms, como `users.ts`). La migración completa `duration` en cada arranque para los archivos que la tengan en `null`, midiendo su mp3 con `utils.probe` (no se recodifica; si el mp3 falta o no es audio avisa y queda `null`); al crear `ts` los archivos que ya existían tomaron la fecha de modificación de su mp3. `/upload` carga `duration`, `kind`, `bpm`, `beats`, `music_key`, `anchor` y `ts`; `props = { volume: dB (−60 = silencio .. 0, default -6) }` (archivos viejos pueden tener `oneShot: bool`: obsoleto, se ignora; el one-shot es por pista). Un archivo puede tener varios tags. `tag` era el tag único: una migración lo copió a `tags`. `track_group`, `tags` y `props` son **obsoletas** desde la fase 3: la migración a proyectos las copió tal cual a `project_files` (una fila por archivo en el primer proyecto de su dueño); quedan como respaldo y ya nada las lee ni las escribe (desde la tarea 3.4 la pista, los tags y el volumen se editan por proyecto con `PUT /projects/:id/files`; `save_fileData` se eliminó; los archivos nuevos las dejan en null). Metadatos (`original_name`, `kind`, `beats`, `music_key`, `anchor`; `bpm` se recalcula) los edita solo el dueño con `PUT /files/:id`; `DELETE /files/:id` borra el archivo y en cascada sus filas de `project_files` en todos los proyectos. Disponible (`available` en la API) = `hidden = 0` y dueño `active`. `GET /catalog` lista solo los disponibles (de todos los usuarios), con el nombre público y la bio del dueño y `uses` = filas de `project_files` que lo usan (índice en `project_files.file_id`) |
| `user_track_groups` | `id` PK, `user_id`, `name`, `color` (#hex), `props` (JSON en texto), `silences` (legado), `project_id` (índice) | Cada track group es una **pista** (la UI lo rotula "Track"). `project_id` = proyecto al que pertenece (fase 3; cargado por la migración a proyectos en las filas existentes; la API lee y reemplaza las pistas por proyecto con `GET /projects/:id` y `PUT /projects/:id/track_groups`). `user_id` se sigue cargando (= dueño del proyecto). `props = { volume: dB (default 0), rest: 0..1 (default 0), rest_len: [min, max] de 4 \| 8 \| 16 \| 32 compases (default [4, 4]), mode: "loop" \| "oneshot" (default "loop"), on_tag_change: bool (default false), density: 0..1 (default 0), bars: 1 \| 2 \| 4 \| 8 \| 16 \| 32 \| 64 (default 1), reverb: dB \| null (default null = sin reverb), delay: dB \| null (default null = sin delay), fx: [instancia] (default []) }`. `rest` = probabilidad de que la pista descanse al terminar cada loop (solo modo loop) y `rest_len` el rango de duración de ese descanso; `on_tag_change`, `density` y `bars` son los disparadores del modo one-shot (ver motor); `reverb` (send a la reverb compartida, `null` = nada, porque `-Infinity` no sobrevive a JSON), `delay` (send al delay global, ídem) y `fx` (FX de transición: `{ id, type, lead, prob, cond, ...parámetros }`, ver "FX de transición") son de los efectos (ver mixer). Un `drift` guardado de antes (el drift se eliminó) se ignora: no se migra ni se borra. `silences` es una columna vieja: no se usa, no se devuelve y no se debe reutilizar (los silencios van en `props.rest`) |
| `user_tags` | `id` PK, `user_id`, `name`, `color`, `project_id` (índice), `weight` | `weight` = peso en el sorteo del próximo Tag (entero 0..32, `NOT NULL DEFAULT 16`: los existentes quedaron en 16; 0 = no sale nunca). `project_id` = proyecto al que pertenece (fase 3; cargado por la migración a proyectos en las filas existentes; la API los lee y reemplaza por proyecto con `GET /projects/:id` y `PUT /projects/:id/tags`). `user_id` se sigue cargando (= dueño del proyecto) |
| `projects` | `id` PK, `user_id` (dueño, índice), `name`, `visibility` (legado), `hidden`, `props` (JSON en texto), `ts` | Fase 3; endpoints `/projects` (ver `API.md`). Un solo dueño: toda la API filtra por `user_id` y un proyecto ajeno responde 404. Borrar un proyecto borra sus pistas, tags y filas de `project_files`, y también los archivos del dueño que usaba y que ya no quedan en ningún proyecto (fila de `files`, `bytes_used` y mp3); los ajenos no se tocan. La migración a proyectos creó uno por usuario existente (nombre `My project`). `visibility` (legado: todos los proyectos son públicos) era `private` \| `public` (`NOT NULL DEFAULT 'private'`); `hidden` = oculto por el admin (0 \| 1, `NOT NULL DEFAULT 0`; lo escribe `PUT /admin/projects/:id/hidden`, tarea 5.1); `props` = config del proyecto, misma forma que `users.props` (tempo, `beats_x_bar`, `tag_range`, delay) más `tempo_tol`, `reverb` (`{ ir, level }`, ver "Reverb compartida") (tolerancia de tempo en %, 0..12, default 6) y `master` (volumen master en dB, −60 = silencio .. +6, default 0) y `comp` (compresor multibanda del master, `{ on, amount, low, mid, high }`, ver "Dinámica del master"), que pasa a quedar obsoleta; `ts` = fecha de alta (ISO sin ms) |
| `project_files` | `id` PK, `project_id` (índice), `file_id` (índice), `track_group`, `tags` (JSON en texto), `props` (JSON en texto) | Fase 3 (la migración a proyectos cargó una fila por cada archivo existente; `GET /projects/:id` las devuelve unidas a `files`; las escribe `PUT /projects/:id/files` (importar, editar, quitar), `/upload` con `project_id` y las borra `DELETE /files/:id` en cascada). Un archivo está como mucho una vez por proyecto (lo valida la API; no hay índice único). Importar exige que el archivo esté disponible; uno que deja de estarlo sigue en el proyecto con `available = false`. Un archivo del catálogo usado en un proyecto (propio o importado): `track_group` = id de `user_track_groups` del mismo proyecto, `tags` = array de ids de `user_tags` del mismo proyecto, `props = { volume, weight, repeat? }` (`weight` = peso en el sorteo de su pista, entero 0..32; sin dato = 16, lo completa el front; `repeat` = `[min, max]` de 1, 2, 4, 8, 16, veces seguidas que suena al salir sorteado; sin dato = `[1, 1]`, el front no lo guarda si es `[1, 1]`; filas viejas pueden tener `anchor`, un override del anclaje que se quitó: el front lo descarta al cargar y desaparece al guardar el archivo). Reemplazan a `files.track_group/tags/props` |
| `sets` | `id` PK, `user_id`, `name`, `tracks`, `tags` | **legado**: tabla prevista, nunca usada |
| `reports` | `id` PK, `target_type`, `target_id` (índice), `reporter_user_id` (índice), `reason`, `status`, `ts` | Denuncias (tarea 4.4, `POST /report`). `target_type` = `file` \| `project`; `target_id` = id de `files` o de `projects`; `reporter_user_id` = quien denuncia; `reason` = texto (1 a 500 caracteres); `status` = `open` \| `resolved` \| `dismissed` (`NOT NULL DEFAULT 'open'`; el admin lo cambia con `PUT /admin/reports/:id`, tarea 5.1; solo las `open` cuentan para no duplicar en `POST /report`); `ts` = fecha (ISO sin ms). Sin claves foráneas: borrar el archivo o el proyecto no borra sus denuncias (`GET /admin/reports` las devuelve con `target: null`) |
| `traffic` | `id` PK (`"YYYY-MM-DD"`, día UTC), `bytes`, `requests` | audio servido por `GET /file/:id`. Total del mes: `select sum(bytes) from traffic where id like '2026-10-%'` |

`db_migrations.js` crea todo el esquema de forma idempotente (base nueva o existente), con
helpers `create_table`, `add_column(tabla, columna, build)` (con `build` = `string(largo, default?)`,
`integer(default?)` o `float()`; con default la columna es `NOT NULL DEFAULT`, las banderas 0/1 son `integer(0)`),
`create_index` (índice simple `<tabla>_<columna>_index`) y `create_unique_index`. En la base
actual `files` no tiene PK porque se creó a mano. No hay claves foráneas; la integridad se maneja desde la aplicación: al borrar
un Tag o Track Group, el front limpia la referencia en cada archivo en memoria (sin guardarlos uno por
uno) y guarda la colección: `PUT /projects/:id/track_groups`
/ `tags` limpian en `project_files` del proyecto las referencias a pistas o tags que ya no están
(pista → `null`, el tag se quita del array). `PUT /projects/:id/files` valida que la pista y los tags
de cada archivo sean del mismo proyecto, y `DELETE /files/:id` borra las filas de `project_files`
que usan el archivo en todos los proyectos.

**Migración a proyectos** (fase 3; ya corrió en todas las bases y se quitó de `db_migrations.js`):
creó un primer proyecto por usuario (`My project`, `props` = su `users.props`), le puso ese `project_id` a
sus pistas y tags y una fila de `project_files` por cada archivo suyo con `track_group`, `tags` y `props`
copiados de `files`. Las columnas viejas no se borraron (quedan como legado, ver la tabla).

`PUT /projects/:id/track_groups` y `PUT /projects/:id/tags` **reemplazan la colección entera** del
proyecto (delete + insert, en una transacción). Solo se guardan las columnas de una lista blanca
por tabla (`PROJECT_ROWS_COLUMNS` en `routes/api.js`: `id, name, color, props` para track groups,
`id, name, color` para tags); `props` se serializa a JSON. Los campos extra que el cliente agrega a
los objetos se ignoran. Los ids los genera el cliente (uuid) y son PK de toda la tabla: un id
repetido en el array o que ya usa otra fila (de otro proyecto o usuario) responde 400 sin cambiar
nada. Reemplazan a `save_trackGroups` / `save_tags`, que se eliminaron en la tarea 3.3 (borraban
las filas del usuario en **todos** sus proyectos y reinsertaban sin `project_id`).

## Frontend

### Estado

`helpers/composable.js` exporta un `store` reactivo global (no hay Pinia):

- `store.projects` (lista de proyectos del usuario, de `u_info.projects`) y `store.project` (el
  proyecto activo: `{ id, name, hidden, ts }`). Pistas, tags, archivos y config
  (`TrackCtrl`) son siempre los del proyecto activo, y todos los guardados van contra él:
  `save_trackGroups()` / `save_tags()` (colección completa → `PUT /projects/:id/track_groups` y
  `/tags`), `save_file(file)` (pista, tags y volumen del archivo → `PUT /projects/:id/files`
  `{ update }`; `save_file_debounced(file)` es la versión diferida, 500 ms con un timer por archivo, que usan
  el fader Volume, el knob Weight y Repeat del diálogo de edición: con la rueda o las flechas cada paso
  dispara `@change`; un `save_file` directo cancela el diferido pendiente de ese archivo),
  `save_project_props_debounced()` (tempo, tolerancia, compás, rango de Tag, delay, reverb, master y compresor →
  `PUT /projects/:id` `{ props }`, 500 ms) y `delete_project_file(file)` (propio: `DELETE /files/:id`,
  en cascada; importado: lo quita del proyecto con `{ remove }`). `load_project(id)` abre otro
  proyecto; antes manda los guardados diferidos pendientes (`flush_pending_saves()`, exportada) para
  que no salgan con el id del proyecto nuevo. No detiene el transporte: la UI usa
  `switch_project(id)`, que hace STOP (`stop_transport()`), olvida el Tag actual y llama a
  `load_project`. `refresh_projects()` vuelve a pedir la lista (`GET /projects`).
- `store.files`: archivos del proyecto activo (filas de `project_files` unidas con el catálogo: `own`,
  `available`, pista, tags y volumen del proyecto), enriquecidos en el cliente con `tag_objs`
  (objetos de `store.tags` de cada id de `tags`; se mantienen con `set_file_tags` / `toggle_file_tag`),
  `isLoaded`, `duration`, `duration_fixed`, `play_rate`, `play_beats`, `in_tempo`, etc.
  Estos campos **no** existen en la DB.
  Los tags se asignan arrastrando un pad de Tag sobre un archivo (toggle: si ya lo tiene, lo quita)
  o desde el diálogo de edición de `Files.vue` (✕ en cada chip y un select para agregar).
  `Files.vue` muestra la tonalidad (`music_key`; el dueño la cambia en el diálogo de edición) y filtra
  la lista por tónica, con "+ atonal" (`key_matches` de `helpers/music_key.js`, misma regla que el
  catálogo). El filtro solo cambia lo que se muestra: el motor sortea todos los archivos.
  Anclaje de los disparos one-shot: `file_anchor(file)` de `composable.js` lo da
  (`anchor ?? "start"`; es dato del archivo, no hay override por proyecto). En el diálogo de edición
  el dueño lo cambia con Start/End (`PUT /files/:id`); los demás solo lo ven. El cartucho (vista Box) marca "⇥end" y la tabla tiene la columna Anchor (solo marca END);
  `ImportFiles.vue` marca con "⇥" los del catálogo con anclaje end.
- `store.track_groups`: al cargar se completa `props` con los defaults (`trg_default_props()` en
  `composable.js`) más lo guardado. Las pistas nuevas (`addTrackGroup` en `App.vue`) nacen con los
  defaults. Los cambios de mixer se guardan con `save_trackGroups_debounced()` (500 ms).
- `store.read_only`: modo lectura (ver "Modo lectura"); con `true` ningún guardado manda requests.
- `store.open_prompt`: proyecto que se ofrece abrir al entrar (fila de `store.projects`) o `null`; ver
  "Carga inicial".
- `store.tags`, `store.u_info`, `store.curr_file` (preview; usa el flag `isPreviewing`, distinto del `isPlaying` que pone el motor en cada archivo), `store.loading`.

Índices auxiliares (objetos planos, no reactivos, se reconstruyen con `rebuildIndexes()`):
`files_by_id`, `tags_by_id`, y `audio_players` (id de archivo → `Tone.Player`). La pista de un archivo
no se guarda como objeto: `trg_of(file)` la busca en `store.track_groups` en el momento (reactivo; null si
no tiene o ya no existe).

### Modo lectura (`/p/:id`, tarea 4.3)

`views/PublicProject.vue` usa **el mismo store y el mismo motor** (`Tracks.vue`, `mixer.js`) que la
app, con `store.read_only = true`:

- `load_public_project(id)` (`composable.js`) pone `read_only`, pide `GET /api/public/project/:id`
  (sin sesión), pasa por el aviso de memoria y llama a `install_project(p)`, la misma instalación que
  usa `load_project` (config en `TrackCtrl`, pistas, tags, un `Tone.Player` por archivo con
  `/api/file/<id>`, que es público). No toca `localStorage` ni el chequeo de sesión. Devuelve
  `{ ok, status, text, creator }` (404 → "Project not found", 429 → "Too many requests").
  `load_project` (la app) vuelve a poner `read_only = false`.
- **Ningún request de escritura**: todos los guardados del store pasan por `can_save()` (`store.project`
  y no `read_only`): `save_tags`, `save_trackGroups`, `save_file`, `save_project_props` y
  `delete_project_file`, más `save_collection` como red de seguridad. Los diferidos
  (`save_trackGroups_debounced`, `save_project_props_debounced`, `save_file_debounced`) ni arman el timer, así que
  `flush_pending_saves` no tiene nada que mandar. Los cambios de tempo y del mixer (que llaman a esos
  guardados desde `Tracks.vue` y `mixer.js`) quedan solo en memoria y se pierden al recargar.
- En `Tracks.vue`, con `read_only` se ven START/STOP, RESET, los knobs Tempo y Tol, y por pista el fader de
  volumen, M/S y los chips de FX (se encienden, pero no abren el diálogo; las tiras no aceptan drops); el botón LOOP/SHOT queda deshabilitado; compás, delay, rango de Tag, Rest,
  Dens/TAG y Rev/Dly no se muestran. La vista no monta pads, Files, Uploader, Projects,
  Import, Account ni Admin.
- Si hay sesión, la vista pide `GET /api/get_user_info` (solo lectura) y, si el proyecto está en la
  lista del visitante, muestra "OPEN IN EDITOR": un `<a href="/">` que antes guarda el id en
  `localStorage` (`looper_project_id`) y marca el pedido en `sessionStorage` (`looper_open_project`,
  `request_open_project`), así la app abre ese proyecto sin preguntar (ver "Carga inicial").
- Al cambiar el `:id` se hace STOP antes de cargar el otro. Al salir de la vista (router-link a la
  galería) `unload_public_project()` hace STOP, olvida el Tag y libera los players
  (`unload_project`); el `beforeUnmount` de la vista corre antes de desmontar `Tracks.vue`.
- `?autostart=1` funciona igual que en la app: `Tracks.vue` se monta recién con el proyecto cargado
  (`isReady` ya en `true`) y su watcher `immediate` hace START; el aviso de memoria no se muestra y la
  vista no tiene diálogos de login. Es el link de la instalación (`/p/<id>?autostart=1`, ver
  `docs/INSTALACION.md`, tarea 4.5). Solo con `?autostart=1`, si la carga falla por algo pasajero
  (sin respuesta, 5xx o 429) la vista reintenta sola con backoff (5 s, 10 s, 20 s... tope 60 s, sin
  límite); un 404 no se reintenta.

### Carga inicial

`App.vue` `onMounted` → `store_get_user_info()`:
1. `GET /api/get_user_info` trae el usuario, su cuota y la lista de proyectos (`store.projects`).
   Se abre (`load_project`) el proyecto activo si sigue en la lista (recarga después de una subida o
   de un re-login); si no, el último abierto en este navegador (`localStorage` `looper_project_id`,
   si es de este usuario); si no, el primero. Si el usuario no tiene ningún proyecto (cuenta nueva o
   borró todos) se crea uno vacío, `My project`. `GET /api/projects/:id` trae config, pistas, tags y
   archivos.
   **Pregunta al entrar**: si no hay proyecto activo (recarga de la página o login), el elegido no se
   abre directo: la app queda sin proyecto (`unload_project()`, LCD `NO PROJECT`) y se pone su fila de
   la lista en `store.open_prompt`, que `OpenProject.vue` (montado en `App.vue`) muestra con nombre,
   memoria estimada, archivos y fecha. OPEN → `switch_project(id)` (puede seguir el aviso de memoria);
   OTHER... → abre el diálogo PROJECTS; CANCEL (o X / Esc) → queda en `NO PROJECT`. No se pregunta con
   `?autostart=1`, con un proyecto recién creado (cuenta nueva) ni con OPEN IN EDITOR de la vista pública
   (pedido en `sessionStorage` `looper_open_project`, que se consume en la primera carga con sesión).
   Las recargas con proyecto activo (después de una subida, o al borrar el activo) tampoco preguntan.
   La config del proyecto (`props`: tempo, compás, rango de Tag, delay) se aplica enseguida a
   `TrackCtrl` y a `Tone.Transport` (`apply_project_props`, con defaults para lo que falte o sea
   inválido), **antes** de cargar los audios, así `calculate_timing()` (paso 4) usa el
   tempo y la tolerancia guardados. Cargar no guarda nada. En una recarga **del mismo proyecto** con el transporte en
   marcha o con un guardado pendiente no se aplica (lo que está en pantalla es más nuevo que lo de la
   base); al cambiar de proyecto se aplica siempre.
   **Aviso de memoria** (solo al abrir otro proyecto, no en la recarga del mismo después de cada
   subida): antes de tocar el store se estima la memoria de los audios decodificados (Tone.js los
   guarda como PCM float32 estéreo: `duration` × 44 100 × 2 × 4 bytes, ~21 MB por minuto; un archivo
   sin `duration` se estima por `size` a 128 kbps). Si supera ¼ de `navigator.deviceMemory` (solo
   Chromium; sin esa API se supone 4 GB, o sea 1 GB de límite) se pregunta con un `ElMessageBox`
   "Load anyway?". La misma estimación se muestra antes de abrir: columna "Memory" del diálogo
   PROJECTS y tarjetas de la galería (con `audio_seconds` de la lista, en amarillo si supera el
   límite). Si se cancela, `load_project` devuelve `false` y queda abierto el proyecto anterior
   (con `switch_project` ya detenido); si no había uno usable (primera carga, o se borró el activo) la
   app queda sin proyecto (`store.project = null`, `unload_project()`, que libera todos los players y
   deja `TrackCtrl.isReady = true` porque no hay audios pendientes) y el LCD de la barra muestra
   `NO PROJECT`: se abre, crea o borra otro desde PROJECTS (con `isReady` en `false` esos botones
   quedarían deshabilitados). Al recargar la página se vuelve a ofrecer el recordado (o el primero) y,
   si se abre, se vuelve a preguntar. Con `?autostart=1` no se pregunta (se carga igual).
   `estimate_files_memory(files)` y `memory_warning_limit()` se exportan: el diálogo de importar
   (`ImportFiles.vue`) muestra el total con la misma cuenta. `project_memory(p)`,
   `project_memory_warn(p)` y `project_memory_title(p)` dan la memoria de un proyecto de una lista
   (`audio_seconds`) para Projects y la galería.
2. Arma índices y resuelve `tag_objs` de cada archivo (descarta ids de tags y de pista
   que ya no existen).
3. Libera los players (y saca de `files_by_id`) los archivos que no son del proyecto: solo hay
   `Tone.Player` para los archivos del proyecto abierto (memoria del navegador, ver el plan).
   Crea un `Tone.Player` por archivo con URL `/api/file/<id>` y espera a que
   todos carguen (`Promise.allSettled`).
   Cada player que termina (bien o con error) suma a `store.load_progress.done`; `App.vue` lo
   muestra como barra de avance (cantidad de archivos, no bytes) y contador junto al LED de estado.
   Si es una recarga (después de una subida o de un re-login), el player anterior de cada archivo se
   libera con `dispose()` (si estaba sonando, recién cuando termina), para no acumular buffers.
4. `calculate_timing()` calcula `play_rate`, `play_beats` y `in_tempo` de cada archivo según el tempo y la tolerancia (ver "Tempo").
5. `TrackCtrl.isReady = true` habilita START.

### Motor de reproducción (`components/Tracks.vue`)

El motor vive en `Tracks.vue` (transporte, Tags, pistas loop, `start_file` / `stop_file`) más dos
módulos movidos tal cual desde ahí: `helpers/engine_oneshot.js` (pistas one-shot: `oneshot_step`,
`end_step`, `end_shots`, `cancel_end_shots`, `cancel_tag_end_shots`, `shot_bars`) y
`helpers/engine_fx.js` (FX de transición: `fx_step`, `beats_to_end`, `end_run`, `fx_back_to_base`,
`clear_fx_state`). Lo que usan de `Tracks.vue` se les pasa al montar el componente con
`bind_oneshot({ start_file, stop_file, draw_candidates, file_weight })` y
`bind_fx({ tag_cuts, NO_TAG_ID, roll_rest })`; `current_TAG` y `tracks` los toman de `TrackCtrl`.
Ninguno de los dos importa `Tracks.vue` (`engine_oneshot.js` importa `end_run` de `engine_fx.js`).

Conceptos:
- **Track** = un Track Group (pista); cada track reproduce un archivo a la vez. Hay un track por
  cada track group, tenga o no archivos (sin archivos sorteables queda en silencio).
- **Sorteables** = archivos del proyecto con buffer cargado (`isLoaded`) y `available !== false`
  (tarea 3.8). Un archivo no disponible (oculto por el admin o de un dueño bloqueado) sigue en el
  proyecto y en `store.files` (con su player), pero `start()` lo saca de `files_per_TRG` y no
  cuenta sus Tags: nunca se sortea ni aporta su Tag al sorteo de Tags. Una pista cuyos archivos son
  todos no disponibles queda en silencio, igual que una vacía. `Files.vue` lo muestra atenuado
  (cartucho y fila de la tabla, con la marca "unavailable"). `available` se lee al cargar el
  proyecto: si el admin oculta un archivo mientras suena, recién deja de sortearse al recargar el
  proyecto y hacer START de nuevo.
- **Tag activo** (`current_TAG`) = filtra qué archivos pueden sonar. Un archivo puede tener varios
  tags y es compatible con el Tag activo si lo incluye; un archivo sin tags es compatible con cualquier Tag.
  Los Tags que se sortean son la unión de los tags de todos los archivos sorteables.
- **Tempo** (`file_timing` / `calculate_timing` en `TrackCtrl.js`). Cada archivo es un **loop** o un
  **shot** (`files.kind`, se elige al subir y lo cambia el dueño en el diálogo de edición). Un loop
  trae `beats` (los carga el creador; deben estar cortados a compás) y `bpm` (deducido por el
  backend: `beats × 60 / duration`). Suena con **resample**: `playbackRate = tempo / bpm` (cambia
  también el tono: 6 % ≈ un semitono). Se prueba a su tempo, al doble y a la mitad (×1, ×2, ×½; a
  la mitad solo con beats pares): un loop de 70 entra en un proyecto de 140 ocupando el doble de
  beats. Se usa el múltiplo que menos lo corre y quedan `play_rate`, `play_beats` (beats del
  transporte que ocupa: es lo que cuenta el motor) e `in_tempo`. Si el corrimiento supera la
  **tolerancia** del proyecto (`TrackCtrl.tempo_tol`, knob **Tol** al lado del tempo, 0..12 %,
  default 6, guardado en `projects.props`; con 0 igual se acepta ±0,5 % de redondeo) el loop no se
  sortea (`Files.vue` lo atenúa con la marca "out of tempo"). Un **shot** suena siempre a velocidad
  original y solo lo sortean las pistas one-shot (las de loops lo ignoran); las one-shot sortean
  shots y loops dentro de la tolerancia. La elegibilidad (`playable` en `Tracks.vue`) se mira en
  cada sorteo, así que cambiar tempo, tolerancia o modo de pista con el transporte en marcha vale
  desde el próximo sorteo. El `playbackRate` se fija en cada `start_file` y, al soltar el knob
  Tempo, se aplica a todos los players (`apply_rates`) junto con el bpm del transporte: lo que
  suena sigue en fase. El knob Tempo es libre (10..160): lo que queda fuera de tolerancia calla.
- **Sugerencia de beats al subir** (`suggest_timing` en `TrackCtrl.js`, `detect_beats` en
  `helpers/bpm_detect.js`, usadas por `Uploader.vue`). Con la duración del `<audio>`, `suggest_timing`
  propone shot (menos de 1 s) o loop con la cantidad de beats "redonda" (`NICE_BEATS`) más cercana al
  tempo del proyecto (el backend aplica la misma regla, `suggest_beats`, si llegan sin beats). Si es
  loop, el archivo se decodifica en el navegador (`OfflineAudioContext`, de a uno por vez, cediendo el
  hilo cada 200 ventanas) y `detect_beats` estima los beats: envolvente de onsets circular (mono,
  ventanas de 1024 muestras cada 512, FFT propia, flujo espectral de log-magnitud en tres bandas
  —graves, medios, agudos con la mitad de peso— normalizadas por sus picos); para cada N entero con
  BPM entre 50 y 250, un peine circular de fase 0 (el loop empieza en un beat y dura N beats) mide la
  energía media en los N pulsos menos la línea de base, castigando a N si a mitad de camino entre
  pulsos suena casi igual (el pulso real sería 2N); el puntaje se pondera por un prior (BPM entre 70
  y 180, cercanía al tempo del proyecto, cantidades redondas). Devuelve `{ beats, bpm, confidence }`
  o `null` si los pulsos no sobresalen (confianza < 0,5). Solo reemplaza la sugerencia si el usuario
  no tocó tipo ni beats; la fila marca "auto" (con la confianza en el `title`) mientras los beats
  sigan siendo los detectados. Limitaciones en `KNOWN_ISSUES.md`.

Flujo:
1. `start()`: agrupa los archivos sorteables por track group (`files_per_TRG`, con un array, quizás vacío, para
   cada track group) y por tag; crea un track por cada track group de `store.track_groups`; sortea y activa un Tag (`start_tag(draw_tag())`, que además preselecciona el siguiente) y calcula archivos disponibles por track
   (`get_available_files_x_tag`); arranca `Tone.Transport`.
2. `Tone.Transport.scheduleRepeat(set_next_step, "4n")`: callback **en cada negra (beat)**. Se
   registra **una sola vez** al montar el componente (no en cada START): STOP detiene el transporte
   sin borrarlo y el próximo START lo reutiliza desde el tiempo 0. Se borra en `onBeforeUnmount`.
   No se crea ningún evento ni `Tone.Loop` por START (los FX de transición se agendan como
   automatización de los nodos desde este mismo callback). El callback corre `LOOK_AHEAD` (0,3 s;
   Tone trae 0,1) antes del beat: se subió para que un cambio de Tag con varias pistas sorteando a la
   vez no llegue tarde. Lo que usa `Tone.now()` (preview, START, STOP/RESET) responde ese tiempo
   después; mute, solo y faders no.
3. **Selección del Tag** (`draw_tag`, `start_tag`, `next_tag_entry`): `draw_tag()` sortea un Tag con
   **peso** (`tag.weight`, ver abajo; puede repetirse el actual; si todos pesan 0 sale `null`: no hay
   Tag y suenan solo los archivos sin tags, START lo avisa) y su duración = `2^n` con `n` al azar
   dentro del rango de los pads TAG CHANGE (`hw/RangePads.vue`, `TrackCtrl.tag_range`, guardado en
   `projects.props`) (5..9), medida en beats (la UI lo rotula "beats"; el contador se decrementa por
   beat). `start_tag(sorteo)` lo activa (`current_TAG.tag`, `duration`, `remaining_beats = duration + 1`,
   levanta `tag_starting`; en el cambio, `set_next_step` guarda antes el id del Tag que termina, o
   `"nada"` si no había, para `tag_cuts`) y
   **preselecciona el siguiente**: `current_TAG.next_tag` / `next_duration` se sortean al empezar
   cada Tag. En el cambio entra el preseleccionado (`next_tag_entry`) y se sortea el siguiente; así
   el motor sabe de antemano qué pistas va a cortar el cambio y cuándo (fin por corte de Tag de los
   FX de transición). Si el preseleccionado ya no es sorteable al llegar el cambio (se le bajó el
   peso a 0; o era `null` y algún Tag pasó a tener peso), se re-sortea en ese momento. Los Tags que
   se sortean son los de `available_tags`, calculados en START. START y RESET activan un sorteo
   nuevo (no el preseleccionado) y preseleccionan otro; RESET sigue siendo inmediato.
   **Pesos**: Tags y archivos (por proyecto) tienen un peso entero 0..32 (default 16). `pick_weighted`
   (`composable.js`) elige con chance = peso / suma de los pesos de los candidatos; todos iguales =
   sorteo uniforme (como antes de los pesos); peso 0 = nunca. `draw_candidates` deja afuera los
   archivos con peso 0 (si no queda ninguno la pista calla). Los pesos se leen en cada sorteo, así
   que editarlos con el transporte en marcha vale desde el próximo. Para los Tags, el próximo sorteo
   es el que se hace al empezar el Tag siguiente: el Tag ya preseleccionado no cambia (salvo que su
   peso pase a 0, ver arriba). Se editan en el diálogo de cada
   archivo (`Files.vue`, knob WEIGHT) y en `TagDialog.vue` (lápiz del pad del Tag: nombre, color y peso).
4. `set_next_step(time)`:
   - Si al Tag le queda 1 beat: activa el Tag preseleccionado (y preselecciona el siguiente),
     recalcula disponibles y, si cambió, corta los tracks cuyo archivo tiene tags y no incluye el
     tag nuevo (`tag_cuts`: con Tag nuevo `null` se cortan todos los que tienen tags) (los que lo incluyen o no tienen tags siguen
     sonando: un loop con tags A y B atraviesa el cambio de A a B). El corte es `stop(time)`, en el
     mismo beat en que arranca el loop nuevo: el callback corre hasta `LOOK_AHEAD` (0,3 s) antes de
     `time`, así que cortar "ya" deja un silencio entre los dos. Si el callback llega después de
     `time` (hilo principal ocupado) se avisa por consola (`agendado N ms tarde`).
   - Por cada track con `remaining_beats == 0`: primero el dado de descanso (ver abajo); si no
     descansa y no tiene archivos disponibles para el Tag, queda en silencio (suelta el loop que
     terminó: `curr_file = null`, LCD vacío); si no, sortea con peso (`props.weight` del archivo en el proyecto) un archivo disponible de su track group, lo arranca en `time` (tiempo de audio exacto que da Tone) y fija
     `remaining_beats = play_beats - 1`. Si no, decrementa (en descanso solo cuenta) y actualiza el progreso.
   - **Repetición (`props.repeat` del archivo en el proyecto, `[min, max]` de 1, 2, 4, 8, 16)**: al
     sortear y arrancar un archivo, `draw_repeat` elige al azar (uniforme) un valor del rango:
     `repeat_n`, y `repeats_left = repeat_n - 1`. Cuando la pista llega a `remaining_beats == 0` con
     `repeats_left > 0` y el archivo sigue entre los candidatos (`draw_candidates`: no se quitó, peso
     > 0, en tempo), vuelve a arrancar el mismo archivo en `time` sin sortear (ni tirar el dado
     de descanso) y descuenta una pasada. El cambio de Tag que corta el loop, RESET y STOP ponen
     `repeats_left = 0`; un loop que tiene también el Tag nuevo sigue con sus repeticiones. El
     descanso no se repite: dura lo que salga de `rest_len`. La tira muestra la pasada en el
     caption del LCD (`2/4`) cuando `repeat_n > 1`.
   - **Descanso (`trg.props.rest`, 0..1)**: al terminar un loop (o un descanso), con probabilidad `rest`
     (o el resultado anticipado `next_rest` de un FX `cond: rest`) la pista **descansa** en vez de
     sortear otro archivo. Se decide antes de mirar los candidatos: si el Tag nuevo no tiene archivos
     para la pista, el descanso igual se cumple (antes se salteaba y el FX "before rest" quedaba sin
     descanso y el LCD vacío). Una pista callada por falta de candidatos no tira el dado. En el primer
     beat tras START o RESET (`first_step`) también se tira: `roll_start_rests` deja el resultado en
     `next_rest` de cada pista loop con candidatos y, si salen todas en descanso, una al azar arranca
     sonando (antes, tras START no había `curr_file` y ninguna pista descansaba al arrancar). Al descansar: `resting = true`, `curr_file = null` y
     `remaining_beats = draw_rest_beats(track) - 1`: un valor al azar (uniforme) del rango
     `trg.props.rest_len` (`[min, max]` de `REST_LEN_OPTIONS = [4, 8, 16, 32]` compases, en
     `composable.js`; sin dato `[4, 4]`), o sea `n * beats_x_bar` beats. Son beats enteros contados desde un beat del
     transporte, así que al volver la pista sigue alineada al compás igual que si hubiera sonado un
     loop. Si había un archivo, se le hace `stop(time)` en ese mismo beat. Al llegar otra vez a 0 se
     repite la lógica normal (puede volver a descansar, con la misma probabilidad).
     El cambio de Tag no toca a una pista en descanso (no tiene archivo que cortar): termina su
     descanso y después sortea entre los compatibles con el Tag nuevo. RESET y STOP sí cortan el
     descanso. Con `rest = 0` el motor se comporta como antes.
   - **Pistas one-shot (`trg.props.mode == "oneshot"`)**: no participan de la lógica de loops
     (ni `remaining_beats` ni descansos); en cada beat pasan por `oneshot_step(track, time, n,
     tag_start, downbeat)`, que dispara si:
     - `on_tag_change` y empieza un Tag (`tag_start`): `start_tag()` levanta el flag `tag_starting`
       y el primer `set_next_step` siguiente lo consume. Desde `set_next_step` es el mismo beat (el
       mismo `time`) en que se elige el Tag; desde `start()` es el primer beat del transporte y desde
       RESET el beat siguiente. Dispara en cada Tag nuevo, aunque el sorteo repita el mismo Tag.
     - o `density` (0..1): al empezar cada frase de `bars` compases (1, 2, 4, 8, 16, 32 o 64;
       default 1 = cada compás) se tira el dado con esa probabilidad. Las frases se cuentan desde el
       inicio del transporte, igual que los loops encadenados: con `bars = 8` un platillo cae siempre
       en el primer tiempo de una vuelta de 8 compases y nunca en el medio. El downbeat se
       calcula en el callback de audio desde los ticks del transporte en `time`
       (`n = round(ticks / PPQ)`, `n % beats_x_bar == 0`; frase: `(n / beats_x_bar) % bars == 0`),
       no desde el estado visual. Si se cambia el compás con el transporte en marcha, la cuenta de
       frases puede quedar corrida hasta el próximo START.
     Se pueden combinar (dispara una sola vez si coinciden). El archivo se sortea con peso entre
     `available_files_per_TRG` de la pista, que si el Tag cambió en ese beat ya es la del Tag nuevo,
     **solo entre los de anchor efectivo `start`** (`file_anchor`, ver modelo de datos).
     Se arranca con `start_file(f, time, on_start)` (pasa por el canal: respeta mute/solo y mueve el vúmetro)
     y **suena entero** (no se le agenda `stop`, y el cambio de Tag no lo corta porque la pista no
     tiene `curr_file`). Si ese mismo player ya está `started`, se saltea el disparo (no se reinicia).
     El nombre (`track.last_shot`) y el destello del LED (`track.shot_n`, cuenta de disparos) los
     actualiza `show_shot` desde el `Tone.Draw.schedule(..., time)` de `start_file`.
     - **Anchor `end`** (`end_step`, en cada beat antes de lo anterior): el archivo **termina** en el
       punto de disparo (riser, crash invertido), así que se decide por adelantado. Puntos, cada uno
       por su lado: el próximo cambio de Tag si `on_tag_change` (faltan `b = current_TAG.remaining_beats`
       beats, ya descontado el del beat actual: el cambio ocurre en el beat que empieza con 1) y el
       inicio de la próxima frase si `density > 0` (`b = bpb*bars - n % (bpb*bars)`). No se mira solo
       el más cercano: un riser largo hacia el cambio de Tag no entraría nunca si hay una frase por
       compás. Si los dos caen en el mismo beat son uno solo y manda el de Tag. Cada punto (número de
       beat absoluto `n + b`, en `track.end_points` como `{ at, tag }`) se decide una vez: en el
       primer beat en que `b * spb < d_max + spb` (`spb` = segundos por beat al tempo actual, `d_max` =
       el "end" más largo de los candidatos: es el último beat en que todavía entra) o en el último
       beat antes del punto (`b == 1`). Se tira el dado (punto de Tag: siempre; de frase: `density`),
       se sortea con peso entre los candidatos "end" de la pista (`draw_candidates`, o sea los del Tag
       que suena ahora) **cuya duración entra** (`d <= b * spb`) y se agenda
       `start_file(f, time + b*spb - d)`. Duración efectiva `d = files_by_id[id].duration / play_rate`:
       la `duration` del objeto del front es la del buffer decodificado (`composable.js` la pisa con
       `player.buffer.duration` al cargar); sin dato (0) el archivo no participa como "end". Si no
       entra ninguno (justo tras START, Tag corto, tempo lento) no dispara. Si ese player está
       `started` o tiene un "end" agendado que todavía suena en el arranque nuevo (`end_shots`), se
       saltea. Se calcula con el tempo del momento: si el tempo cambia después, el final ya no cae
       justo en el punto. Una pista con archivos de los dos anclajes puede disparar uno "end" y uno
       "start" en el mismo punto (dados independientes): aceptado.
     - Indicadores: `start_file` prende `isPlaying` en el momento si el arranque es para el beat que
       viene (`time < Tone.now() + LOOK_AHEAD`: loops y disparos "start", como siempre) y además, para
       todos, con `Tone.Draw.schedule(..., time)` (ahí también llama `on_start`). Ese Draw se descarta si
       en el medio el archivo se cortó o se volvió a arrancar (`start_seq[id]`, lo incrementan
       `start_file` y `stop_file`): un "end" cancelado no prende nada.
     Si la pista pasa de loop a one-shot con un loop sonando, ese
     loop se corta en el beat siguiente; de one-shot a loop, la pista sortea un loop en el beat
     siguiente (`remaining_beats` quedó en 0; los "end" ya agendados suenan igual). RESET no corta los
     disparos que suenan (solo elige Tag y recalcula los disponibles); su cambio es inmediato y no se
     anticipa (no lleva "end"), y `cancel_tag_end_shots` cancela los "end" hacia el cambio de Tag que
     todavía no arrancaron (con `stop` en su propio arranque, no ya: `Player.stop` corta todas las
     fuentes del player y un "end" de frase anterior del mismo archivo puede seguir sonando; los que
     arrancan dentro del lookahead, o ya suenan, terminan donde terminen) y olvida los puntos de Tag decididos; los de frase siguen. STOP los corta todos
     (`cancel_end_shots` y `stop_file` sobre todos los archivos de las pistas one-shot, porque puede
     haber varios superpuestos): `Player.stop(ahora)` de Tone también cancela un `start` agendado a
     futuro (el filtro por `state == "started"` que había antes no los veía, porque `state` mira el
     presente).
5. Después de `set_next_step`, el mismo callback agenda con `Tone.Draw.schedule(..., time)` la
   actualización de `beat` (`n` = número de beat del transporte, `downbeat` = primer tiempo del
   compás), que hace destellar los LEDs del panel de Tracks cuando el beat suena de verdad y
   alimenta el LCD de posición "compás.tiempo" (`bar_position`; `start()` reinicia `beat.n`). Las
   tiras de canal muestran el beat del loop (`play_beats - remaining_beats`) en un medidor de LEDs y un LCD.
   En descanso (`curr_file` null) el LED de actividad y los LEDs de paso quedan apagados y el LCD
   muestra, con el rótulo `REST`, los compases que faltan para el próximo sorteo
   (`ceil((remaining_beats + 1) / beats_x_bar)`, cuenta regresiva hasta 1; `rest_bars_left`).
   El TAG actual se muestra en un LCD con `current_TAG.remaining_beats` como cuenta regresiva
   (de `duration` a 1) y un LED que destella en los últimos 4 beats antes del cambio.
   `current_TAG` y `tracks` viven en `TrackCtrl` (los escribe solo `Tracks.vue`): así los pads de la
   barra lateral (`SidebarItem.vue`) se iluminan si su Track Group tiene un archivo sonando
   (algún archivo del grupo con `isPlaying`: el loop de la pista o los disparos one-shot) o si su
   Tag es el activo. `isPlaying` lo sube `start_file` y lo baja `stop_file` o el `onstop` del
   `Tone.Player` (`getAudioPlayer`), así también se apaga cuando el archivo termina solo.
6. Las tiras de canal se arman con la lista computada `strips` (todos los `store.track_groups`, cada
   uno con su track de `TrackCtrl.tracks` si existe), así se ven y se configuran (volumen, mute,
   solo, descanso) también con el transporte detenido y en pistas sin archivos. El `Knob` chico
   "Rest" (0..1, paso 0.05) escribe `trg.props.rest` y guarda con `save_trackGroups_debounced()`;
   el motor lo lee en cada sorteo, así que un cambio vale desde el próximo fin de loop. Debajo, un
   `RangePads` chico (`small`) con los pads 4/8/16/32 escribe `trg.props.rest_len` (ídem); con Rest en 0 los pads quedan deshabilitados.
   Un `LedButton` LOOP/SHOT (LED amarillo encendido = one-shot) cambia `props.mode`; el motor lo toma
   en el beat siguiente. En modo one-shot la tira oculta el knob Rest, sus pads de duración y los `StepLeds`, el LCD
   muestra `SHOT` con el valor de `bars`, el LED de actividad (amarillo) destella en cada disparo, debajo se ve el nombre
   del último disparo y aparecen el knob "Bars" (`props.bars`, siete posiciones: 1..64 compases), el knob "Dens" (`props.density`, paso 0.05) y el botón "TAG"
   (`props.on_tag_change`). Todo se guarda con `save_trackGroups_debounced()`.
   RESET también recalcula `available_files_per_TRG` para el Tag nuevo (antes seguía usando los
   del Tag anterior hasta el próximo cambio).

Reglas para modificar el motor:
- Todo lo que suene debe programarse con el `time` del callback (no con `Date`/`setTimeout`), si no
  se pierde la sincronía. Lo visual que deba coincidir con el audio va con `Tone.Draw.schedule`
  (usa `requestAnimationFrame`: con la pestaña oculta no se dibuja, pero el audio sigue).
- `Tone.start()` debe llamarse desde un gesto del usuario (política de autoplay del navegador). El
  botón START pasa por `request_start()` (ver "Autostart y recuperación"), que lo llama dentro del clic.
- Los volúmenes están en dB (`props.volume`), aplicados al `Tone.Player` antes de `start` (y al
  player del preview) con `vol_db(..., FILE_VOL_MAX_DB)` de `mixer.js`: −60 dB o menos = silencio.
  El fader del diálogo de edición de Files usa la misma curva de consola que las pistas, con tope en
  0 dB (−∞..0; 0 dB arriba del todo, −12 dB a ~63 %). Al cargar, un archivo sin volumen válido toma −6 dB.

### Autostart y recuperación (instalación sin nadie al lado)

Ver también `docs/INSTALACION.md` (cómo lanzar Chrome en modo kiosko).

- **Autostart:** con `?autostart=1` en la URL, `Tracks.vue` hace START solo cuando
  `TrackCtrl.isReady` pasa a `true` (terminó la carga de audios). Es una sola vez por carga de
  página: una recarga posterior (subida, re-login) no rearranca. En la app (`/`), sin sesión no hay
  carga, así que el autostart espera al login; en el link público (`/p/:id`) no hace falta sesión
  (ver "Modo lectura").
- **`request_start()`** (botón START y autostart): si `Tone.context.state != "running"` llama a
  `Tone.start()` y espera hasta 500 ms a que el contexto corra (sin gesto la promesa puede quedar
  pendiente para siempre, por eso la carrera con un `setTimeout`: no es programación de audio). Si
  no arrancó, no hace START y muestra el **overlay "Click to start"** (`need_gesture`), que cubre la
  ventana: un clic en cualquier parte es un gesto, reanuda el contexto y hace START (o solo reanuda
  si el transporte ya corría). Con un clic en START el contexto arranca enseguida, así que el flujo
  manual no cambia.
- **Recuperación del AudioContext:** un único listener de `Tone.context` `statechange` (registrado
  al montar, quitado al desmontar). Si con el transporte corriendo el estado pasa a `suspended` o
  `interrupted`, reintenta `resume()` con backoff (1 s, 2 s, 4 s... tope 30 s, sin límite de
  intentos mientras el transporte siga en marcha). Tras 3 fallos muestra también el overlay
  (botón RESUME). Al volver a `running` se reinicia el contador y se oculta el overlay. Mientras el
  contexto está suspendido el transporte queda congelado (su reloj es el del contexto), así que al
  reanudar sigue en el mismo punto.
- **Sesión perdida:** `helpers/request.js` avisa (vía `on_session_lost`, que registra
  `composable.js`, para no importar el store y evitar un import circular) cuando una respuesta es
  401, o 403 con `text == "Sin sesión"` (el 403 de "Archivo inexistente" no cuenta). Eso pone
  `store.session_lost = true` y el LED de estado de `App.vue` pasa a rojo con "No session". No se
  desloguea ni se recarga nada: los audios ya están en memoria y la reproducción sigue; solo no se
  guardan cambios. Además, con usuario cargado, `composable.js` consulta `GET /get_user_info` cada
  10 min (`stat: false` = sin sesión; un error de red no cambia el estado). Ese chequeo también
  renueva el TTL de la sesión en Redis. `session_lost` vuelve a `false` al cargar el usuario (login)
  o al desloguearse.

### Mixer y vúmetros (`helpers/mixer.js`)

- Un `Tone.Channel` por track group (estéreo, `channelCount: 2`) conectado a `Destination`. Los
  canales se crean para **todos** los track groups (un `watch` sobre los ids de `store.track_groups`:
  al cargar, al agregar un pad) con lo guardado en `props`, y se eliminan al borrar el pad (antes se
  le quita el solo para no dejar callados a los demás). `start_file` llama a `route_player(id)`, que saca al player de `Destination` (los players se crean
  con `.toDestination()` en `composable.js`) y lo conecta al canal de su grupo. Se hace una sola vez
  por player (WeakMap player → grupo); si el archivo cambió de grupo se pasa al canal nuevo.
- **Volumen**: vive en `trg.props.volume` (dB) y se guarda en la base (`save_trackGroups_debounced`).
- **Mute / solo**: **no se guardan**, a propósito (un solo o un mute olvidado dejaría muda la
  instalación al recargar). Viven en memoria en `mixer.mute[trg]` / `mixer.solo[trg]` (reactive de
  `mixer.js`); al cargar se descartan `props.mute` / `props.solo` que hayan quedado guardados de antes.
  `set_volume`, `toggle_mute` y `toggle_solo` lo aplican al `Tone.Channel` (que resuelve el solo
  entre canales: si hay alguno en solo, el resto queda callado; puede haber varios en solo). La tira tiene un
  `Fader` chico y los botones M / S. El fader trabaja en posición 0..1 con curva de consola
  (`fader_to_db` / `db_to_fader` en `mixer.js`: ganancia ∝ posición³, dB = 6 + 60·log10(pos); 0 dB
  a ~79 % del recorrido, −12 dB a la mitad, abajo del todo = silencio). Lo guardado sigue en dB:
  `VOL_OFF_DB` (−60) o menos = silencio (al nodo se le aplica −120 dB, no `-Infinity`).
  **Master**: knob en el panel Transport con la misma curva (−∞..+6 dB); `TrackCtrl.master` (dB,
  guardado en `projects.props.master`, default 0; en modo lectura solo en memoria) va al `volume` de
  `Destination`, que está antes de la dinámica del master (pasar de 0 dB empuja contra el limitador;
  con COMP prendido también cambia cuánto comprime). Afecta
  también al preview. El estado vive fuera de `TrackCtrl.tracks` porque
  los tracks se rearman en cada START. El volumen del canal se suma al `props.volume` de cada
  archivo (aplicado al player). El preview (`toneLib.js`) no pasa por los canales.
- **Efectos por pista**: la cadena es `player → fx_lp (Tone.Filter lowpass) → fx_hp (Tone.Filter
  highpass) → fx_gain (Tone.Gain) → Tone.Channel` (`route_player` conecta el player a `fx_lp`). Los
  filtros son `Gain → BiquadFilter → Gain` nativos (estéreo, a diferencia del `Panner` del Channel,
  que por eso lleva `channelCount: 2`); en reposo quedan abiertos (20 kHz y 10 Hz, Q 0, −12 dB/oct)
  y no colorean; `fx_gain` en 1. Los usan solo los FX de transición (ver abajo).
  Cadena completa por pista:
  ```
  player → fx_lp → fx_hp → fx_gain → channel → Destination / meter / send (→ reverb_in) / dly_send (→ delay_in)
                     fx_hp → throw_ch → throw_send (→ reverb_in) / throw_dly_send (→ delay_in)
  ```
  `throw_ch` es un segundo `Tone.Channel` (`channelCount: 2`, **no** conectado a Destination) que
  toma la señal de `fx_hp`, o sea **antes de Cut y Fade** (`fx_gain`), con el mismo volumen, mute y
  solo que el canal principal (`set_volume`, `toggle_mute` y `toggle_solo` actualizan los dos). Solo
  alimenta los sends de los throws (`throw_send`, `throw_dly_send`, base 0). El solo de Tone es por
  contexto (`Solo._soloed`: cualquier `Solo` en solo calla a todos los que no lo están); como los dos
  canales de una pista tienen siempre el mismo estado, el solo entre pistas funciona igual.
  `remove_channel` pone `solo = false` en ambos antes de disponerlos (`Solo.dispose` no avisa a los
  demás) y dispone también los tres nodos de FX, los sends (reverb y delay) y los de throw.
- **Reverb compartida** (config en `TrackCtrl.reverb`, guardada en `projects.props.reverb`): un único bus
  por convolución con impulsos reales: sends → `reverb_in` → `Tone.Convolver` activo (`normalize`) →
  `ir_gain` → `reverb_out` (`Tone.Volume`, nivel de retorno `reverb.level`, −24..+6 dB, default 0) →
  `Destination` (pasa por la dinámica del master). Solo devuelve la cola.
  Impulsos: 17 mp3 estéreo en `frontend/public/impulses/` (estáticos, servidos con el build; vienen
  del proyecto carrilion, licencia sin confirmar). Catálogo `REVERB_IRS` en `TrackCtrl.js` (clave =
  nombre del archivo, rótulo del LCD, `gain` y `rt60`); `reverb.ir` default `RoomHuge` (RT60 ≈ 3,1 s),
  también para los proyectos anteriores a los impulsos. `gain` (dB) compensa el volumen de cada impulso
  para que todos suenen como la reverb sintética anterior (`Tone.Reverb` decay 6, que en realidad
  tenía RT60 ≈ 2,5 s): se midió una vez pasando ruido rosa por el impulso normalizado como lo hace el
  `ConvolverNode` a 48 kHz (LUFS integrados). Sin compensar, la diferencia entre impulsos llega a ~18 dB.
  Solo se descarga el impulso elegido (`Tone.ToneAudioBuffer.load`); los ya cargados quedan en memoria
  (`ir_buffers`) y una carga fallida se reintenta la próxima vez. Al cambiar de impulso (watch sobre
  `reverb.ir`) el nuevo `Convolver` se conecta recién cuando terminó de cargar (hasta ahí suena el
  anterior); el anterior se desconecta de `reverb_in` pero **su cola sigue hasta el final** y se libera
  con `Tone.getContext().setTimeout` pasada la duración del impulso. Si se piden varios mientras carga,
  queda el último. Controles en el panel Transport (debajo del delay, oculto en modo lectura): LCD con
  el rótulo, botones ◀ ▶ (anterior / siguiente, dan la vuelta) y knob Level; se guardan con
  `save_project_props_debounced()`.
  Cada canal tiene un send: un `Tone.Gain` (lineal) colgado de
  la **salida** del canal → `reverb_in`. Es lo mismo que hace `Tone.Channel.send()` por dentro, pero no se
  usa la API de buses porque `receive()` solo existe en `Tone.Channel`, y un Channel de retorno
  participa del solo (quedaría callado al poner cualquier pista en solo). Al salir del canal, el send
  es **post-fader, post-mute y post-solo**: una pista muteada o callada por otro solo no manda reverb
  (la cola que ya estaba sonando se apaga sola) y el volumen de la pista también escala el send.
  Nivel en `props.reverb` (dB, `null` = nada). Knob "Rev" en la tira: −40..0 dB, el mínimo = `null`.
- **FX de transición (`props.fx`)**: efectos de **salida** que se disparan una anticipación antes del
  fin de la tirada de una pista loop, para suavizar el paso al loop siguiente o a un descanso.
  Reemplazan al drift (eliminado; un `props.drift` guardado se ignora). Cada pista tiene hasta
  `MAX_FX_PER_TRACK` (4) **instancias** `{ id, type, lead, prob, cond, ...parámetros }` de un catálogo
  fijo (`helpers/fx.js`, `FX_TYPES`: rótulo, letra del chip, defaults y rangos). `normalize_fx_list`
  (al cargar, en `install_project`) acota los valores, descarta tipos desconocidos y deja ids únicos;
  `new_fx(type, list)` crea una instancia con defaults (la usa la UI al soltar un FX en una tira).
  - `lead`: `"1b"`, `"2b"` (beats) o `"1m"`, `"2m"`, `"4m"`, `"8m"` (compases del compás actual;
    `lead_beats(lead, beats_x_bar)`). `prob` 0..1: chance de dispararse en cada fin. `cond`: `any`,
    `rest` (solo si lo que sigue es un descanso) o `tag` (solo si el fin de la tirada es un corte por
    cambio de Tag, ver abajo).
  - Tipos: `cut` (silencio: `fx_gain` a 0 con una rampa de 5 ms), `lpf` / `hpf` (`fx_lp` / `fx_hp`
    en rampa exponencial a `to_hz`, con su `q` aplicado al disparo), `fade` (`fx_gain` en rampa lineal
    a `to_db`; −60 = silencio), `echo` / `verb` (throws: `throw_dly_send` / `throw_send` suben de 0
    a `level` dB en 10 ms). Los throws salen de `throw_ch`, **pre-Cut/Fade** (estilo dub throw: con
    Cut + Echo el delay recibe el último tramo y la cola sigue sobre el corte), y son independientes
    de los knobs Rev/Dly (suenan con Rev/Dly en off; el knob no los toca).
  - Mixer: `fx_schedule(trg, inst, start, end)` agenda la rampa entre `start` (el `time` del beat
    del disparo) y `end` (fin de la tirada); `fx_reset(trg, time)` vuelve todo a la base en el beat
    del fin: filtros abiertos con Q 0 y ganancia 1 **exactamente en `time`**, sends de throw a 0
    con una rampa de 50 ms (la cola del throw cruza al loop siguiente). Las dos
    empiezan con `cancelAndHoldAtTime` (de Tone: recorta la rampa en curso en ese punto y borra lo
    posterior) en vez de `cancelScheduledValues` solo, que borraría el punto final de una rampa que
    termina justo en `time` y la desharía de golpe (el callback corre ~0,1 s antes del beat). Así, si
    dos instancias tocan el mismo nodo, la última agendada arranca desde donde iba la anterior.
    Todos los tiempos son de audio (el `time` del callback), nunca `Tone.now()`.
    `fx_reset_all(ramp)` (STOP y RESET) lleva todas las pistas a la base ya, con una rampa corta.
    Mover Rev o Dly durante un throw no lo afecta: los knobs mueven los sends normales (`send` /
    `dly_send`, post-Channel y después de Cut/Fade) y los throws van por sus sends propios.
  - Motor (`helpers/engine_fx.js`, llamado desde `Tracks.vue`): las pistas one-shot ignoran `props.fx` (las instancias se conservan). En
    cada beat, después del paso del loop (`loop_step`, que devuelve si la pista está sonando una
    tirada), `fx_step` calcula `beats_to_end(track)`: beats hasta el fin de la tirada contando el
    actual (1 = este es el último beat de lo que suena), el **mínimo** entre:
    - fin natural (`natural_end_beats`) = `repeats_left · play_beats + remaining_beats + 1` (en el
      último beat de la última repetición da 1);
    - fin por **corte de Tag** (`tag_cut_beats`) = `current_TAG.remaining_beats` (ya descontado el
      beat actual) si el cambio al Tag preseleccionado va a cortar el archivo (misma regla
      `tag_cuts` que el corte real: tiene tags y no incluye `next_tag`; si `next_tag` es el actual
      no hay corte; con `next_tag` `null` se cortan todos los que tienen tags), si no ∞. Ejemplo:
      un Tag de 4 beats que empieza en el beat 10 queda en 4, 3, 2, 1 en los beats 10..13 y el corte
      es en el `time` del 14 (se procesa con 1 antes de descontar): en el 10 da 4 y en el 13 da 1,
      igual que un loop de 4 beats arrancado en el 10.
    Si los dos caen en el mismo beat cuenta como corte por Tag (`by_tag`). Cada instancia se evalúa
    **una vez por tirada** (`track.fx_fired`), en el primer beat en que `lead_beats(lead)` es **≥**
    a los beats que faltan (≥ y no ==: una tirada más corta que la anticipación dispara igual,
    recortada al tiempo que queda): se tira `prob`, se chequea `cond` y, si pasan,
    `fx_schedule(trg, inst, time, time + faltan · 60 / bpm)` (bpm actual del transporte: un cambio
    de tempo en medio de la rampa se tolera; la vuelta a la base la da el beat real del fin) y el id
    entra en `track.fx_active`. Un cambio de compás en marcha cambia los beats de los `lead` en
    compases desde el beat siguiente.
    Si una instancia se evaluó contra un corte por Tag se marca `track.fx_tag_end`: si al llegar el
    cambio el archivo al final **no** se corta (el preseleccionado se re-sorteó o se editaron los
    tags del archivo), `fx_back_to_base` vuelve los FX a la base en ese `time` y vacía `fx_fired`
    (se reevalúan contra el fin que quede; `next_rest` se conserva). Al revés, una instancia ya
    evaluada contra el fin natural no se reevalúa si un Tag preseleccionado después pasa a cortar
    la tirada antes (su rampa se recorta en el corte y un `cond: "tag"` no dispara).
  - **Fin = de la tirada**: una repetición del mismo archivo no es fin. El fin es el beat en que la
    pista arranca otro archivo, empieza un descanso, queda sin candidatos, la corta el cambio de Tag
    o pasa a one-shot: ahí `end_run` hace `fx_reset` (si algo se evaluó en la tirada) y limpia
    `fx_fired` y `next_rest`.
  - `next_rest`: para `cond: "rest"` el dado de descanso se tira **antes** (al evaluar la instancia)
    y se guarda en `track.next_rest`; en el fin `loop_step` usa ese resultado en vez de tirar otra vez.
    `null` = sin sortear (se tira en el fin, como siempre).
  - `track.fx_active`: ids de las instancias sonando (para los chips de la tira), actualizado con
    `Tone.Draw` (se agregan en el beat del disparo, si la instancia sigue en `fx_fired`, y se vacía
    en el del fin). STOP y RESET llaman a `fx_reset_all` y limpian `fx_fired`, `fx_active`,
    `next_rest` y `fx_tag_end` (el chequeo de `fx_fired` evita que un disparo agendado antes de un
    RESET encienda el chip después). Si `Tone.Draw` descarta el vaciado (callback vencido: pestaña
    oculta), el chip queda encendido hasta el próximo fin con FX evaluados de esa pista.
  - **UI**: en la sidebar (`App.vue`, debajo de Tags, no en modo lectura) hay una sección **FX** con
    un pad por tipo del catálogo (`FxPad.vue`: mismo look que los de pistas y Tags, sin color, borrar
    ni renombrar). El pad se arrastra con `dataTransfer` tipo `looper/fx` = tipo (sin `msg_type` ni
    `id`: los pads de la sidebar no lo aceptan y `Files.vue` lo ignora en `dragover`). Soltarlo sobre
    una tira de `Tracks.vue` (mismo resaltado `drop_over` que el reordenamiento, `dropEffect` copy)
    agrega `new_fx(type, lista)` a `trg.props.fx` y guarda con `save_trackGroups_debounced()`; con
    `MAX_FX_PER_TRACK` instancias avisa con `ElMessage` y no agrega. Se permite en pistas one-shot
    (se guardan pero no suenan).
  - Chips: fila propia de la tira, debajo de Rev/Dly, con un chip por instancia (letra del tipo) que
    se enciende como un LED amarillo mientras su id está en `track.fx_active`. Siempre hay
    `MAX_FX_PER_TRACK` lugares (los libres son zócalos apagados) y alto fijo, así la tira no cambia de
    tamaño y los faders de todas las tiras quedan alineados. En una pista one-shot la fila se atenúa.
    Clic en un chip abre `FxDialog.vue` (uno solo en `Tracks.vue`, con el id de pista e instancia).
    En modo lectura los chips se ven y se encienden pero no abren nada.
  - `FxDialog.vue` (`hw_dialog`): título con el rótulo del tipo y la pista; `lead` y `cond` con filas
    de `LedButton` de selección única (ANY / BEFORE REST / TAG CHANGE); `prob` con un knob (LCD en %); los parámetros del tipo con knobs según los rangos de
    `FX_TYPES` (las frecuencias en escala logarítmica: el knob va de 0 a 1 y se convierte a Hz,
    redondeado a 1 Hz por debajo de 1 kHz y a 10 Hz por encima) y su valor en un LCD chico; REMOVE
    quita la instancia. Edita la instancia en vivo y guarda con `save_trackGroups_debounced()` en cada
    cambio. El motor lee la instancia en cada disparo: los cambios valen desde la próxima tirada.
  Los knobs chicos "Rev" y "Dly" van en una fila propia de la tira, y debajo la de los chips de FX.
- **Delay global** (config en `TrackCtrl.delay`, guardada en `projects.props.delay`): un único bus como
  la reverb: sends → `delay_in` → delay activo → `fade` → `delay_out` (`Tone.Volume`, nivel de retorno
  `delay.level` en dB) → `Destination` (pasa por la dinámica del master). Solo devuelve las repeticiones (wet = 1).
  No va a la reverb. Tipos (`delay.type`):
  - `pingpong` (default): `Tone.PingPongDelay`, las repeticiones alternan L/R.
  - `stereo`: `Tone.FeedbackDelay`, la misma repetición en los dos canales.
  - `dotted`: `Tone.Split` → un `FeedbackDelay` por canal → `Tone.Merge`; L con la división y R con
    1.5 × la división (con puntillo).
  - `tape`: lazo armado a mano (`Tone.Delay` → `Tone.OnePoleFilter` lowpass 2 kHz → salida, y del
    filtro un `Tone.Gain` de feedback de vuelta al delay): cada repetición más oscura. Es un filtro de
    un polo (ganancia ≤ 1, sin resonancia; un biquad con Q tiene un pico que con feedback 0.9 podía
    pasar de 1), así la ganancia del lazo siempre es < 1.
  Solo hay **un** delay armado (el del tipo elegido). Al cambiar de tipo se arma el nuevo, el anterior
  se desconecta de la entrada, su salida baja a 0 en 300 ms y se libera con
  `Tone.getContext().setTimeout`: **las repeticiones que venían sonando se cortan con ese fundido** (no
  pasan al tipo nuevo).
  Tiempo sincronizado: `delay.division` en notación de Tone (`16n`, `8t`, `8n`, `8n.` (default: el
  clásico corchea con puntillo), `4n`, `4n.`, `2n`), convertido a segundos **a mano** con
  `TrackCtrl.tempo` (`DELAY_DIVISIONS` en `TrackCtrl.js`, en beats) y no con `Tone.Time`, que congela
  el valor con el bpm del momento. Un `watch` sobre `TrackCtrl.tempo` y la división recalcula el tiempo
  con una rampa de 100 ms (sin clics; las repeticiones en curso se "estiran" un instante, como una
  cinta). Como el knob Tempo cambia `TrackCtrl.tempo` mientras se arrastra y el transporte recién al
  soltarlo, el delay sigue al knob durante el arrastre. Tope 6 s (`DELAY_MAX_S`): con tempos muy lentos
  y divisiones largas el tiempo se recorta. `delay.feedback` 0..0.9 (default 0.4).
  Send por pista: `props.delay` en dB (`null` = nada), un `Tone.Gain` colgado de la salida del canal
  (post-fader, post-mute y post-solo, igual que la reverb). Knob "Dly" en la tira: −40..0 dB, el mínimo = `null`.
  Controles globales en el panel Transport: LCD con tipo y división, botones TYPE y TIME (ciclan) y
  knobs Feedback y Level. Cambios de tempo, compás, rango de cambio de Tag, delay, reverb, master y compresor se guardan en el proyecto con `save_project_props_debounced()` (500 ms).
- **Dinámica del master** (`mixer.js` + `helpers/master_dsp.worklet.js` + `helpers/master_dsp.js`;
  plan completo en `docs/PLAN_MASTER.md`). Cadena, armada a mano en vez de con
  `Destination.chain()` porque hay dos caminos en paralelo:

  ```
  canales, reverb_out, delay_out, preview
    → Destination.input (Tone.Volume, knob Master)
    → master_in (Tone.Gain)
         ├→ master_limiter (Tone.Limiter(-1)) → lim_gain (1 → 0 al pasar al worklet)
         └→ dsp_node (AudioWorkletNode "looper-master") → dsp_gain (0 → 1)
    → master_out (Tone.Gain) → Destination.output → salida
                                                 └→ master_meter (post-dinámica)
  ```

  - **Worklet** (`master_dsp.worklet.js`): adapta `MasterDsp` (DSP puro y testeado en
    `master_dsp.js`) a `AudioWorkletProcessor`: crossover Linkwitz-Riley de 4.º orden de 3 bandas
    (120 Hz / 3 kHz, suma plana: con COMP apagado solo cambia la fase) → compresor por banda con
    bypass (`comp.on`, rampa de 30 ms) → limitador brickwall con lookahead de 3 ms y techo −1 dBFS
    (garantizado por muestra; latencia ≈ 3 ms en todo el master). Entrada ausente (`inputs[0]` vacío,
    p. ej. sin señal activa) → procesa silencio; mono → mismo canal en L y R; siempre devuelve `true`.
    Si `process` lanza, avisa `{ t: "error" }` una vez y desde ahí deja pasar la entrada recortada
    al techo. `{ t: "dispose" }` lo apaga.
  - **DSP** (`master_dsp.js`, tests en `master_dsp.test.js` y `master_dsp.worklet.test.js`, `npm test`):
    biquads RBJ en doble precisión; bandas `low = AP(3k)·LP4(120)`, `mid = LP4(3k)·HP4(120)`,
    `high = HP4(3k)·HP4(120)` (suma = allpass, plana). Compresor por banda con link estéreo total
    (detector `max(L², R²)` promediado en RMS), rodilla suave de 6 dB y balística en dB; por banda
    (`COMP_BANDS`): umbral base −6 / −8 / −9 dBFS (nivel RMS de la banda), ratio máx 4 / 3 / 3,
    attack 30 / 15 / 5 ms, release 200 / 150 / 100 ms, ventana RMS 25 / 10 / 5 ms. GLUE (`amount`)
    → umbral `base − 18·amount`, ratio `1 + (máx − 1)·amount` (con 0 no comprime) y makeup fijo
    `4 dB·amount` (sin makeup automático). Los trims LOW/MID/HIGH son ganancia **después** del
    compresor (no cambian cuánto comprime) y, como todo el compresor, solo actúan con COMP prendido
    (bypass con rampa de 30 ms; makeup y trims se suavizan con 20 ms). Limitador: mínimo deslizante
    de la ganancia pedida en una ventana de N = 3 ms, release de 80 ms y promedio de N muestras
    (ataque en rampa; garantiza `|y| ≤ −1 dBFS` por muestra), más un clip de seguridad. Entradas
    NaN/∞ → 0; estados por debajo de 1e-15 → 0 al final de cada bloque (anti-denormales). CPU medida
    en Node: ~0.7 % de un núcleo con COMP apagado y ~1.4 % prendido (48 kHz).
    Calibración (F5, con loops reales de "My project" sumados y normalizados a −10 dBFS RMS): con
    GLUE 0.5, GR media ≈ 2.2–2.6 dB en LOW, 1.2–1.7 en MID y 0.8–2.1 en HIGH; con GLUE 1,
    ≈ 9–10 / 6–7 / 4–7 dB. Ojo: esa mezcla, tal como suena en el proyecto (archivos a −6 dB, master
    0 dB), está a ~−20 dBFS RMS, y ahí GLUE 0.5 casi no comprime (< 0.2 dB) y GLUE 1 da ≈ 2.4 /
    1.4 / 0.9–2.6 dB: cuánto comprime depende del nivel del bus (y del knob Master, que está antes).
  - **Carga** (`load_master_dsp()`, al importar `mixer.js`, sin esperar a START): solo en contexto
    seguro (`window.isSecureContext`: https o localhost); `Tone.getContext().addAudioWorkletModule(url,
    "looper-master")` y `createAudioWorkletNode(...)` (nodo de standardized-audio-context, conectable
    con los de Tone; `outputChannelCount: [2]`, `channelCount: 2` explícito). La URL sale de
    `import ... from "./master_dsp.worklet.js?worker&url"`: en build es un único archivo iife
    `assets/master_dsp.worklet-[hash].js` con `master_dsp.js` adentro (`worker.format: "iife"` en
    `vite.config.js`); en dev es el fuente con sus `import`, que standardized-audio-context separa
    con una regex: por eso el `import` es la **primera línea** del worklet (antes de los comentarios).
  - **Cambio**: cuando cargó, fundido de 50 ms (`lim_gain` → 0, `dsp_gain` → 1) y `levels.dsp = true`.
    Mientras carga, si no carga (contexto no seguro, sin AudioWorklet, error) o si falla en marcha
    (`onprocessorerror` o `{ t: "error" }`), suena el `Tone.Limiter(-1)` de antes, que queda
    **conectado siempre** como reserva caliente: fundido inverso, `levels.dsp = false`, el nodo se
    desconecta y no se reintenta hasta recargar. En la consola (solo dev; el build quita `console`)
    queda "Master: dinámica en AudioWorklet" o el motivo del respaldo.
  - **Parámetros**: `TrackCtrl.comp` (`{ on, amount, low, mid, high }`, default `comp_default()` =
    `COMP_DEFAULT` de `master_dsp.js`, COMP apagado). Se mandan por `port` como objeto plano
    (`{ t: "params", comp: { ...TrackCtrl.comp } }`, nunca el reactive: no es clonable) desde un
    `watch` de `mixer.js`, y al crear el nodo en `processorOptions`. El worklet suaviza los cambios
    (sin clics).
  - **Controles** (`Tracks.vue`, grupo `g_comp` del panel Transport, debajo del master; oculto en modo
    lectura como delay y reverb): `LedButton` COMP (rótulo "Dynamics", LED verde = `comp.on`), knob
    GLUE (`amount` 0..1, pasos de 0.01, `title` "Glue 50%") y tres columnas LOW / MID / HIGH, cada una
    con un `Led` de GR arriba (`levels.comp_gr[i]`: encendido con más de 1 dB, amarillo, rojo con más de
    6 dB; `title` "Low GR 2.3 dB") y un knob chico abajo (trim `COMP_BAND_MIN..COMP_BAND_MAX` = −6..+6 dB
    de `TrackCtrl.js`, pasos de 0.5, `title` "Low +1.5 dB"). Con COMP apagado GLUE y las bandas se
    atenúan pero se pueden mover (se guardan). Sin worklet (`!levels.dsp`: contexto no seguro, todavía
    cargando o falló) todo el grupo se atenúa y COMP queda deshabilitado ("Requires a secure context
    (https)"). Cada cambio escribe `TrackCtrl.comp` y llama a `save_project_props_debounced()`; el
    `watch` de arriba lo manda al worklet. En el panel ancho la grilla del Transport es
    `"transport tempo delay range master" / "position tag reverb range comp"` desde 1480 px de ancho
    del panel (antes 1300; en modo lectura, sin compresor, sigue desde 1300); más angosto, los grupos
    van en fila con wrap y el compresor queda después del master.
  - **Guardado**: `projects.props.comp` = `{ on, amount, low, mid, high }` (lo arma
    `save_project_props` con una copia de `TrackCtrl.comp`; el backend lo guarda tal cual dentro de la
    lista blanca de props, sin validar valores, como `delay` y `reverb`). Al cargar,
    `apply_project_props` lo acota: `on` solo si es `true`, `amount` 0..1 (default 0.5, redondeado a
    0.01), bandas −6..+6 redondeadas a 0.5 (default 0); un proyecto sin `comp` queda con
    `comp_default()` (apagado). En modo lectura (`/p/:id`, kiosko) no se ve ni se guarda nada, pero la
    config del proyecto se aplica: un proyecto guardado con COMP prendido suena comprimido.
  - **Indicadores**: el worklet manda `{ t: "gr", comp: [low, mid, high], lim }` (GR máxima en dB
    desde el envío anterior) cada `ceil(sampleRate / 128 / 30)` bloques (~30/s); en silencio no
    manda nada (siempre sale un último 0). `mixer.js` guarda el último en una variable y en el loop
    de `requestAnimationFrame` de los vúmetros lo pasa a `levels.gr` (limitador) y
    `levels.comp_gr` (por banda); sin worklet, `levels.gr` sale de `master_limiter.reduction` (el
    `reduction` del `DynamicsCompressorNode` nativo, dB ≤ 0) y `comp_gr` queda en 0. En la barra
    superior, junto al vúmetro master, un `Led` rotulado LIM se enciende amarillo con más de 1 dB de
    reducción y rojo con más de 3 dB (el `title` muestra el valor). Como el resto de los medidores,
    solo se actualiza mientras suena el transporte o un preview; al cortarse el loop queda en 0.
  - Respecto del `Tone.Limiter` de antes (hoy solo el respaldo): es un `DynamicsCompressorNode` con
    ratio 20 y knee de 30 dB (el default de Tone) más el makeup automático de Chrome, así que dejaba
    pasar picos por encima de −1 dBFS comprimidos suave. El del worklet no los deja pasar.
- Un `Tone.Meter` por canal, **post-mute** (muestra lo que se escucha), y uno estéreo colgado del
  output de `Tone.getDestination()` (o sea **post-dinámica**) para el master de la barra superior
  (incluye el preview).
- `levels` (reactive) tiene `level` y `peak` 0..1 (−48 dB → 0, 0 dB → 1) con pico retenido 800 ms.
  Se actualiza con `requestAnimationFrame` solo mientras suena el transporte o un preview, y al
  parar sigue hasta que los medidores caen a cero.
- El avance dentro del loop ya no usa el `LedMeter`: lo muestra `hw/StepLeds.vue` (16 LEDs de paso).

### Preview

`helpers/toneLib.js` tiene un `mainPlayer` separado para escuchar un archivo suelto desde la lista
(`Files.vue` → `playFile`). Copia el buffer del player del archivo. Para un archivo del catálogo
que no está en el proyecto (`ImportFiles.vue`), `playUrl(file, url)` descarga y decodifica solo ese
archivo en un `Tone.ToneAudioBuffer` (volumen fijo de −6 dB, el default de un archivo); mientras
carga marca `file.isPreviewLoading`. Solo queda referenciado el buffer del último preview, y cada
pedido (`playFile`, `playUrl`, `playerStop`) invalida al que siga cargando, así no arranca tarde.
Los diálogos usan los atajos `previewing(id)` / `preview_loading(id)` (estado del botón),
`toggle_preview(file)` (play/stop: buffer del proyecto si está cargado, si no `playUrl`) y
`stop_foreign_preview()` (al cerrar, corta un preview de un archivo que no es del proyecto).
