// Tests del render offline con Signalsmith (stretch_core.js, fase 7 del editor) con el WASM real del paquete, en
// Node (scope de worklet simulado). Correr con: cd frontend && npm test
import { describe, it, expect, beforeAll } from "vitest"
import { load_stretch, stretch_chans } from "./stretch_core.js"

const SR = 44100
let m

beforeAll(async () => {
  m = await load_stretch()
})

function impulse(n, at) {
  let a = new Float32Array(n)
  a[at] = 1
  return a
}
function argmax(a) {
  let k = 0
  for (let i = 1; i < a.length; i++) if (Math.abs(a[i]) > Math.abs(a[k])) k = i
  return k
}
function sine(n, hz, amp = 0.5) {
  let a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * hz * i / SR)
  return a
}
// frecuencia por cruces ascendentes por cero
function freq(a) {
  let z = 0
  for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) z++
  return z * SR / a.length
}

describe("stretch_chans: transpose (mismo largo, sin corrimiento)", () => {
  it("la latencia se compensa: el impulso queda en su muestra, en los dos canales", () => {
    let n = SR * 2
    for (const semitones of [0, 3, -7, 0.5]) {
      let out = stretch_chans(m, [impulse(n, 30000), impulse(n, 60000)], SR, { semitones })
      expect(out[0].length).toBe(n)
      expect(out[1].length).toBe(n)
      expect(argmax(out[0])).toBe(30000)
      expect(argmax(out[1])).toBe(60000)
    }
  })
  it("cambia el tono", () => {
    let n = SR * 2
    for (const semitones of [2, -12, 0.5]) {
      let out = stretch_chans(m, [sine(n, 440)], SR, { semitones })
      let want = 440 * 2 ** (semitones / 12)
      expect(Math.abs(freq(out[0].subarray(20000, 70000)) / want - 1)).toBeLessThan(0.01)
    }
  })
  it("no toca la entrada", () => {
    let a = sine(8000, 300)
    let copy = a.slice()
    stretch_chans(m, [a], SR, { semitones: 4 })
    expect(a).toEqual(copy)
  })
  it("audio más corto que la latencia: devuelve el largo pedido", () => {
    let out = stretch_chans(m, [sine(500, 1000), sine(500, 1000)], SR, { semitones: 2 })
    expect(out.map(c => c.length)).toEqual([500, 500])
  })
  it("sin muestras: canales vacíos", () => {
    expect(stretch_chans(m, [new Float32Array(0)], SR, { semitones: 2 })[0].length).toBe(0)
  })
})

describe("stretch_chans: stretch (tempo sin cambiar el tono)", () => {
  it("largo round(n / rate) y la grilla escalada (beat 0 en su lugar, < 1 ms de error)", () => {
    let n = SR * 2
    for (const rate of [0.8, 1.25, 138 / 128]) {
      let out = stretch_chans(m, [impulse(n, 30000), impulse(n, 60000)], SR, { rate })
      expect(out[0].length).toBe(Math.round(n / rate))
      expect(Math.abs(argmax(out[0]) - 30000 / rate)).toBeLessThan(SR * 0.001)
      expect(Math.abs(argmax(out[1]) - 60000 / rate)).toBeLessThan(SR * 0.001)
    }
  })
  it("el tono no cambia", () => {
    let out = stretch_chans(m, [sine(SR * 2, 440)], SR, { rate: 0.8 })
    expect(Math.abs(freq(out[0].subarray(20000, 90000)) / 440 - 1)).toBeLessThan(0.01)
  })
  it("rate inválido", () => {
    expect(() => stretch_chans(m, [new Float32Array(10)], SR, { rate: 0 })).toThrow()
  })
})
