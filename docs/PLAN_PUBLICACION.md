# Plan de publicación (VPS multiusuario)

Plan acordado en octubre de 2026 para pasar Looper de app personal a servicio publicado en un VPS
propio, con varios usuarios. Las decisiones se tomaron política por política con el dueño del
proyecto; **no reabrirlas sin consultarlo**. Lo marcado como *propuesta técnica* son detalles de
implementación que se pueden ajustar al implementar.

Al completar una fase, marcarla acá y actualizar `API.md`, `ARCHITECTURE.md` y `KNOWN_ISSUES.md`
en el mismo cambio (regla de `AGENTS.md`).

## Decisiones

### Infraestructura

- VPS propio con **Debian headless** (alias SSH `jape-pruebas`; datos de conexión fuera del repo),
  detrás de **Cloudflare** (proxy) y **nginx**. El VPS **ya aloja otros sitios** (`jape.com.ar`,
  `www`, `carrilion`): no tocar su configuración de nginx ni romper su acceso al cambiar el firewall.
- Dominio: **`looper.jape.com.ar`** — registro A proxied en Cloudflare ✅ creado (oct 2026).
- SSL de la zona en Cloudflare: hoy está en *Full* (no *strict*) y aplica a todos los subdominios;
  pasar a *Full (strict)* solo si los otros sitios tienen certificado válido en el origen (se puede
  usar un certificado de origen de Cloudflare en nginx). Descartados Cloudflare Workers, R2 y la caché de Cloudflare:
  el audio siempre sale del VPS.
- **Un solo subdominio** (`looper.<dominio>`): nginx sirve `frontend/dist/` en `/` y pasa `/api` a
  Node. Todo es mismo origen (CORS solo queda para desarrollo local).
- nginx: `real_ip` con los rangos de Cloudflare y `CF-Connecting-IP` (y `proxy_set_header
  X-Forwarded-For $remote_addr`, `X-Forwarded-Proto $scheme`); headers `X-Content-Type-Options:
  nosniff`, `Content-Security-Policy: frame-ancestors 'none'`, HSTS, `Referrer-Policy`.
  **Sin embebido** en iframes de otros sitios.
- Backend con **pm2**, siguiendo el patrón que ya usa `carrillion` en el mismo servidor: usuario
  de sistema propio `looper` (sin shell, home `/var/lib/looper`), su propio daemon pm2 y un
  servicio `pm2-looper` (`pm2 startup` + `pm2 save`) para que arranque con el sistema.

#### Estado del servidor (revisión de solo lectura, 2026-10-13)

| Tema | Encontrado | Para Looper |
|---|---|---|
| Sistema | Debian 13 (trixie), x86_64, **1 vCPU**, 1,9 GB RAM (~1,6 GB libres), disco 50 GB (44 GB libres) | Cola de conversión con **concurrencia 1**. El umbral de 10 GB libres tiene margen |
| nginx | 1.30, un archivo por sitio en `conf.d/`; `00-default.conf` corta Host desconocido (444) | Agregar `conf.d/looper.jape.com.ar.conf`, sin tocar los demás |
| IP real | `conf.d/cloudflare-realip.conf` autogenerado por `/opt/cloudflare-realip-refresh.sh` | **Ya resuelto**, no hace falta configurarlo |
| Firewall | Tabla nftables `cf_filter`: 80/443 solo desde Cloudflare (`/opt/cloudflare-firewall.sh`, al boot + semanal). SSH lo filtra el Cloud Firewall de DigitalOcean | **Ya resuelto** |
| Certificado | Certificado de origen de Cloudflare en `/opt/cert/` (vence en 2035), usado por `jape.com.ar` | Reusarlo en el server block de Looper. Con certificados de origen en todos los sitios, la zona podría pasar a *Full (strict)* (verificar que el certificado cubra `*.jape.com.ar`) |
| Node | ✅ **v24.21** del sistema (NodeSource `node_24.x`), actualizado el 2026-10-13 desde v22. `carrillion` se recompiló (`better-sqlite3`) y quedó andando sobre 24; respaldo del estado anterior en `/root/rollback-node22-20261013/` | Looper usa el Node del sistema |
| pm2 | 7.0.4; `carrillion` corre con su propio usuario y `pm2-carrillion.service` | Mismo patrón. **Reiniciar siempre con `systemctl restart pm2-<app>`**, nunca `pm2 update`/`pm2 kill` a mano: systemd ve morir el daemon y su `ExecStop` mata al nuevo. Correr `pm2` como root levanta un daemon vacío en `/root/.pm2` |
| Redis | 8.0, escucha solo en localhost, **sin clave**, compartido con `carrillion` | Las claves de Looper ya llevan prefijo `looper_`. *Propuesta*: un usuario ACL de Redis solo para Looper, restringido a `~looper*`, sin tocar el usuario por defecto (ponerle clave rompería `carrillion`) |
| ffmpeg | No instalado | Lo trae `ffmpeg-static` (política 5) |
| Looper viejo | No hay ninguno (ni en nginx ni en disco) | `jape.com.ar/looper` de `.env.prd` no existe: solo cambiar la URL |
| SSH | Puerto 51312, solo con clave en `sshd_config`, pero un drop-in (`sshd_config.d/00-hardening.conf` y `50-cloud-init.conf`) deja **efectivo** `PasswordAuthentication yes` y `PermitRootLogin yes` | Fuera del alcance de Looper. *Recomendación*: desactivar el login con clave |
  `unattended-upgrades` para parches de seguridad.
