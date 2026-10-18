// Worker de los detectores del editor (fase 8): saca el análisis del hilo principal (60 s de audio tardan ~1 s).
// Lo crea detect_job.js (import con ?worker; en el build, un archivo iife con detect.js adentro).
// Mensajes: { id, type ("key" | "note"), x (Float32Array mono, transferido), sr } → { id, result } o { id, error }.
import { detect_key, detect_note } from "./detect.js"

self.onmessage = e => {
  let { id, type, x, sr } = e.data
  try {
    let result = type == "key" ? detect_key(x, sr) : detect_note(x, sr)
    self.postMessage({ id, result })
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) })
  }
}
