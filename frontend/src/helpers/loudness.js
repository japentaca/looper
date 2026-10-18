// Loudness de los archivos en el editor (docs/PLAN_EDITOR.md, decisión 8): lecturas con el volumen del proyecto
// aplicado y el cálculo de MATCH. Funciones puras (sin Tone ni store; los topes del fader llegan por parámetro),
// probadas en loudness.test.js. Los datos vienen del backend: files.loudness (LUFS integrados, EBU R128) y
// files.peak (true peak, dBFS), medidos con ebur128 sobre el archivo entero; null = sin medir.

// el backend guarda -70 (la compuerta absoluta de ebur128) en un archivo silencioso: eso o menos = silencio
export const LOUDNESS_SILENCE = -70

// ¿tiene una medición útil? (medido y no silencioso)
export function has_loudness(file) {
  return Number.isFinite(file?.loudness) && file.loudness > LOUDNESS_SILENCE
}

// nivel medido (loudness o peak) con el volumen del proyecto aplicado, redondeado a décimas. null si no hay
// medición, si el archivo es silencioso o si el volumen lo calla (off_db o menos)
export function level_with_volume(file, value, off_db) {
  let volume = Number(file?.props?.volume)
  if (!has_loudness(file) || !Number.isFinite(value) || !Number.isFinite(volume) || volume <= off_db) return null
  return round1(value + volume)
}

// MATCH: volumen (dB) que lleva la loudness del archivo (loudness + volume) al promedio de la de los otros
// archivos de su pista. Promedio aritmético en LUFS de loudness + volume de cada otro archivo de la misma pista,
// solo los medidos, no silenciosos y no callados por su volumen. El resultado se recorta al rango del fader:
// tope max_db y piso off_db + 0.1 (lo más bajo que todavía suena). Devuelve
//   { ok: true, volume, target, count, wanted, clipped: "max" | "min" | null }  (wanted = volumen sin recortar)
//   { ok: false, reason: "no_track" | "not_measured" | "no_others" }
export function match_volume(file, files, { max_db, off_db }) {
  if (file?.track_group == null) return { ok: false, reason: "no_track" }
  if (!has_loudness(file)) return { ok: false, reason: "not_measured" }
  let levels = []
  for (let o of files ?? []) {
    if (o === file || o.id === file.id || o.track_group !== file.track_group) continue
    if (level_with_volume(o, o.loudness, off_db) != null) levels.push(o.loudness + Number(o.props.volume))
  }
  if (!levels.length) return { ok: false, reason: "no_others" }
  let target = levels.reduce((a, b) => a + b, 0) / levels.length
  let wanted = round1(target - file.loudness)
  let min_db = round1(off_db + 0.1)
  let volume = Math.min(max_db, Math.max(min_db, wanted))
  let clipped = wanted > max_db ? "max" : wanted < min_db ? "min" : null
  return { ok: true, volume: volume, target: round1(target), count: levels.length, wanted: wanted, clipped: clipped }
}

// texto de un nivel para el LCD: una décima ("-18.0"); "---" sin dato
export function fmt_level(v) {
  return Number.isFinite(v) ? v.toFixed(1) : "---"
}

function round1(v) {
  return Math.round(v * 10) / 10
}