- **Despliegue disparado desde la máquina de desarrollo** con un script `deploy` que entra por SSH
  y en el VPS hace: `git pull` de `main` (el repo se **clona en el servidor**; es público en GitHub,
  así que no necesita credenciales git — si pasa a privado, usar una *deploy key* de solo lectura),
  `npm ci` en backend y frontend (compila `better-sqlite3`/`bcrypt` para Linux), `npm run build_prd`
  y `pm2 reload`. Datos SSH en un archivo local ignorado por git o en `~/.ssh/config`. **Sin staging.**
- `backend/.env` y `storage/` viven solo en el servidor (fuera de git).
- **Datos iniciales: se migran** la base y los audios actuales. El usuario actual pasa a `admin` y
  sus pistas, tags y archivos quedan en un primer proyecto; sus archivos entran al catálogo público.
- Fuera del plan por ahora: backups, Turnstile, email (verificación/recuperación), login con Google.

### Audio público y tráfico (política 1) — ✅ implementado

- Los archivos de audio son **siempre públicos**: `GET /api/file/:id` sin sesión, valida uuid,
  busca el dueño en `files`, caché `immutable` de un año. Disco: se mantiene
  `audio/<user_id>/<file_id>.mp3`.
- Tabla `traffic` (bytes y requests por día UTC) para controlar el tope de tráfico del proveedor.
- **Sin botón de descarga** en la UI (solo preview), aunque técnicamente el archivo sea accesible.

### Sesión y login (política 2) — ✅ implementado

- Login con **email + clave**. Secreto de sesión en `.env` (`session_secret`, obligatorio).
- Cookie `looper_sid`: `httpOnly`, `secure: "auto"` (con `trust proxy` = loopback), `sameSite:
  lax`, **30 días renovables** (`rolling`), `resave: false`. `regenerate()` al loguearse.
- Límite de intentos fallidos de login: 10 cada 15 min por IP (contador en Redis).
- Quitar las credenciales precargadas de `Login.vue`. **El admin cambia su clave actual**: está en
  el historial de git y **el repo es público en GitHub**, así que hay que cambiarla antes de migrar
  la base al VPS (no se reescribe el historial).

### Usuarios (política 3)

- Campos: `email` (login, único, minúsculas), `password`, `name` (**nombre público**, único,
  3–32), `bio` (texto breve, ~280), `status` (`pending` | `active` | `blocked`), `role`
  (`user` | `admin`), `ts`.
- **Registro público** (`POST /register`) con email, clave (mín. 8), nombre y bio → `pending`.
  Nombre repetido: se avisa. Email repetido: misma respuesta que el éxito (no revela registrados).
  Límite de intentos por IP. Se acepta la licencia única (ver política 6) al registrarse.
