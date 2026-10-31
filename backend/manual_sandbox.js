// Sandbox de las capturas del manual (docs/MANUAL.md): copia storage/ del repo (base + audios) a un
// directorio FUERA del repo, le escribe un .env derivado de backend/.env (solo cambian db_file y
// storage_path) y arma en la COPIA el usuario y el proyecto de demo. Nunca escribe en storage/ del repo.
// Va en backend/ porque usa knex, better-sqlite3 y bcrypt, que son dependencias del backend.
//   node backend/manual_sandbox.js [directorio]
// Directorio: el argumento, o la variable LOOPER_SANDBOX, o %TEMP%/looper_manual_sandbox. Cada corrida
// rehace la copia desde cero (lo que se haya hecho en el sandbox se pierde). Después:
//   cd <directorio> && node <repo>/backend/index.js     (dotenv lee el .env del directorio actual)
// No imprime el .env (secretos, en particular redis_password).
'use strict'
import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import Knex from "knex"
import bcrypt from "bcrypt"
import { v4 as uuid } from "uuid"

// usuario de demo (la clave está documentada en docs/MANUAL.md; solo existe en el sandbox)
const DEMO_EMAIL = "demo@example.com"
const DEMO_NAME = "demo"
const DEMO_PASSWORD = "demo-looper"
const DEMO_BIO = "Cuenta de demostración del manual."
const PROJECT_NAME = "Demo Psy Groove"

// proyecto de demo: pistas, tags y archivos del catálogo por nombre (original_name). Si alguno no está en la
// base se saltea con un aviso. Tags de cada archivo: G = "Groove 4/4", T = "Triplet", B = "Breakdown"
const TAGS = [
  { key: "G", name: "Groove 4/4", color: "#39e30b", weight: 16 },
  { key: "T", name: "Triplet", color: "#928af5", weight: 12 },
  { key: "B", name: "Breakdown", color: "#4fb6e8", weight: 6 },
]
const TRACKS = [
  { name: "Kick", color: "#f800a9", props: { rest: 0.05 },
    files: [["bombo 138.wav", "GT", { repeat: [4, 16] }]] },
  { name: "Drums", color: "#6b8ebf", props: { rest: 0.1, delay: -14 },
    files: [["Top_Loop_01.wav", "G"], ["Top_Loop_02.wav", "G"], ["Top_Loop_03.wav", "G"], ["Top_Loop_04.wav", "G"],
      ["Top_Loop_05.wav", "G"], ["Top_Loop_26_(Triplet).wav", "T"], ["Top_Loop_27_(Triplet).wav", "T"],
      ["Top_Loop_28_(Triplet).wav", "T"]] },
  { name: "Perc", color: "#d9a441", props: { rest: 0.1, reverb: -30, delay: -16 },
    files: [["Top_Loop_06.wav", "G"], ["Top_Loop_07.wav", "G"], ["Top_Loop_09.wav", "G"], ["Top_Loop_13.wav", "G"],
      ["Top_Loop_32_(Triplet).wav", "T"]] },
  { name: "Bass", color: "#f53404", props: { rest: 0.15 },
    files: [["G_Bass_Loop_29.wav", "G"], ["G_Bass_Loop_30.wav", "G"], ["G_Bass_Loop_34.wav", "GB"],
      ["G_Bass_Loop_12_(Triplet).wav", "T"], ["G_Bass_Loop_13_(Triplet).wav", "T"]] },
  { name: "Lead", color: "#16e70b", props: { volume: -2, rest: 0.2, reverb: -18 },
    files: [["G_Synth_Loop_01.wav", "GB", { volume: -8 }], ["G_Synth_Loop_04.wav", "GB", { volume: -10 }],
      ["G_Synth_Loop_40.wav", "G"], ["G_Synth_Loop_17_(Triplet).wav", "T"], ["G_Synth_Loop_21_(Triplet).wav", "TB"],
      ["G_Synth_Loop_26_(Triplet).wav", "T", { volume: -10 }]] },
  { name: "Impacts", color: "#b23a3a",
    props: { mode: "oneshot", on_tag_change: true, density: 0.35, bars: 4, reverb: -12, volume: -6 },
    files: [["MB3_IMPACT_Dark_01 One-Shot.wav", "GTB"], ["MB3_IMPACT_Dark_02 One-Shot.wav", "GTB"],
      ["MB3_BOOM_01 One-Shot.wav", "B"], ["MB3_BOOM_02 One-Shot.wav", "B"]] },
]
const PROJECT_PROPS = {
  tempo: 138, tempo_tol: 6, beats_x_bar: "4", tag_range: [5, 6],
  delay: { type: "pingpong", division: "8n.", feedback: 0.35, level: -3 },
  reverb: { ir: "RoomHuge", level: 0 },
  master: -6,
  comp: { on: true, amount: 0.5, low: 1, mid: 0, high: 1 },
}
// otros proyectos del demo (galería y lista de proyectos): pistas de TRACKS por nombre, con sus archivos que tengan
// alguno de los tags del proyecto (y solo esos tags). Se crean con un ts más nuevo: la app abre primero el más viejo,
// así /?autostart=1 sigue abriendo PROJECT_NAME
const EXTRA_PROJECTS = [
  { name: "Triplet Night", tags: "T", tracks: ["Kick", "Drums", "Bass", "Lead"],
    props: { tempo: 140, tag_range: [6, 7] } },
  { name: "Breakdown Sketch", tags: "B", tracks: ["Bass", "Lead", "Impacts"],
    props: { tempo: 136, tag_range: [6, 6], comp: { on: false, amount: 0.5, low: 0, mid: 0, high: 0 } } },
]
// en la galería del sandbox solo se ven los proyectos del demo: los demás quedan ocultos (hidden = 1, como si los
// hubiera ocultado el admin), para que las capturas no muestren proyectos ni nombres de otros usuarios
const HIDE_OTHER_PROJECTS = true
// los demás usuarios quedan anónimos en la copia (nombre artist_<n>, email artist_<n>@example.com, sin bio): el
// catálogo (IMPORT) muestra el creador de cada archivo, y en las capturas no tienen que verse nombres reales
const ANONYMIZE_OTHER_USERS = true
const TRG_DEFAULT_PROPS = { volume: 0, pan: 0, rest: 0, rest_len: [4, 4], mode: "loop", on_tag_change: false,
  density: 0, bars: 1, reverb: null, delay: null, fx: [] }

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repo_storage = path.join(repo, "storage")

