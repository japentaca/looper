// Región de un archivo en el proyecto (docs/PLAN_EDITOR.md, fase 3; decisión 6): start/stop, NUDGE y FADE,
// no destructivos, en project_files.props. Funciones puras (sin Tone, Vue ni window; tests en region.test.js):
// las usan el motor (Tracks.vue, engine_oneshot.js), file_timing (TrackCtrl.js), el preview (toneLib.js) y el
// editor (RegionEditor.vue, WaveScreen.vue).
//
// Props (todas opcionales; sin ninguna, el archivo suena entero como siempre):
// - region_beats: [start, stop] de un loop, en beats de la grilla del archivo (float; enteros con SNAP);
// - region_secs: [start, stop] de un shot, en segundos desde el inicio del archivo;
// - nudge: ms (entero 0..NUDGE_MAX) que corre la grilla entera del loop a la derecha (silencio del encoder);
// - fade: ms (entero 0..FADE_MAX) de fadeIn y fadeOut del player (anti-click de la costura);
// - anchor (fase 4; decisión 7): punto de un shot que cae en el beat, en segundos desde el inicio del archivo
//   (0..ANCHOR_SECS_MAX). Sin dato, el default del catálogo (files.anchor: "start" = inicio de la región,
//   "end" = fin de la región). Ver shot_anchor y shot_preroll.
// Cada tipo usa la suya: si el dueño cambia el kind del archivo, la del otro tipo queda guardada pero se
// ignora (y vuelve a valer si vuelve al tipo anterior). nudge solo vale en loops.

export const NUDGE_MAX = 250
export const FADE_MAX = 50
export const REGION_BEATS_MAX = 1024 // = BEATS_MAX (FileEditor.vue y backend)
export const REGION_SECS_MAX = 120 // los archivos duran hasta 1 minuto; margen
// largo mínimo de una región que se arrastra o se mueve con las flechas (en el editor)
export const MIN_LOOP_BEATS = 0.25
export const MIN_SHOT_SECS = 0.005
export const ANCHOR_SECS_MAX = REGION_SECS_MAX
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
  // un anchor inválido se borra; también el viejo override "start" / "end" por proyecto (texto), que se quitó
  // antes de la fase 4: desaparece de la base al guardar el archivo
  if (parse_anchor(props.anchor) == null) delete props.anchor
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
  let anchor = parse_anchor(props?.anchor)
  if (anchor != null) out.anchor = anchor
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

// --- anchor de un shot (fase 4; decisión 7) ---
// Punto del shot que cae en el beat. Pre-roll = (anchor − inicio de la región) / playbackRate: lo que suena
// antes del beat. 0 = se dispara en el beat (los "start" de siempre); > 0 = se agenda por adelantado (los "end"
// son el caso anchor = stop). Un anchor guardado fuera de la región (se movió start/stop después) no se
// reescribe: se usa el borde más cercano y el editor avisa.

// pre-roll por debajo de esto (s) cuenta como 0: un corrimiento inaudible no saca al disparo del camino "en el beat"
export const PREROLL_MIN = 0.001
const EPS = 1e-9

// anchor guardado: segundos en 0..ANCHOR_SECS_MAX; cualquier otra cosa (sin dato, el viejo "start"/"end") = null
export function parse_anchor(v) {
  return Number.isFinite(v) && v >= 0 && v <= ANCHOR_SECS_MAX ? v : null
}
// anchor efectivo dentro de la región r = { start, stop } (s): el guardado (`saved`, o null) recortado a la región,
// o el default del catálogo (`catalog` = files.anchor: "end" = r.stop, si no r.start). clamped = el guardado
// quedaba fuera de la región (se toca en el borde más cercano)
export function anchor_in_region(saved, catalog, r) {
  let raw = saved ?? (catalog == "end" ? r.stop : r.start)
  let at = clamp(raw, r.start, r.stop)
  return { at, clamped: saved != null && Math.abs(at - raw) > EPS }
}
// anchor de un shot del proyecto: { at, start, stop, saved, clamped } (s del archivo; start/stop = lo que toca el
// player, play_window: la región o el archivo entero). null si no se puede saber (sin duración ni región, con un
// anchor que depende del final). Un loop sorteado por una pista one-shot no lleva anchor propio (props.anchor se
// ignora): usa el del catálogo sobre su ventana (nudge y region_beats), como antes de la fase 4
export function shot_anchor(f) {
  let d = Number(f.duration)
  let saved = f.kind == "shot" ? parse_anchor(f.props?.anchor) : null
  let w = play_window(f)
  let len = w.duration ?? (d > 0 ? Math.max(0, d - w.offset) : null)
  if (len == null) {
    // sin duración (no debería pasar con el audio cargado): solo se sabe el default "start"
    if (saved != null || f.anchor == "end") return null
    return { at: w.offset, start: w.offset, stop: null, saved: null, clamped: false }
  }
  let r = { start: w.offset, stop: w.offset + len }
  return { ...anchor_in_region(saved, f.anchor, r), start: r.start, stop: r.stop, saved }
}
// pre-roll de un shot en segundos de reloj: (anchor − inicio de la región) / play_rate; menos de PREROLL_MIN = 0;
// null = sin dato
export function shot_preroll(f) {
  let a = shot_anchor(f)
  if (!a) return null
  let pre = (a.at - a.start) / (f.play_rate || 1)
  return pre < PREROLL_MIN ? 0 : pre
}
// valor a guardar de un anchor que se arrastró o movió con las flechas (s, con PRECISION). null = el default
// del catálogo (cae justo en el borde que ya es el default: no se guarda y sigue a ese borde si se recorta)
export function anchor_to_save(v, catalog, r) {
  let at = round_p(clamp(v, r.start, r.stop))
  let def = catalog == "end" ? r.stop : r.start
  return Math.abs(at - round_p(def)) < EPS ? null : at
}

