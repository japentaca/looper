import axios from 'axios'


// create an axios instance
const service = axios.create({
  baseURL: import.meta.env.VITE_APP_BACKEND, // url = base url + request url
  withCredentials: true, // send cookies when cross-domain requests
  timeout: 15000 // request timeout
})

// request interceptor
service.interceptors.request.use(

  config => {
    //loadingInstance = Loading.service({ fullscreen: false, text: "cargando..." });




    // do something before request is sent


    return config
  },
  error => {

    // do something with request error
    console.log("request err", error) // for debug
    return Promise.reject(error)
  }
)

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

    return Promise.reject(error)
  }
)

export default service
