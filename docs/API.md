# API (backend/routes/api.js)

Base: `<VITE_APP_BACKEND>/api`. Autenticación por cookie de sesión (`express-session` en Redis),
salvo `file/:id`, que es público (los archivos de audio son siempre públicos). Respuesta típica: `{ stat: boolean, text?: string, data?: any }`.

En cada request con sesión, un middleware del router lee `status` y `role` del usuario **de la
base**: si no existe o no está `active`, destruye la sesión (en Redis) y el request sigue sin
sesión. Los endpoints con "Sesión: sí" responden entonces **401** `{ stat: false, text: "Sin sesión" }`
(helper `require_session`); `get_user_info` responde `{ stat: false }`. Así, bloquear a alguien corta
su sesión en el request siguiente. Los endpoints de admin usan `require_admin` (401 sin sesión,
403 `{ stat: false, text: "Sin permiso" }` si `role` no es `admin`).

Los wrappers del frontend están en `frontend/src/helpers/api.js`; `request.js` ya devuelve
`response.data`, así que el front recibe directamente el cuerpo JSON. Si el status no es 2xx, axios
rechaza la promesa: `error_text(e)` (en `helpers/api.js`) devuelve el `text` del backend o un
mensaje de conexión para mostrarlo al usuario. Wrappers de cuenta: `register`, `change_password` y
`save_profile` (`PUT /profile`). Wrappers de admin: `admin_get_users(status?)` (`GET /admin/users`)
y `admin_update_user(id, { action, ... })` (`PUT /admin/users/:id`), usados por `Admin.vue`.
Wrappers de proyectos (tarea 3.3; desde la 3.6 el store de `composable.js` guarda todo contra el
proyecto activo con estos, y `Projects.vue` los usa para listar, crear, renombrar, cambiar la
visibilidad y borrar): `get_projects`,
`create_project(data)`, `get_project(id)`, `update_project(id, data)`, `delete_project(id)`,
`save_project_track_groups(id, array)` y `save_project_tags(id, array)`. Wrappers de archivos (tarea
3.4): `save_project_files(id, { add?, update?, remove? })` (`PUT /projects/:id/files`),
`update_file(id, data)` (`PUT /files/:id`) y `delete_file(file | id)` (ahora `DELETE /files/:id`);
`upload_file` acepta `project_id`. Catálogo (tarea 3.5): `get_catalog(params)` (`GET /catalog`);
lo usa el diálogo de importar (`ImportFiles.vue`, tarea 3.10), que importa con
`save_project_files(id, { add })`.
Los wrappers de los endpoints eliminados (`save_trackGroups`, `save_tags`, `save_user_props`,
`save_fileData`) se quitaron en la tarea 3.6.

Proyectos: un proyecto es de **un solo dueño**. Todos los endpoints `/projects/:id...` buscan el
proyecto con `id` **y** `user_id` de la sesión: uno ajeno o inexistente responde **404**
`{ stat: false, text: "Proyecto inexistente" }` (sin distinguir entre ambos).

