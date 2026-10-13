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

| Método | Ruta | Sesión | Body / Query | Respuesta |
|---|---|---|---|---|
| POST | `/login` | no | `{ email, password }` (el email se compara en minúsculas) | `{ stat: true, data: { u_info, text } }` solo si `status = 'active'`; si no, `{ stat: false, text }`: clave correcta con `status = 'pending'` → "Tu cuenta está pendiente de aprobación"; clave inválida, email inexistente o `blocked` → "Usuario o clave inválida" (mismo texto y cuenta como fallo); 10 fallos por IP en 15 min → "Demasiados intentos" |
| POST | `/register` | no | `{ email, password, name, bio?, accept_license: true }` | `{ stat: true, text }` si se registró **o si el email ya existía** (misma respuesta, no revela registrados; la cuenta existente no se toca). Error `{ stat: false, text }`: email inválido, clave fuera de 8–72, nombre fuera de 3–32 o con caracteres no permitidos, bio de más de 280, licencia no aceptada, "Ese nombre ya está en uso" (sin distinguir mayúsculas), 10 intentos por IP por hora → "Demasiados intentos". Ver detalle abajo |
| PUT | `/change_password` | sí | `{ current_password, new_password }` | `{ stat: true, text: "Clave cambiada" }`; si no, `{ stat: false, text }`: falta la actual, nueva fuera de 8–72, "La clave actual es incorrecta" (cuenta como fallo), 10 fallos por usuario en 15 min → "Demasiados intentos". Ver detalle abajo |
| PUT | `/profile` | sí | `{ bio }` (string o `null`) | `{ stat: true }`; `{ stat: false, text }` si la bio pasa de 280 caracteres; 400 si `bio` no es string ni `null` |
| PUT | `/logout` | — | — | `{ stat: true }` |
| GET | `/get_user_info` | sí | — | `{ stat: true, u_info }` o `{ stat: false }` (200) sin sesión o con la sesión recién cortada |
| PUT | `/save_trackGroups` | sí | array `[{ id, name, color, props }]` | `{ stat: true }`; 400 si el body no es un array |
| PUT | `/save_user_props` | sí | objeto `{ tempo, beats_x_bar, tag_range, delay }` | `{ stat: true }`; 400 si el body no es un objeto o si el JSON pasa de 4096 caracteres |
| PUT | `/save_tags` | sí | array `[{ id, name, color }]` | `{ stat: true }`; 400 si el body no es un array |
| PUT | `/save_fileData` | sí | `{ file: { id, track_group, tags, props } }` | `{ stat: true }` |
| PUT | `/delete_file` | sí | `{ id }` (se envía el objeto archivo entero) | `{ stat: true }`; borra el mp3 y la fila, y descuenta el tamaño de `users.bytes_used` |
| GET | `/file/:id` | no | `id` = file_id (uuid) | archivo mp3 (soporta Range; `Cache-Control: public, max-age=31536000, immutable`); 404 si el id no es un uuid o no está en `files`. Los bytes enviados se suman a la tabla `traffic` |
| POST | `/upload` | sí | multipart: **un** archivo (mp3/wav/ogg/flac/m4a/aiff, hasta 80 MB y 60 s) + campos opcionales `bpm` y `beats` | `{ stat: true, text, data: archivo }` (misma forma que los `files` de `u_info`). Rechazos `{ stat: false, text }` con 400 (sin archivo, más de uno, formato, no es audio, más de 1 minuto, bpm/beats inválidos), 403 (cuota), 409 (otra subida en curso), 413 (más de 80 MB), 422 (no se pudo convertir), 507 (disco). Ver detalle abajo |
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
  props: { tempo, beats_x_bar, delay: { type, division, feedback, level } }, // config global; {} si no hay nada guardado
                                                                             // (el front completa los defaults)
  files: [{ id, original_name, track_group, tags: [tag_id, ...], size, props: { volume }, name: "<id>.mp3",
            duration, bpm, beats, ts }], // props.oneShot viejo puede venir: se ignora. duration: segundos (float);
                                         // bpm/beats: null hasta que el creador los cargue; ts: fecha de alta o null
  track_groups: [{ id, name, color, props: { volume, rest, mode, on_tag_change, density, reverb, drift, delay } }], // props: {} si no hay nada guardado
                                                                                // (el front completa los defaults)
  tags: [{ id, name, color }]
}
```

`login` devuelve el mismo `u_info` que `get_user_info`. Los datos del usuario se leen de la base en
cada llamada (lista blanca de columnas de `users`; nunca `password` ni `id`): la sesión solo guarda
el id.

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

### `save_trackGroups` / `save_tags`

Borran **todas** las filas del usuario y reinsertan el array recibido, en una transacción (si
falla, no se pierde nada y responden 500). Mandar siempre la colección
completa. De cada objeto solo se guardan las columnas de una lista blanca (`id, name, color, props`
para track groups, `id, name, color` para tags); el resto de los campos se ignora. `props` de un
track group se guarda como JSON (`JSON.stringify`) y `get_user_info` lo devuelve parseado.
`props.reverb` y `props.delay` (sends a la reverb y al delay global) son un número en dB o `null`
(= nada; no se usa `-Infinity` porque no es JSON válido) y `props.drift` un número 0..1. El backend no valida el contenido de `props`.

### `save_user_props`

Guarda la config global del usuario en `users.props` (JSON), reemplazando lo anterior. De lo recibido
solo se guardan las claves `tempo` (BPM), `beats_x_bar` (`"3"` | `"4"`), `tag_range`
(`[min, max]`, exponentes 5..9 de 2^n beats del cambio de Tag) y `delay`
(`{ type: "pingpong" | "stereo" | "dotted" | "tape", division: "16n" | "8t" | "8n" | "8n." | "4n" | "4n." | "2n", feedback: 0..0.9, level: dB }`);
el resto se ignora. El backend no valida los valores: el front los acota al cargar
(`apply_user_props` en `composable.js`). `get_user_info` lo devuelve parseado en `u_info.props`, leído
de la base en cada llamada (no de la copia de `users` que quedó en la sesión al hacer login).

### `save_fileData`

Solo actualiza `track_group`, `tags` (array de ids de tags, guardado como JSON) y `props`
(serializado a JSON). El resto de los campos del objeto se ignoran. Filtra por `user_id`: si el
archivo no existe o es de otro usuario responde 403 `{ stat: false, text: "Archivo inexistente" }`.

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
   `size` del mp3, `tags = []`) y suma `size` a `users.bytes_used`.

Cuota: `users.max_seconds` (o `default_max_seconds` de `.env` si es `null`, default 1200 = 20 min)
contra la suma de `files.duration` de los archivos del usuario. Por ahora todos los archivos de
`files.user_id` son propios; cuando existan los importados (fase 3) no cuentan.

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
   solo `res.status(...)` sin `send`, que deja la request colgada. Ver `delete_file` como ejemplo.
2. Agregar el wrapper en `frontend/src/helpers/api.js`.
3. Documentarlo en esta tabla.
