import { reactive } from 'vue'
import { get_user_data } from './helpers/api'
export const store = reactive({
  loginVisible: false,
  user_data: reactive({})
})

export const store_get_user_data = async () => {
  let res = await get_user_data()
  return res

}