| Método | Ruta | Sesión | Body / Query | Respuesta |
|---|---|---|---|---|
| POST | `/login` | no | `{ email, password }` (el email se compara en minúsculas) | `{ stat: true, data: { u_info, text } }` solo si `status = 'active'`; si no, `{ stat: false, text }`: clave correcta con `status = 'pending'` → "Tu cuenta está pendiente de aprobación"; clave inválida, email inexistente o `blocked` → "Usuario o clave inválida" (mismo texto y cuenta como fallo); 10 fallos por IP en 15 min → "Demasiados intentos" |
| POST | `/register` | no | `{ email, password, name, bio?, accept_license: true }` | `{ stat: true, text }` si se registró **o si el email ya existía** (misma respuesta, no revela registrados; la cuenta existente no se toca). Error `{ stat: false, text }`: email inválido, clave fuera de 8–72, nombre fuera de 3–32 o con caracteres no permitidos, bio de más de 280, licencia no aceptada, "Ese nombre ya está en uso" (sin distinguir mayúsculas), 10 intentos por IP por hora → "Demasiados intentos". Ver detalle abajo |
| PUT | `/change_password` | sí | `{ current_password, new_password }` | `{ stat: true, text: "Clave cambiada" }`; si no, `{ stat: false, text }`: falta la actual, nueva fuera de 8–72, "La clave actual es incorrecta" (cuenta como fallo), 10 fallos por usuario en 15 min → "Demasiados intentos". Ver detalle abajo |
| PUT | `/profile` | sí | `{ bio }` (string o `null`) | `{ stat: true }`; `{ stat: false, text }` si la bio pasa de 280 caracteres; 400 si `bio` no es string ni `null` |
| PUT | `/logout` | — | — | `{ stat: true }` |
| GET | `/get_user_info` | sí | — | `{ stat: true, u_info }` (usuario, cuota y lista de proyectos; **sin** archivos, pistas, tags ni config) o `{ stat: false }` (200) sin sesión o con la sesión recién cortada |
| GET | `/projects` | sí | — | `{ stat: true, data: [proyecto] }` (forma de la lista, ver abajo), del más viejo al más nuevo |
| POST | `/projects` | sí | `{ name, visibility?, props? }` | `{ stat: true, data: proyecto }` (vacío: sin pistas, tags ni archivos); `{ stat: false, text }` si el nombre no tiene 1–64 caracteres; 400 si `visibility` no es `private`/`public` o `props` no es un objeto |
| GET | `/projects/:id` | sí | — | `{ stat: true, data: proyecto completo }` (con `props`, `track_groups`, `tags` y `files`); 404 si no es del usuario |
| PUT | `/projects/:id` | sí | `{ name?, visibility?, props? }` (solo lo que venga) | `{ stat: true, data: proyecto }` (forma de la lista, ya actualizado); mismas validaciones que `POST`; 404 si no es del usuario |
| DELETE | `/projects/:id` | sí | — | `{ stat: true }`; borra el proyecto, sus pistas, tags y filas de `project_files` (los archivos del catálogo quedan); 404 si no es del usuario |
| PUT | `/projects/:id/track_groups` | sí | array **completo** `[{ id, name, color, props }]` | `{ stat: true }`; 400 si el body no es un array, falta un `id` o hay un id repetido o usado en otro proyecto; 404 si no es del usuario |
| PUT | `/projects/:id/tags` | sí | array **completo** `[{ id, name, color }]` | ídem `track_groups` |
| PUT | `/projects/:id/files` | sí | `{ add?, update?, remove? }` (ver detalle abajo) | `{ stat: true, data: [archivo del proyecto] }` (todos los del proyecto, ya actualizados); 400 `{ stat: false, text }` si algo es inválido (no se aplica nada); 404 si el proyecto no es del usuario |
| PUT | `/files/:id` | sí | `{ original_name?, bpm?, beats? }` | `{ stat: true, data: archivo }` (forma del catálogo); `{ stat: false, text }` si un valor es inválido; 404 si el archivo no es del usuario o no existe |
| DELETE | `/files/:id` | sí | — | `{ stat: true, data: { removed_from_projects } }`; borra el archivo **en cascada** de todos los proyectos (propios y ajenos), la fila, el mp3 y descuenta `users.bytes_used`; 404 si no es del usuario o no existe |
| GET | `/catalog` | sí | query opcional: `bpm`, `bpm_tol`, `beats`, `creator`, `q`, `page`, `per_page` | `{ stat: true, data: { items: [archivo del catálogo con creador y usos], total, page, per_page } }` (solo archivos disponibles); 400 `{ stat: false, text }` si un parámetro es inválido. Ver detalle abajo |
| GET | `/file/:id` | no | `id` = file_id (uuid) | archivo mp3 (soporta Range; `Cache-Control: public, max-age=31536000, immutable`); 404 si el id no es un uuid o no está en `files`. Los bytes enviados se suman a la tabla `traffic` |
| POST | `/upload` | sí | multipart: **un** archivo (mp3/wav/ogg/flac/m4a/aiff, hasta 80 MB y 60 s) + campos opcionales `bpm`, `beats` y `project_id` | `{ stat: true, text, data: archivo }` (forma de los archivos del proyecto, más `project_id`). 404 si `project_id` no es un proyecto del usuario. Rechazos `{ stat: false, text }` con 400 (sin archivo, más de uno, formato, no es audio, más de 1 minuto, bpm/beats inválidos), 403 (cuota), 409 (otra subida en curso), 413 (más de 80 MB), 422 (no se pudo convertir), 507 (disco). Ver detalle abajo |
| GET | `/admin/users` | admin | query `status` opcional: `pending` \| `active` \| `blocked` (sin él o vacío: todos) | `{ stat: true, data: [usuario admin] }`, ordenados por `ts` descendente; 400 si `status` es otro valor. Ver detalle abajo |
| PUT | `/admin/users/:id` | admin | `{ action, password?, max_seconds? }` | `{ stat: true, data: usuario admin }` (ya actualizado); `{ stat: false, text }` si la acción no corresponde al estado, el usuario es admin, o la clave/cuota no es válida; 400 acción desconocida; 404 usuario inexistente. Ver detalle abajo |