- El estado se informa **solo después** de validar la clave: `pending` → "pendiente de
  aprobación"; `blocked` → mismo error genérico que clave inválida.
- Las solicitudes se ven **en el panel de admin** (sin notificaciones por ahora).
- Rechazar una solicitud la deja **bloqueada** (email y nombre quedan reservados).
- Recuperación de clave: **el admin la resetea a mano** (clave temporal por otro canal). El usuario
  puede cambiar su clave (`PUT /change_password`, pide la actual).
- Cada request con sesión verifica `status = active` contra la base: bloquear a alguien corta su
  sesión al instante.

### Autorización (política 4)

- Proyectos de **un solo dueño**, **sin límite de cantidad**.
- Todo acceso a datos de un proyecto verifica `projects.user_id`; si no es del usuario, 404.
- Solo el dueño edita metadatos o borra un archivo. Cualquier usuario activo puede importarlo a
  un proyecto propio si está disponible (no oculto, dueño no bloqueado).
- Al guardar `project_files` el servidor valida que pista y tags pertenezcan al mismo proyecto.
- `require_admin` verifica `role` contra la base.
- **Admin modera, no edita**: admitir, rechazar y bloquear usuarios; ocultar un archivo puntual;
  ocultar un proyecto puntual; resetear clave; cambiar la cuota de un usuario.

### Subidas (política 5)

- ffmpeg y ffprobe vía los paquetes npm **`ffmpeg-static`** y **`ffprobe-static`** (binario por
  plataforma: Windows en desarrollo, Linux x64 en el VPS); `path_to_ffmpeg`/`path_to_ffprobe` en
  `.env` quedan como override opcional. *Dependencias nuevas aprobadas en este plan.*
- Validar con ffprobe que sea audio. Formatos de entrada: mp3, wav, ogg, flac, m4a, aiff.
- **Recodificar todo** (también mp3) a **MP3 VBR V0** (`-q:a 0`), 44.1 kHz estéreo; quita
  metadatos ID3. ffmpeg con `execFile` (sin shell).
- **Duración máxima: 1 minuto** por archivo (se rechaza, no se recorta).
- **Cuota: 20 minutos de audio por usuario**, medida en segundos (`files.duration`); editable por
  usuario desde el admin. Los archivos importados no cuentan. Chequeo antes de procesar y con la
  duración real dentro de la transacción.
- Cola global de conversión (concurrencia 1–2) y una subida en curso por usuario.
- Si el disco libre del VPS baja de **10 GB**, se rechazan todas las subidas.
- Solo usuarios `active` suben.

### Contenido público (política 6)

- **Licencia única**: "libre uso dentro de Looper", aceptada al registrarse.
- Catálogo: nombre, BPM, beats, duración, tonalidad (cuando haya detección), creador (nombre
  público + bio), fecha, cantidad de proyectos que lo usan. **Nunca el email.**
- BPM y beats los carga el creador (detección automática más adelante).
- **Borrar un archivo** (dueño): se borra el audio y, **en cascada**, todas las filas de
  `project_files` que lo referencian en todos los proyectos.
- **Ocultar archivo** (admin) o **bloquear usuario**: reversibles, sin cascada. Esos archivos
  quedan **fuera del sorteo** del motor (y del catálogo) en todos los proyectos; vuelven al
  desocultar/desbloquear. Una pista sin archivos sorteables queda en silencio.
- Botón de denuncia en el catálogo → entrada en el admin. **Solo usuarios logueados** (límite por
  usuario, p. ej. 20 por día); cuando se agregue Turnstile, se abre a visitantes sin sesión.

### Acceso público de solo lectura (política 7)

- Visibilidad por proyecto: `private` (default) | `public`. Link `looper.<dominio>/p/<id>`.
- **Galería pública** de proyectos públicos (con su creador). El admin puede ocultar un proyecto.
- `GET /api/public/project/:id`: config, pistas, tags y archivos disponibles + nombre público del
  dueño; sin emails ni ids de usuario. 404 si es privado, oculto o el dueño está bloqueado.
  Límite de requests por IP.
- El visitante puede **START/STOP y mixer local** (mute, solo, volúmenes, tempo); nada se guarda.
- La **instalación (kiosko) usa el link público** con `?autostart=1`: ya no necesita login.

