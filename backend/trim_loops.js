// Corta los loops de un proyecto que repiten el mismo patrón en todo su largo (un bajo de 32 beats que es 8 veces
// el mismo compás) a su período real, y sube props.repeat para que suene lo mismo: pesan una fracción en RAM
// (todo se decodifica al cargar) y en cuota. Análisis en loop_period.js; procedimiento en docs/LIBRERIAS.md
// ("Acortar loops que se repiten"). Se corre a mano desde backend/, en cuatro pasos:
//   1. servidor (solo lectura):  node trim_loops.js export --user=<email> --project=<nombre o id> > estado.json
//   2. local:  node trim_loops.js analyze <estado.json> <fuentes.json> <dir> [--min-beats=8] [--listen]
//      fuentes.json: { "<original_name>": "<wav original>" } (rutas relativas a fuentes.json). Escribe
//      <dir>/plan.json y <dir>/tabla.md (decisión por loop: cortar / casi / variación / no cortar); con --listen,
//      <dir>/escuchar/ con A (original) y B (el corte repetido al mismo largo) de los casi y las variaciones.
//   3. local:  node trim_loops.js cut <dir>/plan.json [--accept=cortar,casi]
//      Corta los primeros P beats exactos del wav original (sin fundido: la costura es la del bloque 2 → 1) y los
//      convierte con utils.convert con la medición del original (misma ganancia que en la importación).
//      Escribe <dir>/trim.json y <dir>/mp3/.
//   4. servidor:  node trim_loops.js apply --user=<email> <dir>/trim.json [--dry-run]
//      Copia cada mp3 con un id nuevo (el audio se sirve immutable) y en una transacción cambia files (id,
//      duration, size, beats, bpm, loudness, peak), project_files (file_id y props.repeat), files.parent_id de las
//      copias del editor, reports.target_id y users.bytes_used; después borra los mp3 viejos. Los archivos con
//      región o anchor propio en algún proyecto no se tocan (se avisa). Si ya tiene los beats nuevos, se saltea.
import * as dotenv from "dotenv"
import fs from "fs/promises"
import fs_sync from "fs"
import path from "path"
import child_process from "child_process"
import Knex from "knex"
import { v4 as uuid } from "uuid"
import ffmpeg_static from "ffmpeg-static"
import utils from "./utils.js"
import { analyze_loop, decide, block_level, cut_length, trim_repeat, THRESHOLDS } from "./loop_period.js"

const SR = 44100
const SOURCE_MAX_DIFF = 0.01 // s: el wav de fuentes.json tiene que durar lo mismo que el archivo importado
const CONVERTED_MAX_DIFF = 0.1 // s: el mp3 mide un poco más por el relleno del encoder (ver import_manifest.js)
const RAM_PER_SECOND = 2 * 4 * SR // estéreo float32 decodificado en el navegador
const REGION_PROPS = ["region_beats", "region_secs", "nudge", "fade"]

global.config = dotenv.config().parsed || {}
const args = process.argv.slice(2)
const opt = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const positional = args.filter(a => !a.startsWith("--"))
const [command, ...files] = positional
const dry_run = args.includes("--dry-run")

const ffmpeg = () => global.config.path_to_ffmpeg || ffmpeg_static

function decode(file) {
  let raw = child_process.execFileSync(ffmpeg(), ["-nostdin", "-v", "error", "-i", file, "-ac", "2", "-ar", String(SR), "-f", "f32le", "-"],
    { maxBuffer: 1 << 30, windowsHide: true })
  let il = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length))
  let n = il.length / 2
  let ch = [new Float32Array(n), new Float32Array(n)]
  for (let i = 0; i < n; i++) {
    ch[0][i] = il[2 * i]
    ch[1][i] = il[2 * i + 1]
  }
  return ch
}

