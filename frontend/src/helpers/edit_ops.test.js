// Tests de las ediciones destructivas (edit_ops.js). Correr con: cd frontend && npm test
import { describe, it, expect } from "vitest"
import {
  apply_op, apply_ops, op_length, map_pos, map_through, clamp_range, peak, db_to_gain, gain_to_db, project_span,
  work_file_of, copy_plan, selection_plan, copy_props, copy_name, strip_ext, encode_wav, tempo_factor
} from "./edit_ops.js"
import { play_window, shot_anchor, bake_region } from "./region.js"

const ch = (...v) => Float32Array.from(v)
const arr = c => Array.from(c)

describe("operaciones", () => {
  const L = ch(0, 1, 2, 3, 4, 5)
  const R = ch(0, -1, -2, -3, -4, -5)
  it("cut quita [a, b) y acorta", () => {
    let out = apply_op([L, R], { type: "cut", a: 1, b: 3 })
    expect(arr(out[0])).toEqual([0, 3, 4, 5])
    expect(arr(out[1])).toEqual([0, -3, -4, -5])
    expect(op_length(6, { type: "cut", a: 1, b: 3 })).toBe(4)
  })
  it("silence pone [a, b) a cero y mantiene el largo", () => {
    expect(arr(apply_op([L], { type: "silence", a: 2, b: 4 })[0])).toEqual([0, 1, 0, 0, 4, 5])
  })
  it("silence con rampa: baja de a poco en los bordes", () => {
    let c = new Float32Array(10).fill(1)
    let out = apply_op([c], { type: "silence", a: 0, b: 10, ramp: 2 })[0]
    expect(out[0]).toBeCloseTo(2 / 3)
    expect(out[1]).toBeCloseTo(1 / 3)
    expect(out[2]).toBe(0)
    expect(out[7]).toBe(0)
    expect(out[8]).toBeCloseTo(1 / 3)
    expect(out[9]).toBeCloseTo(2 / 3)
  })
  it("duplicate repite [a, b) a continuación", () => {
    let out = apply_op([L], { type: "duplicate", a: 1, b: 3 })[0]
    expect(arr(out)).toEqual([0, 1, 2, 1, 2, 3, 4, 5])
    expect(op_length(6, { type: "duplicate", a: 1, b: 3 })).toBe(8)
  })
  it("reverse invierte el rango o todo", () => {
    expect(arr(apply_op([L], { type: "reverse", a: 1, b: 4 })[0])).toEqual([0, 3, 2, 1, 4, 5])
    expect(arr(apply_op([L], { type: "reverse", a: 0, b: 6 })[0])).toEqual([5, 4, 3, 2, 1, 0])
  })
  it("gain multiplica el rango (dB)", () => {
    let out = apply_op([L], { type: "gain", a: 4, b: 6, db: 6 })[0]
    expect(arr(out.subarray(0, 4))).toEqual([0, 1, 2, 3])
    expect(out[4]).toBeCloseTo(4 * db_to_gain(6))
    expect(db_to_gain(-6)).toBeCloseTo(0.501, 3)
    expect(gain_to_db(2)).toBeCloseTo(6.02, 2)
  })
  it("no modifica la entrada y encadena", () => {
    let src = ch(1, 2, 3, 4)
    let out = apply_ops([src], [{ type: "reverse", a: 0, b: 4 }, { type: "cut", a: 0, b: 1 }])
    expect(arr(src)).toEqual([1, 2, 3, 4])
    expect(arr(out[0])).toEqual([3, 2, 1])
  })
  it("clamp_range ordena, redondea y recorta", () => {
    expect(clamp_range(5.4, 1.6, 10)).toEqual({ a: 2, b: 5 })
    expect(clamp_range(-3, 20, 10)).toEqual({ a: 0, b: 10 })
    expect(clamp_range(3, 3.2, 10)).toBe(null)
  })
  it("peak: máximo absoluto de todos los canales", () => {
    expect(peak([ch(0.2, -0.5), ch(1.5, 0)])).toBe(1.5)
  })
})

