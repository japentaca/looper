import * as Tone from 'tone'
import { store, audio_players } from "../helpers/composable"



export const mainPlayer = new Tone.Player({ onstop: onstop }).toDestination()

// cada start() crea una fuente que termina una sola vez (por stop o al llegar al final):
// si terminaron tantas como se iniciaron, no queda nada sonando
let started = 0
let ended = 0
// número del último pedido de preview (ver playUrl)
let url_request = 0

function onstop() {
  ended++
  if (ended >= started) {
    store.curr_file.isPreviewing = false
  }
}

export async function playerStop() {
  // un preview por url que todavía se está descargando ya no debe arrancar
  url_request++
  if (store.curr_file.isPreviewLoading) store.curr_file.isPreviewLoading = false
  await mainPlayer.stop()

}

export async function playFile(file) {
  url_request++
  mainPlayer.stop()
  if (store.curr_file !== file) store.curr_file.isPreviewing = false
  store.curr_file = file
  mainPlayer.buffer.set(audio_players[file.id].buffer)
  mainPlayer.volume.value = file.props.volume
  mainPlayer.start()
  started++
  store.curr_file.isPreviewing = true
}

// preview de un archivo que no está cargado en el proyecto (diálogo de importar): se descarga y
// decodifica solo ese archivo. Únicamente se guarda el buffer del último (el anterior queda para el
// recolector), así escuchar el catálogo no acumula memoria. Si mientras se descarga se pide otro
// preview o STOP, este ya no arranca. Mientras carga: file.isPreviewLoading = true
const PREVIEW_VOLUME = -6 // dB, el volumen por defecto de un archivo en un proyecto
export async function playUrl(file, url) {
  let req = ++url_request
  mainPlayer.stop()
  if (store.curr_file !== file) {
    store.curr_file.isPreviewing = false
    store.curr_file.isPreviewLoading = false
  }
  store.curr_file = file
  store.curr_file.isPreviewLoading = true
  let buffer
  try {
    buffer = await new Tone.ToneAudioBuffer().load(url)
  } catch (e) {
    console.log("Error cargando el preview", url, e)
    if (req === url_request) store.curr_file.isPreviewLoading = false
    throw e
  }
  if (req !== url_request) return // se pidió otro preview o STOP mientras cargaba
  store.curr_file.isPreviewLoading = false
  mainPlayer.buffer.set(buffer)
  mainPlayer.volume.value = PREVIEW_VOLUME
  mainPlayer.start()
  started++
  store.curr_file.isPreviewing = true
}