// escribe canales como wav float (codec "pcm_f32le") o mp3 de escucha ("libmp3lame")
function encode(ch, dest, codec) {
  let n = ch[0].length
  let buf = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    buf[2 * i] = ch[0][i]
    buf[2 * i + 1] = ch[1][i]
  }
  let out = codec == "libmp3lame" ? ["-c:a", codec, "-q:a", "2"] : ["-c:a", codec]
  child_process.execFileSync(ffmpeg(), ["-v", "error", "-y", "-f", "f32le", "-ar", String(SR), "-ac", "2", "-i", "-", ...out, dest],
    { input: Buffer.from(buf.buffer), maxBuffer: 1 << 30, windowsHide: true })
}

function open_db() {
  if (!global.config.storage_path || !global.config.db_file) throw new Error("Faltan storage_path o db_file en .env (correr desde backend/)")
  return Knex({ client: "better-sqlite3", useNullAsDefault: false, connection: { filename: global.config.db_file } })
}

const json_props = s => {
  try {
    return JSON.parse(s || "{}") || {}
  } catch {
    return {}
  }
}

// ---------- 1. export ----------
async function cmd_export() {
  let email = opt("user")?.trim().toLowerCase()
  let project_ref = opt("project")?.trim()
  if (!email || !project_ref) throw new Error("Uso: node trim_loops.js export --user=<email> --project=<nombre o id>")
  let knex = open_db()
  try {
    let user = await knex("users").select("id", "email").where({ email }).first()
    if (!user) throw new Error(`No existe el usuario ${email}`)
    let project = await knex("projects").select("id", "name").where({ user_id: user.id })
      .andWhere(q => q.where({ id: project_ref }).orWhere({ name: project_ref })).first()
    if (!project) throw new Error(`El usuario no tiene el proyecto ${project_ref}`)
    let rows = await knex("project_files as pf").join("files as f", "f.id", "pf.file_id")
      .leftJoin("user_track_groups as g", "g.id", "pf.track_group")
      .where({ "pf.project_id": project.id, "f.kind": "loop", "f.user_id": user.id })
      .select("f.id", "f.original_name", "f.beats", "f.duration", "f.size", "g.name as track", "pf.props")
      .orderBy("f.original_name")
    let loops = rows.map(r => ({ ...r, props: json_props(r.props) }))
    console.log(JSON.stringify({ user, project, loops }, null, 1))
  } finally {
    await knex.destroy()
  }
}

// ---------- 2. analyze ----------
const short_name = n => n.replace(/\.(wav|mp3|aiff?|flac|ogg|m4a)$/i, "")

async function cmd_analyze() {
  let [state_file, sources_file, dir] = files
  if (!state_file || !sources_file || !dir) throw new Error("Uso: node trim_loops.js analyze <estado.json> <fuentes.json> <dir> [--min-beats=8] [--listen]")
  let min_beats = Number(opt("min-beats") ?? 1)
  let state = JSON.parse(await fs.readFile(state_file, "utf8"))
  let sources = JSON.parse(await fs.readFile(sources_file, "utf8"))
  let sources_dir = path.dirname(path.resolve(sources_file))
  await fs.mkdir(dir, { recursive: true })
  let loops = []
  for (let [i, f] of state.loops.entries()) {
    let label = `[${i + 1}/${state.loops.length}] ${f.original_name}`
    let src = sources[f.original_name] && path.resolve(sources_dir, sources[f.original_name])
    if (!src || !fs_sync.existsSync(src)) {
      console.log(label, "sin original en fuentes.json → salteado")
      continue
    }
    let chs = decode(src)
    let samples = chs[0].length
    if (Math.abs(samples / SR - f.duration) > SOURCE_MAX_DIFF) {
      console.log(label, `el original dura ${(samples / SR).toFixed(3)} s y el archivo ${f.duration} s → salteado`)
      continue
    }
    let a = analyze_loop(chs, SR, f.beats, { min_beats })
    let d = decide(a)
    let c = a.candidates.find(c => c.P == d.P)
    let blocks = (c?.blocks ?? []).map(b => ({
      k: b.k, level: block_level(b), worst: +Math.max(...b.spec_beats).toFixed(1), spec: +b.spec.toFixed(1),
      wave: b.wave == null ? null : +b.wave.toFixed(1),
    }))
    loops.push({ id: f.id, original_name: f.original_name, track: f.track, beats: f.beats, duration: f.duration, size: f.size, src, samples, ...d, blocks })
    console.log(label, f.beats, "→", d.P ?? "-", d.decision, "·", d.reason)
  }
  let plan = { user: state.user, project: state.project, min_beats, thresholds: THRESHOLDS, loops }
  await fs.writeFile(path.join(dir, "plan.json"), JSON.stringify(plan, null, 1))
  await fs.writeFile(path.join(dir, "tabla.md"), table(loops))
  console.log(table(loops).split("\n").filter(l => l.startsWith("| ") && !/^\| \d/.test(l)).join("\n"))
  if (args.includes("--listen")) await listen(loops, path.join(dir, "escuchar"))
}