describe("crossfade de las uniones (cut, duplicate, reverse)", () => {
  // seno lento (período de 200 muestras): el salto natural entre muestras es ~0,03; las uniones elegidas caen en
  // un pico de un lado y en un valle del otro (salto de 2 sin crossfade)
  const sine = n => Float32Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * i / 200))
  const max_step = c => {
    let m = 0
    for (let i = 1; i < c.length; i++) m = Math.max(m, Math.abs(c[i] - c[i - 1]))
    return m
  }
  const X = 20
  it("cut: sin salto en la unión, mismo largo, igual fuera del crossfade", () => {
    let c = sine(1000)
    let op = { type: "cut", a: 50, b: 150 }
    let raw = apply_op([c], op)[0]
    let out = apply_op([c], { ...op, xfade: X })[0]
    expect(max_step(raw)).toBeGreaterThan(1.5)
    expect(max_step(out)).toBeLessThan(0.25)
    expect(out.length).toBe(raw.length)
    expect(arr(out.subarray(0, 50))).toEqual(arr(raw.subarray(0, 50)))
    expect(arr(out.subarray(50 + X))).toEqual(arr(raw.subarray(50 + X)))
  })
  it("cut desde el inicio o hasta el final: no hay unión, no cambia", () => {
    let c = sine(1000)
    for (const op of [{ type: "cut", a: 0, b: 150 }, { type: "cut", a: 50, b: 1000 }]) {
      expect(arr(apply_op([c], { ...op, xfade: X })[0])).toEqual(arr(apply_op([c], op)[0]))
    }
  })
  it("duplicate: la repetición entra sin salto; al final del archivo se funde antes de la unión", () => {
    let c = sine(1000)
    let op = { type: "duplicate", a: 150, b: 250 }
    let raw = apply_op([c], op)[0]
    let out = apply_op([c], { ...op, xfade: X })[0]
    expect(max_step(raw)).toBeGreaterThan(1.5)
    expect(max_step(out)).toBeLessThan(0.25)
    expect(out.length).toBe(raw.length)
    expect(arr(out.subarray(0, 250))).toEqual(arr(raw.subarray(0, 250)))
    expect(arr(out.subarray(250 + X))).toEqual(arr(raw.subarray(250 + X)))
    let end = sine(250)
    let raw_end = apply_op([end], op)[0]
    let out_end = apply_op([end], { ...op, xfade: X })[0]
    expect(max_step(raw_end)).toBeGreaterThan(1.5)
    expect(max_step(out_end)).toBeLessThan(0.25)
    expect(arr(out_end.subarray(250))).toEqual(arr(raw_end.subarray(250)))
  })
  it("reverse: sin salto en las dos uniones", () => {
    let c = sine(1000)
    let op = { type: "reverse", a: 50, b: 350 }
    let raw = apply_op([c], op)[0]
    let out = apply_op([c], { ...op, xfade: X })[0]
    expect(max_step(raw)).toBeGreaterThan(1.5)
    expect(max_step(out)).toBeLessThan(0.25)
    expect(arr(out.subarray(50 + X, 350 - X))).toEqual(arr(raw.subarray(50 + X, 350 - X)))
    expect(arr(out.subarray(350))).toEqual(arr(raw.subarray(350)))
    // rango más corto que dos crossfades: se achican a la mitad del rango
    let short = apply_op([c], { type: "reverse", a: 50, b: 60, xfade: X })[0]
    expect(short.length).toBe(1000)
  })
})

describe("posiciones a través de las operaciones", () => {
  it("cut: adentro queda en el borde, después se corre", () => {
    let op = { type: "cut", a: 10, b: 20 }
    expect(map_pos(5, op)).toBe(5)
    expect(map_pos(15, op)).toBe(10)
    expect(map_pos(20, op)).toBe(10)
    expect(map_pos(30, op)).toBe(20)
  })
  it("duplicate: desde el fin del rango se corre (incluido)", () => {
    let op = { type: "duplicate", a: 10, b: 20 }
    expect(map_pos(15, op)).toBe(15)
    expect(map_pos(20, op)).toBe(30)
    expect(map_pos(25, op)).toBe(35)
  })
  it("silence / reverse / gain no mueven nada; map_through encadena", () => {
    expect(map_pos(7, { type: "reverse", a: 0, b: 10 })).toBe(7)
    expect(map_through(25, [{ type: "cut", a: 0, b: 5 }, { type: "duplicate", a: 0, b: 10 }])).toBe(30)
  })
})

