// Tests de la región de un archivo (region.js). Correr con: cd frontend && npm test
import { describe, it, expect } from "vitest"
import {
  parse_pair, normalize_region_props, region_props_out, loop_region, shot_region, region_beats, play_window,
  window_length, beat_to_sec, sec_to_beat, snap_beat, move_marker, arrow_beat, region_to_save, zero_cross,
  zero_cross_dir, first_hit, nudge_for_hit, bake_region, mono_window, seam_window, file_bpm
} from "./region.js"

describe("props", () => {
  it("parse_pair: [start, stop] creciente dentro de [0, max]", () => {
    expect(parse_pair([1, 3.5], 8)).toEqual([1, 3.5])
    expect(parse_pair([3, 3], 8)).toBe(null)
    expect(parse_pair([-1, 3], 8)).toBe(null)
    expect(parse_pair([1, 9], 8)).toBe(null)
    expect(parse_pair([1, "3"], 8)).toBe(null)
    expect(parse_pair(null, 8)).toBe(null)
  })
  it("normalize_region_props: defaults y descarta lo inválido", () => {
    let p = normalize_region_props({ nudge: 300, fade: 12, region_beats: [2, 1], region_secs: [0.1, 0.5] })
    expect(p).toEqual({ nudge: 0, fade: 12, region_secs: [0.1, 0.5] })
  })
  it("region_props_out: solo lo que tiene valor", () => {
    expect(region_props_out({ nudge: 0, fade: 0 })).toEqual({})
    expect(region_props_out({ nudge: 20, fade: 5, region_beats: [0, 4], region_secs: [0, 0.2] }))
      .toEqual({ nudge: 20, fade: 5, region_beats: [0, 4], region_secs: [0, 0.2] })
  })
})

describe("regiones", () => {
  it("loop_region recorta a los beats del archivo", () => {
    expect(loop_region({ region_beats: [2, 12] }, 8)).toEqual({ start: 2, stop: 8 })
    expect(loop_region({ region_beats: [9, 12] }, 8)).toBe(null)
    expect(loop_region({}, 8)).toBe(null)
  })
  it("shot_region recorta a la duración", () => {
    expect(shot_region({ region_secs: [0.1, 5] }, 2)).toEqual({ start: 0.1, stop: 2 })
    expect(shot_region({ region_secs: [0.1, 0.4] }, 0)).toEqual({ start: 0.1, stop: 0.4 })
  })
  it("region_beats: redondeo, mínimo 1", () => {
    expect(region_beats(1, 7)).toBe(6)
    expect(region_beats(0, 7.3)).toBe(7)
    expect(region_beats(0, 0.25)).toBe(1)
  })
  it("file_bpm: guardado o deducido", () => {
    expect(file_bpm({ bpm: 128, beats: 8, duration: 4 })).toBe(128)
    expect(file_bpm({ beats: 8, duration: 4 })).toBe(120)
  })
})

describe("play_window", () => {
  const loop = (props) => ({ kind: "loop", beats: 8, bpm: 120, duration: 4.05, props })
  it("sin props: el archivo entero, como siempre", () => {
    expect(play_window(loop({}))).toEqual({ offset: 0, duration: null, fade: 0, period: 4 })
    expect(play_window({ kind: "shot", duration: 1, props: {} })).toEqual({ offset: 0, duration: null, fade: 0, period: null })
  })
  it("loop: offset = nudge + start × beat, duration = (stop − start) × beat", () => {
    let w = play_window(loop({ region_beats: [2, 6], nudge: 30, fade: 5 }))
    expect(w.offset).toBeCloseTo(0.03 + 1)
    expect(w.duration).toBeCloseTo(2)
    expect(w.period).toBeCloseTo(2)
    expect(w.fade).toBeCloseTo(0.005)
  })
  it("loop con región no entera: más corta deja hueco, más larga se corta en la tirada", () => {
    let short = play_window(loop({ region_beats: [0, 6.7] }))
    expect(short.duration).toBeCloseTo(3.35)
    expect(short.period).toBeCloseTo(3.5)
    let long = play_window(loop({ region_beats: [0, 7.3] }))
    expect(long.duration).toBeCloseTo(3.5)
    expect(long.period).toBeCloseTo(3.5)
  })
  it("solo nudge: corre el inicio, sigue hasta el final", () => {
    let w = play_window(loop({ nudge: 40 }))
    expect(w.offset).toBeCloseTo(0.04)
    expect(w.duration).toBe(null)
  })
  it("shot: la región en segundos; el nudge no cuenta", () => {
    let w = play_window({ kind: "shot", duration: 2, props: { region_secs: [0.2, 0.9], nudge: 50 } })
    expect(w.offset).toBeCloseTo(0.2)
    expect(w.duration).toBeCloseTo(0.7)
  })
  it("cambio de kind: la región del otro tipo se ignora", () => {
    let props = { region_beats: [2, 4] }
    expect(play_window({ kind: "shot", duration: 2, props }).duration).toBe(null)
    expect(play_window(loop({ region_secs: [0.2, 0.9] })).duration).toBe(null)
  })
  it("window_length", () => {
    expect(window_length({ offset: 0.5, duration: null }, 2)).toBe(1.5)
    expect(window_length({ offset: 0.5, duration: 0.3 }, 2)).toBe(0.3)
  })
})

