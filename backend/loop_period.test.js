// tests de loop_period.js (npm test = node --test). Señales sintéticas definidas en tiempo continuo y muestreadas:
// a 145 BPM el beat dura 18248,3 muestras, así que los bloques caen en posiciones fraccionarias como en un loop real
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { fft, analyze_loop, decide, block_level, cut_length, default_repeat, trim_repeat } from "./loop_period.js"

const SR = 44100
const BEAT = 60 / 145
const BASS = [55, 55, 82.4, 73.4] // una nota por beat: el patrón dura 4 beats

// patrón de 4 beats: bombo en cada beat, bajo en el contratiempo, hat en las corcheas de contratiempo y las semis
function pattern(t) {
  let b = Math.floor(t / BEAT) % 4
  let tb = t % BEAT
  let kick = Math.sin(2 * Math.PI * (50 * tb + 300 * (1 - Math.exp(-tb * 30)) / 30)) * Math.exp(-tb * 12)
  let tbass = tb - BEAT / 2
  let bass = tbass >= 0 ? 0.4 * Math.sin(2 * Math.PI * BASS[b] * tbass) * Math.exp(-tbass * 6) : 0
  let th = t % (BEAT / 4)
  let hat = 0.08 * (Math.sin(2 * Math.PI * 7100 * th) + Math.sin(2 * Math.PI * 9300 * th)) * Math.exp(-th * 80)
  return kick + bass + hat
}

// loop estéreo de `beats` beats con la función f(t, beat)
function render(beats, f) {
  let n = Math.round(beats * BEAT * SR)
  let x = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let t = i / SR
    x[i] = f(t, Math.floor(t / BEAT))
  }
  return [x, x.slice()]
}

describe("fft", () => {
  it("coincide con la DFT directa", () => {
    let n = 16
    let x = Array.from({ length: n }, (_, i) => Math.sin(i * 1.3) + 0.5 * Math.cos(i * 0.4))
    let re = Float64Array.from(x)
    let im = new Float64Array(n)
    fft(re, im)
    for (let k = 0; k < n; k++) {
      let dr = 0
      let di = 0
      for (let i = 0; i < n; i++) {
        dr += x[i] * Math.cos(-2 * Math.PI * k * i / n)
        di += x[i] * Math.sin(-2 * Math.PI * k * i / n)
      }
      assert.ok(Math.abs(re[k] - dr) < 1e-9 && Math.abs(im[k] - di) < 1e-9)
    }
  })
})

describe("analyze_loop + decide", () => {
  it("un patrón de 4 beats repetido 4 veces se corta a 4 (o a 8 con min_beats)", () => {
    let chs = render(16, t => pattern(t))
    let r = analyze_loop(chs, SR, 16)
    assert.deepEqual(r.candidates.map(c => c.P), [4, 8])
    let d = decide(r)
    assert.equal(d.decision, "cortar")
    assert.equal(d.P, 4)
    // idénticos en tiempo continuo, pero muestreados en otra fase (medio sample): -35..-50 en los hats
    for (let b of r.candidates[0].blocks) assert.ok(Math.max(...b.spec_beats) < -32, `bloque ${b.k}: ${b.spec_beats}`)
    let d8 = decide(analyze_loop(chs, SR, 16, { min_beats: 8, wave: false }))
    assert.equal(d8.decision, "cortar")
    assert.equal(d8.P, 8)
  })

  it("un fill en el último beat es variación, en el bloque y el beat correctos", () => {
    let chs = render(16, (t, beat) => beat == 15 ? 0.5 * Math.sin(2 * Math.PI * 330 * t) * Math.sin(Math.PI * (t / BEAT % 1)) : pattern(t))
    let d = decide(analyze_loop(chs, SR, 16, { wave: false }))
    assert.equal(d.decision, "variación")
    assert.equal(d.P, 4)
    assert.match(d.reason, /bloque 4 beat .*\b4 \(\d+ dB\)/) // el beat 3 puede aparecer por el derrame del cuadro
  })

  it("una ganancia que sube 1 dB por compás no se corta", () => {
    let chs = render(16, (t, beat) => pattern(t) * 10 ** (Math.floor(beat / 4) / 20))
    let d = decide(analyze_loop(chs, SR, 16, { wave: false }))
    assert.equal(d.decision, "no cortar")
    assert.equal(d.P, null)
  })

  it("un bajo que cambia en cada compás no se repite a 4 pero sí a 8", () => {
    let chs = render(16, (t, beat) => pattern(t) + (Math.floor(beat / 4) % 2 ? 0.3 * Math.sin(2 * Math.PI * 98 * (t % (8 * BEAT))) : 0))
    let d = decide(analyze_loop(chs, SR, 16, { wave: false }))
    assert.equal(d.decision, "cortar")
    assert.equal(d.P, 8)
  })
})

describe("decide con bloques armados", () => {
  let blk = (k, worst) => ({ k, spec: worst - 6, spec_beats: [worst - 10, worst, worst - 10, worst - 10] })
  it("niveles", () => {
    assert.equal(block_level(blk(1, -40)), "same")
    assert.equal(block_level(blk(1, -24)), "near")
    assert.equal(block_level(blk(1, -10)), "diff")
  })
  it("casi: todos iguales o casi", () => {
    let d = decide({ candidates: [{ P: 4, blocks: [blk(1, -40), blk(2, -23), blk(3, -40)] }] })
    assert.equal(d.decision, "casi")
    assert.equal(d.P, 4)
  })
  it("prefiere un P mayor con todos iguales a uno menor casi igual", () => {
    let d = decide({ candidates: [{ P: 4, blocks: [blk(1, -23)] }, { P: 8, blocks: [blk(1, -40)] }] })
    assert.equal(d.decision, "cortar")
    assert.equal(d.P, 8)
  })
})

describe("largo y repetición", () => {
  it("cut_length redondea P beats fraccionarios", () => {
    assert.equal(cut_length(583945, 32, 8), 145986)
    assert.equal(cut_length(583945, 32, 4), 72993)
  })
  it("default_repeat", () => {
    assert.deepEqual(default_repeat(4), [4, 16])
    assert.deepEqual(default_repeat(8), [4, 16])
    assert.deepEqual(default_repeat(16), [2, 8])
    assert.deepEqual(default_repeat(32), [1, 4])
    assert.deepEqual(default_repeat(64), [1, 2])
  })
  it("trim_repeat: la regla si era la de por defecto; si no, escalada con tope en 16", () => {
    assert.deepEqual(trim_repeat([1, 4], 32, 8), { repeat: [4, 16], how: "regla" })
    assert.deepEqual(trim_repeat([1, 2], 64, 16), { repeat: [2, 8], how: "regla" })
    assert.deepEqual(trim_repeat([2, 2], 32, 16), { repeat: [4, 4], how: "escalado" })
    assert.deepEqual(trim_repeat(undefined, 32, 8), { repeat: [4, 4], how: "escalado" })
    assert.deepEqual(trim_repeat([2, 8], 32, 8), { repeat: [8, 16], how: "escalado con tope" })
  })
})