// loop de 8 beats a 120 BPM (spb 0.5, 4 s), 1000 Hz para que las cuentas sean exactas
const SR = 1000
const loop = (props = {}) => ({ kind: "loop", duration: 4, beats: 8, bpm: 120, anchor: "start", props: { nudge: 0, fade: 0, ...props } })
const shot = (props = {}, anchor = "start") => ({ kind: "shot", duration: 2, beats: null, bpm: null, anchor, props: { nudge: 0, fade: 0, ...props } })

describe("región del proyecto sobre el buffer de trabajo", () => {
  it("project_span: loop con región y nudge; sin región hasta nudge + beats", () => {
    expect(project_span(loop({ region_beats: [2, 6], nudge: 100 }))).toEqual({ start: 1.1, stop: 3.1 })
    expect(project_span(loop({ nudge: 100 }))).toEqual({ start: 0.1, stop: 4.1 })
    expect(project_span(shot({ region_secs: [0.2, 1] }))).toEqual({ start: 0.2, stop: 1 })
    expect(project_span(shot())).toEqual({ start: 0, stop: 2 })
  })
  it("loop sin región, CUT de 2 beats: la tirada pasa a 6 beats", () => {
    let ops = [{ type: "cut", a: 1000, b: 2000 }]
    let v = work_file_of(loop(), ops, SR, 3)
    expect(v.duration).toBe(3)
    expect(v.props.region_beats).toEqual([0, 6])
    expect(v.beats).toBe(6)
    let w = play_window(v)
    expect(w.offset).toBe(0)
    expect(w.period).toBeCloseTo(3)
  })
  it("loop con región, DUPLICATE adentro que termina en el fin de la región: la incluye", () => {
    // región beats [0, 4] = [0, 2] s; duplica [1, 2] s → región [0, 3] s = 6 beats
    let ops = [{ type: "duplicate", a: 1000, b: 2000 }]
    let v = work_file_of(loop({ region_beats: [0, 4] }), ops, SR, 5)
    expect(v.props.region_beats).toEqual([0, 6])
    expect(v.beats).toBe(10) // la grilla cubre todo el buffer de trabajo
    expect(copy_plan(v, 5)).toMatchObject({ from: 0, total: 3, beats: 6 })
  })
  it("loop con nudge: se conserva salvo que un corte lo deje antes de la región", () => {
    let v = work_file_of(loop({ nudge: 100 }), [{ type: "cut", a: 2000, b: 3000 }], SR, 3)
    expect(v.props.nudge).toBe(100)
    expect(v.props.region_beats[0]).toBeCloseTo(0)
    expect(v.props.region_beats[1]).toBeCloseTo(6)
    let v2 = work_file_of(loop({ nudge: 100 }), [{ type: "cut", a: 0, b: 50 }], SR, 3.95)
    expect(v2.props.nudge).toBe(50)
    expect(play_window(v2).offset).toBeCloseTo(0.05)
  })
  it("shot: región y anchor guardado llevados por el corte", () => {
    let f = shot({ region_secs: [0.5, 1.5], anchor: 1.2 })
    let v = work_file_of(f, [{ type: "cut", a: 0, b: 300 }], SR, 1.7)
    expect(v.props.region_secs).toEqual([0.2, 1.2])
    expect(v.props.anchor).toBeCloseTo(0.9)
    expect(shot_anchor(v).at).toBeCloseTo(0.9)
  })
  it("shot sin región: el archivo entero (sin region_secs)", () => {
    let v = work_file_of(shot(), [{ type: "reverse", a: 0, b: 2000 }], SR, 2)
    expect(v.props.region_secs).toBeUndefined()
  })
})

