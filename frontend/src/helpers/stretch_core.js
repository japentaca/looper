// Render offline con Signalsmith Stretch (fase 7 del editor; docs/PLAN_EDITOR.md, decisión 5): cambio de tono sin
// cambiar la duración (transpose, KEY LOCK) y cambio de tempo sin cambiar el tono (STRETCH). Corre en el Worker
// (stretch.worker.js) y en los tests de Node (stretch_core.test.js): sin Tone, Vue, window ni AudioContext.
//
// Se usa el WASM del paquete directo (stretch_scope.js) con el procedimiento offline de la librería C++: seek() con
// las primeras inputLatency muestras (la entrada va adelantada), process() del resto con la razón exacta
// entrada/salida y flush() de outputLatency muestras al final. Así la salida sale corrida exactamente outputLatency
// muestras (medido: igual para cualquier rate): se descartan las primeras y el flush completa el final. Resultado: el
// mismo largo (round(n / rate)) y el beat 0 en su lugar.
import "./stretch_scope.js"
import "signalsmith-stretch"
import { create_wasm } from "./stretch_scope.js"

// muestras de entrada por llamada a process() (cualquier tamaño da lo mismo; más grande = menos llamadas)
const BLOCK = 8192
// límite de tono de la librería (Hz; el default del nodo de Web Audio)
const TONALITY_HZ = 8000

let wasm = null
// módulo de emscripten (una instancia por Worker)
export async function load_stretch() {
  wasm ??= await create_wasm()
  return wasm
}

// canales (Float32Array, mismo largo) procesados con el módulo m: { semitones (cambio de tono), rate (velocidad: > 1
// más rápido y corto; el tono no cambia) }. Devuelve canales nuevos de round(n / rate) muestras; no toca la entrada
export function stretch_chans(m, chans, sr, { semitones = 0, rate = 1 } = {}) {
  let ch = chans.length
  let n = ch ? chans[0].length : 0
  if (!(rate > 0) || !Number.isFinite(rate)) throw new Error("rate inválido: " + rate)
  let total = Math.max(0, Math.round(n / rate))
  let out = chans.map(() => new Float32Array(total))
  if (!ch || !n || !total) return out

  m._presetDefault(ch, sr)
  m._setTransposeSemitones(semitones, TONALITY_HZ / sr)
  m._setFormantSemitones(0, false)
  m._setFormantBase(0)
  let lin = m._inputLatency()
  let lout = m._outputLatency()
  let len = Math.max(BLOCK, Math.ceil(BLOCK / rate) + 2, lin, lout) + 8
  let ptr = m._setBuffers(ch, len)
  const heap = () => (m.exports ? m.exports.memory.buffer : m.HEAP8.buffer)
  // vistas sobre la memoria del WASM (se rehacen en cada uso por si la memoria creció)
  const in_buf = c => new Float32Array(heap(), ptr + len * 4 * c, len)
  const out_buf = c => new Float32Array(heap(), ptr + len * 4 * (c + ch), len)
  // copia k muestras de la entrada desde `from` (lo que pasa del final, ceros)
  const feed = (from, k) => {
    for (let c = 0; c < ch; c++) {
      let b = in_buf(c)
      let part = chans[c].subarray(Math.min(n, from), Math.min(n, from + k))
      b.set(part)
      b.fill(0, part.length, k)
    }
  }
  // k muestras de salida producidas a partir de `at` (contando desde el inicio, con la latencia): van a at − lout
  const take = (at, k) => {
    let skip = Math.max(0, lout - at)
    let end = Math.min(k, total + lout - at)
    if (skip >= end) return
    for (let c = 0; c < ch; c++) out[c].set(out_buf(c).subarray(skip, end), at + skip - lout)
  }

  feed(0, lin)
  m._seek(lin, rate)
  let in_done = 0
  let made = 0
  while (in_done < n) {
    let k_in = Math.min(BLOCK, n - in_done)
    // salida acumulada = round(entrada acumulada / rate): la razón total es exacta y el largo da `total`
    let k_out = Math.round((in_done + k_in) / rate) - made
    feed(lin + in_done, k_in)
    m._process(k_in, k_out)
    take(made, k_out)
    in_done += k_in
    made += k_out
  }
  m._flush(lout)
  take(made, lout)
  return out
}
