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
| PUT | `/save_trackGroups` | sí | array `[{ id, name, color, props }]` | `{ stat: true }`; 400 si el body no es un array |
| PUT | `/save_tags` | sí | array `[{ id, name, color }]` | `{ stat: true }`; 400 si el body no es un array |
| PUT | `/save_fileData` | sí | `{ file: { id, track_group, tags, props } }` | `{ stat: true }` |
| PUT | `/delete_file` | sí | `{ id }` (se envía el objeto archivo entero) | `{ stat: true }`; borra el mp3 y la fila, y descuenta el tamaño de `users.bytes_used` |
| GET | `/get_file` | token | `?file=<file_id>&token=<u_info.token>` | archivo mp3 |
| POST | `/upload` | sí | multipart, uno o más archivos (mp3/wav) | 200 sin cuerpo |

## Detalles

### `u_info` (de `get_user_info` y `login`)

```js
{
  email, name, ts, bytes_used, max_bytes_uploaded,
  token,                       // para get_file
  files: [{ id, original_name, track_group, tags: [tag_id, ...], size, props: { volume }, name: "<id>.mp3" }], // props.oneShot viejo puede venir: se ignora
  track_groups: [{ id, name, color, props: { volume, mute, solo, rest, mode, on_tag_change, density, reverb, drift } }], // props: {} si no hay nada guardado
                                                                                // (el front completa los defaults)
  tags: [{ id, name, color }]
}
```

`login` devuelve el mismo `u_info` que `get_user_info`.

### `save_trackGroups` / `save_tags`

Borran **todas** las filas del usuario y reinsertan el array recibido, en una transacción (si
falla, no se pierde nada y responden 500). Mandar siempre la colección
completa. De cada objeto solo se guardan las columnas de una lista blanca (`id, name, color, props`
para track groups, `id, name, color` para tags); el resto de los campos se ignora. `props` de un
track group se guarda como JSON (`JSON.stringify`) y `get_user_info` lo devuelve parseado.
`props.reverb` es un número en dB o `null` (= sin reverb; no se usa `-Infinity` porque no es JSON
válido) y `props.drift` un número 0..1. El backend no valida el contenido de `props`.

### `save_fileData`

Solo actualiza `track_group`, `tags` (array de ids de tags, guardado como JSON) y `props`
(serializado a JSON). El resto de los campos del objeto se ignoran. Filtra por `user_id`: si el
archivo no existe o es de otro usuario responde 403 `{ stat: false, text: "Archivo inexistente" }`.

## Cómo agregar un endpoint

1. En `routes/api.js`: validar `req.session.isLogged` y responder
   `res.status(403).send({ stat: false, text: "Sin sesión" })` (nunca solo `res.status(403)`, que
   deja la request colgada), filtrar toda query por `user_id: req.session.u_info.id` y envolver en
   `try/catch` respondiendo 500 (Express 4 no captura rechazos de funciones `async`). Ver
   `delete_file` como ejemplo.
2. Agregar el wrapper en `frontend/src/helpers/api.js`.
3. Documentarlo en esta tabla.