// tabla markdown por loop y resumen del ahorro por decisión
function table(loops) {
  let out = ["| # | archivo | pista | beats | peor beat por bloque (dB) | decisión | motivo |", "|---|---|---|---|---|---|---|"]
  let sum = {}
  for (let [i, l] of loops.entries()) {
    out.push(`| ${i + 1} | ${short_name(l.original_name)} | ${l.track ?? ""} | ${l.beats} → ${l.P ?? l.beats} | ${l.blocks.map(b => b.worst.toFixed(0)).join(" ")} | ${l.decision} | ${l.reason} |`)
    let s = (sum[l.decision] ??= { n: 0, before: 0, after: 0 })
    s.n++
    s.before += l.duration
    s.after += l.P ? l.duration * l.P / l.beats : l.duration
  }
  out.push("", "| decisión | loops | s antes | s después | ahorro s | ahorro RAM |", "|---|---|---|---|---|---|")
  for (let [d, s] of Object.entries(sum)) {
    out.push(`| ${d} | ${s.n} | ${s.before.toFixed(0)} | ${s.after.toFixed(0)} | ${(s.before - s.after).toFixed(0)} | ${((s.before - s.after) * RAM_PER_SECOND / 1e6).toFixed(0)} MB |`)
  }
  return out.join("\n") + "\n"
}

// A/B para escuchar: A = original, B = los primeros P beats repetidos hasta el mismo largo (como lo toca el motor)
async function listen(loops, dir) {
  await fs.mkdir(dir, { recursive: true })
  for (let [i, l] of loops.entries()) {
    if (!l.P || !["casi", "variación"].includes(l.decision)) continue
    let chs = decode(l.src)
    let len = cut_length(l.samples, l.beats, l.P)
    let tiled = chs.map(c => Float32Array.from(c, (_, j) => c[j % len]))
    let base = path.join(dir, `${String(i + 1).padStart(3, "0")} ${short_name(l.original_name)} (${l.decision} ${l.beats}→${l.P})`)
    encode(chs, base + " A original.mp3", "libmp3lame")
    encode(tiled, base + " B cortado.mp3", "libmp3lame")
  }
  console.log("A/B para escuchar en", dir)
}