describe("STRETCH (fase 7)", () => {
  // stretch de 120 a 150 BPM: rate 1.25, el buffer de 4 s pasa a 3,2 s (el render lo hace edit_session; acá, de mentira)
  const stretch = (n, rate) => ({ type: "stretch", a: 0, b: n, rate, out: [new Float32Array(Math.round(n / rate))] })
  it("apply_op devuelve el render y op_length su largo; sin render, el largo esperado", () => {
    let op = stretch(4000, 1.25)
    expect(apply_op([new Float32Array(4000)], op)).toBe(op.out)
    expect(op_length(4000, op)).toBe(3200)
    expect(op_length(4000, { type: "stretch", a: 0, b: 4000, rate: 0.8 })).toBe(5000)
    expect(() => apply_op([new Float32Array(4)], { type: "stretch", a: 0, b: 4, rate: 2 })).toThrow()
  })
  it("map_pos escala; tempo_factor multiplica", () => {
    expect(map_pos(1000, { type: "stretch", rate: 1.25 })).toBe(800)
    expect(tempo_factor([{ type: "cut" }, { type: "stretch", rate: 1.25 }, { type: "stretch", rate: 2 }])).toBe(2.5)
    expect(tempo_factor([])).toBe(1)
  })
  it("loop: el bpm nuevo, los mismos beats; la copia dura beats × 60 / bpm destino", () => {
    let v = work_file_of(loop(), [stretch(4000, 1.25)], SR, 3.2)
    expect(v.bpm).toBe(150)
    expect(v.props.region_beats[0]).toBeCloseTo(0)
    expect(v.props.region_beats[1]).toBeCloseTo(8)
    let p = copy_plan(v, 3.2)
    expect(p.beats).toBe(8)
    expect(p.total).toBeCloseTo(8 * 60 / 150)
    // lo que el backend deduce: beats × 60 / duración
    expect(p.beats * 60 / p.total).toBeCloseTo(150, 6)
  })
  it("loop con región y nudge: la región sigue en los mismos beats y el nudge se escala", () => {
    let v = work_file_of(loop({ region_beats: [2, 6], nudge: 100 }), [stretch(4000, 1.25)], SR, 3.2)
    expect(v.props.nudge).toBe(80)
    expect(v.props.region_beats[0]).toBeCloseTo(2)
    expect(v.props.region_beats[1]).toBeCloseTo(6)
    expect(copy_plan(v, 3.2)).toMatchObject({ beats: 4 })
    // más lento: el nudge escalado no pasa de NUDGE_MAX
    let slow = work_file_of(loop({ nudge: 200 }), [stretch(4000, 0.5)], SR, 8)
    expect(slow.props.nudge).toBe(250)
  })
  it("después de un CUT: se combina con la posición del corte", () => {
    let ops = [{ type: "cut", a: 1000, b: 2000 }, stretch(3000, 1.5)]
    let v = work_file_of(loop(), ops, SR, 2)
    expect(v.bpm).toBe(180)
    expect(v.props.region_beats[1]).toBeCloseTo(6)
  })
})

