import * as Tone from 'tone'
import { store, audio_players, files_by_id } from "../helpers/composable"
import { file_url } from "./api"
import { vol_db, FILE_VOL_MAX_DB } from "./mixer"



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
  mainPlayer.volume.value = vol_db(file.props.volume, FILE_VOL_MAX_DB)
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

// --- preview desde la UI (Files, catálogo, admin). Leen store.curr_file, así que son reactivas
// usadas en un template ---
// el archivo con ese id es el que suena en el preview
export function previewing(id) {
  return store.curr_file.isPreviewing == true && store.curr_file.id == id
}
// el archivo con ese id se está descargando para el preview
export function preview_loading(id) {
  return store.curr_file.isPreviewLoading == true && store.curr_file.id == id
}
// play o stop de un archivo ({ id, original_name }): si está cargado en el proyecto se usa su
// buffer; si no, se descarga solo ese archivo. Si falla la carga, tira el error
export async function toggle_preview(file) {
  if (previewing(file.id) || preview_loading(file.id)) return playerStop()
  let loaded = files_by_id[file.id]
  if (loaded?.isLoaded && audio_players[file.id]) await playFile(loaded)
  else await playUrl(file, file_url(file.id))
}
// corta el preview si es de un archivo que no está cargado en el proyecto (al cerrar un diálogo)
export function stop_foreign_preview() {
  let cf = store.curr_file
  if (cf.isPreviewLoading || (cf.isPreviewing && !files_by_id[cf.id])) playerStop()
}
