// Tests de los detectores del editor (detect.js, fase 8) con señales sintéticas. Correr con: cd frontend && npm test
import { describe, it, expect } from "vitest"
import {
  detect_key, detect_note, key_scores, harmonic_sieve, mono_mix, freq_to_midi, midi_to_freq, note_name, fmt_cents,
  tune_semis, tune_targets, nearest_target, dominant_key, KK_MAJOR, KEY_MIN_CONFIDENCE
} from "./detect.js"

const SR = 44100

// nota con armónicos (amplitud amp · decay^(h−1)) y rampas cortas en los bordes, sumada a out
function tone(out, midi, t0, dur, { amp = 0.15, harm = 6, decay = 0.6, sr = SR } = {}) {
  let f = midi_to_freq(midi)
  let a = Math.floor(t0 * sr)
  let n = Math.floor(dur * sr)
  for (let h = 1; h <= harm && f * h < sr / 2; h++) {
    let ah = amp * Math.pow(decay, h - 1)
    for (let i = 0; i < n && a + i < out.length; i++) {
      let env = Math.min(1, i / 200, (n - i) / 200)
      out[a + i] += ah * env * Math.sin(2 * Math.PI * f * h * i / sr)
    }
  }
}
// secuencia de acordes (listas de notas midi) de `dur` s cada uno
function chords(list, dur, opts = {}) {
  let sr = opts.sr ?? SR
  let out = new Float32Array(Math.floor(list.length * dur * sr))
  list.forEach((c, i) => c.forEach(m => tone(out, m, i * dur, dur, opts)))
  return out
}
// ruido determinístico (los tests no dependen del azar)
function noise_gen(seed = 1) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647 * 2 - 1
  }
}
function white(secs, amp = 0.3, seed = 1) {
  let r = noise_gen(seed)
  let out = new Float32Array(Math.floor(secs * SR))
  for (let i = 0; i < out.length; i++) out[i] = amp * r()
  return out
}
// loop de batería: bombo (seno que baja de 150 a 50 Hz) en cada negra y hat (ruido) a contratiempo, 120 BPM
function drums(secs) {
  let r = noise_gen(7)
  let out = new Float32Array(Math.floor(secs * SR))
  for (let b = 0; b < secs * 2; b++) {
    let a = Math.floor(b * 0.5 * SR)
    let ph = 0
    for (let i = 0; i < 0.3 * SR && a + i < out.length; i++) {
      ph += 2 * Math.PI * (50 + 100 * Math.exp(-i / (0.03 * SR))) / SR
      out[a + i] += 0.6 * Math.exp(-i / (0.1 * SR)) * Math.sin(ph)
    }
    let h = a + Math.floor(0.25 * SR)
    for (let i = 0; i < 0.05 * SR && h + i < out.length; i++) out[h + i] += 0.2 * Math.exp(-i / (0.01 * SR)) * r()
  }
  return out
}

describe("utilidades", () => {
  it("frecuencia ↔ midi y nombre de la nota", () => {
    expect(freq_to_midi(440)).toBeCloseTo(69, 10)
    expect(midi_to_freq(60)).toBeCloseTo(261.626, 2)
    expect(note_name(69)).toBe("A4")
    expect(note_name(61)).toBe("C#4")
    expect(note_name(70)).toBe("Bb4")
    expect(note_name(24)).toBe("C1")
    expect(note_name(59.6)).toBe("C4")
  })
  it("fmt_cents", () => {
    expect(fmt_cents(12.4)).toBe("+12¢")
    expect(fmt_cents(-3)).toBe("−3¢")
    expect(fmt_cents(0.2)).toBe("±0¢")
  })
  it("mono_mix promedia los canales del tramo", () => {
    let l = Float32Array.from([1, 1, 1, 1])
    let r = Float32Array.from([0, 0, 1, 1])
    expect(Array.from(mono_mix([l, r], 1, 2))).toEqual([0.5, 1])
    expect(mono_mix([l, r], 3, 10).length).toBe(1)
    expect(mono_mix([l], 0).length).toBe(4)
  })
  it("key_scores: el perfil mayor de C correlaciona 1 consigo mismo", () => {
    let s = key_scores(KK_MAJOR)
    expect(s[0].key).toBe("C")
    expect(s[0].r).toBeCloseTo(1, 10)
    expect(s.length).toBe(24)
  })
  it("harmonic_sieve: descuenta el 3.º y 5.º armónico de un pico más grave", () => {
    let out = harmonic_sieve([
      { m: 48, a: 1 }, // C3
      { m: 48 + 19.02, a: 0.4 }, // G4 = 3.º armónico
      { m: 48 + 27.86, a: 0.2 }, // E5 = 5.º armónico
      { m: 60, a: 0.5 }, // C4 = octava: no se toca
    ])
    expect(out.map(p => p.a)).toEqual([1, 0.5, 0, 0])
  })
})

