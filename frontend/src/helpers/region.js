// Región de un archivo en el proyecto (docs/PLAN_EDITOR.md, fase 3; decisión 6): start/stop, NUDGE y FADE,
// no destructivos, en project_files.props. Funciones puras (sin Tone, Vue ni window; tests en region.test.js):
// las usan el motor (Tracks.vue, engine_oneshot.js), file_timing (TrackCtrl.js), el preview (toneLib.js) y el
// editor (RegionEditor.vue, WaveScreen.vue).
//
// Props (todas opcionales; sin ninguna, el archivo suena entero como siempre):
// - region_beats: [start, stop] de un loop, en beats de la grilla del archivo (float; enteros con SNAP);
// - region_secs: [start, stop] de un shot, en segundos desde el inicio del archivo;
// - nudge: ms (entero 0..NUDGE_MAX) que corre la grilla entera del loop a la derecha (silencio del encoder);
// - fade: ms (entero 0..FADE_MAX) de fadeIn y fadeOut del player (anti-click de la costura).
// Cada tipo usa la suya: si el dueño cambia el kind del archivo, la del otro tipo queda guardada pero se
// ignora (y vuelve a valer si vuelve al tipo anterior). nudge solo vale en loops.

export const NUDGE_MAX = 250
export const FADE_MAX = 50
export const REGION_BEATS_MAX = 1024 // = BEATS_MAX (Files.vue y backend)
export const REGION_SECS_MAX = 120 // los archivos duran hasta 1 minuto; margen
// largo mínimo de una región que se arrastra o se mueve con las flechas (en el editor)
export const MIN_LOOP_BEATS = 0.25
export const MIN_SHOT_SECS = 0.005
// precisión con que se guardan start/stop sin SNAP (no hace falta más en el JSON)
const PRECISION = 1e4

function round_p(v) {
  return Math.round(v * PRECISION) / PRECISION
}
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

// ms enteros en 0..max; cualquier otra cosa = 0 (sin dato)
function parse_ms(v, max) {
  return Number.isInteger(v) && v >= 0 && v <= max ? v : 0
}
export function parse_nudge(v) {
  return parse_ms(v, NUDGE_MAX)
}
export function parse_fade(v) {
  return parse_ms(v, FADE_MAX)
}
// [start, stop] con 0 <= start < stop <= max; si no, null
export function parse_pair(v, max) {
  if (!Array.isArray(v) || v.length != 2) return null
  let [a, b] = v
  return Number.isFinite(a) && Number.isFinite(b) && a >= 0 && a < b && b <= max ? [a, b] : null
}

// deja las props de la región de un archivo normalizadas (al cargar el proyecto): nudge y fade numéricos
// (0 = nada) y las regiones válidas o borradas
export function normalize_region_props(props) {
  props.nudge = parse_nudge(props.nudge)
  props.fade = parse_fade(props.fade)
  for (const [k, max] of [["region_beats", REGION_BEATS_MAX], ["region_secs", REGION_SECS_MAX]]) {
    let r = parse_pair(props[k], max)
    if (r) props[k] = r
    else delete props[k]
  }
  return props
}
// lo que save_file manda de la región (solo lo que tiene valor)
export function region_props_out(props) {
  let out = {}
  let rb = parse_pair(props?.region_beats, REGION_BEATS_MAX)
  if (rb) out.region_beats = rb
  let rs = parse_pair(props?.region_secs, REGION_SECS_MAX)
  if (rs) out.region_secs = rs
  let nudge = parse_nudge(props?.nudge)
  if (nudge) out.nudge = nudge
  let fade = parse_fade(props?.fade)
  if (fade) out.fade = fade
  return out
}

// bpm del archivo a su velocidad original: el guardado o, sin dato, deducido de beats y duración (como el backend)
export function file_bpm(f) {
  let beats = Number(f.beats)
  let d = Number(f.duration)
  return Number(f.bpm) || (beats > 0 && d > 0 ? beats * 60 / d : 0)
}

// región de un loop en beats, recortada a [0, beats] (el dueño pudo bajar los beats después); null = sin
// región o vacía después de recortar (el archivo entero)
export function loop_region(props, beats) {
  let r = parse_pair(props?.region_beats, REGION_BEATS_MAX)
  let b = Number(beats)
  if (!r || !(b > 0)) return null
  let start = Math.min(r[0], b)
  let stop = Math.min(r[1], b)
  return stop > start ? { start, stop } : null
}
// región de un shot en segundos, recortada a [0, duration] (sin duración, tal cual); null = sin región
export function shot_region(props, duration) {
  let r = parse_pair(props?.region_secs, REGION_SECS_MAX)
  if (!r) return null
  let d = Number(duration)
  let max = d > 0 ? d : Infinity
  let start = Math.min(r[0], max)
  let stop = Math.min(r[1], max)
  return stop > start ? { start, stop } : null
}
// beats que ocupa en el transporte una región de loop: round(stop − start), mínimo 1. El BPM no cambia
export function region_beats(start, stop) {
  return Math.max(1, Math.round(stop - start))
}

