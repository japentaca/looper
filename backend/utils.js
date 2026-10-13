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
async function run(bin, args) {
  const { stdout } = await exec_file(bin, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 })
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

// convierte a MP3 VBR V0 (-q:a 0), 44.1 kHz estéreo, sin metadatos ni carátula.
// Lanza si ffmpeg falla.
async function convert(in_file, out_file) {
  await run(ffmpeg_path(), [
    '-hide_banner', '-loglevel', 'error',
    '-y',
    '-i', in_file,
    '-map', '0:a:0',
    '-vn', '-sn', '-dn',
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-ar', '44100',
    '-ac', '2',
    '-c:a', 'libmp3lame',
    '-q:a', '0',
    '-id3v2_version', '0',
    '-write_xing', '1',
    '-f', 'mp3',
    out_file
  ])
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
  get_file_extension,
  ffmpeg_path,
  ffprobe_path
}
