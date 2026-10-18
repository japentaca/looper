// Tests de las funciones puras de la pantalla de onda (wave.js). Correr con: cd frontend && npm test
import { describe, it, expect } from "vitest"
import { compute_peaks, grid_lines, rate_label } from "./wave.js"

describe("compute_peaks", () => {
  it("da min y max de cada tramo", () => {
    let data = Float32Array.from([0, 0.5, -0.25, 1, -1, 0.1, 0.2, 0.3])
    let p = compute_peaks(data, 2)
    expect(Array.from(p)).toEqual([-0.25, 1, -1, 0.30000001192092896])
  })
  it("con más columnas que muestras no deja columnas vacías", () => {
    let p = compute_peaks(Float32Array.from([0.5, -0.5]), 4)
    expect(Array.from(p)).toEqual([0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5])
  })
  it("sin muestras o sin columnas no rompe", () => {
    expect(compute_peaks(new Float32Array(0), 3).length).toBe(6)
    expect(compute_peaks(Float32Array.from([1]), 0).length).toBe(0)
  })
})

describe("grid_lines", () => {
  it("loop: una línea por beat con los bordes, compás cada beats_x_bar", () => {
    let l = grid_lines({ kind: "loop", duration: 4, beats: 8, beats_x_bar: "4" })
    expect(l.length).toBe(9)
    expect(l.map(x => x.t)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4])
    expect(l.filter(x => x.bar).map(x => x.t)).toEqual([0, 2, 4])
  })
  it("loop con nudge y largo de beat: corrida, sin las que pasan del final", () => {
    let l = grid_lines({ kind: "loop", duration: 4, beats: 8, beats_x_bar: "4", nudge: 0.1, spb: 0.5 })
    expect(l.map(x => Math.round(x.t * 100) / 100)).toEqual([0.1, 0.6, 1.1, 1.6, 2.1, 2.6, 3.1, 3.6])
    expect(l[0].bar && l[4].bar).toBe(true)
  })
  it("loop sin beats válidos: sin grilla", () => {
    expect(grid_lines({ kind: "loop", duration: 4, beats: 0, beats_x_bar: "4" })).toEqual([])
    expect(grid_lines({ kind: "loop", duration: 0, beats: 4, beats_x_bar: "4" })).toEqual([])
  })
  it("shot con anchor al inicio: al tempo desde el inicio", () => {
    let l = grid_lines({ kind: "shot", duration: 1.1, beats_x_bar: "3", tempo: 120, anchor_t: 0 })
    expect(l.map(x => x.t)).toEqual([0, 0.5, 1])
    expect(l[0].anchor).toBe(true)
    expect(l.filter(x => x.anchor).length).toBe(1)
  })
  it("shot con anchor al final: al tempo hacia atrás desde el final", () => {
    let l = grid_lines({ kind: "shot", duration: 1.2, beats_x_bar: "4", tempo: 120, anchor_t: 1.2 })
    expect(l.map(x => Math.round(x.t * 100) / 100)).toEqual([0.2, 0.7, 1.2])
    expect(l[2].anchor && l[2].bar).toBe(true)
  })
  it("shot con anchor intermedio: hacia los dos lados, compases contados desde el anchor", () => {
    let l = grid_lines({ kind: "shot", duration: 3, beats_x_bar: "2", tempo: 120, anchor_t: 1.2 })
    expect(l.map(x => Math.round(x.t * 100) / 100)).toEqual([0.2, 0.7, 1.2, 1.7, 2.2, 2.7])
    expect(l.findIndex(x => x.anchor)).toBe(2)
    expect(l.map(x => x.bar)).toEqual([true, false, true, false, true, false])
  })
})

describe("rate_label", () => {
  it("solo cuando el motor lo toca a otro largo", () => {
    expect(rate_label(8, 8)).toBe("")
    expect(rate_label(8, 16)).toBe("in this project: 16 beats (×2)")
    expect(rate_label(8, 4)).toBe("in this project: 4 beats (×½)")
  })
})
