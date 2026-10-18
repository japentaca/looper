import util from 'util'
import os from 'os'
import child_process from 'child_process'
import ffmpeg_static from 'ffmpeg-static'
import ffprobe_static from 'ffprobe-static'
const exec_file = util.promisify(child_process.execFile)

// binarios: override opcional en .env (path_to_ffmpeg / path_to_ffprobe); si no, los de los paquetes npm
function ffmpeg_path() {
  return global.config?.path_to_ffmpeg || ffmpeg_static
}
function ffprobe_path() {
  return global.config?.path_to_ffprobe || ffprobe_static.path
}

// execFile sin shell: las rutas van como argumentos, sin interpolar en un comando. Con low_priority el
// proceso corre con menos prioridad (nice 10; en Windows, "por debajo de lo normal"), para trabajos de fondo
async function run_full(bin, args, low_priority = false) {
  let p = exec_file(bin, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 })
  if (low_priority && p.child?.pid) {
    try { os.setPriority(p.child.pid, 10) } catch { /* sin permiso o ya terminó: queda con la prioridad normal */ }
  }
  return await p
}
async function run(bin, args) {
  const { stdout } = await run_full(bin, args)
  return stdout
}

// ¿es audio? y duración en segundos.
// Devuelve { is_audio, duration, format, codec }. Si el archivo no es multimedia (o no existe)
// no lanza: is_audio = false. Lanza solo si no se puede ejecutar ffprobe.
async function probe(file) {
  let out
  try {
    out = await run(ffprobe_path(), [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      file
    ])
  } catch (e) {
    // si ffprobe no se pudo ejecutar (ENOENT, EACCES...) es un error de configuración, no "no es audio"
    if (typeof e.code == 'string') { throw e }
    return { is_audio: false, duration: null, format: null, codec: null }
  }
  let info
  try {
    info = JSON.parse(out)
  } catch {
    return { is_audio: false, duration: null, format: null, codec: null }
  }
  let streams = info.streams || []
  let audio = streams.find(s => s.codec_type == 'audio')
  let duration = parseFloat(info.format?.duration ?? audio?.duration)
  if (!Number.isFinite(duration)) { duration = null }
  return {
    is_audio: !!audio && duration != null && duration > 0,
    duration,
    format: info.format?.format_name || null,
    codec: audio?.codec_name || null
  }
}

// normalización de loudness: objetivo integrado (LUFS) y techo de true peak (dBTP)
const TARGET_I = -18
const TARGET_TP = -1
// tope de la ganancia (dB) por seguridad, y nivel por debajo del cual se toma como silencio
const MAX_GAIN_DB = 30
const SILENCE_I = -70
// misma conversión de formato en la medición y en la recodificación, para que lo medido sea lo que se codifica
const FORMAT_FILTER = 'aresample=44100,aformat=channel_layouts=stereo'

// mide el loudness con loudnorm (solo análisis, salida descartada). Devuelve { input_i, input_tp }
// (números, o null si no se pudieron leer: silencio da "-inf"). El JSON de loudnorm sale por stderr.
// Lanza si ffmpeg falla.
async function measure_loudness(in_file) {
  const { stderr } = await run_full(ffmpeg_path(), [
    '-hide_banner', '-nostats', '-loglevel', 'info',
    '-i', in_file,
    '-map', '0:a:0',
    '-vn', '-sn', '-dn',
    '-af', `${FORMAT_FILTER},loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=11:print_format=json`,
    '-f', 'null', '-'
  ])
  let start = stderr.lastIndexOf('{')
  let end = stderr.lastIndexOf('}')
  let data = null
  if (start >= 0 && end > start) {
    try { data = JSON.parse(stderr.slice(start, end + 1)) } catch { data = null }
  }
  let num = v => {
    let n = parseFloat(v)
    return Number.isFinite(n) ? n : null
  }
  return { input_i: num(data?.input_i), input_tp: num(data?.input_tp) }
}

// ganancia fija (dB) para llegar a TARGET_I sin pasar TARGET_TP: min(I objetivo - I, TP objetivo - TP),
// limitada a ±MAX_GAIN_DB y redondeada a centésimas. 0 si no hay medición válida o es silencio
function loudness_gain({ input_i, input_tp }) {
  if (input_i == null || input_tp == null || input_i <= SILENCE_I) return 0
  let gain = Math.min(TARGET_I - input_i, TARGET_TP - input_tp)
  gain = Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, gain))
  return Math.round(gain * 100) / 100
}

