# Problemas conocidos y deuda técnica

Relevamiento hecho en octubre de 2026 sobre la rama `vuelta_a_knex` (commit `34c0cad`), leyendo el
código, sin ejecutarlo. Las referencias son a archivo y función/ruta, no a números de línea.
**Al arreglar algo, borrarlo de esta lista (o marcarlo como resuelto) en el mismo commit.**

Severidad: 🔴 seguridad o pérdida de datos · 🟠 bug funcional · 🟡 deuda técnica / prolijidad.

## Seguridad

- 🔴 **`GET /get_file` no valida el token.** `sessions.find(sess => sess.token = req.query.token)`
  asigna en lugar de comparar, así que siempre toma la primera sesión de Redis y sirve archivos de
  ese usuario a cualquiera. Además el token vive en `sess.u_info.token`, no en `sess.token`, y
  `sessionStore.all` carga todas las sesiones en cada request. Lo correcto sería resolver
  `HGET "TOKEN:" <token>` → session id (ya se guarda en el login) o firmar URLs.
- 🔴 **Path traversal en `get_file`.** `req.query.file` se concatena a la ruta sin sanitizar
  (`../` permite salir del directorio del usuario, siempre con extensión `.mp3`).
- 🔴 **Credenciales por defecto en `Login.vue`**: el formulario viene precargado con un email y
  clave reales (y la clave está en el historial de git). Quitar los valores y cambiar la clave.
  El input de password tampoco usa `type="password"`.
- 🟠 Secreto de sesión fijo (`secret: 'session_secret'` en `index.js`): moverlo a `.env`.
- 🟠 `utils.convert_file` arma un comando de shell interpolando rutas sin comillas: falla con
  espacios en `storage_path` y es frágil ante rutas controladas por terceros. Usar `execFile` con
  array de argumentos.

## Backend

- 🟡 `users.bytes_used` es correcto (recalculado desde `sum(files.size)` en oct 2026 y descontado en `delete_file`),
  pero no se usa para nada; tampoco `max_bytes_uploaded`. Si se implementa una cuota, validarlo en `upload`.

## Frontend — motor de reproducción (`Tracks.vue`)

- 🟡 `props.oneShot` se guarda y edita pero el motor no lo usa. `user_track_groups.silences` y la
  tabla `sets` tampoco (`silences` ya no se devuelve en `get_user_info` ni se guarda: al guardar los
  track groups queda en null; en la base actual estaba vacía en todas las filas).

## Frontend — general

- 🟠 Si `GET /get_file` no encuentra una sesión, el handler lanza dentro del callback de
  `sessionStore.all` y la request queda colgada: el audio no dispara `onerror` y la app no queda
  lista. Se resuelve junto con el arreglo de seguridad de `get_file`.

## Entorno

- ✅ Resuelto (oct 2026): `better-sqlite3@9` no tenía binarios para Node 24; se actualizó a `^12`
  y `.nvmrc` pasó a Node 24. Backend probado: arranca, migra y responde.
- 🟡 Si Redis no tiene clave pero `.env` define `redis_password`, ioredis loguea un warning
  (inofensivo). Dejar `redis_password` vacío en ese caso.
