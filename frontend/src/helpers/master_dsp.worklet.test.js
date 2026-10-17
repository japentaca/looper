// Humo del AudioWorkletProcessor del master (docs/PLAN_MASTER.md, "Tests") con el
// AudioWorkletGlobalScope simulado en globalThis. Correr con: cd frontend && npm test
import { describe, it, expect, beforeAll } from "vitest"
import { MasterDsp, COMP_DEFAULT, LIMIT_CEILING_DB } from "./master_dsp.js"

const FS = 48000
const BLOCK = 128
const CEIL = Math.pow(10, LIMIT_CEILING_DB / 20)
const METER_EVERY = Math.ceil(FS / BLOCK / 30) // 13 a 48 kHz

let registered = {}
let Processor

beforeAll(async () => {
  globalThis.sampleRate = FS
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = {
        sent: [],
        onmessage: null,
        postMessage(m) {
          this.sent.push(m)
        },
      }
    }
  }
  globalThis.registerProcessor = (name, cls) => {
    registered[name] = cls
  }
  // import dinámico: los globals tienen que existir antes de evaluar el módulo
  await import("./master_dsp.worklet.js")
  Processor = registered["looper-master"]
})

function make(comp) {
  return new Processor(comp === undefined ? {} : { processorOptions: { comp } })
}

function out_bufs() {
  return [[new Float32Array(BLOCK), new Float32Array(BLOCK)]]
}

function sine_block(k, f, amp, phase = 0) {
  const a = new Float32Array(BLOCK)
  for (let i = 0; i < BLOCK; i++) a[i] = amp * Math.sin(2 * Math.PI * f * (k * BLOCK + i) / FS + phase)
  return a
}

function send(proc, data) {
  proc.port.onmessage({ data })
}

const gr_msgs = proc => proc.port.sent.filter(m => m.t === "gr")

describe("master_dsp.worklet", () => {
  it("registra looper-master", () => {
    expect(typeof Processor).toBe("function")
  })

  it("sin processorOptions arranca con COMP_DEFAULT", () => {
    const p = new Processor()
    expect(p.dsp.comp).toEqual({ ...COMP_DEFAULT })
    expect(make({ on: true, amount: 1 }).dsp.comp.on).toBe(true)
  })

  it("entrada ausente o vacía: devuelve true y sale silencio", () => {
    const p = make()
    for (const inputs of [[], [[]]]) {
      const out = out_bufs()
      out[0][0].fill(1)
      out[0][1].fill(1)
      expect(p.process(inputs, out, {})).toBe(true)
      expect(out[0][0].every(v => v === 0)).toBe(true)
      expect(out[0][1].every(v => v === 0)).toBe(true)
    }
  })

  it("mono: el canal se usa para L y R, igual que MasterDsp", () => {
    const p = make()
    const ref = new MasterDsp(FS, COMP_DEFAULT)
    const rl = new Float32Array(BLOCK), rr = new Float32Array(BLOCK)
    for (let k = 0; k < 20; k++) {
      const x = sine_block(k, 440, 0.5)
      const out = out_bufs()
      expect(p.process([[x]], out, {})).toBe(true)
      ref.process(x, x, rl, rr, BLOCK)
      for (let i = 0; i < BLOCK; i++) {
        expect(out[0][0][i]).toBe(out[0][1][i])
        expect(out[0][0][i]).toBe(rl[i])
      }
    }
  })

  it("estéreo: canales independientes, techo respetado", () => {
    const p = make()
    let diff = 0, peak = 0
    for (let k = 0; k < 40; k++) {
      const out = out_bufs()
      expect(p.process([[sine_block(k, 300, 2), sine_block(k, 300, 0.3, 1)]], out, {})).toBe(true)
      for (let i = 0; i < BLOCK; i++) {
        diff = Math.max(diff, Math.abs(out[0][0][i] - out[0][1][i]))
        peak = Math.max(peak, Math.abs(out[0][0][i]), Math.abs(out[0][1][i]))
      }
    }
    expect(diff).toBeGreaterThan(0.1)
    expect(peak).toBeLessThanOrEqual(CEIL * (1 + 1e-6))
    expect(peak).toBeGreaterThan(CEIL * 0.9)
  })

  it("medición: un { t: 'gr' } cada METER_EVERY bloques con GR; en silencio, un último 0 y nada más", () => {
    const p = make()
    // silencio desde el arranque: no hay tráfico
    for (let k = 0; k < METER_EVERY * 5; k++) p.process([[]], out_bufs(), {})
    expect(gr_msgs(p).length).toBe(0)
    // señal fuerte (el limitador trabaja): un mensaje por cada METER_EVERY bloques
    const loud = 10
    for (let k = 0; k < METER_EVERY * loud; k++) p.process([[sine_block(k, 200, 3)]], out_bufs(), {})
    const msgs = gr_msgs(p)
    expect(msgs.length).toBe(loud)
    expect(msgs.every(m => m.lim > 6 && Array.isArray(m.comp) && m.comp.length === 3)).toBe(true)
    // silencio largo: el release baja la GR, sale un último envío ~0 y después ninguno
    for (let k = 0; k < METER_EVERY * 60; k++) p.process([[]], out_bufs(), {})
    const all = gr_msgs(p)
    const last = all[all.length - 1]
    expect(last.lim).toBeLessThan(0.05)
    const n = all.length
    for (let k = 0; k < METER_EVERY * 10; k++) p.process([[]], out_bufs(), {})
    expect(gr_msgs(p).length).toBe(n)
  })

  it("{ t: 'params' } cambia el compresor; el GR por banda aparece en la medición", () => {
    const p = make()
    send(p, { t: "params", comp: { on: true, amount: 1, low: 0, mid: 0, high: 0 } })
    expect(p.dsp.comp.on).toBe(true)
    expect(p.dsp.comp.amount).toBe(1)
    for (let k = 0; k < METER_EVERY * 20; k++) p.process([[sine_block(k, 1000, 0.5)]], out_bufs(), {})
    const last = gr_msgs(p).at(-1)
    expect(last.comp[1]).toBeGreaterThan(1)
    // mensajes ajenos o mal formados no rompen
    send(p, null)
    send(p, { t: "otro" })
    expect(p.dsp.comp.on).toBe(true)
  })

  it("si el DSP lanza: avisa una vez, la entrada sale recortada al techo y sigue vivo", () => {
    const p = make()
    p.dsp.process = () => {
      throw new Error("roto")
    }
    for (let k = 0; k < 3; k++) {
      const x = sine_block(k, 100, 2)
      const out = out_bufs()
      expect(p.process([[x]], out, {})).toBe(true)
      for (let i = 0; i < BLOCK; i++) {
        expect(Math.abs(out[0][0][i])).toBeLessThanOrEqual(CEIL)
        expect(out[0][1][i]).toBe(out[0][0][i])
      }
    }
    const errs = p.port.sent.filter(m => m.t === "error")
    expect(errs.length).toBe(1)
    expect(errs[0].text).toBe("roto")
  })

  it("{ t: 'dispose' }: process devuelve false", () => {
    const p = make()
    send(p, { t: "dispose" })
    expect(p.process([[]], out_bufs(), {})).toBe(false)
  })
})
