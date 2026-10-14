// Importa audios en lote a la cuenta de un usuario (por ejemplo, una librería de loops entera), con
// la misma conversión que /upload (MP3 V0 normalizado, ver utils.convert). Se corre a mano desde
// backend/ (con el .env del backend), en el servidor o en local:
//   node import_manifest.js --user=<email> [--project=<nombre>] [--ignore-quota] [--dry-run] <manifest.json>
// El manifiesto es un array JSON; las rutas son relativas a su directorio:
//   [{ "file": "kit01/loop.wav", "original_name": "loop.wav", "kind": "loop" | "shot",
//      "bpm": 140, "beats": 16, "music_key": "C#" | "atonal" | "" }]
// Solo `file` es obligatorio. original_name: default el nombre del archivo. kind: default "loop". En
// un loop manda `beats`; si no, beats = round(duración × bpm / 60); sin ninguno de los dos, el
// archivo se saltea. El bpm guardado se deduce de los beats, como en /upload. music_key: si no viene,
// se sugiere por original_name (utils.suggest_key); "" = sin dato.
// Chequeos como en /upload: es audio, dura hasta 60 s, bpm en 20..400 y la cuota del usuario (salvo
// --ignore-quota). Con --project, los archivos se agregan a ese proyecto del usuario (sin pista ni
// tags); si no existe un proyecto con ese nombre, se crea.
// Idempotente: saltea los que el usuario ya tiene con el mismo original_name (y los agrega al
// proyecto si faltan ahí). De a un archivo; un error en uno no corta el resto.
'use strict'
import * as dotenv from 'dotenv'
import fs from 'fs/promises'
import path from 'path'
import Knex from 'knex'
import { v4 as uuid } from 'uuid'
import utils from './utils.js'

const MAX_SECONDS = 60
const SECONDS_MARGIN = 0.1
const BPM_MIN = 20
const BPM_MAX = 400
const BEATS_MAX = 1024
const DEFAULT_MAX_SECONDS = 1200

let config = dotenv.config()
global.config = config.parsed || {}
if (!global.config.storage_path || !global.config.db_file) {
  console.log("Faltan storage_path o db_file en .env (correr desde backend/)")
  process.exit(1)
}

let args = process.argv.slice(2)
let opt = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
let dry_run = args.includes("--dry-run")
let ignore_quota = args.includes("--ignore-quota")
let email = opt("user")?.trim().toLowerCase()
let project_name = opt("project")?.trim()
let manifest_file = args.find(a => !a.startsWith("--"))
if (!email || !manifest_file) {
  console.log("Uso: node import_manifest.js --user=<email> [--project=<nombre>] [--ignore-quota] [--dry-run] <manifest.json>")
  process.exit(1)
}

const knex = Knex({
  client: 'better-sqlite3',
  useNullAsDefault: false,
  connection: { filename: global.config.db_file }
})

function now() {
  return new Date().toISOString().slice(0, 19)
}

// tipo y tempo de una entrada del manifiesto: { kind, beats, bpm } o { error }
function timing(entry, duration) {
  let kind = entry.kind ?? "loop"
  if (kind == "shot") return { kind, beats: null, bpm: null }
  if (kind != "loop") return { error: `kind inválido: ${kind}` }
  let beats = entry.beats != null ? Number(entry.beats) : null
  if (beats == null && entry.bpm != null) beats = Math.max(1, Math.round(duration * Number(entry.bpm) / 60))
  if (!Number.isInteger(beats) || beats < 1 || beats > BEATS_MAX) return { error: "sin beats ni bpm válidos" }
  let bpm = utils.loop_bpm(beats, duration)
  if (bpm < BPM_MIN || bpm > BPM_MAX) return { error: `con ${beats} beats queda en ${bpm} BPM` }
  return { kind, beats, bpm }
}