### Memoria del navegador

- Tone.js decodifica cada archivo a PCM (~21 MB de RAM por minuto de audio, sin importar el
  bitrate). Se cargan **solo los archivos del proyecto abierto**.
- **Sin tope duro de minutos por proyecto**: antes de cargar se calcula la memoria
  (segundos × 44 100 × 2 × 4 bytes) y, si supera una fracción de `navigator.deviceMemory`
  (p. ej. ¼; valor fijo en navegadores sin esa API), se avisa con "¿cargar igual?". El diálogo de
  importar muestra el total del proyecto mientras se suman archivos.

## Modelo de datos (propuesta técnica)

Todo en `db_migrations.js`, idempotente. Las columnas que quedan sin uso se documentan como
obsoletas (como `files.tag`), no se borran.

| Tabla | Cambios |
|---|---|
| `users` | + `status`, `role`, `bio`, `max_seconds`. `email` y `name` únicos. `props` pasa a `projects.props` (queda obsoleta) |
| `files` | Catálogo global: `id`, `user_id` (dueño), `original_name`, `size` + `duration` (s), `bpm`, `beats`, `hidden`, `ts`. `track_group`, `tags`, `props` pasan a `project_files` (quedan obsoletas) |
| `projects` (nueva) | `id`, `user_id`, `name`, `visibility`, `hidden`, `props` (tempo, compás, `tag_range`, delay), `ts` |
| `project_files` (nueva) | `id`, `project_id`, `file_id`, `track_group`, `tags` (JSON), `props` (volumen) |
| `user_track_groups`, `user_tags` | + `project_id` (se mantienen los nombres de tabla) |
| `reports` (nueva) | `id`, `target_type` (`file` \| `project`), `target_id`, `reporter_user_id`, `reason`, `status`, `ts` |
| `traffic` | ✅ ya existe |

Migración de los datos actuales (una vez, sobre copia primero): un proyecto por usuario existente
con su `users.props`; `project_files` desde `files.track_group/tags/props`; `project_id` en pistas y
tags; `duration` de los mp3 existentes con ffprobe (no se recodifican); usuario actual → `active` +
`admin`.

## Endpoints nuevos (propuesta técnica)

Todos validan sesión + `status` y filtran por dueño, salvo los públicos.

- Usuarios: `POST /register`, `PUT /change_password`. `GET /get_user_info` devuelve el usuario y
  la lista de proyectos (no los archivos).
- Proyectos: `GET/POST /projects`, `GET/PUT/DELETE /projects/:id`,
  `PUT /projects/:id/track_groups`, `PUT /projects/:id/tags`, `PUT /projects/:id/files`
  (importar, quitar, editar pista/tags/volumen).
- Archivos propios: `POST /upload` (con duración y metadatos), `PUT /files/:id`,
  `DELETE /files/:id` (cascada). Reemplazan a `save_fileData` y `delete_file`.
- Catálogo: `GET /catalog` (filtros: BPM con tolerancia, beats, creador, texto; paginado; solo
  disponibles).
- Público: `GET /public/projects` (galería), `GET /public/project/:id`. `GET /file/:id` ✅.
- Denuncias: `POST /report`.
- Admin: `GET /admin/users?status=`, `PUT /admin/users/:id` (admitir, rechazar, bloquear,
  desbloquear, cuota, reset de clave), `GET/PUT /admin/reports`, `PUT /admin/files/:id/hidden`,
  `PUT /admin/projects/:id/hidden`, `GET /admin/stats` (tráfico del mes, disco libre, usuarios).

Frontend: hacen falta rutas (`/`, `/p/:id`, `/admin`, registro). **Decidido: `vue-router`**
(dependencia nueva aprobada, con historial HTML5 y `try_files` en nginx).

## Ejecución con agentes

El plan se ejecuta **una fase por vez** con un agente orquestador. Dentro de la fase, las tareas
corren **estrictamente en secuencia**, sin paralelismo:

1. El orquestador toma la siguiente tarea pendiente de la fase.
2. Lanza un **subagente implementador** con el texto de la tarea, las reglas de abajo y el resumen
   de lo que hicieron las tareas anteriores.