// qué toca el player de un archivo, en segundos del buffer (a su velocidad original: playbackRate lo escala):
// { offset, duration, fade, period }.
// - loop: offset = nudge + start × beat, con beat = 60 / bpm del archivo. duration = lo que suena de la
//   región, como mucho los beats de la tirada (round(stop − start) × beat): una región más larga la corta el
//   fin de la tirada, sea cual sea el archivo siguiente; una más corta deja un hueco. period = largo de la
//   tirada (lo usa el preview en sync para dar la vuelta). Sin región: duration null (hasta el final del
//   buffer, como siempre) y period = beats × beat.
// - shot: offset/duration = la región (sin región: 0 y null); sin nudge ni period.
// fade = fadeIn y fadeOut en segundos (0 = nada)
export function play_window(f) {
  let p = f.props ?? {}
  let fade = parse_fade(p.fade) / 1000
  if (f.kind == "shot") {
    let r = shot_region(p, f.duration)
    return r ? { offset: r.start, duration: r.stop - r.start, fade, period: null }
      : { offset: 0, duration: null, fade, period: null }
  }
  let nudge = parse_nudge(p.nudge) / 1000
  let bpm = file_bpm(f)
  let beats = Number(f.beats)
  if (!(bpm > 0)) return { offset: nudge, duration: null, fade, period: null }
  let spb = 60 / bpm
  let r = loop_region(p, beats)
  if (!r) return { offset: nudge, duration: null, fade, period: beats > 0 ? beats * spb : null }
  let period = region_beats(r.start, r.stop) * spb
  return { offset: nudge + r.start * spb, duration: Math.min(r.stop - r.start, region_beats(r.start, r.stop)) * spb, fade, period }
}
// segundos del buffer que suenan con una ventana de play_window en un buffer de `buffer_dur` s
export function window_length(w, buffer_dur) {
  let rest = Math.max(0, Number(buffer_dur) - w.offset)
  return w.duration == null ? rest : w.duration
}

// --- edición (RegionEditor.vue) ---
// segundos del archivo ↔ beats de la grilla de un loop (beat 0 en nudge)
export function beat_to_sec(b, spb, nudge_s) {
  return nudge_s + b * spb
}
export function sec_to_beat(t, spb, nudge_s) {
  return (t - nudge_s) / spb
}
// valor de un marcador de loop: con SNAP al beat entero más cercano, sin SNAP con PRECISION
export function snap_beat(b, snap) {
  return snap ? Math.round(b) : round_p(b)
}
// mueve un marcador ("start" | "stop") de la región r = { start, stop } a v, sin cruzar el otro (queda al
// menos min_len) y dentro de [0, max]
export function move_marker(r, which, v, max, min_len) {
  if (which == "start") return { start: round_p(clamp(v, 0, Math.max(0, r.stop - min_len))), stop: r.stop }
  return { start: r.start, stop: round_p(clamp(v, Math.min(max, r.start + min_len), max)) }
}
// paso de las flechas sobre un marcador de loop (en beats): con SNAP, al beat entero siguiente en esa
// dirección (dir = 1 | -1); sin SNAP, 1 ms
export function arrow_beat(b, dir, snap, spb) {
  if (snap) return dir > 0 ? Math.floor(b + 1e-9) + 1 : Math.ceil(b - 1e-9) - 1
  return b + dir * 0.001 / spb
}
// región guardable: null si es el archivo entero (loop [0, beats] o shot [0, duración]): no se guarda nada
export function region_to_save(r, max) {
  if (!r || (r.start <= 0 && r.stop >= max)) return null
  return [r.start, r.stop]
}

