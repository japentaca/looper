// Normaliza el loudness de los audios ya subidos (los nuevos se normalizan en /upload, ver utils.convert).
// Se corre a mano, una vez, desde backend/ (con el .env del backend):
//   node normalize_existing.js --dry-run              solo informa lo que haría
//   node normalize_existing.js [--backup-dir=<dir>]   recodifica los que hagan falta
// Recorre los archivos de la tabla `files`, mide cada mp3 (storage_path/<user_id>/<id>.mp3) y si la
// ganancia necesaria supera ±0,5 dB lo recodifica (salvo el sobrepico
// del encoder, ver needs_normalize) normalizado (-18 LUFS / -1 dBTP, ganancia fija):
// copia el original al directorio de respaldo (por defecto <storage_path>/../../backups/
// audio_pre_normalize_<fecha>/<user_id>/<id>.mp3), escribe a un temporal al lado y lo renombra encima
// (reemplazo atómico). Actualiza files.size y al final recalcula users.bytes_used = sum(files.size).
// No toca duration ni los volúmenes de project_files. De a un archivo.
// Idempotente: saltea los que ya tienen respaldo en algún audio_pre_normalize_* del mismo directorio de
// respaldos (con --backup-dir, conviene que el directorio también se llame audio_pre_normalize_<algo>)
// y los que no superan el umbral.
'use strict'
import * as dotenv from 'dotenv'
import fs from 'fs/promises'
import path from 'path'
import Knex from 'knex'
import utils from './utils.js'

const THRESHOLD_DB = 0.5
const TARGET_I = -18

// ¿hace falta recodificar? Sí si la ganancia supera el umbral, salvo que sea una baja chica en un
// archivo que ya está en o por debajo del objetivo y no pasa de 0 dBTP: es el sobrepico que agrega el
// encoder mp3 a uno limitado por pico (tras normalizarlo, la nueva medición da TP algo mayor a -1);
// sin esta excepción cada corrida lo volvería a bajar
function needs_normalize(m, gain) {
  if (Math.abs(gain) <= THRESHOLD_DB) return false
  if (gain < 0 && m.input_i <= TARGET_I + THRESHOLD_DB && m.input_tp <= 0) return false
  return true
}

let config = dotenv.config()
global.config = config.parsed || {}
if (!global.config.storage_path || !global.config.db_file) {
  console.log("Faltan storage_path o db_file en .env (correr desde backend/)")
  process.exit(1)
}

let dry_run = process.argv.includes("--dry-run")
let backup_arg = process.argv.find(a => a.startsWith("--backup-dir="))
let stamp = new Date().toISOString().replace(/[:.]/g, "-")
let backup_dir = backup_arg
  ? path.resolve(backup_arg.slice("--backup-dir=".length))
  : path.resolve(global.config.storage_path, "..", "..", "backups", "audio_pre_normalize_" + stamp)

const knex = Knex({
  client: 'better-sqlite3',
  useNullAsDefault: false,
  connection: { filename: global.config.db_file }
})

function fmt(n) {
  return n == null ? "?" : n.toFixed(1)
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

// archivos ya normalizados en corridas anteriores: los que tienen respaldo en algún
// audio_pre_normalize_* del mismo directorio de respaldos (claves "<user_id>/<id>")
async function previously_done() {
  let done = new Set()
  let root = path.dirname(backup_dir)
  let runs = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (let run of runs) {
    if (!run.isDirectory() || !run.name.startsWith("audio_pre_normalize_")) continue
    let users = await fs.readdir(path.join(root, run.name), { withFileTypes: true }).catch(() => [])
    for (let u of users) {
      if (!u.isDirectory()) continue
      for (let f of await fs.readdir(path.join(root, run.name, u.name)).catch(() => [])) {
        if (f.endsWith(".mp3")) done.add(u.name + "/" + f.slice(0, -4))
      }
    }
  }
  return done
}

async function main() {
  console.log(dry_run ? "Modo --dry-run: no se modifica nada" : "Respaldo de originales en " + backup_dir)
  let done_before = await previously_done()
  let files = await knex("files").select("id", "user_id", "size", "original_name").orderBy("ts")
  let count = { total: files.length, done: 0, skipped: 0, missing: 0, errors: 0, bytes_before: 0, bytes_after: 0 }
  for (let [i, f] of files.entries()) {
    let label = `[${i + 1}/${files.length}] ${f.user_id}/${f.id} (${f.original_name})`
    let file = utils.audio_path(f.user_id, f.id)
    if (!await exists(file)) {
      console.log(label, "FALTA el mp3")
      count.missing++
      continue
    }
    if (done_before.has(f.user_id + "/" + f.id)) {
      console.log(label, "ya normalizado en una corrida anterior → sin cambios")
      count.skipped++
      continue
    }
    try {
      let m = await utils.measure_loudness(file)
      let gain = utils.loudness_gain(m)
      let info = `I=${fmt(m.input_i)} LUFS TP=${fmt(m.input_tp)} dBTP ganancia=${gain} dB`
      if (!needs_normalize(m, gain)) {
        console.log(label, info, "→ sin cambios")
        count.skipped++
        continue
      }
      if (dry_run) {
        console.log(label, info, "→ se normalizaría")
        count.done++
        continue
      }
      // respaldo del original (si ya está de una corrida anterior con el mismo directorio, no se pisa)
      let backup = path.join(backup_dir, f.user_id, f.id + ".mp3")
      await fs.mkdir(path.dirname(backup), { recursive: true })
      if (!await exists(backup)) await fs.copyFile(file, backup)
      let tmp = file + ".normalize_tmp"
      try {
        await utils.convert(file, tmp, m)
        await fs.rename(tmp, file)
      } catch (e) {
        await fs.unlink(tmp).catch(() => { })
        throw e
      }
      let size = (await fs.stat(file)).size
      await knex("files").update({ size: size }).where({ id: f.id, user_id: f.user_id })
      count.bytes_before += f.size || 0
      count.bytes_after += size
      console.log(label, info, `→ normalizado (${f.size} → ${size} bytes)`)
      count.done++
    } catch (e) {
      console.log(label, "ERROR", e.message)
      count.errors++
    }
  }
  if (!dry_run && count.done > 0) {
    // bytes_used es informativo: se recalcula entero desde files.size
    await knex("users").update({
      bytes_used: knex("files").sum("size").whereRaw("files.user_id = users.id")
    })
    await knex("users").whereNull("bytes_used").update({ bytes_used: 0 })
    console.log("users.bytes_used recalculado")
  }
  console.log(`Total ${count.total}: ${dry_run ? "a normalizar" : "normalizados"} ${count.done}, sin cambios ${count.skipped}, ` +
    `faltan ${count.missing}, errores ${count.errors}` +
    (dry_run ? "" : `; bytes de los normalizados ${count.bytes_before} → ${count.bytes_after}`))
}

try {
  await main()
} finally {
  await knex.destroy()
}