describe("plan de la copia", () => {
  it("loop sin región ni cambios: los beats del archivo, con el nudge horneado (silencio al final)", () => {
    let p = copy_plan(loop({ nudge: 100 }), 4)
    expect(p.from).toBeCloseTo(0.1)
    expect(p.len).toBeCloseTo(3.9)
    expect(p.total).toBeCloseTo(4)
    expect(p.beats).toBe(8)
  })
  it("loop con región no entera: la tirada redondea y corta lo que sobra", () => {
    let p = copy_plan(loop({ region_beats: [1, 4.4] }), 4)
    expect(p.beats).toBe(3)
    expect(p.from).toBeCloseTo(0.5)
    expect(p.len).toBeCloseTo(1.5)
    expect(p.total).toBeCloseTo(1.5)
  })
  it("shot: la región, y el anchor guardado relativo a su inicio", () => {
    let p = copy_plan(shot({ region_secs: [0.5, 1.5], anchor: 1.2 }), 2)
    expect(p).toMatchObject({ from: 0.5, beats: null })
    expect(p.len).toBeCloseTo(1)
    expect(p.anchor).toBeCloseTo(0.7)
    expect(copy_plan(shot({}, "end"), 2).anchor).toBe(null)
  })
  it("selection_plan: loop a beats enteros (mínimo 1), shot tal cual con anchor adentro", () => {
    let p = selection_plan(loop(), { start: 1, stop: 2.1 })
    expect(p.beats).toBe(2)
    expect(p.total).toBeCloseTo(1)
    expect(p.len).toBeCloseTo(1)
    expect(selection_plan(loop(), { start: 1, stop: 1.1 }).beats).toBe(1)
    let s = selection_plan(shot({ anchor: 0.8 }), { start: 0.5, stop: 1 })
    expect(s.anchor).toBeCloseTo(0.3)
    expect(selection_plan(shot({ anchor: 1.5 }), { start: 0.5, stop: 1 }).anchor).toBe(null)
  })
  it("copy_props: lo que no se hornea; región y nudge no pasan", () => {
    expect(copy_props({ volume: -3, weight: 10, repeat: [1, 4], fade: 5, nudge: 20, region_beats: [0, 2] }, 0.25))
      .toEqual({ volume: -3, weight: 10, repeat: [1, 4], fade: 5, anchor: 0.25 })
    expect(copy_props({ volume: -6, weight: 16, repeat: [1, 1], fade: 0 })).toEqual({ volume: -6, weight: 16 })
  })
  it("copy_props: transpose y KEY LOCK pasan (no se hornean)", () => {
    expect(copy_props({ volume: -6, weight: 16, transpose: -2.5, key_lock: true }))
      .toEqual({ volume: -6, weight: 16, transpose: -2.5, key_lock: true })
    expect(copy_props({ volume: -6, weight: 16, transpose: 0, key_lock: false })).toEqual({ volume: -6, weight: 16 })
  })
  it("copy_name: sin extensión, numerado si ya existe", () => {
    expect(copy_name("Bass Loop 120.wav")).toBe("Bass Loop 120 (edit)")
    expect(copy_name("Bass.wav", new Set(["bass (edit)"]))).toBe("Bass (edit 2)")
    expect(strip_ext("x.aiff")).toBe("x")
  })
})

describe("horneado de la copia", () => {
  it("loop con nudge y CUT: la copia arranca en el beat 0 y dura los beats de la tirada", () => {
    // 4 s a 1000 Hz con una rampa (muestra i = i); nudge 100 ms, corta el beat 2 (1.1..1.6 s)
    let src = new Float32Array(4000).map((_, i) => i)
    let f = loop({ nudge: 100 })
    let ops = [{ type: "cut", a: 1100, b: 1600 }]
    let work = apply_ops([src], ops)
    let v = work_file_of(f, ops, SR, work[0].length / SR)
    let p = copy_plan(v, work[0].length / SR)
    expect(p.beats).toBe(7)
    expect(p.total).toBeCloseTo(3.5)
    let out = bake_region(work, SR, { from: p.from, len: p.len, total: p.total })[0]
    expect(out.length).toBe(3500)
    expect(out[0]).toBe(100) // beat 0 = el nudge
    expect(out[999]).toBe(1099)
    expect(out[1000]).toBe(1600) // el corte
    expect(out[3399]).toBe(3999) // fin del audio
    expect(out[3400]).toBe(0) // silencio del nudge al final (la tirada dura 7 beats)
  })
})

describe("WAV", () => {
  it("encode_wav: cabecera float 32 e intercalado", () => {
    let buf = encode_wav([ch(0.5, -1), ch(1.5, 0.25)], 48000)
    let v = new DataView(buf)
    const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n))
    expect(str(0, 4)).toBe("RIFF")
    expect(str(8, 4)).toBe("WAVE")
    expect(v.getUint32(4, true)).toBe(36 + 16)
    expect(v.getUint16(20, true)).toBe(3)
    expect(v.getUint16(22, true)).toBe(2)
    expect(v.getUint32(24, true)).toBe(48000)
    expect(v.getUint32(28, true)).toBe(48000 * 8)
    expect(v.getUint16(32, true)).toBe(8)
    expect(v.getUint16(34, true)).toBe(32)
    expect(str(36, 4)).toBe("data")
    expect(v.getUint32(40, true)).toBe(16)
    expect([0, 1, 2, 3].map(i => v.getFloat32(44 + i * 4, true))).toEqual([0.5, 1.5, -1, 0.25])
    expect(buf.byteLength).toBe(60)
  })
})