// ---------- 3. cut ----------
async function cmd_cut() {
  let [plan_file] = files
  if (!plan_file) throw new Error("Uso: node trim_loops.js cut <dir>/plan.json [--accept=cortar,casi]")
  let accept = (opt("accept") ?? "cortar").split(",")
  let plan = JSON.parse(await fs.readFile(plan_file, "utf8"))
  let dir = path.dirname(path.resolve(plan_file))
  await fs.mkdir(path.join(dir, "wav"), { recursive: true })
  await fs.mkdir(path.join(dir, "mp3"), { recursive: true })
  let todo = plan.loops.filter(l => l.P && accept.includes(l.decision))
  let entries = []
  for (let [i, l] of todo.entries()) {
    let label = `[${i + 1}/${todo.length}] ${l.original_name}`
    let chs = decode(l.src)
    if (chs[0].length != l.samples) throw new Error(`${label}: el original cambió desde el análisis`)
    let len = cut_length(l.samples, l.beats, l.P)
    let wav = path.join(dir, "wav", `${i + 1}.wav`)
    let mp3 = path.join(dir, "mp3", `${i + 1}.mp3`)
    encode(chs.map(c => c.slice(0, len)), wav, "pcm_f32le")
    let measured = await utils.measure_loudness(l.src)
    let conv = await utils.convert(wav, mp3, measured)
    let info = await utils.probe(mp3)
    let duration = len / SR
    if (Math.abs(info.duration - duration) > CONVERTED_MAX_DIFF) throw new Error(`${label}: el mp3 dura ${info.duration} s y el corte ${duration} s`)
    let m = await utils.measure_ebur128(mp3)
    let size = (await fs.stat(mp3)).size
    entries.push({
      original_name: l.original_name, old_beats: l.beats, old_duration: l.duration, beats: l.P, duration,
      file: path.relative(dir, mp3).replace(/\\/g, "/"), size, loudness: m.loudness, peak: m.peak, decision: l.decision,
    })
    console.log(label, `${l.beats} → ${l.P} beats, ${l.duration.toFixed(2)} → ${duration.toFixed(2)} s, ganancia ${conv.gain} dB, ${m.loudness} LUFS`)
  }
  let out = { user: plan.user, project: plan.project, entries }
  await fs.writeFile(path.join(dir, "trim.json"), JSON.stringify(out, null, 1))
  let saved = entries.reduce((a, e) => a + e.old_duration - e.duration, 0)
  console.log(`${entries.length} cortes en ${path.join(dir, "trim.json")}; ahorro ${saved.toFixed(0)} s (~${(saved * RAM_PER_SECOND / 1e6).toFixed(0)} MB de RAM)`)
}

