import { reactive } from 'vue'
import { get_user_info, logout } from './helpers/api'
export const store = reactive({
  loginVisible: false,
  u_info: {},
  isLogged: false,
  track_groups: [],
  tagas: []
})

export const store_get_user_info = async () => {
  let res = await get_user_info()
  console.log("res get_user_info", res)
  if (res.stat) {
    store.isLogged = true
    store.u_info = reactive(res.u_info)
  }
  return res

}
export const doLogout = async () => {
  let res = await logout()
  store.isLogged = false

  return res

}