3. Lanza un **subagente verificador** (no edita código): corre la verificación de la tarea y
   chequea el criterio de aceptación y que la documentación esté al día. Devuelve aprobado o una
   lista de fallas concretas.
4. Si falla, vuelve al implementador con el informe (**máximo 2 reintentos**). Si sigue fallando,
   el orquestador **se detiene** y reporta; no salta a la tarea siguiente.
5. Aprobada, marca la tarea `[x]` en este archivo y pasa a la siguiente.
6. Al terminar la fase, se detiene y entrega: resumen de cambios, resultado de cada verificación y
   la **lista de pruebas manuales** de la fase. El dueño prueba en el navegador y commitea; recién
   entonces se lanza la fase siguiente.

En Claude Code esto es un workflow (se pide explícitamente: "ejecutá la fase N con un workflow").
Otras herramientas pueden seguir el mismo procedimiento a mano: las tareas viven acá.

### Reglas para todos los subagentes

- Leer `AGENTS.md`, este plan y `docs/KNOWN_ISSUES.md` antes de empezar. Respetar las decisiones
  de este plan; si una tarea no se puede hacer sin cambiar una decisión, detenerse y reportarlo.
- **No tocar `storage/`.** Probar siempre contra una copia de `db.sqlite` (ver "Entorno de prueba").
- Sin commits, push ni ramas. Sin dependencias nuevas fuera de las aprobadas en este plan.
- **Nada en el servidor**: las acciones sobre el VPS (tarea 6.5) las hace la sesión principal con
  confirmación del dueño, nunca un subagente.
- Cada tarea actualiza en el mismo cambio la documentación que afecta (`API.md`,
  `ARCHITECTURE.md`, `KNOWN_ISSUES.md`, `INSTALACION.md`).
- No leer ni imprimir secretos de `backend/.env`.

### Entorno de prueba (lo usan implementador y verificador)

- Copiar `storage/db.sqlite` y `backend/.env` a un directorio temporal; en la copia del `.env`
  cambiar `db_file` a la copia de la base y `service_port` a `31299` (sin imprimir el archivo).
- Arrancar `node <repo>/backend/index.js` con ese directorio como cwd. Requiere Redis accesible.
- Probar con `curl` (login con `jntaca_password` de `backend/.env`, leído sin imprimirlo).
  Al terminar: apagar el proceso y borrar las claves `looper_login_fails:*` que hayan quedado.
- Verificación base de toda tarea: `node --check` de lo tocado en backend, `npm run lint` en
  backend y frontend (0 errores en lo tocado), `npm run build` en frontend, y el backend arranca
  y migra dos veces seguidas sin error sobre la copia (idempotencia).

## Fases y tareas

Formato de cada tarea: archivos que toca, qué hace y *Acepta* (criterio verificable). La
verificación base aplica siempre.

### Fase 0 — Seguridad base ✅

- [x] Política 1: `GET /file/:id` público + tabla `traffic`.
- [x] Política 2: sesión, cookie, límite de intentos, `Login.vue` vacío (probado contra una copia
      de la base).
- [x] El admin cambia su clave (nueva en `backend/.env` local, `jntaca_password`).

*Pruebas manuales*: entrar desde el navegador con la clave nueva; los loops cargan y suenan.

### Fase 1 — Usuarios ✅

- [x] **1.1 Esquema de usuarios.** `db_migrations.js`. Columnas `status`, `role`, `bio`,
  `max_seconds`; índices únicos en `email` y `name`. Usuarios existentes → `active`;
  `jntaca@gmail.com` → `admin`. Emails existentes a minúsculas.
  *Acepta*: en la copia, el usuario actual queda `active`/`admin`; migrar dos veces no cambia nada.
- [x] **1.2 Chequeo de sesión por request.** `routes/api.js`. Middleware que, con sesión, lee
  `status` y `role` de la base: si no es `active`, destruye la sesión y responde 401. Helper
  `require_admin`. Los endpoints existentes lo usan en vez de mirar solo `isLogged`.
  *Acepta*: poner `status = 'blocked'` en la copia corta una sesión abierta en el request siguiente.