// índice del cruce por cero más cercano a i en `data` (a no más de `radius` muestras): el de la muestra
// que vale 0 o donde cambia el signo respecto de la anterior. Sin cruce cerca, i
export function zero_cross(data, i, radius) {
  let n = data.length
  i = clamp(Math.round(i), 0, Math.max(0, n - 1))
  const is_cross = k => k >= 0 && k < n && (data[k] == 0 || (k > 0 && (data[k - 1] < 0) != (data[k] < 0)))
  for (let r = 0; r <= radius; r++) {
    if (is_cross(i - r)) return i - r
    if (is_cross(i + r)) return i + r
  }
  return i
}
// primer cruce por cero desde i en la dirección dir (1 | -1), a no más de `radius` muestras; sin cruce, i
export function zero_cross_dir(data, i, dir, radius) {
  let n = data.length
  i = clamp(Math.round(i), 0, Math.max(0, n - 1))
  for (let r = 0; r <= radius; r++) {
    let k = i + dir * r
    if (k < 0 || k >= n) break
    if (data[k] == 0 || (k > 0 && (data[k - 1] < 0) != (data[k] < 0))) return k
  }
  return i
}

// AUTO del NUDGE: segundos hasta el primer golpe, la primera muestra (de cualquier canal) cuyo valor
// absoluto llega a `ratio` del pico del archivo. null si el archivo es silencio
export const HIT_RATIO = 0.1
export function first_hit(chans, sr, ratio = HIT_RATIO) {
  let peak = 0
  for (const ch of chans) {
    for (let i = 0; i < ch.length; i++) {
      let v = Math.abs(ch[i])
      if (v > peak) peak = v
    }
  }
  if (!(peak > 0) || !(sr > 0)) return null
  let th = peak * ratio
  let first = Infinity
  for (const ch of chans) {
    let lim = Math.min(ch.length, first)
    for (let i = 0; i < lim; i++) {
      if (Math.abs(ch[i]) >= th) {
        first = i
        break
      }
    }
  }
  return Number.isFinite(first) ? first / sr : null
}
// nudge en ms (entero 0..NUDGE_MAX) para un primer golpe en `hit` segundos
export function nudge_for_hit(hit) {
  return hit == null ? 0 : clamp(Math.round(hit * 1000), 0, NUDGE_MAX)
}

// ganancia del fade lineal (como Tone con curve "linear") en la muestra k de una región de n muestras con
// fades de fn muestras
function fade_gain(k, n, fn) {
  if (fn <= 0) return 1
  return Math.min(1, k / fn, (n - 1 - k) / fn)
}

// copia de la región para el preview en sync, con el fade ya aplicado (en loop no se aplicaría en cada vuelta).
// chans = canales (Float32Array) del archivo, sr = sample rate. La región (from, len en s; lo que pasa del
// final del archivo queda en silencio) va en `at` s dentro de un buffer de `total` s (default len, mínimo
// lo que hace falta para la región). Devuelve un Float32Array por canal
export function bake_region(chans, sr, { from, len, fade = 0, at = 0, total = len }) {
  let n = Math.max(1, Math.round(len * sr))
  let size = Math.max(n, Math.round(total * sr))
  let a = clamp(Math.round(at * sr), 0, size - n)
  let i0 = Math.max(0, Math.round(from * sr))
  let fn = Math.min(Math.floor(n / 2), Math.round(fade * sr))
  return chans.map(src => {
    let out = new Float32Array(size)
    let m = Math.max(0, Math.min(n, src.length - i0))
    if (m > 0) out.set(src.subarray(i0, i0 + m), a)
    if (fn > 0) for (let k = 0; k < n; k++) out[a + k] *= fade_gain(k, n, fn)
    return out
  })
}

// muestra mono (promedio de los canales) en el índice i; 0 fuera del archivo
function mono_at(chans, i) {
  if (i < 0) return 0
  let s = 0
  for (const ch of chans) s += i < ch.length ? ch[i] : 0
  return chans.length ? s / chans.length : 0
}
// ventana mono [from, from + len) s del archivo (lupa de inicio)
export function mono_window(chans, sr, from, len) {
  let i0 = Math.round(from * sr)
  let n = Math.max(1, Math.round(len * sr))
  let out = new Float32Array(n)
  for (let k = 0; k < n; k++) out[k] = mono_at(chans, i0 + k)
  return out
}
// lupa de costura: los últimos `half` s de la región pegados a sus primeros `half` s (lo que suena al
// repetir), mono y con el fade aplicado. La región = [from, from + len) s
export function seam_window(chans, sr, { from, len, fade = 0, half }) {
  let n = Math.max(1, Math.round(len * sr))
  let h = Math.max(1, Math.round(half * sr))
  let i0 = Math.round(from * sr)
  let fn = Math.min(Math.floor(n / 2), Math.round(fade * sr))
  let out = new Float32Array(2 * h)
  const val = k => (k < 0 || k >= n ? 0 : mono_at(chans, i0 + k) * fade_gain(k, n, fn))
  for (let j = 0; j < h; j++) {
    out[j] = val(n - h + j)
    out[h + j] = val(j)
  }
  return out
}