// golpes del audio (s): generaliza first_hit (AUTO del NUDGE) para el SNAP del anchor. Envolvente = máximo
// absoluto (de cualquier canal) por bloque de ONSET_BLOCK s. Un golpe es un bloque que llega a `ratio` del pico
// del archivo y que: viene de abajo del umbral (después de silencio; el primero coincide con first_hit), o
// duplica lo que venía sonando en los ONSET_GAP s anteriores (golpe nuevo encima de una cola). Después de un
// golpe no se busca otro en ONSET_GAP s (el ataque mismo no cuenta dos veces). El instante es la primera
// muestra del bloque que pasa el umbral, o lo que venía sonando
export const ONSET_BLOCK = 0.002
export const ONSET_GAP = 0.03
export function onsets(chans, sr, ratio = HIT_RATIO) {
  if (!(sr > 0) || !chans.length) return []
  let n = Math.max(...chans.map(c => c.length))
  let bs = Math.max(1, Math.round(ONSET_BLOCK * sr))
  let env = new Float32Array(Math.ceil(n / bs))
  for (const ch of chans) {
    for (let i = 0; i < ch.length; i++) {
      let v = Math.abs(ch[i])
      let b = Math.floor(i / bs)
      if (v > env[b]) env[b] = v
    }
  }
  let peak = 0
  for (const v of env) if (v > peak) peak = v
  if (!(peak > 0)) return []
  let th = peak * ratio
  let gap = Math.max(1, Math.round(ONSET_GAP / ONSET_BLOCK))
  let out = []
  let last = -Infinity
  for (let b = 0; b < env.length; b++) {
    if (env[b] < th || b - last < gap) continue
    let prev = 0
    for (let k = Math.max(0, b - gap); k < b; k++) if (env[k] > prev) prev = env[k]
    let fresh = prev < th
    if (!fresh && env[b] < 2 * prev) continue
    let first = Infinity
    for (const ch of chans) {
      let lim = Math.min(ch.length, (b + 1) * bs, first)
      for (let i = b * bs; i < lim; i++) {
        let v = Math.abs(ch[i])
        if (fresh ? v >= th : v > prev) {
          first = i
          break
        }
      }
    }
    if (!Number.isFinite(first)) continue
    out.push(first / sr)
    last = b
  }
  return out
}
// puntos de SNAP del anchor: los bordes de la región r y los golpes adentro, ordenados
export function anchor_snap_points(hits, r) {
  let inner = (hits ?? []).filter(t => t > r.start + EPS && t < r.stop - EPS)
  return [r.start, ...inner, r.stop]
}
// el punto de `points` más cercano a t (null si no hay)
export function nearest_point(points, t) {
  let best = null
  for (const p of points) if (best == null || Math.abs(p - t) < Math.abs(best - t)) best = p
  return best
}
// el primer punto de `points` (ordenados) después de t en la dirección dir (1 | -1); null si no hay
export function next_point(points, t, dir) {
  if (dir > 0) return points.find(p => p > t + 1e-6) ?? null
  for (let i = points.length - 1; i >= 0; i--) if (points[i] < t - 1e-6) return points[i]
  return null
}
