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

export function get_user_data(data) {
  return request({
    url: '/api/get_user_data',
    method: 'get',

  })
}

export function get_user_info(data) {
  return request({
    url: '/api/get_user_info',
    method: 'get',

  })
}