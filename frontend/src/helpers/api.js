import request from './request'

export function login(data) {
  return request({
    url: '/api/login',
    method: 'post',
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