## Detalles

### `u_info` (de `get_user_info` y `login`)

```js
{
  email, name, ts, bytes_used, max_bytes_uploaded,
  status, role, bio, max_seconds, // status: "active" (los otros estados no deberían tener sesión); role: "user" | "admin"; max_seconds: null = default
  quota: { max_seconds, used_seconds }, // cuota efectiva (max_seconds o default_max_seconds de .env) y suma de files.duration;
                                        // la usa Uploader.vue para "te quedan m:ss"
  projects: [{ id, name, visibility, hidden, ts }] // proyectos del usuario (forma de la lista de GET /projects)
}
```

`login` devuelve el mismo `u_info` que `get_user_info`. Los datos del usuario se leen de la base en
cada llamada (lista blanca de columnas de `users`; nunca `password` ni `id`): la sesión solo guarda
el id. Desde la tarea 3.3 **no** trae `props`, `files`, `track_groups` ni `tags`: todo eso es del
proyecto y viene de `GET /projects/:id` (el front abre el proyecto activo con `get_project`
después de `get_user_info`; ver "Carga inicial" en `ARCHITECTURE.md`).

### `register`

Registro público. La cuenta se crea con `status = 'pending'` y `role = 'user'` (no se crea sesión:
hasta que un admin la admita, el login responde "pendiente de aprobación"). Validación:

- `email`: se recorta y pasa a minúsculas; formato `x@y.z`, hasta 254 caracteres.
- `password`: 8 a 72 caracteres (bcrypt solo usa los primeros 72 bytes); se guarda el hash bcrypt.
- `name`: nombre público, se recorta; 3 a 32 caracteres, solo letras, números, espacio, `.`, `-` y
  `_`. Único **sin distinguir mayúsculas** (`Jape` y `jape` chocan; el índice de la base sí las
  distingue, el chequeo lo hace el endpoint).
- `bio`: opcional, se recorta, hasta 280 caracteres (vacía → `null`).
- `accept_license`: tiene que ser `true` (licencia única "libre uso dentro de Looper"). No se guarda:
  toda cuenta registrada la aceptó.

Orden: validación de formato (no cuenta para el límite) → límite por IP → hash bcrypt (se calcula
siempre, para que el tiempo de respuesta no delate un email repetido) → nombre repetido (error) →
email repetido (misma respuesta que el éxito) → insert. Si dos registros simultáneos chocan en los
índices únicos, se responde igual (nombre → error; email → éxito).

Límite por IP en Redis: `looper_register:<ip>` cuenta los intentos con datos válidos (éxitos
incluidos); con más de 10 en una hora desde el primero responde "Demasiados intentos, probá de
nuevo más tarde".

### `change_password`