describe("detect_key", () => {
  it("tríada de C mayor con armónicos → C", () => {
    let r = detect_key(chords([[60, 64, 67]], 4), SR)
    expect(r.key).toBe("C")
    expect(r.uncertain).toBe(false)
    expect(r.suggestion).toBe("C")
    // la segunda es la que comparte más notas (Em o Am)
    expect(["Em", "Am"]).toContain(r.second.key)
  })
  it("tríada de C mayor más brillante (10 armónicos fuertes) → C", () => {
    expect(detect_key(chords([[60, 64, 67]], 4, { harm: 10, decay: 0.85 }), SR).key).toBe("C")
  })
  it("tríada de A menor con armónicos → Am (con y sin el bajo)", () => {
    expect(detect_key(chords([[57, 60, 64]], 4), SR).key).toBe("Am")
    let r = detect_key(chords([[45, 57, 60, 64]], 4), SR)
    expect(r.key).toBe("Am")
    expect(r.confidence).toBeGreaterThan(KEY_MIN_CONFIDENCE)
  })
  it("progresión I-IV-V-I en G → G", () => {
    let r = detect_key(chords([[55, 59, 62], [60, 64, 67], [62, 66, 69], [55, 59, 62]], 1), SR)
    expect(r.key).toBe("G")
    expect(r.margin).toBeGreaterThan(0.1)
    expect(detect_key(chords([[43, 55, 59, 62], [48, 60, 64, 67], [50, 62, 66, 69], [43, 55, 59, 62]], 1), SR).key)
      .toBe("G")
  })
  it("escala de C mayor → C; la relativa (Am) queda segunda", () => {
    let r = detect_key(chords([60, 62, 64, 65, 67, 69, 71, 72].map(m => [m]), 0.5), SR)
    expect(r.key).toBe("C")
    expect(r.second.key).toBe("Am")
  })
  it("menores: i-iv-V en A → Am; i-VI-VII en D → Dm", () => {
    expect(detect_key(chords([[45, 57, 60, 64], [50, 57, 62, 65], [52, 56, 59, 64], [45, 57, 60, 64]], 1), SR).key)
      .toBe("Am")
    expect(detect_key(chords([[50, 62, 65, 69], [46, 58, 62, 65], [48, 60, 64, 67], [50, 62, 65, 69]], 1), SR).key)
      .toBe("Dm")
  })
  it("senos puros en F# (I-IV-V-I) → F#, también a 48 kHz", () => {
    let prog = [[54, 58, 61], [59, 63, 66], [61, 65, 68], [54, 58, 61]]
    expect(detect_key(chords(prog, 1, { harm: 1 }), SR).key).toBe("F#")
    expect(detect_key(chords(prog, 1, { harm: 1, sr: 48000 }), 48000).key).toBe("F#")
  })
  it("desafinado (A = 432 Hz, −32 cents) → C igual, con la afinación medida", () => {
    let r = detect_key(chords([[60 - 0.32, 64 - 0.32, 67 - 0.32]], 4), SR)
    expect(r.key).toBe("C")
    expect(r.tuning).toBeCloseTo(-0.32, 1)
  })
  it("progresión en A menor con bajo y batería encima → Am", () => {
    let x = drums(8)
    let prog = [[45, 57, 60, 64], [41, 57, 60, 65], [43, 55, 59, 62], [40, 56, 59, 64]]
    prog.forEach((c, i) => c.forEach((m, j) => tone(x, m, i * 2, 2, { amp: j == 0 ? 0.25 : 0.08 })))
    expect(detect_key(x, SR).key).toBe("Am")
  })
  it("ruido blanco → uncertain, sugiere atonal", () => {
    let r = detect_key(white(4), SR)
    expect(r.uncertain).toBe(true)
    expect(r.suggestion).toBe("atonal")
    expect(r.confidence).toBeLessThan(0.3)
  })
  it("loop de batería (bombo + hat) → uncertain", () => {
    let r = detect_key(drums(4), SR)
    expect(r.uncertain).toBe(true)
    expect(r.suggestion).toBe("atonal")
  })
  it("silencio o vacío → sin tonalidad", () => {
    for (const x of [new Float32Array(SR), new Float32Array(0)]) {
      let r = detect_key(x, SR)
      expect(r.key).toBe(null)
      expect(r.uncertain).toBe(true)
    }
  })
  it("60 s se analizan en un tiempo razonable", () => {
    let x = chords([[55, 59, 62], [60, 64, 67], [62, 66, 69], [55, 59, 62]], 15, { harm: 3 })
    let t = performance.now()
    expect(detect_key(x, SR).key).toBe("G")
    expect(performance.now() - t).toBeLessThan(10000)
  })
})

