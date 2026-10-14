// tonalidad de un archivo (files.music_key): null = sin dato; "atonal" = sin tonalidad (percusión,
// ruidos: combina con cualquiera); o una tónica con grafía fija (KEY_TONICS) más "m" si es menor.
// normalize_key y suggest_key son el mismo código que backend/utils.js: cambiarlos juntos.
export const KEY_ATONAL = "atonal"
export const KEY_TONICS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]
const KEY_ENHARMONIC = { "Db": "C#", "D#": "Eb", "Gb": "F#", "Ab": "G#", "A#": "Bb", "Cb": "B", "Fb": "E", "E#": "F", "B#": "C" }
const KEY_RE = /^([A-G])([#b♯♭]?)\s*(m|min|minor|maj|major)?$/

// tonalidad escrita a mano o en un nombre → forma canónica; null si no se reconoce
export function normalize_key(v) {
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

// tonalidad sugerida por el nombre del archivo: "atonal" si nombra percusión o ruidos; si no, la nota
// que aparezca como palabra suelta entre separadores (`_C#_`, `G_Bass`, `(Key_Bb)`). Las letras
// sueltas tienen que ser mayúsculas y no se separa por espacios, para no tomar "Percussion A Loop"
// como La. Si aparecen dos tonalidades distintas, null
export function suggest_key(name) {
  let base = String(name ?? "").replace(/\.[^./\\]+$/, "")
  if (KEY_ATONAL_WORDS.test(base) && !KEY_TONAL_WORDS.test(base)) return KEY_ATONAL
  let found = new Set()
  for (let token of base.split(/[_\-()[\].,/\\]+/)) {
    token = token.trim()
    if (!/^[A-G]/.test(token)) continue
    let k = normalize_key(token)
    if (k && k != KEY_ATONAL) found.add(k)
  }
  return found.size == 1 ? [...found][0] : null
}

// opciones para un el-select de tonalidad ("" = sin dato)
export const KEY_OPTIONS = [
  { value: "", label: "—" },
  { value: KEY_ATONAL, label: "atonal" },
  ...KEY_TONICS.map(t => ({ value: t, label: t })),
  ...KEY_TONICS.map(t => ({ value: t + "m", label: t + "m" })),
]

// para mostrar: "–" sin dato
export function key_label(k) {
  return k || "–"
}

// ¿el archivo pasa el filtro de tonalidad? `tonic` = tónica elegida ("" = sin filtro; trae mayor y
// menor), `with_atonal` = sumar los atonales. Misma regla que el filtro `key` de GET /catalog
export function key_matches(music_key, tonic, with_atonal) {
  if (!tonic) return true
  if (music_key == KEY_ATONAL) return !!with_atonal
  return music_key == tonic || music_key == tonic + "m"
}
