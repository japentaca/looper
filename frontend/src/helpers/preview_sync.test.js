// Tests de los cálculos puros del preview en sync (preview_sync.js). Correr con: cd frontend && npm test
import { describe, it, expect } from "vitest"
import { next_grid_point, shot_period_beats, shot_sync_start, preview_pos } from "./preview_sync.js"

describe("next_grid_point", () => {
  it("sin lead: el primer punto (first ya es >= now)", () => {
    expect(next_grid_point(10, 10.5, 0.5)).toBe(10.5)
    expect(next_grid_point(10, 10, 0.5)).toBe(10)
  })
  it("con lead: el primer punto que deja lead segundos desde now", () => {
    // beats cada 0.5 desde 10.5; un shot de 1.2 s tiene que terminar en un beat B con B - 1.2 >= 10
    expect(next_grid_point(10, 10.5, 0.5, 1.2)).toBe(11.5)
    // justo en el límite cuenta (B - lead == now)
    expect(next_grid_point(10, 10.5, 0.5, 1)).toBe(11)
  })
  it("step inválido: no rompe", () => {
    expect(next_grid_point(10, 10.5, 0)).toBe(10.5)
    expect(next_grid_point(10, 10.5, 0, 2)).toBe(12)
  })
})

describe("shot_period_beats", () => {
  it("los beats necesarios para que el shot entre entero", () => {
    expect(shot_period_beats(0.3, 0.5)).toBe(1)
    expect(shot_period_beats(1.2, 0.5)).toBe(3)
    expect(shot_period_beats(1, 0.5)).toBe(2) // exacto: no suma un beat de más
  })
  it("sin datos: 1 beat", () => {
    expect(shot_period_beats(0, 0.5)).toBe(1)
    expect(shot_period_beats(1, 0)).toBe(1)
  })
})

describe("shot_sync_start", () => {
  const base = { now: 10, first: 10.25, spb: 0.5 }
  it("anchor start con el motor: arranca en el próximo beat, sin relleno", () => {
    let s = shot_sync_start({ ...base, dur: 1.2, anchor: "start", engine: true })
    expect(s.time).toBe(10.25)
    expect(s.offset).toBe(0)
    expect(s.pad).toBe(0)
    expect(s.period).toBe(1.5)
  })
  it("anchor end con el motor: termina en el primer beat posible", () => {
    // beats: 10.25, 10.75, 11.25, 11.75... primer B con B - 1.2 >= 10 → 11.25. period 1.5, pad 0.3
    let s = shot_sync_start({ ...base, dur: 1.2, anchor: "end", engine: true })
    expect(s.pad).toBeCloseTo(0.3)
    // el buffer con relleno "empezaría" en 11.25 - 1.5 = 9.75 (ya pasó): arranca ahora con offset 0.25
    expect(s.time).toBe(10)
    expect(s.offset).toBeCloseTo(0.25)
    // el shot suena desde time + (pad - offset) y termina en el beat
    expect(s.time + (s.pad - s.offset) + 1.2).toBeCloseTo(11.25)
  })
  it("anchor end con el motor y tiempo de sobra: el buffer arranca en un beat", () => {
    // dur 0.3: period 0.5, pad 0.2; primer B con B - 0.3 >= 10 → 10.75; inicio 10.25 (>= now)
    let s = shot_sync_start({ ...base, dur: 0.3, anchor: "end", engine: true })
    expect(s.time).toBe(10.25)
    expect(s.offset).toBe(0)
    expect(s.time + s.period).toBe(10.75)
  })
  it("motor parado: arranca ya con el shot sonando", () => {
    let st = shot_sync_start({ ...base, dur: 1.2, anchor: "start", engine: false })
    expect(st).toMatchObject({ time: 10, offset: 0, pad: 0 })
    let en = shot_sync_start({ ...base, dur: 1.2, anchor: "end", engine: false })
    expect(en.time).toBe(10)
    expect(en.offset).toBeCloseTo(0.3) // saltea el silencio de adelante
  })
})

describe("preview_pos", () => {
  it("libre: avanza a la velocidad del player, sin vuelta", () => {
    let c = { t0: 5, off: 0, rate: 1, wrap: 0, pad: 0 }
    expect(preview_pos(c, 4.9)).toBe(null) // todavía no arrancó (armado)
    expect(preview_pos(c, 6.5)).toBe(1.5)
  })
  it("loop con play_rate: da la vuelta en wrap", () => {
    let c = { t0: 0, off: 0, rate: 2, wrap: 4, pad: 0 }
    expect(preview_pos(c, 1)).toBe(2)
    expect(preview_pos(c, 2.5)).toBe(1)
  })
  it("reanclado al cambiar la velocidad: sigue visible antes del t0 nuevo (ya arrancó)", () => {
    // arrancó en 0 a rate 1; en 2.3 (Tone.now() del cambio) va por 2.3 y pasa a rate 2
    let c = { start: 0, t0: 2.3, off: 2.3, rate: 2, wrap: 10, pad: 0 }
    expect(preview_pos(c, 2)).toBeCloseTo(1.7) // antes del reanclado: aproximado con la velocidad nueva
    expect(preview_pos(c, 3.3)).toBeCloseTo(4.3)
  })
  it("shot con relleno adelante: null en el silencio, posición del archivo después", () => {
    let c = { t0: 10, off: 0.25, rate: 1, wrap: 1.5, pad: 0.3 }
    expect(preview_pos(c, 10)).toBe(null)
    expect(preview_pos(c, 10.25)).toBeCloseTo(0.2)
    expect(preview_pos(c, 11)).toBeCloseTo(0.95)
    // segunda vuelta: 1.75 % 1.5 = 0.25, otra vez en el silencio; y después el shot de nuevo
    expect(preview_pos(c, 11.5)).toBe(null)
    expect(preview_pos(c, 11.65)).toBeCloseTo(0.1)
  })
  it("con región: posición en el archivo desde base y null pasado su largo", () => {
    // loop en sync con un buffer de la región (base 1.5 s del archivo, 2 s de largo, 0.5 s de silencio al final)
    let c = { start: 0, t0: 0, off: 0, rate: 1, wrap: 2.5, pad: 0, base: 1.5, len: 2 }
    expect(preview_pos(c, 0.5)).toBeCloseTo(2)
    expect(preview_pos(c, 2.2)).toBe(null)
    expect(preview_pos(c, 2.75)).toBeCloseTo(1.75)
  })
})
