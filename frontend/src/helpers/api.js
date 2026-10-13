import request from './request'

export function login(data) {
  return request({
    url: '/api/login',
    method: 'post',
    data
  })
}


export function logout() {
  return request({
    url: '/api/logout',
    method: 'put',

  })
}
// borra un archivo propio (audio + sus filas en todos los proyectos): recibe el archivo o su id.
// Responde { stat, data: { removed_from_projects } }
export function delete_file(file) {
  let id = typeof file == 'object' ? file.id : file
  return request({
    url: '/api/files/' + encodeURIComponent(id),
    method: 'delete'
  })
}

// metadatos de un archivo propio: { original_name?, bpm?, beats? } → { stat, data: archivo }
export function update_file(id, data) {
  return request({
    url: '/api/files/' + encodeURIComponent(id),
    method: 'put',
    data
  })
}

export function get_user_info(data) {
  return request({
    url: '/api/get_user_info',
    method: 'get',

  })
}
// subida de UN archivo (multipart) con `bpm` y `beats` opcionales (null/vacío = sin dato) y
// `project_id` opcional (proyecto propio al que se agrega el archivo, sin pista ni tags).
// Sin timeout: un archivo grande más la conversión pueden tardar más que el default de request.js.
// on_progress(porcentaje 0..100) informa el avance del envío (no de la conversión)
export function upload_file(file, { bpm, beats, project_id } = {}, on_progress) {
  let data = new FormData()
  data.append("file", file, file.name)
  if (bpm != null && bpm !== "") data.append("bpm", String(bpm))
  if (beats != null && beats !== "") data.append("beats", String(beats))
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
  return request({
    url: '/api/register',
    method: 'post',
    data
  })
}

// cambio de clave del propio usuario: { current_password, new_password }
export function change_password(data) {
  return request({
    url: '/api/change_password',
    method: 'put',
    data
  })
}

// perfil público del propio usuario: { bio } (string o null)
export function save_profile(data) {
  return request({
    url: '/api/profile',
    method: 'put',
    data
  })
}

// admin: lista de usuarios; status opcional "pending" | "active" | "blocked" (sin él: todos)
export function admin_get_users(status) {
  return request({
    url: '/api/admin/users',
    method: 'get',
    params: status ? { status } : {}
  })
}

// admin: una acción sobre un usuario: { action, password?, max_seconds? } → { stat, data: usuario }
export function admin_update_user(id, data) {
  return request({
    url: '/api/admin/users/' + encodeURIComponent(id),
    method: 'put',
    data
  })
}

// admin: denuncias con los datos del target; status opcional "open" | "resolved" | "dismissed" (sin él: todas)
export function admin_get_reports(status) {
  return request({
    url: '/api/admin/reports',
    method: 'get',
    params: status ? { status } : {}
  })
}

// admin: cambia el estado de una denuncia ("open" | "resolved" | "dismissed") → { stat, data: denuncia }
export function admin_update_report(id, status) {
  return request({
    url: '/api/admin/reports/' + encodeURIComponent(id),
    method: 'put',
    data: { status }
  })
}

// admin: oculta (true) o desoculta (false) un archivo → { stat, data: { id, name, hidden, available } }
export function admin_set_file_hidden(id, hidden) {
  return request({
    url: '/api/admin/files/' + encodeURIComponent(id) + '/hidden',
    method: 'put',
    data: { hidden }
  })
}

// admin: oculta (true) o desoculta (false) un proyecto → { stat, data: { id, name, visibility, hidden } }
export function admin_set_project_hidden(id, hidden) {
  return request({
    url: '/api/admin/projects/' + encodeURIComponent(id) + '/hidden',
    method: 'put',
    data: { hidden }
  })
}

// admin: estadísticas (tráfico del mes, disco, usuarios por estado, archivos, proyectos, denuncias abiertas)
export function admin_get_stats() {
  return request({
    url: '/api/admin/stats',
    method: 'get'
  })
}

// proyectos del usuario: [{ id, name, visibility, hidden, ts }]
export function get_projects() {
  return request({
    url: '/api/projects',
    method: 'get'
  })
}

// crea un proyecto vacío: { name, visibility?, props? } → { stat, data: proyecto }
export function create_project(data) {
  return request({
    url: '/api/projects',
    method: 'post',
    data
  })
}

// proyecto completo: { id, name, visibility, hidden, ts, props, track_groups, tags, files }
export function get_project(id) {
  return request({
    url: '/api/projects/' + encodeURIComponent(id),
    method: 'get'
  })
}

// edita el proyecto: { name?, visibility?, props? } (props reemplaza la config completa)
export function update_project(id, data) {
  return request({
    url: '/api/projects/' + encodeURIComponent(id),
    method: 'put',
    data
  })
}

// borra el proyecto con sus pistas, tags y archivos asociados (los archivos del catálogo quedan)
export function delete_project(id) {
  return request({
    url: '/api/projects/' + encodeURIComponent(id),
    method: 'delete'
  })
}

// reemplaza las pistas del proyecto: array completo [{ id, name, color, props }]
export function save_project_track_groups(id, data) {
  return request({
    url: '/api/projects/' + encodeURIComponent(id) + '/track_groups',
    method: 'put',
    data
  })
}

// reemplaza los tags del proyecto: array completo [{ id, name, color }]
export function save_project_tags(id, data) {
  return request({
    url: '/api/projects/' + encodeURIComponent(id) + '/tags',
    method: 'put',
    data
  })
}

// cambios en los archivos del proyecto, en una transacción: { add?, update?, remove? }
//  add: [file_id | { id, track_group?, tags?, props? }], update: [{ id, track_group?, tags?, props? }],
//  remove: [file_id]. Responde { stat, data: archivos del proyecto ya actualizados }
export function save_project_files(id, data) {
  return request({
    url: '/api/projects/' + encodeURIComponent(id) + '/files',
    method: 'put',
    data
  })
}

// catálogo de archivos disponibles (paginado). params opcionales:
//  { bpm, bpm_tol, beats, creator, q, page, per_page } → { stat, data: { items, total, page, per_page } }
export function get_catalog(params = {}) {
  return request({
    url: '/api/catalog',
    method: 'get',
    params
  })
}

// galería pública (sin sesión): proyectos públicos paginados. params opcionales: { page, per_page }
//  → { stat, data: { items: [{ id, name, ts, tempo, files, creator: { name, bio } }], total, page, per_page } }
export function get_public_projects(params = {}) {
  return request({
    url: '/api/public/projects',
    method: 'get',
    params
  })
}

// proyecto público (sin sesión): { id, name, ts, props, track_groups, tags, files, creator: { name, bio } }.
// 404 si es privado, está oculto, su dueño está bloqueado o no existe
export function get_public_project(id) {
  return request({
    url: '/api/public/project/' + encodeURIComponent(id),
    method: 'get'
  })
}

// denuncia (con sesión): { target_type: "file" | "project", target_id, reason } → { stat, text, data: { duplicate } }.
// 401 sin sesión, 404 si el archivo/proyecto no existe o no está a la vista, 429 por el límite diario
export function report(data) {
  return request({
    url: '/api/report',
    method: 'post',
    data
  })
}

// texto de error de un request rechazado (status no 2xx o sin respuesta), para mostrarlo al usuario
export function error_text(e) {
  return e?.response?.data?.text || (e?.response ? "Error del servidor" : "No hay conexión con el servidor")
}