Cambio de clave del propio usuario. Pide la clave actual (se compara con bcrypt) y la nueva, con la
misma regla que el registro (8 a 72 caracteres; se guarda el hash bcrypt). No se exige que la nueva
sea distinta de la actual. Los fallos con la actual se cuentan **por usuario** en Redis
(`looper_pwchange_fails:<user_id>`; por usuario y no por IP para no bloquear el login de otros en la
misma red): con 10 fallos se rechaza 15 min desde el primero; un cambio correcto borra el contador.
La sesión actual sigue abierta; las otras sesiones del usuario **no** se cierran (ver
`KNOWN_ISSUES.md`).

### `profile`

Edita el perfil público del propio usuario. Por ahora solo `bio`: se recorta, hasta 280 caracteres,
vacía o `null` → `null`. El nombre público no se cambia. `get_user_info` devuelve la bio nueva.

### `projects` (proyectos)

Proyecto en la **forma de la lista** (`GET /projects`, `u_info.projects`, respuesta de `POST` y `PUT`):

```js
{ id, name, visibility: "private" | "public", hidden: bool, ts } // hidden: oculto por el admin (fase 5; el dueño lo sigue viendo)
```

**Proyecto completo** (`GET /projects/:id`): lo de arriba más

```js
{
  props: { tempo, beats_x_bar, tag_range, delay }, // config del proyecto; {} si no hay nada guardado (el front completa los defaults)
  track_groups: [{ id, name, color, props: { volume, rest, mode, on_tag_change, density, reverb, drift, delay } }], // props: {} si no hay nada
  tags: [{ id, name, color }],
  files: [{ id, original_name, size, duration, bpm, beats, ts, // del catálogo (files)
            track_group, tags: [tag_id, ...], props: { volume }, // del proyecto (project_files)
            name: "<id>.mp3", own: bool, available: bool }] // own: el archivo es del usuario (si no, es importado)
}
```

`id` de cada archivo es el id del archivo del catálogo (el de `GET /file/:id`). `props.oneShot` viejo
puede venir en archivos migrados: se ignora. `available` es `false` si el admin ocultó el archivo
(`files.hidden`) o su dueño no está `active` (bloqueado): el archivo sigue en el proyecto pero queda
fuera del sorteo (tarea 3.8) y no se puede importar. Ver `projects/:id/files`.

- `POST /projects`: `name` se recorta, 1 a 64 caracteres. `visibility` default `private`. `props`
  opcional (default `{}`), con la misma lista blanca que abajo. `hidden` nace en 0.
- `PUT /projects/:id`: actualiza solo los campos presentes. `props` **reemplaza** la config completa
  (lista blanca `tempo`, `beats_x_bar`, `tag_range`, `delay`; el resto se ignora; hasta 4096
  caracteres de JSON; el backend no valida los valores: el front los acota al cargar con
`apply_project_props` en `composable.js`). Forma: `tempo` (BPM), `beats_x_bar` (`"3"` | `"4"`),
`tag_range` (`[min, max]`, exponentes 5..9 de 2^n beats del cambio de Tag) y `delay`
(`{ type: "pingpong" | "stereo" | "dotted" | "tape", division: "16n" | "8t" | "8n" | "8n." | "4n" | "4n." | "2n", feedback: 0..0.9, level: dB }`). `hidden` no se
  puede cambiar desde acá (lo modera el admin) y se ignora si viene.
- `DELETE /projects/:id`: en una transacción borra las filas de `project_files`, `user_track_groups`
  y `user_tags` del proyecto y el proyecto. Los archivos no se tocan (siguen en el catálogo y en otros
  proyectos). Se puede borrar el último proyecto: el usuario queda con la lista vacía.

### `projects/:id/track_groups` / `projects/:id/tags`

Borran **todas** las pistas (o tags) del proyecto y reinsertan el array recibido, en una
transacción (si falla, no se pierde nada). Mandar siempre la colección completa. De cada objeto
solo se guardan las columnas de una lista blanca (`id, name, color, props` para track groups,
`id, name, color` para tags); el resto de los campos se ignora. `props` de un track group se guarda
como JSON y `GET /projects/:id` lo devuelve parseado. `props.reverb` y `props.delay` (sends a la
reverb y al delay global) son un número en dB o `null` (= nada; no se usa `-Infinity` porque no es
JSON válido) y `props.drift` un número 0..1. El backend no valida el contenido de `props`.