- [x] **1.3 Login con estados.** `routes/api.js`. Email en minúsculas; después de validar la clave:
  `pending` → "pendiente de aprobación", `blocked` → error genérico (igual que clave inválida).
  *Acepta*: los tres casos responden lo especificado y solo `active` crea sesión.
- [x] **1.4 Registro.** `routes/api.js`. `POST /register` con email, clave (mín. 8), nombre
  (3–32, único), bio (≤280) y aceptación de la licencia → `pending`. Nombre repetido: error;
  email repetido: misma respuesta que el éxito. Límite por IP en Redis (como el login).
  *Acepta*: el alta queda `pending`; nombre repetido avisa; email repetido no se distingue.
- [x] **1.5 Cambio de clave.** `routes/api.js`. `PUT /change_password` pide la actual.
  *Acepta*: con la actual correcta cambia; con la incorrecta no.
- [x] **1.6 Admin de usuarios (API).** `routes/api.js`. `GET /admin/users?status=`,
  `PUT /admin/users/:id` con acciones admitir, rechazar (→ `blocked`), bloquear, desbloquear,
  reset de clave (la define el admin) y `max_seconds`. Todo con `require_admin`.
  *Acepta*: un usuario no admin no accede; cada acción cambia lo esperado.
- [x] **1.7 UI de cuenta.** `Login.vue` (+ componentes nuevos si hace falta), `helpers/api.js`.
  Diálogo de registro (con el texto de la licencia), cambio de clave, edición de bio. Sin rutas
  nuevas: diálogos dentro de la app.
  *Acepta*: build OK; un wrapper en `helpers/api.js` por endpoint nuevo.
- [x] **1.8 UI de admin mínima.** Componente nuevo, visible solo para `role = admin`, como
  diálogo: pendientes con admitir/rechazar; usuarios con bloquear/desbloquear/reset/cuota.
  *Acepta*: build OK; no aparece para usuarios comunes.

*Pruebas manuales*: registrarse desde el navegador, aprobar desde el admin, entrar con el usuario
nuevo, cambiar la clave, bloquearlo con su sesión abierta.

### Fase 2 — Subidas y audio ✅

- [x] **2.1 ffmpeg/ffprobe.** `backend/package.json`, `utils.js`. Agregar `ffmpeg-static` y
  `ffprobe-static`; `path_to_ffmpeg`/`path_to_ffprobe` opcionales en `.env`. `execFile` sin shell.
  Funciones `probe` (¿es audio?, duración) y `convert` a MP3 VBR V0 44.1 kHz estéreo sin metadatos.
  *Acepta*: probe y convert funcionan con un wav y un mp3 de prueba generados con el propio ffmpeg
  (no de `storage/`).
- [x] **2.2 Esquema de archivos.** `db_migrations.js`. `files.duration`, `bpm`, `beats`, `ts`.
  Migración: `duration` de los mp3 existentes con ffprobe donde sea null (sin recodificarlos).
  *Acepta*: en la copia, los 48 archivos tienen `duration`.
- [x] **2.3 Subida.** `routes/api.js`. Formatos mp3/wav/ogg/flac/m4a/aiff; rechazo de no-audio y
  de más de 60 s; cuota en segundos (`max_seconds`, default `default_max_seconds=1200` en `.env`)
  chequeada antes y dentro de la transacción; una subida en curso por usuario; cola global con
  concurrencia 1; rechazo si el disco libre < 10 GB (`disk_min_free_gb` en `.env`); solo `active`;
  recibe `bpm` y `beats`. Mensajes de error claros.
  *Acepta*: cada caso de rechazo responde su mensaje; una subida válida guarda un mp3 V0 con
  `duration` correcta.
- [x] **2.4 UI de subida.** `Uploader.vue`, `helpers/api.js`. Formatos aceptados, campos BPM y
  beats, cuota restante ("te quedan mm:ss"), errores del backend.
  *Acepta*: build OK.

*Pruebas manuales*: subir cada formato; rechazos por duración, no-audio y cuota; **un loop V0
empalma sin clic en Tone.js**.

### Fase 3 — Proyectos y catálogo ✅