describe("edición", () => {
  it("beats ↔ segundos con nudge", () => {
    expect(beat_to_sec(2, 0.5, 0.03)).toBeCloseTo(1.03)
    expect(sec_to_beat(1.03, 0.5, 0.03)).toBeCloseTo(2)
  })
  it("snap_beat", () => {
    expect(snap_beat(2.4, true)).toBe(2)
    expect(snap_beat(2.41234, false)).toBe(2.4123)
  })
  it("move_marker no cruza el otro marcador ni sale de [0, max]", () => {
    let r = { start: 2, stop: 6 }
    expect(move_marker(r, "start", 7, 8, 1)).toEqual({ start: 5, stop: 6 })
    expect(move_marker(r, "start", -1, 8, 1)).toEqual({ start: 0, stop: 6 })
    expect(move_marker(r, "stop", 1, 8, 1)).toEqual({ start: 2, stop: 3 })
    expect(move_marker(r, "stop", 12, 8, 1)).toEqual({ start: 2, stop: 8 })
  })
  it("arrow_beat: un beat entero con SNAP, 1 ms sin SNAP", () => {
    expect(arrow_beat(2, 1, true, 0.5)).toBe(3)
    expect(arrow_beat(2.4, 1, true, 0.5)).toBe(3)
    expect(arrow_beat(2.4, -1, true, 0.5)).toBe(2)
    expect(arrow_beat(2, -1, true, 0.5)).toBe(1)
    expect(arrow_beat(2, 1, false, 0.5)).toBeCloseTo(2.002)
  })
  it("region_to_save: el archivo entero no se guarda", () => {
    expect(region_to_save({ start: 0, stop: 8 }, 8)).toBe(null)
    expect(region_to_save({ start: 1, stop: 8 }, 8)).toEqual([1, 8])
  })
})

describe("cruce por cero", () => {
  let data = Float32Array.from([0.5, 0.4, 0.2, -0.1, -0.3, -0.2, 0.1, 0.3])
  it("el más cercano dentro del radio", () => {
    expect(zero_cross(data, 1, 4)).toBe(3)
    expect(zero_cross(data, 5, 4)).toBe(6)
    expect(zero_cross(data, 0, 1)).toBe(0) // sin cruce cerca
  })
  it("en una dirección", () => {
    expect(zero_cross_dir(data, 4, 1, 8)).toBe(6)
    expect(zero_cross_dir(data, 5, -1, 8)).toBe(3)
  })
})

describe("AUTO (primer golpe)", () => {
  it("primera muestra que llega al umbral relativo al pico, en cualquier canal", () => {
    let l = new Float32Array(1000)
    let r = new Float32Array(1000)
    l[0] = 0.001 // ruido del encoder: no cuenta
    l[300] = 0.8
    r[200] = -0.5
    expect(first_hit([l, r], 1000)).toBeCloseTo(0.2)
  })
  it("silencio: null; nudge en ms con tope", () => {
    expect(first_hit([new Float32Array(10)], 1000)).toBe(null)
    expect(nudge_for_hit(null)).toBe(0)
    expect(nudge_for_hit(0.0234)).toBe(23)
    expect(nudge_for_hit(0.4)).toBe(250)
  })
})

describe("buffers del preview y lupas", () => {
  let ch = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  it("bake_region copia la región y rellena con silencio", () => {
    let [out] = bake_region([ch], 1, { from: 2, len: 3, total: 5 })
    expect(Array.from(out)).toEqual([3, 4, 5, 0, 0])
    let [pad] = bake_region([ch], 1, { from: 0, len: 2, at: 3, total: 5 })
    expect(Array.from(pad)).toEqual([0, 0, 0, 1, 2])
  })
  it("bake_region: pasado el final del archivo queda en silencio", () => {
    let [out] = bake_region([ch], 1, { from: 8, len: 4 })
    expect(Array.from(out)).toEqual([9, 10, 0, 0])
  })
  it("bake_region aplica el fade lineal a los dos lados", () => {
    let ones = new Float32Array(10).fill(1)
    let [out] = bake_region([ones], 1, { from: 0, len: 10, fade: 2 })
    expect(Array.from(out)).toEqual([0, 0.5, 1, 1, 1, 1, 1, 1, 0.5, 0])
  })
  it("mono_window promedia canales", () => {
    let out = mono_window([Float32Array.from([1, 1, 1]), Float32Array.from([0, 1, 3])], 1, 1, 3)
    expect(Array.from(out)).toEqual([1, 2, 0])
  })
  it("seam_window pega el final de la región a su inicio", () => {
    let out = seam_window([ch], 1, { from: 2, len: 5, half: 2 })
    expect(Array.from(out)).toEqual([6, 7, 3, 4])
  })
})