async function main() {
  let manifest = JSON.parse(await fs.readFile(manifest_file, "utf8"))
  if (!Array.isArray(manifest)) throw new Error("El manifiesto tiene que ser un array")
  let base_dir = path.dirname(path.resolve(manifest_file))

  let user = await knex("users").select("id", "max_seconds", "status").where({ email: email }).first()
  if (!user) throw new Error(`No existe el usuario ${email}`)
  if (user.status != "active") throw new Error(`El usuario ${email} no está activo`)
  let max = user.max_seconds ?? (Number(global.config.default_max_seconds) || DEFAULT_MAX_SECONDS)
  let used = Number((await knex("files").sum({ s: "duration" }).where({ user_id: user.id }).first())?.s) || 0

  let project = null
  if (project_name) {
    project = await knex("projects").select("id").where({ user_id: user.id, name: project_name }).first()
    if (!project && !dry_run) {
      project = { id: uuid(), user_id: user.id, name: project_name, props: "{}", ts: now() }
      await knex("projects").insert(project)
      console.log(`Proyecto creado: ${project_name}`)
    } else if (!project) {
      console.log(`Se crearía el proyecto ${project_name}`)
    }
  }
  let in_project = new Set(project
    ? (await knex("project_files").select("file_id").where({ project_id: project.id })).map(r => r.file_id) : [])
  let existing = new Map((await knex("files").select("id", "original_name").where({ user_id: user.id }))
    .map(r => [r.original_name, r.id]))

  async function add_to_project(file_id) {
    if (!project || in_project.has(file_id) || dry_run) return
    await knex("project_files").insert({
      id: uuid(), project_id: project.id, file_id: file_id, track_group: null, tags: "[]", props: "{}",
    })
    in_project.add(file_id)
  }

  console.log(`${dry_run ? "[dry-run] " : ""}${manifest.length} entradas para ${email}; cuota usada ${Math.round(used)} de ${max} s`)
  let count = { done: 0, skipped: 0, errors: 0, seconds: 0 }
  let dir = global.config.storage_path + user.id
  if (!dry_run) await fs.mkdir(dir, { recursive: true })

  for (let [i, entry] of manifest.entries()) {
    let file = path.resolve(base_dir, String(entry.file ?? ""))
    let name = entry.original_name ?? path.basename(file)
    let label = `[${i + 1}/${manifest.length}] ${name}`
    try {
      if (existing.has(name)) {
        await add_to_project(existing.get(name))
        console.log(label, "ya existe → salteado")
        count.skipped++
        continue
      }
      let info = await utils.probe(file)
      if (!info.is_audio) throw new Error("no es audio")
      if (info.duration > MAX_SECONDS + SECONDS_MARGIN) throw new Error(`dura ${info.duration.toFixed(1)} s`)
      let t = timing(entry, info.duration)
      if (t.error) throw new Error(t.error)
      let music_key = entry.music_key === undefined ? utils.suggest_key(name)
        : (String(entry.music_key).trim() === "" ? null : utils.normalize_key(entry.music_key))
      if (music_key === null && entry.music_key) throw new Error(`tonalidad inválida: ${entry.music_key}`)
      if (!ignore_quota && used + info.duration > max) throw new Error("no alcanza la cuota")
      let desc = `${t.kind} ${t.beats ?? ""}${t.beats ? " beats " + t.bpm + " BPM" : ""} key=${music_key ?? "-"} ${info.duration.toFixed(2)} s`
      if (dry_run) {
        console.log(label, desc, "→ se importaría")
      } else {
        let id = uuid()
        let out_file = dir + "/" + id + ".mp3"
        try {
          await utils.convert(file, out_file)
          let size = (await fs.stat(out_file)).size
          await knex.transaction(async trx => {
            await trx("files").insert({
              id: id, user_id: user.id, original_name: name, size: size, tags: "[]", duration: info.duration,
              kind: t.kind, bpm: t.bpm, beats: t.beats, music_key: music_key, ts: now(),
            })
            await trx("users").where({ id: user.id }).update({ bytes_used: trx.raw("coalesce(bytes_used, 0) + ?", [size]) })
          })
        } catch (e) {
          await fs.unlink(out_file).catch(() => { })
          throw e
        }
        existing.set(name, id)
        await add_to_project(id)
        console.log(label, desc, "→ importado")
      }
      used += info.duration
      count.seconds += info.duration
      count.done++
    } catch (e) {
      console.log(label, "ERROR", e.message)
      count.errors++
    }
  }
  console.log(`${dry_run ? "Se importarían" : "Importados"} ${count.done} (${Math.round(count.seconds)} s), salteados ${count.skipped}, errores ${count.errors}`)
}

main()
  .catch(e => {
    console.log("ERROR", e.message)
    process.exitCode = 1
  })
  .finally(() => knex.destroy())
