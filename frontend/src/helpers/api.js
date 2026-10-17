import request from './request'

// versión del audio servido: GET /file/:id va con caché immutable de un año, así que si se reprocesan
// los mp3 del servidor (p.ej. backend/normalize_existing.js) hay que subir este número para que los
// navegadores los vuelvan a bajar. El backend ignora el query.
const AUDIO_VERSION = 2
// url pública del audio de un archivo
export function file_url(id) {
  return import.meta.env.VITE_APP_BACKEND + "/api/file/" + id + "?v=" + AUDIO_VERSION
}

// atajos: cada wrapper devuelve la promesa de request (que resuelve con el body JSON)
const enc = encodeURIComponent
const get = (url, params) => request({ url, method: "get", params })
const post = (url, data) => request({ url, method: "post", data })
const put = (url, data) => request({ url, method: "put", data })
const del = (url) => request({ url, method: "delete" })

export function login(data) {
  return post("/api/login", data)
}

export function logout() {
  return put("/api/logout")
}
// borra un archivo propio (audio + sus filas en todos los proyectos): recibe el archivo o su id.
// Responde { stat, data: { removed_from_projects } }
export function delete_file(file) {
  return del("/api/files/" + enc(typeof file == "object" ? file.id : file))
}

// metadatos de un archivo propio: { original_name?, kind?, beats?, bpm?, music_key? } → { stat, data: archivo }
// (kind = "loop" | "shot"; en los loops manda beats y el backend deduce el bpm; music_key: ver helpers/music_key.js,
// "" o null = sin dato)
export function update_file(id, data) {
  return put("/api/files/" + enc(id), data)
}

export function get_user_info() {
  return get("/api/get_user_info")
}
// subida de UN archivo (multipart) con `kind` ("loop" | "shot"), `beats` y `bpm` opcionales (sin beats
// el backend los deduce del bpm o del tempo del proyecto; el bpm guardado siempre sale de los beats) y
// `project_id` opcional (proyecto propio al que se agrega el archivo, sin pista ni tags). `music_key`:
// tonalidad ("" = sin dato); si es undefined no se manda y el backend la sugiere por el nombre.
// Sin timeout: un archivo grande más la conversión pueden tardar más que el default de request.js.
// on_progress(porcentaje 0..100) informa el avance del envío (no de la conversión)
export function upload_file(file, { kind, bpm, beats, music_key, anchor, project_id } = {}, on_progress) {
  let data = new FormData()
  data.append("file", file, file.name)
  if (kind) data.append("kind", String(kind))
  if (bpm != null && bpm !== "") data.append("bpm", String(bpm))
  if (beats != null && beats !== "") data.append("beats", String(beats))
  if (music_key !== undefined) data.append("music_key", music_key ?? "")
  if (anchor) data.append("anchor", String(anchor))
  if (project_id) data.append("project_id", String(project_id))
  return request({
    url: '/api/upload',
    method: 'post',
    data,
    timeout: 0,
    onUploadProgress: e => {
      if (on_progress && e.total) on_progress(Math.round(100 * e.loaded / e.total))
    }
  })
}

// registro público: { email, password, name, bio?, accept_license: true } → la cuenta queda pendiente
export function register(data) {
  return post("/api/register", data)
}

// cambio de clave del propio usuario: { current_password, new_password }
export function change_password(data) {
  return put("/api/change_password", data)
}

// perfil público del propio usuario: { bio } (string o null)
export function save_profile(data) {
  return put("/api/profile", data)
}

// admin: lista de usuarios; status opcional "pending" | "active" | "blocked" (sin él: todos)
export function admin_get_users(status) {
  return get("/api/admin/users", status ? { status } : {})
}

// admin: una acción sobre un usuario: { action, password?, max_seconds? } → { stat, data: usuario }
export function admin_update_user(id, data) {
  return put("/api/admin/users/" + enc(id), data)
}

// admin: denuncias con los datos del target; status opcional "open" | "resolved" | "dismissed" (sin él: todas)
export function admin_get_reports(status) {
  return get("/api/admin/reports", status ? { status } : {})
}