// convierte a MP3 VBR V0 (-q:a 0), 44.1 kHz estéreo, sin metadatos ni carátula, normalizado a
// -18 LUFS / -1 dBTP con una ganancia fija (filtro volume: sin compresión, la forma de onda y la
// unión del loop no cambian). Primero mide (o usa `measured` si ya se midió). Con normalize = false no
// mide ni normaliza (ganancia 0: las copias editadas del editor se guardan como se escucharon; input_i e
// input_tp quedan null). Devuelve { input_i, input_tp, gain }. Lanza si ffmpeg falla.
async function convert(in_file, out_file, measured = null, normalize = true) {
  let m = normalize ? measured || await measure_loudness(in_file) : { input_i: null, input_tp: null }
  let gain = normalize ? loudness_gain(m) : 0
  await run(ffmpeg_path(), [
    '-hide_banner', '-loglevel', 'error',
    '-y',
    '-i', in_file,
    '-map', '0:a:0',
    '-vn', '-sn', '-dn',
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-af', `${FORMAT_FILTER},volume=${gain}dB`,
    '-ar', '44100',
    '-ac', '2',
    '-c:a', 'libmp3lame',
    '-q:a', '0',
    '-id3v2_version', '0',
    '-write_xing', '1',
    '-f', 'mp3',
    out_file
  ])
  return { input_i: m.input_i, input_tp: m.input_tp, gain }
}

// ---------- medición de loudness (files.loudness / files.peak) ----------
// Filtro ebur128 de ffmpeg sobre el mp3 ya convertido (el archivo entero): loudness integrada (LUFS, EBU R128)
// y true peak (dBFS, sobremuestreado). Por debajo de la compuerta absoluta ebur128 da -70.0 LUFS y en silencio
// digital el pico da "-inf": los dos se guardan con piso LOUDNESS_FLOOR, así un archivo silencioso queda medido
// (no null, no se vuelve a medir) y el front lo toma como silencio (loudness <= -70)
const LOUDNESS_FLOOR = -70
// largo mínimo que se le da al audio antes de medir (un bloque de ebur128)
const EBUR128_MIN_SECONDS = 0.4

// parsea el Summary que ebur128 escribe al final de stderr. Devuelve { loudness, peak } (redondeados a
// décimas, con piso LOUDNESS_FLOOR) o null si no encuentra el Summary con los dos valores. Función pura
function parse_ebur128(stderr) {
  let text = String(stderr ?? "")
  let at = text.lastIndexOf("Summary:")
  if (at < 0) return null
  text = text.slice(at)
  let i = /\bI:\s*(-?inf|-?\d+(?:\.\d+)?)\s*LUFS/.exec(text)
  let peak = /\bPeak:\s*(-?inf|-?\d+(?:\.\d+)?)\s*dBFS/.exec(text)
  if (!i || !peak) return null
  let num = v => {
    if (v == "-inf") return LOUDNESS_FLOOR
    let n = parseFloat(v)
    if (!Number.isFinite(n)) return null
    return Math.max(LOUDNESS_FLOOR, Math.round(n * 10) / 10)
  }
  let r = { loudness: num(i[1]), peak: num(peak[1]) }
  return r.loudness == null || r.peak == null ? null : r
}

// mide loudness y true peak de un archivo con ebur128 (salida descartada). Devuelve { loudness, peak }.
// Lanza si ffmpeg falla (p. ej. el archivo no existe) o si no se pudo leer el Summary. Con low_priority
// ffmpeg corre con menos prioridad (relleno en segundo plano: fill_file_loudness en db_migrations.js)
async function measure_ebur128(file, low_priority = false) {
  const { stderr } = await run_full(ffmpeg_path(), [
    '-hide_banner', '-nostats', '-loglevel', 'info',
    '-threads', '1',
    '-i', file,
    '-map', '0:a:0',
    '-vn', '-sn', '-dn',
    // apad: ebur128 integra bloques de 400 ms y uno más corto (un golpe) daría -70 como si fuera silencio; con
    // silencio hasta 0,4 s queda un bloque: la energía del golpe repartida en 400 ms (los más largos no cambian).
    // framelog=verbose: sin una línea cada 100 ms (con -loglevel info solo queda el Summary)
    '-af', `apad=whole_dur=${EBUR128_MIN_SECONDS},ebur128=peak=true:framelog=verbose`,
    '-f', 'null', '-'
  ], low_priority)
  let r = parse_ebur128(stderr)
  if (!r) throw new Error("ebur128: no se pudo leer el Summary")
  return r
}

function get_file_extension(file) {
  let ext = file.split('.').pop()
  return ext.toLowerCase()
}

// ruta en disco del mp3 de un archivo: <storage_path><user_id>/<id>.mp3
function audio_path(user_id, id) {
  return global.config.storage_path + user_id + "/" + id + ".mp3"
}

