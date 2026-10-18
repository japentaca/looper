// Tests de transpose.js (fase 7 del editor). Correr con: cd frontend && npm test
import { describe, it, expect } from "vitest"
import {
  parse_transpose, parse_key_lock, normalize_pitch_props, pitch_props_out, rate_semitones, round_semis,
  effective_transpose, transpose_key, fmt_semis, fmt_transpose, key_display, stretch_rate, stretch_length, stretch_bpm_range,
  TRANSPOSE_MIN, TRANSPOSE_MAX
} from "./transpose.js"

describe("parse_transpose / key_lock", () => {
  it("acepta números en rango, con hasta 2 decimales", () => {
    expect(parse_transpose(2)).toBe(2)
    expect(parse_transpose(-1.3)).toBe(-1.3)
    expect(parse_transpose(0.30000000000000004)).toBe(0.3)
    expect(parse_transpose(1.26)).toBe(1.26)
    expect(parse_transpose(1.264)).toBe(1.26)
    expect(parse_transpose(TRANSPOSE_MIN)).toBe(TRANSPOSE_MIN)
    expect(parse_transpose(TRANSPOSE_MAX)).toBe(TRANSPOSE_MAX)
  })
  it("fmt_transpose: un decimal en la grilla del knob, dos si no (TUNE TO)", () => {
    expect(fmt_transpose(0)).toBe("0.0")
    expect(fmt_transpose(2)).toBe("+2.0")
    expect(fmt_transpose(-1.3)).toBe("-1.3")
    expect(fmt_transpose(0.37)).toBe("+0.37")
    expect(fmt_transpose(-11.98)).toBe("-11.98")
    expect(fmt_transpose(undefined)).toBe("0.0")
  })
  it("cualquier otra cosa es 0", () => {
    for (const v of [undefined, null, "2", NaN, Infinity, 12.5, -13, [], {}]) expect(parse_transpose(v)).toBe(0)
  })
  it("key_lock solo con true", () => {
    expect(parse_key_lock(true)).toBe(true)
    for (const v of [undefined, 1, "true", false]) expect(parse_key_lock(v)).toBe(false)
  })
  it("normalize y out", () => {
    let p = normalize_pitch_props({ transpose: "x", key_lock: 1 })
    expect(p).toEqual({ transpose: 0, key_lock: false })
    expect(pitch_props_out(p)).toEqual({})
    expect(pitch_props_out({ transpose: -2.5, key_lock: true })).toEqual({ transpose: -2.5, key_lock: true })
  })
})

describe("effective_transpose (KEY LOCK)", () => {
  it("sin KEY LOCK es el transpose", () => {
    expect(effective_transpose({ kind: "loop", play_rate: 1.1, props: { transpose: 2 } })).toBe(2)
    expect(effective_transpose({ kind: "loop", play_rate: 1, props: {} })).toBe(0)
  })
  it("con KEY LOCK compensa el resample: 128 → 138 BPM baja ~1,3 semitonos", () => {
    let rate = 138 / 128
    expect(rate_semitones(rate)).toBeCloseTo(1.3025, 3)
    expect(effective_transpose({ kind: "loop", play_rate: rate, props: { key_lock: true } })).toBe(-1.3)
    expect(effective_transpose({ kind: "loop", play_rate: rate, props: { transpose: 2, key_lock: true } })).toBe(0.7)
  })
  it("los shots y el preview libre no compensan", () => {
    expect(effective_transpose({ kind: "shot", play_rate: 1.2, props: { transpose: 1, key_lock: true } })).toBe(1)
    expect(effective_transpose({ kind: "loop", play_rate: 1.2, props: { transpose: 1, key_lock: true } }, { free: true })).toBe(1)
  })
  it("redondea a 0,01 y lo casi nulo es 0", () => {
    expect(round_semis(0.004)).toBe(0)
    expect(round_semis(-0.004)).toBe(0)
    expect(round_semis(1.23456)).toBe(1.23)
    expect(effective_transpose({ kind: "loop", play_rate: 1.0001, props: { key_lock: true } })).toBe(0)
  })
})

describe("tonalidad efectiva", () => {
  it("transpone con la grafía de KEY_TONICS", () => {
    expect(transpose_key("C#m", 2)).toBe("Ebm")
    expect(transpose_key("Bb", 3)).toBe("C#")
    expect(transpose_key("A", -12)).toBe("A")
    expect(transpose_key("C", -1)).toBe("B")
    expect(transpose_key("Db", 1)).toBe("D")
    expect(transpose_key("F#m", 1.4)).toBe("Gm")
    expect(transpose_key("F#m", 1.6)).toBe("G#m")
  })
  it("sin dato o atonal, tal cual", () => {
    expect(transpose_key(null, 2)).toBe(null)
    expect(transpose_key("atonal", 2)).toBe("atonal")
  })
  it("fmt_semis", () => {
    expect(fmt_semis(2)).toBe("+2")
    expect(fmt_semis(-1.5)).toBe("−1.5")
  })
  it("key_display: sin transponer muestra la del catálogo", () => {
    let d = key_display("Am", 0)
    expect(d).toMatchObject({ text: "Am", mark: null, transposed: false })
    expect(key_display(null, undefined).text).toBe("–")
  })
  it("key_display: transpuesta, con marca y el valor exacto en el title", () => {
    let d = key_display("C#m", 2.3)
    expect(d.text).toBe("Ebm")
    expect(d.mark).toBe("+2")
    expect(d.transposed).toBe(true)
    expect(d.title).toContain("+2.3")
    expect(d.title).toContain("rounded")
    let e = key_display("C", 0.3)
    expect(e.text).toBe("C")
    expect(e.mark).toBe("+0.3")
    expect(key_display("atonal", -2).text).toBe("atonal")
    expect(key_display("G", 1, 1.3).title).toContain("KEY LOCK off")
  })
})

describe("stretch", () => {
  it("rate y largo", () => {
    expect(stretch_rate(128, 138)).toBeCloseTo(1.078125, 9)
    expect(stretch_rate(0, 138)).toBe(0)
    expect(stretch_length(44100, 0.5)).toBe(88200)
    expect(stretch_length(44100, 138 / 128)).toBe(Math.round(44100 * 128 / 138))
  })
  it("rango de BPM destino", () => {
    expect(stretch_bpm_range(128)).toEqual({ min: 64, max: 256 })
    expect(stretch_bpm_range(30)).toEqual({ min: 20, max: 60 })
    expect(stretch_bpm_range(300)).toEqual({ min: 150, max: 400 })
    expect(stretch_bpm_range(0)).toBe(null)
  })
})