- [x] **3.1 Esquema de proyectos.** `db_migrations.js`. Tablas `projects` y `project_files`;
  `project_id` en `user_track_groups` y `user_tags`; `files.hidden`.
  *Acepta*: tablas y columnas creadas, idempotente.
- [x] **3.2 Migración de datos.** `db_migrations.js`. Un proyecto por usuario con su `users.props`;
  `project_files` desde `files.track_group/tags/props`; `project_id` en pistas y tags. Corre una
  sola vez (detecta si ya migró). Las columnas viejas quedan documentadas como obsoletas.
  *Acepta*: en la copia, pistas, tags y archivos del proyecto = los que tenía el usuario.
- [x] **3.3 API de proyectos.** `routes/api.js`. `GET/POST /projects`,
  `GET/PUT/DELETE /projects/:id`, `PUT /projects/:id/track_groups`, `PUT /projects/:id/tags`.
  `get_user_info` devuelve usuario + lista de proyectos. Proyecto ajeno → 404.
  *Acepta*: CRUD completo; un usuario no ve ni edita proyectos de otro.
- [x] **3.4 API de archivos en proyectos.** `routes/api.js`. `PUT /projects/:id/files` (importar,
  quitar, editar pista/tags/volumen, validando que pista y tags sean del proyecto),
  `PUT /files/:id` (metadatos, solo el dueño), `DELETE /files/:id` (audio + cascada en todos los
  `project_files`). Se eliminan `save_fileData` y `delete_file`. Cada archivo devuelto trae
  `available` (false si está oculto o su dueño bloqueado).
  *Acepta*: importar un archivo ajeno disponible funciona; uno oculto no; borrar cascadea.
- [x] **3.5 Catálogo.** `routes/api.js`. `GET /catalog` con filtros (BPM ± tolerancia, beats,
  creador, texto), paginado, solo disponibles, con nombre público del creador y cantidad de usos.
  *Acepta*: filtros y paginado; ningún email ni dato sensible en la respuesta.
- [x] **3.6 Store por proyecto.** `composable.js`, `helpers/api.js`, `TrackCtrl.js`. Proyecto
  activo; cargar solo sus archivos (`Tone.Player` solo para esos); config (tempo, compás, delay,
  `tag_range`) desde `projects.props`; guardados contra los endpoints nuevos.
  *Acepta*: build OK; no quedan llamadas a endpoints eliminados.
- [x] **3.7 UI de proyectos.** Componente nuevo + `App.vue`. Elegir, crear, renombrar y borrar
  proyectos; visibilidad privada/pública.
  *Acepta*: build OK.
- [x] **3.8 Motor: no disponibles fuera del sorteo.** `Tracks.vue`, `Files.vue`. La selección
  aleatoria ignora archivos con `available = false`; una pista sin sorteables queda en silencio;
  tarjeta atenuada en Files.
  *Acepta*: build OK; sección del motor de `ARCHITECTURE.md` actualizada.
- [x] **3.9 Aviso de memoria.** `composable.js` + UI. Antes de cargar: segundos × 44 100 × 2 × 4;
  aviso con "¿cargar igual?" si supera ¼ de `navigator.deviceMemory` (o un valor fijo sin esa API).
  *Acepta*: build OK.
- [x] **3.10 Diálogo de importar.** Componente nuevo. Catálogo con filtros, preview con
  `toneLib.js` y total de memoria del proyecto a medida que se suman archivos.
  *Acepta*: build OK.

*Pruebas manuales*: tus datos migrados suenan igual que antes; crear un proyecto e importar;
quitar; borrar un archivo propio y ver la cascada; ocultarlo y que deje de sortearse; el aviso de
memoria aparece con un proyecto grande.

### Fase 4 — Público

*Decidido*: rutas con `vue-router`; denuncias solo de usuarios logueados.

- [ ] **4.1 API pública.** `routes/api.js`. `GET /public/projects` (galería) y
  `GET /public/project/:id` (404 si es privado, está oculto o el dueño está bloqueado); límite por IP.
  *Acepta*: ningún email ni id de usuario en las respuestas; casos 404.