// fecha y hora actual UTC en ISO sin ms ("2026-10-17T12:34:56"): el formato de las columnas `ts`
function now_ts() {
  return new Date().toISOString().slice(0, 19)
}
// tempo de un loop: bpm = beats × 60 / duración (segundos), redondeado a 2 decimales. null si falta
// algún dato. El dato que carga el creador es `beats`; `bpm` siempre se deduce de ahí
function loop_bpm(beats, duration) {
  let b = Number(beats)
  let d = Number(duration)
  if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(d) || d <= 0) return null
  return Math.round(b * 60 / d * 100) / 100
}

// ---------- tonalidad (files.music_key) ----------
// Valores: null = sin dato; "atonal" = sin tonalidad (percusión, ruidos: combina con cualquiera); o una
// tonalidad = tónica con una grafía fija (KEY_TONICS) más "m" si es menor ("G", "C#m", "Bb").
// Mismo código que frontend/src/helpers/music_key.js: cambiarlos juntos.
const KEY_ATONAL = "atonal"
const KEY_TONICS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]
const KEY_ENHARMONIC = { "Db": "C#", "D#": "Eb", "Gb": "F#", "Ab": "G#", "A#": "Bb", "Cb": "B", "Fb": "E", "E#": "F", "B#": "C" }
const KEY_RE = /^([A-G])([#b♯♭]?)\s*(m|min|minor|maj|major)?$/

// tonalidad escrita a mano o en un nombre → forma canónica; null si no se reconoce
function normalize_key(v) {
  let s = String(v ?? "").trim()
  if (s.toLowerCase() == KEY_ATONAL) return KEY_ATONAL
  let m = KEY_RE.exec(s.length > 1 ? s[0].toUpperCase() + s.slice(1) : s.toUpperCase())
  if (!m) return null
  let tonic = m[1] + m[2].replace("♯", "#").replace("♭", "b")
  tonic = KEY_ENHARMONIC[tonic] ?? tonic
  if (!KEY_TONICS.includes(tonic)) return null
  return tonic + (m[3] && m[3].startsWith("m") && !m[3].startsWith("ma") ? "m" : "")
}

// palabras de un nombre de archivo que indican un sonido sin tonalidad, salvo que también tenga
// alguna de KEY_TONAL_WORDS ("Filtered Kick Bass" es tonal). Cada palabra empieza donde no hay otra
// letra antes ("Top_Loop" sí, "stop" o "that" no)
const KEY_ATONAL_WORDS = /(?<![a-z])(kick|bombo|snare|hat|perc|crash|ride|cymbal|top|tom|clap|shaker|tribal|drum|noise|impact|upfilter|riser|sweep)/i
const KEY_TONAL_WORDS = /bass|synth|seq|melod|theme|lead|chord|pad|voice|vocal|riff|arp|sitar|pluck/i
// nota escrita después del tempo, separada por espacios: "Synth Melody 120bpm F# Funk", "Bass 95 BPM Cm"
const KEY_AFTER_BPM_RE = /\d\s*[bB][pP][mM][\s_-]+([A-G](?:[#♯♭]|b(?![a-z]))?(?:\s*(?:minor|min|major|maj|m)(?![a-z]))?)(?![A-Za-z0-9#♯♭])/g

// tonalidad sugerida por el nombre del archivo: "atonal" si nombra percusión o ruidos; si no, la nota
// que aparezca como palabra suelta entre separadores (`_C#_`, `G_Bass`, `(Key_Bb)`) o la que sigue al
// tempo aunque esté separada por espacios (`120bpm F# Funk`). Las notas tienen que ser mayúsculas y
// fuera de esos dos casos no se separa por espacios, para no tomar "Percussion A Loop" como La. Si
// aparecen dos tonalidades distintas, null
function suggest_key(name) {
  let base = String(name ?? "").replace(/\.[^./\\]+$/, "")
  if (KEY_ATONAL_WORDS.test(base) && !KEY_TONAL_WORDS.test(base)) return KEY_ATONAL
  let found = new Set()
  for (let token of base.split(/[_\-()[\].,/\\]+/)) {
    token = token.trim()
    if (!/^[A-G]/.test(token)) continue
    let k = normalize_key(token)
    if (k && k != KEY_ATONAL) found.add(k)
  }
  for (let m of base.matchAll(KEY_AFTER_BPM_RE)) {
    let k = normalize_key(m[1])
    if (k && k != KEY_ATONAL) found.add(k)
  }
  return found.size == 1 ? [...found][0] : null
}

export default {
  probe,
  loop_bpm,
  normalize_key,
  suggest_key,
  KEY_ATONAL,
  convert,
  measure_loudness,
  loudness_gain,
  parse_ebur128,
  measure_ebur128,
  LOUDNESS_FLOOR,
  get_file_extension,
  now_ts,
  audio_path,
}
