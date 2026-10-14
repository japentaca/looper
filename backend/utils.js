import util from 'util'
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

// execFile sin shell: las rutas van como argumentos, sin interpolar en un comando
async function run_full(bin, args) {
  return await exec_file(bin, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 })
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
// unión del loop no cambian). Primero mide (o usa `measured` si ya se midió). Devuelve
// { input_i, input_tp, gain }. Lanza si ffmpeg falla.
async function convert(in_file, out_file, measured = null) {
  let m = measured || await measure_loudness(in_file)
  let gain = loudness_gain(m)
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

function get_file_extension(file) {
  let ext = file.split('.').pop()
  return ext.toLowerCase()
}
// tempo de un loop: bpm = beats × 60 / duración (segundos), redondeado a 2 decimales. null si falta
// algún dato. El dato que carga el creador es `beats`; `bpm` siempre se deduce de ahí
function loop_bpm(beats, duration) {
  let b = Number(beats)
  let d = Number(duration)
  if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(d) || d <= 0) return null
  return Math.round(b * 60 / d * 100) / 100
}

export default {
  probe,
  loop_bpm,
  convert,
  measure_loudness,
  loudness_gain,
  get_file_extension,
  ffmpeg_path,
  ffprobe_path
}