describe("detect_note", () => {
  // nota de 1 s con armónicos
  function note(freq, opts = {}) {
    let out = new Float32Array(opts.secs ? Math.floor(opts.secs * SR) : SR)
    tone(out, freq_to_midi(freq), 0, out.length / SR, { amp: 0.5, ...opts })
    return out
  }
  it("A4 = 440 Hz → A4, 0 cents (seno puro y con armónicos)", () => {
    for (const harm of [1, 6]) {
      let r = detect_note(note(440, { harm }), SR)
      expect(r.pitched).toBe(true)
      expect(r.note).toBe("A4")
      expect(Math.abs(r.cents)).toBeLessThan(1)
      expect(r.confidence).toBeGreaterThan(0.9)
    }
  })
  it("446 Hz → A4 +23 cents", () => {
    let r = detect_note(note(446), SR)
    expect(r.note).toBe("A4")
    expect(r.cents).toBeCloseTo(1200 * Math.log2(446 / 440), 0)
    expect(r.freq).toBeCloseTo(446, 0)
  })
  it("graves y agudos: E1 (41,2 Hz), A1, C4, B5 (1000 Hz +22 cents)", () => {
    expect(detect_note(note(41.2), SR).note).toBe("E1")
    expect(detect_note(note(55), SR).note).toBe("A1")
    expect(detect_note(note(261.63), SR).note).toBe("C4")
    let r = detect_note(note(1000), SR)
    expect(r.note).toBe("B5")
    expect(r.cents).toBeCloseTo(21.8, 0)
  })
  it("pluck que se apaga con el 2.º armónico más fuerte que la fundamental → D3 (sin salto de octava)", () => {
    let f0 = 146.83
    let x = new Float32Array(SR)
    for (let i = 0; i < SR; i++) {
      let e = Math.exp(-i / (0.3 * SR))
      x[i] = e * (0.3 * Math.sin(2 * Math.PI * f0 * i / SR) + 0.6 * Math.sin(2 * Math.PI * 2 * f0 * i / SR)
        + 0.3 * Math.sin(2 * Math.PI * 3 * f0 * i / SR))
    }
    let r = detect_note(x, SR)
    expect(r.note).toBe("D3")
    expect(Math.abs(r.cents)).toBeLessThan(2)
  })
  it("con un ataque de ruido y silencio antes → la nota de después del ataque", () => {
    let x = new Float32Array(SR)
    let r = noise_gen(3)
    let a = Math.floor(0.2 * SR)
    for (let i = 0; i < 0.01 * SR; i++) x[a + i] += 0.8 * r()
    tone(x, freq_to_midi(196), 0.2, 0.8, { amp: 0.4 })
    let res = detect_note(x, SR)
    expect(res.note).toBe("G3")
    expect(Math.abs(res.cents)).toBeLessThan(2)
  })
  it("ruido blanco y hat → sin altura", () => {
    expect(detect_note(white(1), SR).pitched).toBe(false)
    let hat = white(0.5, 0.5, 5)
    for (let i = 0; i < hat.length; i++) hat[i] *= Math.exp(-i / (0.03 * SR))
    expect(detect_note(hat, SR).pitched).toBe(false)
  })
  it("silencio o demasiado corto → sin altura", () => {
    expect(detect_note(new Float32Array(SR), SR).pitched).toBe(false)
    expect(detect_note(note(440, { secs: 0.02 }), SR).pitched).toBe(false)
  })
})

describe("afinar a… (TUNE TO)", () => {
  it("tune_semis: a la nota más cercana corrige los cents (en pasos de 0,1)", () => {
    let midi = 69 + 0.234 // A4 +23 cents
    expect(nearest_target(midi)).toBe(69)
    expect(tune_semis(midi, 69)).toBe(-0.2)
    expect(tune_semis(midi, 72)).toBe(2.8)
    expect(tune_semis(60 - 0.12, 60)).toBe(0.1)
  })
  it("tune_semis: fuera de ±12 → null", () => {
    expect(tune_semis(60, 73)).toBe(null)
    expect(tune_semis(60, 47)).toBe(null)
    expect(tune_semis(60, 72)).toBe(12)
    expect(tune_semis(60.02, 72)).toBe(12)
  })
  it("tune_targets: las notas alcanzables, marcando la tónica", () => {
    let t = tune_targets(69.1, 9)
    expect(t[0]).toMatchObject({ midi: 81, note: "A5", tonic: true })
    expect(t.at(-1).midi).toBe(58)
    expect(t.find(x => x.midi == 69)).toMatchObject({ semis: -0.1, tonic: true })
    expect(t.filter(x => x.tonic).length).toBe(2)
  })
  it("dominant_key: la más repetida sin empate", () => {
    expect(dominant_key(["Am", "Am", "C", null, "atonal", "atonal", "atonal"])).toEqual({ key: "Am", tonic: 9 })
    expect(dominant_key(["Am", "C"])).toBe(null)
    expect(dominant_key([null, "atonal"])).toBe(null)
    expect(dominant_key(["Db"])).toEqual({ key: "C#", tonic: 1 })
  })
})