Los `id` los genera el cliente (uuid; string de hasta 36 caracteres, obligatorio) y son únicos en
toda la tabla: un id repetido dentro del array → 400 "Id repetido: <id>"; un id que ya usa una fila
de **otro** proyecto (propio o ajeno) → 400 "Id ya usado: <id>", sin cambiar nada (no se puede
pisar ni mover una pista de otro proyecto).

Después de reinsertar, limpian en `project_files` del proyecto las referencias a lo que ya no está:
un archivo cuya pista desapareció queda con `track_group = null`; los tags que desaparecieron se
quitan de su array `tags`.

Reemplazan a `save_trackGroups` / `save_tags`, eliminados en la tarea 3.3: borraban las filas del
usuario en todos sus proyectos y reinsertaban sin `project_id` (desde la tarea 3.6 el front usa
estos).

`save_user_props` (config global en `users.props`) se eliminó en la tarea 3.6: la config es de cada
proyecto (`props` de `PUT /projects/:id`).

### `projects/:id/files` (archivos en un proyecto)

Importa, edita y quita archivos del proyecto, **todo en una transacción**: si un elemento es
inválido responde 400 `{ stat: false, text }` con el motivo y no aplica nada. Body (las tres listas
son opcionales):

```js
{
  add: [file_id | { id, track_group?, tags?, props? }], // importar archivos del catálogo (propios o ajenos)
  update: [{ id, track_group?, tags?, props? }],        // editar archivos que ya están en el proyecto
  remove: [file_id]                                     // quitarlos del proyecto (el archivo sigue en el catálogo)
}
```

- `id` es el id del archivo del catálogo. Un archivo está **como mucho una vez** por proyecto, y
  no puede aparecer dos veces en el mismo body ("Archivo repetido").