// admin: cambia el estado de una denuncia ("open" | "resolved" | "dismissed") → { stat, data: denuncia }
export function admin_update_report(id, status) {
  return put("/api/admin/reports/" + enc(id), { status })
}

// admin: oculta (true) o desoculta (false) un archivo → { stat, data: { id, name, hidden, available } }
export function admin_set_file_hidden(id, hidden) {
  return put("/api/admin/files/" + enc(id) + "/hidden", { hidden })
}

// admin: oculta (true) o desoculta (false) un proyecto → { stat, data: { id, name, hidden } }
export function admin_set_project_hidden(id, hidden) {
  return put("/api/admin/projects/" + enc(id) + "/hidden", { hidden })
}

// admin: estadísticas (tráfico del mes, disco, usuarios por estado, archivos, proyectos, denuncias abiertas)
export function admin_get_stats() {
  return get("/api/admin/stats")
}

// proyectos del usuario: [{ id, name, hidden, ts }]
export function get_projects() {
  return get("/api/projects")
}

// crea un proyecto vacío: { name, props? } → { stat, data: proyecto }
export function create_project(data) {
  return post("/api/projects", data)
}

// proyecto completo: { id, name, hidden, ts, props, track_groups, tags, files }
export function get_project(id) {
  return get("/api/projects/" + enc(id))
}

// edita el proyecto: { name?, props? } (props reemplaza la config completa)
export function update_project(id, data) {
  return put("/api/projects/" + enc(id), data)
}

// borra el proyecto con sus pistas, tags y archivos asociados; también los archivos propios que no
// usa ningún otro proyecto. Responde { deleted_files: n }
export function delete_project(id) {
  return del("/api/projects/" + enc(id))
}

// reemplaza las pistas del proyecto: array completo [{ id, name, color, props }]
export function save_project_track_groups(id, data) {
  return put("/api/projects/" + enc(id) + "/track_groups", data)
}

// reemplaza los tags del proyecto: array completo [{ id, name, color }]
export function save_project_tags(id, data) {
  return put("/api/projects/" + enc(id) + "/tags", data)
}

// cambios en los archivos del proyecto, en una transacción: { add?, update?, remove? }
//  add: [file_id | { id, track_group?, tags?, props? }], update: [{ id, track_group?, tags?, props? }],
//  remove: [file_id]. Responde { stat, data: archivos del proyecto ya actualizados }
export function save_project_files(id, data) {
  return put("/api/projects/" + enc(id) + "/files", data)
}

// catálogo de archivos disponibles (paginado). params opcionales:
//  { bpm, bpm_tol, beats, key, atonal, creator, q, page, per_page } → { stat, data: { items, total, page, per_page } }
//  (key = tónica, trae mayor y menor; atonal = 1 suma los atonales)
export function get_catalog(params = {}) {
  return get("/api/catalog", params)
}

// galería pública (sin sesión): proyectos públicos paginados. params opcionales: { page, per_page }
//  → { stat, data: { items: [{ id, name, ts, tempo, files, creator: { name, bio } }], total, page, per_page } }
export function get_public_projects(params = {}) {
  return get("/api/public/projects", params)
}

// proyecto público (sin sesión): { id, name, ts, props, track_groups, tags, files, creator: { name, bio } }.
// 404 si es privado, está oculto, su dueño está bloqueado o no existe
export function get_public_project(id) {
  return get("/api/public/project/" + enc(id))
}

// denuncia (con sesión): { target_type: "file" | "project", target_id, reason } → { stat, text, data: { duplicate } }.
// 401 sin sesión, 404 si el archivo/proyecto no existe o no está a la vista, 429 por el límite diario
export function report(data) {
  return post("/api/report", data)
}

0// texto de error de un request rechazado (status no 2xx o sin respuesta), para mostrarlo al usuario
export function error_text(e) {
  return e?.response?.data?.text || (e?.response ? "Error del servidor" : "No hay conexión con el servidor")
}
