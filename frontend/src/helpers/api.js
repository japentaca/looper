import request from './request'

export function login(data) {
  return request({
    url: '/api/login',
    method: 'post',
    data
  })
}

export function save_trackGroups(data) {
  return request({
    url: '/api/save_trackGroups',
    method: 'put',
    data
  })
}
// config global del usuario (tempo, compás, delay): objeto, se guarda en users.props
export function save_user_props(data) {
  return request({
    url: '/api/save_user_props',
    method: 'put',
    data
  })
}
export function save_fileData(data) {
  return request({
    url: '/api/save_fileData',
    method: 'put',
    data
  })
}
export function save_tags(data) {
  return request({
    url: '/api/save_tags',
    method: 'put',
    data
  })
}


export function logout() {
  return request({
    url: '/api/logout',
    method: 'put',

  })
}
export function delete_file(data) {
  return request({
    url: '/api/delete_file',
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
// subida de UN archivo (multipart) con `bpm` y `beats` opcionales (null/vacío = sin dato).
// Sin timeout: un archivo grande más la conversión pueden tardar más que el default de request.js.
// on_progress(porcentaje 0..100) informa el avance del envío (no de la conversión)
export function upload_file(file, { bpm, beats } = {}, on_progress) {
  let data = new FormData()
  data.append("file", file, file.name)
  if (bpm != null && bpm !== "") data.append("bpm", String(bpm))
  if (beats != null && beats !== "") data.append("beats", String(beats))
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

// texto de error de un request rechazado (status no 2xx o sin respuesta), para mostrarlo al usuario
export function error_text(e) {
  return e?.response?.data?.text || (e?.response ? "Error del servidor" : "No hay conexión con el servidor")
}