- `add`: el archivo tiene que existir ("Archivo inexistente"), estar **disponible** (no oculto y
  dueño `active`; si no, "Archivo no disponible") y no estar ya en el proyecto ("El archivo ya está
  en el proyecto"). Entra con lo que venga (default: sin pista, `tags = []`, `props = {}`).
- `update`: solo cambia los campos presentes; `props` reemplaza las props completas. Un archivo no
  disponible que ya está en el proyecto se puede editar o quitar. El archivo tiene que estar en el
  proyecto ("El archivo no está en el proyecto"; igual para `remove`).
- `track_group`: id de una pista **del mismo proyecto** o `null`/`""` (sin pista). `tags`: array de
  ids de tags **del mismo proyecto** (los repetidos se descartan). Si no, "La pista/El tag no es del
  proyecto".
- `props`: objeto con lista blanca `{ volume }` (dB, número; el resto de las claves se ignora).

Responde todos los archivos del proyecto ya actualizados, con la forma de `files` de
`GET /projects/:id` (con `own` y `available`). Validar la forma del body no necesita el proyecto:
con un body inválido responde 400 aunque el proyecto sea ajeno (con uno válido, 404).

### `files/:id` (metadatos y borrado de un archivo propio)

Solo el **dueño** del archivo: uno ajeno o inexistente responde 404 `{ stat: false, text: "Archivo
inexistente" }` (sin distinguir). Archivo en la **forma del catálogo**:

```js
{ id, original_name, size, duration, bpm, beats, ts, name: "<id>.mp3", own: bool, available: bool }
```

- `PUT /files/:id` `{ original_name?, bpm?, beats? }`: solo lo que venga. `original_name` se recorta,
  1 a 128 caracteres; `bpm` 20..400 y `beats` entero 1..1024, como en `/upload` (vacío o `null` →
  sin dato). Pista, tags y volumen son de cada proyecto (`PUT /projects/:id/files`). Reemplaza a
  `save_fileData` (eliminado en la tarea 3.4).
- `DELETE /files/:id`: en una transacción borra las filas de `project_files` que lo usan en
  **todos** los proyectos (también los de otros usuarios que lo importaron), la fila de `files` y
  descuenta su tamaño de `users.bytes_used` (sin bajar de 0); después borra el mp3 (si falla, queda
  un mp3 huérfano en disco y se loguea). Responde `{ removed_from_projects: n }`. Reemplaza a
  `delete_file` (eliminado en la tarea 3.4).

### `catalog` (catálogo)

Archivos **disponibles** de todos los usuarios (no ocultos por el admin y con dueño `active`; los
mismos que se pueden importar con `PUT /projects/:id/files`), para buscar e importar. Pide sesión.
Query, toda opcional:

| Parámetro | Valor | Filtro |
|---|---|---|
| `bpm` | número 20..400 | `files.bpm` entre `bpm - bpm_tol` y `bpm + bpm_tol` (los archivos sin BPM quedan afuera) |
| `bpm_tol` | número 0..50, default 2 | tolerancia de `bpm` (sin `bpm` se ignora) |
| `beats` | entero 1..1024 | `files.beats` igual |
| `creator` | nombre público, hasta 64 caracteres | creador con ese nombre exacto, sin distinguir mayúsculas |
| `q` | texto, hasta 64 caracteres | `original_name` contiene el texto (sin distinguir mayúsculas en ASCII; `%` y `_` son literales) |
| `page` | entero ≥ 1, default 1 | página |
| `per_page` | entero 1..100, default 50 | archivos por página |

Vacíos se ignoran; un valor fuera de rango (o un parámetro repetido) responde 400 `{ stat: false,
text }` con el motivo. Orden: los más nuevos primero (`ts` descendente; los sin `ts` al final;
desempata por `id`, así el paginado es estable). Respuesta:

```js
{
  items: [{ id, original_name, duration, bpm, beats, ts, name: "<id>.mp3",
            own: bool,                 // el archivo es del usuario de la sesión
            uses: n,                   // cantidad de proyectos que lo usan (filas de project_files, de cualquier usuario)
            creator: { name, bio } }], // nombre público y bio del dueño (bio null si no tiene)
  total,           // archivos que cumplen los filtros (todas las páginas)
  page, per_page
}
```

Nunca trae el email, el id ni el estado del dueño, ni `size`. Una página más allá del final
responde `items: []` con el `total` real.

### `upload`

Sube **un archivo por request** (multipart; el nombre del campo no importa) con dos campos de texto
opcionales: `bpm` (número 20..400, se redondea a 2 decimales) y `beats` (entero 1..1024); vacíos o
ausentes → `null`. Solo usuarios `active` (lo garantiza `require_session`). Orden de los chequeos:

1. **Antes de recibir el archivo** (el cuerpo multipart se lee recién después): otra subida del
   mismo usuario en curso → 409 "Ya tenés una subida en curso: esperá a que termine"; disco de
   `storage_path` con menos de `disk_min_free_gb` GB libres (`.env`, default 10) → 507 "El servidor
   está sin espacio: las subidas están suspendidas por ahora"; cuota agotada → 403 "Llegaste a tu
   cuota de m:ss de audio".
2. **Con el archivo en un temporal**: más de 80 MB → 413 "El archivo supera los 80 MB" (se corta la
   conexión); sin archivo → 400 "No llegó ningún archivo"; más de uno → 400 "Se sube un archivo por
   vez"; extensión fuera de mp3/wav/ogg/flac/m4a/aiff (`.aif` también) → 400 "Formato no aceptado";
   `bpm`/`beats` fuera de rango → 400; ffprobe dice que no es audio → 400 "<nombre> no es un archivo
   de audio válido"; dura más de 60 s (con 0,1 s de margen por el relleno de mp3/m4a) → 400
   "<nombre> dura m:ss: el máximo es 1 minuto por archivo"; la duración no entra en la cuota → 403
   "No te alcanza la cuota: te quedan m:ss y <nombre> dura m:ss"; disco otra vez → 507.
3. **Conversión** en la cola global (concurrencia 1) a MP3 VBR V0 44,1 kHz estéreo sin metadatos
   (todo se recodifica, también los mp3). Si ffmpeg falla → 422 "No se pudo convertir <nombre>".
4. **Transacción**: vuelve a calcular la cuota (por si cambió mientras se convertía; 403 si ya no
   entra), inserta la fila en `files` (`duration` medida sobre la entrada, `bpm`, `beats`, `ts`,
   `size` del mp3, `tags = []`) y suma `size` a `users.bytes_used`. Con `project_id`, vuelve a
   comprobar que el proyecto siga siendo del usuario (404 si se borró mientras se convertía) e
   inserta la fila de `project_files`: el archivo queda en ese proyecto sin pista, sin tags y con
   `props = {}`.

**`project_id`** (campo opcional): proyecto propio al que se agrega el archivo subido. Se valida
después de `bpm`/`beats` y antes de medir con ffprobe: si no es un proyecto del usuario → 404
"Proyecto inexistente". Sin él (o vacío), el archivo solo queda en el catálogo (se puede agregar
después con `PUT /projects/:id/files` `{ add: [id] }`). La respuesta trae `project_id` (o `null`).

Cuota: `users.max_seconds` (o `default_max_seconds` de `.env` si es `null`, default 1200 = 20 min)
contra la suma de `files.duration` de los archivos **del usuario** (`files.user_id`). Los importados
de otros usuarios no cuentan (siguen siendo del dueño en `files`).

Los temporales se borran siempre al terminar; si la subida no queda registrada, también el mp3
convertido. Si el cliente corta la conexión mientras sube, el lugar de "subida en curso" se libera
al cerrarse la conexión.

### `admin/users` (admin de usuarios)

Ambos con `require_admin` (401 sin sesión, 403 si `role` no es `admin`). El "usuario admin" que
devuelven tiene solo `{ id, email, name, bio, status, role, max_seconds, bytes_used, ts }`: nunca el
hash de la clave ni `props`.

Acciones de `PUT /admin/users/:id` (`action`):

| `action` | Requiere | Efecto |
|---|---|---|
| `admit` | `status = 'pending'` | → `active` (admite la solicitud) |
| `reject` | `status = 'pending'` | → `blocked` (email y nombre quedan reservados) |
| `block` | `status = 'active'` | → `blocked`; sus sesiones abiertas se cortan en el request siguiente |
| `unblock` | `status = 'blocked'` | → `active` (también sirve para admitir una solicitud rechazada) |
| `reset_password` | `password` (8 a 72, como el registro) | guarda el hash bcrypt de la clave que define el admin (se la pasa al usuario por otro canal) y borra `looper_pwchange_fails:<id>`. **No** cierra las sesiones abiertas del usuario (ver `KNOWN_ISSUES.md`) |
| `set_max_seconds` | `max_seconds`: entero 0..86400 o `null` | cuota de audio en segundos; `null` = `default_max_seconds` de `.env` (la usa `/upload`) |

Si el estado no es el requerido responde `{ stat: false, text: 'No se puede aplicar "<action>" a un
usuario <status>' }` sin cambiar nada (el update está condicionado al estado de partida). Las
acciones de estado no se aplican a usuarios con `role = 'admin'` (`{ stat: false, text: "No se puede
cambiar el estado de un admin" }`), así el admin no se bloquea a sí mismo; el reset de clave y la
cuota sí. El rol no se cambia desde la API.

## Cómo agregar un endpoint

1. En `routes/api.js`: poner `require_session` (o `require_admin`) como middleware de la ruta
   (`router.put("/x", require_session, async (req, res) => ...)`), filtrar toda query por
   `user_id: req.user.id` (lo deja el chequeo de sesión; no usar `req.session.u_info`) y envolver en
   `try/catch` respondiendo 500 (Express 4 no captura rechazos de funciones `async`). Nunca responder
   solo `res.status(...)` sin `send`, que deja la request colgada. Ver `DELETE /files/:id` como ejemplo.
2. Agregar el wrapper en `frontend/src/helpers/api.js`.
3. Documentarlo en esta tabla.