// ---------- 4. apply ----------
async function cmd_apply() {
  let email = opt("user")?.trim().toLowerCase()
  let [trim_file] = files
  if (!email || !trim_file) throw new Error("Uso: node trim_loops.js apply --user=<email> <dir>/trim.json [--dry-run]")
  let trim = JSON.parse(await fs.readFile(trim_file, "utf8"))
  let dir = path.dirname(path.resolve(trim_file))
  let knex = open_db()
  try {
    let user = await knex("users").select("id", "bytes_used").where({ email }).first()
    if (!user) throw new Error(`No existe el usuario ${email}`)
    let plan = []
    let count = { apply: 0, skipped: 0, warned: 0 }
    for (let e of trim.entries) {
      let label = e.original_name
      let found = await knex("files").select("id", "kind", "beats", "duration", "size").where({ user_id: user.id, original_name: e.original_name })
      if (found.length != 1) throw new Error(`${label}: ${found.length} archivos con ese nombre`)
      let f = found[0]
      if (f.kind == "loop" && f.beats == e.beats && Math.abs(f.duration - e.duration) < 1e-3) {
        console.log(label, "ya cortado → salteado")
        count.skipped++
        continue
      }
      if (f.kind != "loop" || f.beats != e.old_beats || Math.abs(f.duration - e.old_duration) > SOURCE_MAX_DIFF) {
        throw new Error(`${label}: en la base es ${f.kind} de ${f.beats} beats y ${f.duration} s; el corte es de ${e.old_beats} beats y ${e.old_duration} s`)
      }
      let rows = await knex("project_files").select("id", "project_id", "props").where({ file_id: f.id })
      let region = rows.filter(r => {
        let p = json_props(r.props)
        return REGION_PROPS.some(k => p[k] != null) || typeof p.anchor == "number"
      })
      if (region.length) {
        console.log(label, `tiene región o anchor propio en ${region.length} proyecto(s) → NO se toca, revisar a mano`)
        count.warned++
        continue
      }
      let mp3 = path.resolve(dir, e.file)
      if ((await fs.stat(mp3)).size != e.size) throw new Error(`${label}: el mp3 ${mp3} no es el del corte`)
      let pf = rows.map(r => {
        let p = json_props(r.props)
        let t = trim_repeat(p.repeat, e.old_beats, e.beats)
        return { id: r.id, props: { ...p, repeat: t.repeat }, how: t.how, before: p.repeat }
      })
      plan.push({ e, f, mp3, new_id: uuid(), pf })
      let reps = pf.map(p => `${JSON.stringify(p.before ?? null)}→${JSON.stringify(p.props.repeat)} (${p.how})`).join(", ")
      console.log(label, `${f.beats} → ${e.beats} beats, ${f.duration.toFixed(2)} → ${e.duration.toFixed(2)} s, ${f.size} → ${e.size} bytes; repeat ${reps || "sin proyectos"}`)
    }
    let delta = plan.reduce((a, p) => a + p.e.size - p.f.size, 0)
    let saved = plan.reduce((a, p) => a + p.f.duration - p.e.duration, 0)
    console.log(`${dry_run ? "[dry-run] " : ""}${plan.length} a cortar, ${count.skipped} ya cortados, ${count.warned} con región (sin tocar); ` +
      `${saved.toFixed(0)} s menos, bytes_used ${delta >= 0 ? "+" : ""}${delta}`)
    if (dry_run || !plan.length) return

    let copied = []
    try {
      await fs.mkdir(global.config.storage_path + user.id, { recursive: true })
      for (let p of plan) {
        await fs.copyFile(p.mp3, utils.audio_path(user.id, p.new_id))
        copied.push(utils.audio_path(user.id, p.new_id))
      }
      await knex.transaction(async trx => {
        for (let p of plan) {
          await trx("files").where({ id: p.f.id }).update({
            id: p.new_id, duration: p.e.duration, size: p.e.size, beats: p.e.beats,
            bpm: utils.loop_bpm(p.e.beats, p.e.duration), loudness: p.e.loudness, peak: p.e.peak,
          })
          for (let r of p.pf) await trx("project_files").where({ id: r.id }).update({ file_id: p.new_id, props: JSON.stringify(r.props) })
          await trx("files").where({ parent_id: p.f.id }).update({ parent_id: p.new_id })
          await trx("reports").where({ target_type: "file", target_id: p.f.id }).update({ target_id: p.new_id })
        }
        await trx("users").where({ id: user.id }).update({ bytes_used: trx.raw("max(coalesce(bytes_used, 0) + ?, 0)", [delta]) })
      })
    } catch (err) {
      for (let c of copied) await fs.rm(c, { force: true })
      throw err
    }
    for (let p of plan) await fs.rm(utils.audio_path(user.id, p.f.id), { force: true })
    let left = await knex("project_files").whereIn("file_id", plan.map(p => p.f.id)).count({ n: "*" }).first()
    let now = await knex("project_files").whereIn("file_id", plan.map(p => p.new_id)).count({ n: "*" }).first()
    console.log(`Hecho: ${plan.length} archivos con id nuevo; project_files con ids viejos ${left.n}, con nuevos ${now.n}. ` +
      "El dueño tiene que recargar la app (una pestaña vieja pisa los cambios)")
    console.log("ids nuevos (para GET /api/file/<id>):", plan.slice(0, 3).map(p => p.new_id).join(" "))
  } finally {
    await knex.destroy()
  }
}

const COMMANDS = { export: cmd_export, analyze: cmd_analyze, cut: cmd_cut, apply: cmd_apply }
if (!COMMANDS[command]) {
  console.log("Uso: node trim_loops.js export | analyze | cut | apply ... (ver la cabecera del archivo)")
  process.exit(1)
}
COMMANDS[command]().catch(err => {
  console.error(err.message)
  process.exit(1)
})
