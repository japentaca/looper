// Worker del render offline con Signalsmith (fase 7 del editor): saca el cálculo del hilo principal (un archivo de
// 60 s estéreo tarda ~1 s). Lo crea stretch_queue.js (import con ?worker; en el build, un archivo iife con el paquete
// y su WASM adentro). Mensajes: { id, chans (transferidos), sr, semitones, rate } → { id, chans } o { id, error }.
import { load_stretch, stretch_chans } from "./stretch_core.js"

self.onmessage = async e => {
  let { id, chans, sr, semitones, rate } = e.data
  try {
    let m = await load_stretch()
    let out = stretch_chans(m, chans, sr, { semitones, rate })
    self.postMessage({ id, chans: out }, out.map(c => c.buffer))
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) })
  }
}
