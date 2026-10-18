// Cola de renders offline con Signalsmith (fase 7 del editor): un solo Worker (stretch.worker.js), un trabajo a la
// vez, así cargar un proyecto con muchos archivos transpuestos no dispara todo junto. Los pedidos urgentes (editor,
// preview) pasan adelante de los de la carga. Cada pedido puede traer wanted(): se mira al salir de la cola y, si ya
// no hace falta (otro transpose, archivo que salió del proyecto, otra edición), se descarta sin calcular (null).
// Lo usan pitch.js (transpose y KEY LOCK) y edit_session.js (STRETCH).
import * as Tone from "tone"
import StretchWorker from "./stretch.worker.js?worker"

let worker = null
let worker_failed = false
let current = null // trabajo en el Worker: { id, resolve, reject }
let next_id = 1
const queue = []

function get_worker() {
  if (worker || worker_failed) return worker
  try {
    worker = new StretchWorker()
  } catch (e) {
    console.log("Stretch: no se pudo crear el Worker", e)
    worker_failed = true
    return null
  }
  worker.onmessage = e => {
    let job = current
    current = null
    if (job && e.data.id === job.id) {
      if (e.data.error) job.reject(new Error(e.data.error))
      else job.resolve(e.data.chans)
    }
    pump()
  }
  worker.onerror = e => {
    console.log("Stretch: error en el Worker", e)
    let job = current
    current = null
    job?.reject(new Error("Stretch worker error"))
    pump()
  }
  return worker
}

function pump() {
  while (!current && queue.length) {
    let job = queue.shift()
    if (!job.wanted()) {
      job.resolve(null)
      continue
    }
    let w = get_worker()
    if (!w) {
      job.reject(new Error("Stretch worker not available"))
      continue
    }
    current = job
    // copias: el Worker se queda con ellas (transferidas); el original no se toca
    let chans = job.chans.map(c => c.slice())
    w.postMessage({ id: job.id, chans, sr: job.sr, semitones: job.semitones, rate: job.rate }, chans.map(c => c.buffer))
    job.chans = null
  }
}

// canales procesados (ver stretch_chans en stretch_core.js): promesa de canales nuevos, o null si al salir de la cola
// wanted() dio false. opts = { semitones, rate }; ctl = { wanted, urgent }
export function render_chans(chans, sr, { semitones = 0, rate = 1 } = {}, { wanted = () => true, urgent = false } = {}) {
  return new Promise((resolve, reject) => {
    let job = { id: next_id++, chans, sr, semitones, rate, wanted, resolve, reject }
    if (urgent) queue.unshift(job)
    else queue.push(job)
    pump()
  })
}

// lo mismo para un AudioBuffer: promesa de un AudioBuffer nuevo (o null)
export async function render_buffer(buf, opts, ctl) {
  let chans = []
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c))
  let out = await render_chans(chans, buf.sampleRate, opts, ctl)
  if (!out) return null
  let res = Tone.getContext().createBuffer(out.length, Math.max(1, out[0].length), buf.sampleRate)
  out.forEach((d, c) => res.getChannelData(c).set(d))
  return res
}
