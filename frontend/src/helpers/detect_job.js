// Análisis de los detectores del editor (fase 8): arma la señal de un archivo del proyecto y la manda al Worker
// (detect.worker.js), fuera del hilo principal. Se analiza el buffer original (source_buffer: no el transpuesto que
// toca el motor, ni el de trabajo de las ediciones destructivas) y, si el proyecto tiene región, solo la región (la
// misma ventana que toca el motor: play_window de region.js). Loops → tonalidad (detect_key); shots → nota
// (detect_note). Un Worker para todos los pedidos (son pocos y a mano: no hace falta cola).
import DetectWorker from "./detect.worker.js?worker"
import { source_buffer } from "./composable"
import { play_window, window_length } from "./region"
import { mono_mix } from "./detect"

let worker = null
let next_id = 1
const pending = new Map() // id → { resolve, reject }

function fail_all(msg) {
  for (const p of pending.values()) p.reject(new Error(msg))
  pending.clear()
}

function get_worker() {
  if (worker) return worker
  worker = new DetectWorker()
  worker.onmessage = e => {
    let p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.error) p.reject(new Error(e.data.error))
    else p.resolve(e.data.result)
  }
  worker.onerror = e => {
    console.log("Detect: error en el Worker", e)
    // se descarta: el próximo pedido crea otro
    worker.terminate()
    worker = null
    fail_all("Detector worker error")
  }
  return worker
}

// qué se analiza de un archivo: tipo de análisis y ventana (s) del buffer original. Si cambia (otro archivo, otro
// tipo, otra región), un resultado anterior ya no vale
export function detect_window(file) {
  let w = play_window(file)
  let type = file.kind == "shot" ? "note" : "key"
  return { type, offset: w.offset, duration: w.duration, sig: [file.id, type, w.offset, w.duration].join("|") }
}

// analiza el archivo: promesa de { type ("key" | "note"), sig, result (de detect_key o detect_note) }
export async function detect_file(file) {
  let buf = source_buffer(file.id)
  if (!buf) throw new Error("The audio is not loaded")
  let { type, offset, duration, sig } = detect_window(file)
  let sr = buf.sampleRate
  let from = Math.round(offset * sr)
  let len = Math.round(window_length({ offset, duration }, buf.duration) * sr)
  let chans = []
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c))
  // la mezcla mono es una copia: se transfiere al Worker sin tocar el original
  let x = mono_mix(chans, from, len)
  if (!x.length) throw new Error("Nothing to analyze in the region")
  let w = get_worker()
  let id = next_id++
  let result = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, type, x, sr }, [x.buffer])
  })
  return { type, sig, result }
}
