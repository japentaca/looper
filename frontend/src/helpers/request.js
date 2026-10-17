import axios from 'axios'


// create an axios instance
const service = axios.create({
  baseURL: import.meta.env.VITE_APP_BACKEND, // url = base url + request url
  withCredentials: true, // send cookies when cross-domain requests
  timeout: 15000 // request timeout
})

// aviso de sesión perdida: lo registra composable.js (así request.js no importa el store y no hay
// import circular). Se llama con el status de la respuesta.
let session_lost_handler = null
export function on_session_lost(fn) {
  session_lost_handler = fn
}
// 401, o 403 con el texto "Sin sesión" (el backend también responde 403 a "Archivo inexistente",
// que no es un problema de sesión)
function is_session_error(response) {
  if (!response) return false // sin respuesta (red caída, timeout): no se sabe si la sesión sigue
  return response.status == 401 || (response.status == 403 && response.data?.text == "Sin sesión")
}

// response interceptor
service.interceptors.response.use(
  /**
   * If you want to get http information such as headers or status
   * Please return  response => response
  */

  /**
   * Determine the request status by custom code
   * Here is just an example
   * You can also judge the status by HTTP Status Code
   */
  response => {
    //loadingInstance.close()

    const res = response.data
    //console.log("resdata", res)

    // if the custom code is not 20000, it is judged as an error.



    return res

  },
  error => {
    //loadingInstance.close()
    console.log('err', error) // for debug
    if (is_session_error(error.response) && session_lost_handler) session_lost_handler(error.response.status)

    return Promise.reject(error)
  }
)

export default service
