// Tests de las lecturas de loudness y MATCH del editor (loudness.js). Correr con: cd frontend && npm test
import { describe, it, expect } from "vitest"
import { LOUDNESS_SILENCE, has_loudness, level_with_volume, match_volume, fmt_level } from "./loudness.js"

const LIMITS = { max_db: 12, off_db: -60 }
let n = 0
function file(track_group, loudness, volume, peak = null) {
  return { id: "f" + n++, track_group, loudness, peak, props: { volume } }
}

describe("has_loudness / level_with_volume", () => {
  it("sin medir, silencioso o callado → null", () => {
    expect(has_loudness(file("a", null, 0))).toBe(false)
    expect(has_loudness(file("a", LOUDNESS_SILENCE, 0))).toBe(false)
    expect(level_with_volume(file("a", null, 0), null, -60)).toBe(null)
    let f = file("a", -18, -60)
    expect(level_with_volume(f, f.loudness, -60)).toBe(null)
  })
  it("suma el volumen y redondea a décimas", () => {
    let f = file("a", -18.3, -6, -1.2)
    expect(level_with_volume(f, f.loudness, -60)).toBe(-24.3)
    expect(level_with_volume(f, f.peak, -60)).toBe(-7.2)
    f.props.volume = 7.5
    expect(level_with_volume(f, f.peak, -60)).toBe(6.3)
  })
  it("fmt_level", () => {
    expect(fmt_level(-18)).toBe("-18.0")
    expect(fmt_level(null)).toBe("---")
    expect(fmt_level(-0.04)).toBe("-0.0")
  })
})

describe("match_volume", () => {
  it("lleva al promedio de loudness + volume de los otros de la pista", () => {
    let me = file("a", -24, 0)
    let files = [me, file("a", -18, -6), file("a", -20, -2), file("b", -10, 0)]
    // otros de "a": -24 y -22 → objetivo -23 → volumen = -23 - (-24) = +1
    let r = match_volume(me, files, LIMITS)
    expect(r).toMatchObject({ ok: true, volume: 1, target: -23, count: 2, clipped: null })
  })
  it("ignora sin medir, silenciosos y callados por su volumen", () => {
    let me = file("a", -18, -6)
    let files = [me, file("a", -20, 0), file("a", null, 0), file("a", LOUDNESS_SILENCE, 0), file("a", -5, -60)]
    expect(match_volume(me, files, LIMITS)).toMatchObject({ ok: true, volume: -2, count: 1 })
  })
  it("no cuenta su propio volumen actual (MATCH es idempotente)", () => {
    let me = file("a", -30, -20)
    let files = [me, file("a", -18, -6)]
    let r = match_volume(me, files, LIMITS)
    expect(r.volume).toBe(6)
    me.props.volume = r.volume
    expect(match_volume(me, files, LIMITS).volume).toBe(6)
  })
  it("recorta al tope y al piso del fader y lo informa", () => {
    let low = file("a", -50, 0)
    let r = match_volume(low, [low, file("a", -18, 0)], LIMITS)
    expect(r).toMatchObject({ ok: true, volume: 12, wanted: 32, clipped: "max" })
    let loud = file("b", -5, 0)
    r = match_volume(loud, [loud, file("b", -69, 0)], LIMITS)
    expect(r).toMatchObject({ ok: true, volume: -59.9, wanted: -64, clipped: "min" })
  })
  it("sin pista, sin medición propia o sin otros medidos → no disponible", () => {
    let alone = file(null, -18, 0)
    expect(match_volume(alone, [alone, file(null, -10, 0)], LIMITS)).toEqual({ ok: false, reason: "no_track" })
    let unmeasured = file("a", null, 0)
    expect(match_volume(unmeasured, [unmeasured, file("a", -18, 0)], LIMITS)).toEqual({ ok: false, reason: "not_measured" })
    let me = file("a", -18, 0)
    expect(match_volume(me, [me, file("a", null, 0), file("b", -18, 0)], LIMITS)).toEqual({ ok: false, reason: "no_others" })
  })
})