// comparación de rutas en Windows: sin distinguir mayúsculas
function same_path(a, b) {
  let na = path.resolve(a), nb = path.resolve(b)
  return process.platform == "win32" ? na.toLowerCase() == nb.toLowerCase() : na == nb
}
function inside(child, parent) {
  let rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}
function fail(text) {
  console.error("manual_sandbox: " + text)
  process.exit(1)
}
const fwd = p => p.replace(/\\/g, "/")

async function main() {
  let sandbox = path.resolve(process.argv[2] || process.env.LOOPER_SANDBOX || path.join(os.tmpdir(), "looper_manual_sandbox"))
  if (inside(sandbox, repo)) fail(`el sandbox tiene que estar fuera del repo (${sandbox})`)
  let src_db = path.join(repo_storage, "db.sqlite")
  let src_audio = path.join(repo_storage, "audio")
  if (!fs.existsSync(src_db) || !fs.existsSync(src_audio)) fail("falta storage/db.sqlite o storage/audio en el repo")
  let src_env = path.join(repo, "backend", ".env")
  if (!fs.existsSync(src_env)) fail("falta backend/.env (ver docs/INSTALACION.md / AGENTS.md)")

  let dst_storage = path.join(sandbox, "storage")
  let dst_db = path.join(dst_storage, "db.sqlite")
  let dst_audio = path.join(dst_storage, "audio")
  // la base que se va a tocar nunca puede ser la del repo
  if (same_path(dst_db, src_db) || inside(dst_storage, repo_storage)) fail("la base destino es la del repo: no se toca")

  // copia fresca (solo se borra storage/ DENTRO del sandbox)
  fs.mkdirSync(sandbox, { recursive: true })
  fs.rmSync(dst_storage, { recursive: true, force: true })
  fs.mkdirSync(dst_storage, { recursive: true })
  fs.copyFileSync(src_db, dst_db)
  // si la base está en modo WAL (backend de desarrollo corriendo), también sus archivos -wal / -shm
  for (let ext of ["-wal", "-shm"]) {
    if (fs.existsSync(src_db + ext)) fs.copyFileSync(src_db + ext, dst_db + ext)
  }
  fs.cpSync(src_audio, dst_audio, { recursive: true })
  console.log("Copia de storage/ en", dst_storage)

  // .env del sandbox: el de backend/ línea por línea, cambiando solo db_file y storage_path (no se imprime)
  let lines = fs.readFileSync(src_env, "utf8").split(/\r?\n/)
  let seen = { db_file: false, storage_path: false }
  lines = lines.map(line => {
    let m = /^\s*(db_file|storage_path)\s*=/.exec(line)
    if (!m) return line
    seen[m[1]] = true
    return m[1] == "db_file" ? "db_file=" + fwd(dst_db) : "storage_path=" + fwd(dst_audio) + "/"
  })
  if (!seen.db_file) lines.push("db_file=" + fwd(dst_db))
  if (!seen.storage_path) lines.push("storage_path=" + fwd(dst_audio) + "/")
  fs.writeFileSync(path.join(sandbox, ".env"), lines.join("\n"))
  console.log("Escrito", path.join(sandbox, ".env"), "(db_file y storage_path apuntan a la copia)")

  // última verificación antes de escribir: la ruta que abre knex
  if (same_path(dst_db, src_db) || inside(dst_db, repo)) fail("la base destino es la del repo: no se toca")
  let knex = Knex({ client: "better-sqlite3", useNullAsDefault: false, connection: { filename: dst_db } })
  try {
    await make_demo(knex)
  } finally {
    await knex.destroy()
  }
  console.log(`\nListo. Backend: cd "${sandbox}" && node "${path.join(repo, "backend", "index.js")}"`)
  console.log(`Login de demo: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
}

async function make_demo(knex) {
  let ts = new Date().toISOString().slice(0, 19)
  // la copia es fresca, pero por las dudas: si ya había un demo (otra corrida sobre la misma base) se rehace
  let old = await knex("users").where({ email: DEMO_EMAIL }).orWhere({ name: DEMO_NAME }).select("id")
  for (let u of old) {
    let pids = (await knex("projects").where({ user_id: u.id }).select("id")).map(p => p.id)
    await knex("project_files").whereIn("project_id", pids).del()
    await knex("user_track_groups").whereIn("project_id", pids).del()
    await knex("user_tags").whereIn("project_id", pids).del()
    await knex("projects").whereIn("id", pids).del()
    await knex("users").where({ id: u.id }).del()
  }

  let user_id = uuid()
  await knex("users").insert({
    id: user_id, email: DEMO_EMAIL, name: DEMO_NAME, password: bcrypt.hashSync(DEMO_PASSWORD, 10), ts,
    bytes_used: 0, status: "active", role: "user", bio: DEMO_BIO,
  })
  let missing = new Set()
  let count = await make_project(knex, user_id, PROJECT_NAME, PROJECT_PROPS, ts, "GTB", TRACKS, missing)
  console.log(`Usuario ${DEMO_NAME} (${DEMO_EMAIL}), proyecto "${PROJECT_NAME}": ${TRACKS.length} pistas, ` +
    `${TAGS.length} tags, ${count} archivos`)
  let later = new Date(Date.now() + 60000)
  for (let x of EXTRA_PROJECTS) {
    later = new Date(later.getTime() + 60000)
    let tracks = TRACKS.filter(t => x.tracks.includes(t.name))
    let n = await make_project(knex, user_id, x.name, { ...PROJECT_PROPS, ...x.props }, later.toISOString().slice(0, 19),
      x.tags, tracks, missing)
    console.log(`Proyecto "${x.name}": ${tracks.length} pistas, ${n} archivos`)
  }
  if (HIDE_OTHER_PROJECTS) {
    let n = await knex("projects").whereNot({ user_id }).update({ hidden: 1 })
    console.log(`Ocultos en la galería del sandbox: ${n} proyectos de otros usuarios`)
  }
  if (ANONYMIZE_OTHER_USERS) {
    let others = await knex("users").whereNot({ id: user_id }).orderBy("ts").select("id")
    for (let [i, u] of others.entries()) {
      await knex("users").where({ id: u.id }).update({ name: `artist_${i + 1}`, email: `artist_${i + 1}@example.com`,
        bio: null })
    }
    console.log(`Anónimos en el sandbox: ${others.length} usuarios (artist_<n>)`)
  }
  if (missing.size) console.log("Archivos que no están en el catálogo (salteados):", [...missing].join(", "))
}

// un proyecto del demo: tags (claves de TAGS en tag_keys) y pistas; de cada pista, los archivos con alguno de esos
// tags (y solo esos). Devuelve cuántos archivos quedaron
async function make_project(knex, user_id, name, props, ts, tag_keys, tracks, missing) {
  let project_id = uuid()
  await knex("projects").insert({ id: project_id, user_id, name, hidden: 0, props: JSON.stringify(props), ts })

  let tag_ids = {}
  for (let t of TAGS.filter(t => tag_keys.includes(t.key))) {
    tag_ids[t.key] = uuid()
    await knex("user_tags").insert({ id: tag_ids[t.key], user_id, project_id, name: t.name, color: t.color,
      weight: t.weight })
  }

  let count = 0
  for (let tr of tracks) {
    let trg_id = uuid()
    await knex("user_track_groups").insert({ id: trg_id, user_id, project_id, name: tr.name, color: tr.color,
      props: JSON.stringify({ ...TRG_DEFAULT_PROPS, ...tr.props }) })
    for (let [file_name, tags, extra] of tr.files) {
      let keys = [...tags].filter(k => tag_ids[k])
      if (!keys.length) continue
      // del catálogo: disponible (no oculto); si hay varios con el mismo nombre, el más viejo
      let f = await knex("files").where({ original_name: file_name, hidden: 0 }).orderBy("ts").first("id")
      if (!f) {
        missing.add(file_name)
        continue
      }
      await knex("project_files").insert({ id: uuid(), project_id, file_id: f.id, track_group: trg_id,
        tags: JSON.stringify(keys.map(k => tag_ids[k])),
        props: JSON.stringify({ volume: -6, weight: 16, ...extra }) })
      count++
    }
  }
  return count
}

await main()
