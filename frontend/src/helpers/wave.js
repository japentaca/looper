// Funciones puras de la pantalla de onda del editor (components/WaveScreen.vue): picos por columna y
// líneas de la grilla. Sin Tone, Vue ni window, para poder probarlas con Vitest (wave.test.js).

// picos min/max de `data` (muestras de un canal) en `columns` columnas: Float32Array de 2 × columns con
// [min0, max0, min1, max1, ...]. Cada columna cubre su tramo de muestras; si hay más columnas que
// muestras, una columna sin muestras propias toma la muestra que le cae encima (no queda vacía)
export function compute_peaks(data, columns) {
  let n = data.length
  let out = new Float32Array(columns * 2)
  if (!(columns > 0) || n == 0) return out
  for (let c = 0; c < columns; c++) {
    let a = Math.floor(c * n / columns)
    let b = Math.max(a + 1, Math.floor((c + 1) * n / columns))
    if (a >= n) a = n - 1
    if (b > n) b = n
    let min = data[a]
    let max = data[a]
    for (let i = a + 1; i < b; i++) {
      let v = data[i]
      if (v < min) min = v
      else if (v > max) max = v
    }
    out[c * 2] = min
    out[c * 2 + 1] = max
  }
  return out
}

// líneas de la grilla sobre un archivo de `duration` segundos: [{ t (s desde el inicio), bar, anchor }].
// - loop: una por beat (del 0 al último, incluidos los bordes); bar = cada `beats_x_bar` beats desde el
//   inicio. Sin `spb`, repartidas sobre sus `beats`; con `spb` (largo del beat: 60 / bpm del archivo, como
//   lo toca el motor) y `nudge` (s; la grilla entera corrida a la derecha, ver region.js), beat i en
//   nudge + i × spb (las que caen después del final no van).
// - shot: al tempo del proyecto (`tempo`, el shot suena a velocidad original), desde el anchor efectivo
//   (`anchor_t`, s desde el inicio del archivo: el punto que cae en el beat, ver shot_anchor en region.js) hacia
//   los dos lados. bar se cuenta desde el anchor y anchor = true marca la línea del punto de disparo.
// Ordenadas por t. Sin datos válidos devuelve []
export function grid_lines({ kind, duration, beats, beats_x_bar, tempo, anchor_t = 0, nudge = 0, spb = 0 }) {
  let d = Number(duration)
  let bpb = Math.max(1, parseInt(beats_x_bar) || 4)
  if (!(d > 0)) return []
  let lines = []
  if (kind == "shot") {
    let spb = 60 / Number(tempo)
    if (!(spb > 0) || !Number.isFinite(spb)) return []
    let a = Math.min(d, Math.max(0, Number(anchor_t) || 0))
    // k = beats desde el anchor (negativos antes); con un margen de redondeo para no perder las de los bordes
    for (let k = -Math.floor(a / spb + 1e-9); a + k * spb <= d + 1e-9; k++) {
      lines.push({ t: Math.min(d, Math.max(0, a + k * spb)), bar: (k % bpb + bpb) % bpb == 0, anchor: k == 0 })
    }
    return lines
  }
  let b = Math.round(Number(beats))
  if (!(b >= 1)) return []
  let step = spb > 0 ? spb : d / b
  for (let i = 0; i <= b; i++) {
    let t = nudge + step * i
    if (t > d + 1e-9) break
    lines.push({ t, bar: i % bpb == 0, anchor: false })
  }
  return lines
}

// texto del rótulo cuando el motor toca el loop a ×2 o ×½ en este proyecto (play_beats ≠ beats); "" si no
export function rate_label(beats, play_beats) {
  let b = Number(beats)
  let p = Number(play_beats)
  if (!(b > 0) || !(p > 0) || p == b) return ""
  let m = p / b
  let mult = m == 2 ? "×2" : m == 0.5 ? "×½" : "×" + Math.round(m * 100) / 100
  return `in this project: ${p} beats (${mult})`
}
