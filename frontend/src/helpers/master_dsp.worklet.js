import { MasterDsp, COMP_DEFAULT, LIMIT_CEILING_DB } from "./master_dsp.js"
// ⚠ El import tiene que ser la PRIMERA línea del archivo (antes de cualquier comentario): en dev,
// standardized-audio-context (lo usa Tone) descarga este fuente, separa los `import` del principio
// con una regex y envuelve el resto en una función; un import que quede después de un comentario
// termina adentro de la función y no compila. En build es un solo archivo iife sin imports
// (worker.format en vite.config.js).
//
// AudioWorkletProcessor "looper-master": la dinámica del master (ver docs/PLAN_MASTER.md y "Dinámica
// del master" en docs/ARCHITECTURE.md). Todo el DSP está en master_dsp.js (JS puro, testeado);
// acá solo se adapta a la API del worklet: entradas ausentes o mono, mensajes por port y medición.
// Lo carga mixer.js con Tone.getContext().addAudioWorkletModule.
//
// Mensajes que recibe (port): { t: "params", comp } → set_comp; { t: "dispose" } → se apaga.
// Mensajes que manda: { t: "gr", comp: [l, m, h], lim } (~30/s, GR máxima en dB desde el envío
// anterior; en silencio no hay tráfico) y { t: "error", text } (una vez, si process lanzó).

const METER_HZ = 30 // envíos de medición por segundo (aprox.)
const METER_QUIET_DB = 0.05 // GR por debajo de esto cuenta como 0
const RENDER_QUANTUM = 128 // tamaño de bloque del Web Audio actual (solo para la cadencia)
const CEIL = Math.pow(10, LIMIT_CEILING_DB / 20)

class MasterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.dsp = new MasterDsp(sampleRate, options?.processorOptions?.comp ?? COMP_DEFAULT)
    this.alive = true // false con { t: "dispose" }: el próximo process devuelve false
    this.failed = false // process lanzó: desde ahí la entrada pasa recortada (mixer.js vuelve al Tone.Limiter)
    this.meter_every = Math.ceil(sampleRate / RENDER_QUANTUM / METER_HZ) // 12 a 44.1 kHz, 13 a 48 kHz
    this.meter_count = 0
    this.meter_quiet = true // el último envío fue todo ~0 (al arrancar no hay nada que mandar)
    // buffers para entrada ausente / salida mono: se reservan acá (y se rehacen solo si cambia el tamaño)
    this.zeros = new Float32Array(RENDER_QUANTUM)
    this.scratch = new Float32Array(RENDER_QUANTUM)
    this.port.onmessage = (e) => this.on_message(e.data)
  }

  on_message(m) {
    if (!m || typeof m !== "object") return
    if (m.t === "params") this.dsp.set_comp(m.comp)
    else if (m.t === "dispose") this.alive = false
  }

  process(inputs, outputs) {
    if (!this.alive) return false
    const out = outputs[0]
    if (!out || out.length === 0) return true
    const outL = out[0]
    const n = outL.length
    if (this.zeros.length !== n) {
      this.zeros = new Float32Array(n)
      this.scratch = new Float32Array(n)
    }
    const outR = out.length > 1 ? out[1] : this.scratch
    // sin nada conectado (o con la entrada inactiva) inputs[0] llega vacío: se procesa silencio, así
    // la demora del limitador se vacía y al volver la señal no queda un resto viejo. Mono → L = R.
    const inp = inputs[0]
    let inL = this.zeros
    let inR = this.zeros
    if (inp && inp.length > 0) {
      inL = inp[0]
      inR = inp.length > 1 ? inp[1] : inp[0]
    }
    if (!this.failed) {
      try {
        this.dsp.process(inL, inR, outL, outR, n)
      } catch (e) {
        this.failed = true
        this.port.postMessage({ t: "error", text: String(e?.message ?? e) })
      }
    }
    if (this.failed) {
      // respaldo dentro del worklet: la entrada recortada al techo (sin limitador), mientras mixer.js
      // hace el fundido al Tone.Limiter
      for (let i = 0; i < n; i++) {
        const l = inL[i], r = inR[i]
        outL[i] = l > CEIL ? CEIL : l < -CEIL ? -CEIL : l === l ? l : 0
        outR[i] = r > CEIL ? CEIL : r < -CEIL ? -CEIL : r === r ? r : 0
      }
    }
    this.meter()
    return true
  }

  // medición cada meter_every bloques (~30/s). Si todo es ~0 y el envío anterior también lo era, no
  // se manda nada (siempre sale un último 0 después de la actividad)
  meter() {
    if (++this.meter_count < this.meter_every) return
    this.meter_count = 0
    const m = this.dsp.take_meters()
    const quiet = m.lim < METER_QUIET_DB && m.comp[0] < METER_QUIET_DB &&
      m.comp[1] < METER_QUIET_DB && m.comp[2] < METER_QUIET_DB
    if (quiet && this.meter_quiet) return
    this.meter_quiet = quiet
    this.port.postMessage({ t: "gr", comp: m.comp, lim: m.lim })
  }
}

registerProcessor("looper-master", MasterProcessor)
