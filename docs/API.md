# API (backend/routes/api.js)

Base: `<VITE_APP_BACKEND>/api`. Autenticación por cookie de sesión (`express-session` en Redis),
salvo `get_file`, que usa `token` en query. Respuesta típica: `{ stat: boolean, text?: string, data?: any }`.

Los wrappers del frontend están en `frontend/src/helpers/api.js`; `request.js` ya devuelve
`response.data`, así que el front recibe directamente el cuerpo JSON.

| Método | Ruta | Sesión | Body / Query | Respuesta |
|---|---|---|---|---|
| POST | `/login` | no | `{ email, password }` | `{ stat: true, data: { u_info, text } }` o `{ stat: false, text }` |
| PUT | `/logout` | — | — | `{ stat: true }` |
| GET | `/get_user_info` | sí | — | `{ stat: true, u_info }` o `{ stat: false }` |
| PUT | `/save_trackGroups` | sí | array `[{ id, name, color }]` | `{ stat: true }` |
| PUT | `/save_tags` | sí | array `[{ id, name, color }]` | `{ stat: true }` |
| PUT | `/save_fileData` | sí | `{ file: { id, track_group, tag, props } }` | `{ stat: true }` |
| PUT | `/delete_file` | sí | `{ id }` (se envía el objeto archivo entero) | `{ stat: true }` |
| GET | `/get_file` | token | `?file=<file_id>&token=<u_info.token>` | archivo mp3 |
| POST | `/upload` | sí | multipart, uno o más archivos (mp3/wav) | 200 sin cuerpo |

## Detalles

### `u_info` (de `get_user_info` y `login`)

```js
{
  email, name, ts, bytes_used, max_bytes_uploaded,
  token,                       // para get_file
  files: [{ id, original_name, track_group, tag, size, props: { volume, oneShot }, name: "<id>.mp3" }],
  track_groups: [{ id, name, color, silences }],
  tags: [{ id, name, color }]
}
```

`login` devuelve el mismo `u_info` que `get_user_info`.

### `save_trackGroups` / `save_tags`

Borran **todas** las filas del usuario y reinsertan el array recibido, en una transacción (si
falla, no se pierde nada y responden 500). Mandar siempre la colección
completa. Los objetos se insertan tal cual, así que no deben traer campos que no sean columnas.

### `save_fileData`

Solo actualiza `track_group`, `tag` y `props` (serializado a JSON). El resto de los campos del
objeto se ignoran.

## Cómo agregar un endpoint

1. En `routes/api.js`: validar `req.session.isLogged` y responder
   `res.status(403).send({ stat: false, text: "Sin sesión" })` (nunca solo `res.status(403)`, que
   deja la request colgada), filtrar toda query por `user_id: req.session.u_info.id` y envolver en
   `try/catch` respondiendo 500 (Express 4 no captura rechazos de funciones `async`). Ver
   `delete_file` como ejemplo.
2. Agregar el wrapper en `frontend/src/helpers/api.js`.
3. Documentarlo en esta tabla.