- [ ] **4.2 Rutas en el frontend.** Según la decisión previa: `/`, `/p/:id`, galería.
  *Acepta*: build OK; el `try_files` necesario queda anotado para la 6.1.
- [ ] **4.3 Modo lectura.** Componentes afectados. En `/p/:id`: START/STOP y mixer local (mute,
  solo, volúmenes, tempo) sin guardar nada; edición, subida y guardado ocultos.
  *Acepta*: build OK; el modo lectura no hace ningún request de escritura.
- [ ] **4.4 Denuncias.** `db_migrations.js` (`reports`), `routes/api.js` (`POST /report`), botón en
  catálogo y galería.
  *Acepta*: se registra una denuncia con el alcance decidido.
- [ ] **4.5 Kiosko.** `docs/INSTALACION.md`: la instalación usa `/p/<id>?autostart=1` sin login.
  *Acepta*: documento actualizado.

*Pruebas manuales*: abrir un proyecto público sin sesión, tocar el mixer y recargar (no se guardó);
galería; autostart en kiosko con el link público.

### Fase 5 — Admin completo

- [ ] **5.1 API de moderación.** `routes/api.js`. `GET/PUT /admin/reports`,
  `PUT /admin/files/:id/hidden`, `PUT /admin/projects/:id/hidden`, `GET /admin/stats` (tráfico del
  mes desde `traffic`, disco libre, usuarios por estado).
  *Acepta*: todo con `require_admin`; ocultar es reversible.
- [ ] **5.2 UI de admin completa.** El diálogo de la 1.8 suma denuncias, ocultar archivo/proyecto
  y estadísticas.
  *Acepta*: build OK.

*Pruebas manuales*: denunciar, ocultar desde la denuncia, ver que deja de sortearse y de aparecer.

### Fase 6 — Infra y despliegue

- [x] DNS `looper.jape.com.ar` en Cloudflare.
- [x] Revisión de solo lectura del VPS (ver "Estado del servidor").
- [x] Node 24 en el servidor.
- [ ] **6.1 nginx.** `deploy/nginx/looper.jape.com.ar.conf` (plantilla en el repo): `dist/` en `/`
  con `try_files` para las rutas del frontend, `/api` a Node, certificado de `/opt/cert/`, headers
  de seguridad, `client_max_body_size` acorde a las subidas.
  *Acepta*: sintaxis revisada; se valida con `nginx -t` en el servidor en la 6.5.
- [ ] **6.2 pm2.** `backend/ecosystem.config.cjs` (nombre `looper`, cwd, sin secretos).
  *Acepta*: archivo válido.
- [ ] **6.3 Script de despliegue.** `deploy/deploy.sh` + `deploy/.env.deploy.example`
  (`.env.deploy` en `.gitignore`): por SSH, `git pull`, `npm ci` (backend y frontend),
  `npm run build_prd`, `systemctl restart pm2-looper`. `frontend/.env.prd` →
  `https://looper.jape.com.ar`.
  *Acepta*: `bash -n` OK; ninguna IP ni secreto en archivos versionados.
- [ ] **6.4 Documentación.** `docs/DEPLOY.md`: preparación inicial del servidor, despliegue,
  rollback y lecciones (`systemctl restart`, nunca `pm2 update`; no correr `pm2` como root).
  *Acepta*: sin IPs ni secretos.
- [ ] **6.5 Puesta en marcha en el servidor** — *la hace la sesión principal, paso a paso y con
  confirmación del dueño; no un subagente*: usuario `looper`, `git clone`, `backend/.env` con
  secretos nuevos, usuario ACL de Redis, migración de `storage/` (base + audios), servicio
  `pm2-looper`, nginx (`nginx -t` antes de `reload`).
  *Acepta*: `looper.jape.com.ar` carga y suena; **`jape.com.ar` y `carrilion.jape.com.ar` siguen
  respondiendo 200**.


## Más adelante (fuera de este plan)

Backups, email (verificación y recuperación), Turnstile en registro (y denuncias abiertas a visitantes), login con Google, detección
de BPM/tonalidad, stretch, editor gráfico de loops, semilla reproducible, pesos y transiciones
entre Tags, Web MIDI, grabar la sesión.
