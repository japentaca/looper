// AudioWorkletGlobalScope simulado para usar el WASM de signalsmith-stretch sin AudioContext (fase 7 del editor). El
// paquete solo exporta un AudioWorkletNode de tiempo real; su módulo, si al evaluarse encuentra AudioWorkletProcessor
// y registerProcessor, registra su processor (que adentro instancia el WASM) en vez de crear el nodo. Con este scope
// falso se obtiene esa clase, se la construye una vez y se usa su `wasmModule` directo, con la API offline de la
// librería (seek / process / flush; ver stretch_core.js).
// Va importado ANTES que "signalsmith-stretch" (stretch_core.js): los globals tienen que existir cuando se evalúa el
// paquete. Solo se usa dentro del Worker (stretch.worker.js) y en los tests de Node: nunca en el hilo principal.

// nombre con que el paquete registra su processor (SignalsmithStretch.mjs)
const PROCESSOR_NAME = "signalsmith-stretch"

let Processor = null
let on_port_message = null

// el processor lee sampleRate en el constructor (después se configura con el de cada render)
if (typeof globalThis.sampleRate != "number") globalThis.sampleRate = 44100
globalThis.AudioWorkletProcessor = class {
  constructor() {
    // port mínimo: el processor manda ["ready", ...] cuando terminó de instanciar el WASM
    this.port = { onmessage: null, postMessage: msg => on_port_message?.(msg) }
  }
}
globalThis.registerProcessor = (name, cls) => {
  if (name === PROCESSOR_NAME) Processor = cls
}

// instancia el WASM (una vez por Worker): promesa del módulo de emscripten con _presetDefault, _seek, _process...
export function create_wasm() {
  return new Promise((resolve, reject) => {
    if (!Processor) return reject(new Error("signalsmith-stretch no registró su processor"))
    let p = null
    on_port_message = msg => {
      if (!Array.isArray(msg) || msg[0] !== "ready") return
      on_port_message = null
      resolve(p.wasmModule)
    }
    p = new Processor({ numberOfOutputs: 1, outputChannelCount: [2] })
  })
}
