// Efectos de transición (FX) por pista: catálogo fijo de tipos y utilidades de las instancias.
// Las instancias viven en trg.props.fx (ver docs/ARCHITECTURE.md, "FX de transición"):
// { id, type, lead, prob, cond, ...parámetros del tipo }. El motor (Tracks.vue) las dispara `lead`
// antes del fin de la tirada de un loop y mixer.js agenda las rampas (fx_schedule / fx_reset).
// Este módulo no depende de Tone ni del store: solo datos.

export const MAX_FX_PER_TRACK = 4

// anticipación: "Nb" = N beats, "Nm" = N compases del compás actual (ver lead_beats)
export const LEAD_OPTIONS = [
  { value: "1b", label: "1B" },
  { value: "2b", label: "2B" },
  { value: "1m", label: "1M" },
  { value: "2m", label: "2M" },
  { value: "4m", label: "4M" },
  { value: "8m", label: "8M" },
]

// condición del fin: any = cualquier fin; rest = solo si lo que sigue es un descanso;
// tag = solo si el fin es un corte por cambio de Tag (fase 3; por ahora nunca se cumple)
export const COND_OPTIONS = [
  { value: "any", label: "ANY" },
  { value: "rest", label: "REST" },
  { value: "tag", label: "TAG" },
]

// campos comunes a todas las instancias (el lead por defecto depende del tipo)
const COMMON_DEFAULTS = { prob: 1, cond: "any" }

// catálogo: rótulo, letra del chip, valores por defecto y rangos de los parámetros propios del tipo
// (para el diálogo de la fase 2; normalize_fx también los usa para acotar)
export const FX_TYPES = {
  cut: {
    label: "Cut", chip: "C",
    defaults: { lead: "1m" },
    params: {},
  },
  lpf: {
    label: "Low-pass", chip: "L",
    defaults: { lead: "2m", to_hz: 300, q: 1 },
    params: {
      to_hz: { label: "Freq", min: 100, max: 5000, step: 10, unit: "Hz" },
      q: { label: "Q", min: 0, max: 12, step: 0.5, unit: "" },
    },
  },
  hpf: {
    label: "High-pass", chip: "H",
    defaults: { lead: "2m", to_hz: 800, q: 1 },
    params: {
      to_hz: { label: "Freq", min: 100, max: 5000, step: 10, unit: "Hz" },
      q: { label: "Q", min: 0, max: 12, step: 0.5, unit: "" },
    },
  },
  fade: {
    label: "Fade", chip: "F",
    defaults: { lead: "2m", to_db: -60 },
    // -60 = silencio
    params: { to_db: { label: "To", min: -60, max: -6, step: 1, unit: "dB" } },
  },
  echo: {
    label: "Echo throw", chip: "E",
    defaults: { lead: "1b", level: 0 },
    params: { level: { label: "Level", min: -24, max: 0, step: 1, unit: "dB" } },
  },
  verb: {
    label: "Reverb throw", chip: "R",
    defaults: { lead: "1b", level: 0 },
    params: { level: { label: "Level", min: -24, max: 0, step: 1, unit: "dB" } },
  },
}

// beats de una anticipación ("2b" = 2, "2m" con 4/4 = 8). 0 si no se reconoce (nunca dispara)
export function lead_beats(lead, beats_x_bar) {
  let m = /^(\d+)([bm])$/.exec(lead ?? "")
  if (!m) return 0
  let n = parseInt(m[1])
  return m[2] == "m" ? n * (parseInt(beats_x_bar) || 4) : n
}

// id corto al azar, distinto de los de `list` (las instancias de la misma pista)
function new_id(list = []) {
  let id
  do {
    id = Math.random().toString(36).slice(2, 8).padEnd(6, "0")
  } while (list.some(f => f?.id === id))
  return id
}

// instancia nueva de `type` con los valores por defecto (la usa la UI al soltar un FX en una tira).
// null si el tipo no existe
export function new_fx(type, list = []) {
  let def = FX_TYPES[type]
  if (!def) return null
  return { id: new_id(list), type, ...COMMON_DEFAULTS, ...def.defaults }
}

function clamp_num(v, min, max, dflt) {
  let n = Number(v)
  if (v === null || v === "" || !Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, n))
}

// instancia leída (de la base o de un proyecto viejo) con los valores faltantes o inválidos
// reemplazados por los defaults del tipo. null si no es un objeto o el tipo no existe.
// Se conservan solo los campos conocidos.
export function normalize_fx(inst, list = []) {
  if (!inst || typeof inst != "object") return null
  let def = FX_TYPES[inst.type]
  if (!def) return null
  let out = { id: typeof inst.id == "string" && inst.id ? inst.id : new_id(list), type: inst.type }
  out.lead = LEAD_OPTIONS.some(o => o.value === inst.lead) ? inst.lead : def.defaults.lead
  out.prob = clamp_num(inst.prob, 0, 1, COMMON_DEFAULTS.prob)
  out.cond = COND_OPTIONS.some(o => o.value === inst.cond) ? inst.cond : COMMON_DEFAULTS.cond
  for (const [key, r] of Object.entries(def.params)) {
    out[key] = clamp_num(inst[key], r.min, r.max, def.defaults[key])
  }
  return out
}

// lista de props.fx normalizada: siempre un array, sin instancias inválidas, con ids únicos y como
// mucho MAX_FX_PER_TRACK
export function normalize_fx_list(list) {
  let out = []
  for (const inst of Array.isArray(list) ? list : []) {
    if (out.length >= MAX_FX_PER_TRACK) break
    let n = normalize_fx(inst, out)
    if (!n) continue
    if (out.some(f => f.id === n.id)) n.id = new_id(out)
    out.push(n)
  }
  return out
}
