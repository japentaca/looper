import express from 'express'
var router = express.Router()
export default router
import fs from "fs/promises"
import os from "os"
import path from "path"
import bcrypt from 'bcrypt'
import { v4 as uuid } from "uuid"
import fileUpload from 'express-fileupload'
import utils from "../utils.js"



// chequeo de sesión en cada request: con sesión, se leen `status` y `role` de la base (no de la
// copia de la sesión), así bloquear a alguien corta su sesión en el request siguiente. Si el
// usuario no existe o no está `active`, la sesión se destruye (regenerate: borra la de Redis y deja
// una vacía que no se guarda) y el request sigue sin sesión: los endpoints que la piden
// (`require_session`) responden 401 y get_user_info responde { stat: false }.
// Con sesión válida deja `req.user = { id, role }`.
router.use(async (req, res, next) => {
  if (!req.session?.isLogged) return next()
  try {
    let id = req.session.u_info?.id
    let user = id ? await global.knex("users").select("status", "role").where({ id: id }).first() : null
    if (user?.status === "active") {
      req.user = { id: id, role: user.role }
      return next()
    }
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()))
    next()
  } catch (e) {
    console.log("Error chequeando la sesión", e)
    res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// para endpoints que piden sesión (activa: la valida el middleware de arriba)
function require_session(req, res, next) {
  if (!req.user) return res.status(401).send({ stat: false, text: "Sin sesión" })
  next()
}

// para endpoints de admin: el rol sale de la base en cada request (middleware de arriba)
export function require_admin(req, res, next) {
  if (!req.user) return res.status(401).send({ stat: false, text: "Sin sesión" })
  if (req.user.role !== "admin") return res.status(403).send({ stat: false, text: "Sin permiso" })
  next()
}

// intentos de login fallidos por IP: a partir de LOGIN_MAX_FAILS se bloquea por LOGIN_BLOCK_S
const LOGIN_MAX_FAILS = 10
const LOGIN_BLOCK_S = 15 * 60

router.post('/login', async function (req, res) {
  //res.send(200, 'piden login')
  //console.log("piden login", req.body)
  // los emails se guardan en minúsculas (migración y registro): se compara igual
  var email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : ""
  var password = typeof req.body.password === "string" ? req.body.password : ""
  let fails_key = "looper_login_fails:" + req.ip
  try {
    if (!email || !password) {
      res.status(200).send({ stat: false, text: "Por favor ingrese email o clave" })
      return
    }
    let fails = Number(await global.redisClient.get(fails_key)) || 0
    if (fails >= LOGIN_MAX_FAILS) {
      res.status(200).send({ stat: false, text: "Demasiados intentos, probá de nuevo en 15 minutos" })
      return
    }

    var db_res = await global.knex("users").select().where({ email: email })
    var isValid = db_res[0] !== undefined && await bcrypt.compare(password, db_res[0].password)
    // el estado se mira solo con la clave ya validada. `blocked` (y cualquier estado desconocido)
    // responde y cuenta igual que una clave inválida, para no revelar que la cuenta existe
    if (isValid && db_res[0].status === "pending") {
      await global.redisClient.del(fails_key)
      res.status(200).send({ stat: false, text: "Tu cuenta está pendiente de aprobación" })
      return
    }
    if (isValid && db_res[0].status !== "active") isValid = false
    if (!isValid) {
      // el bloqueo dura LOGIN_BLOCK_S desde el primer fallo
      if (await global.redisClient.incr(fails_key) == 1) await global.redisClient.expire(fails_key, LOGIN_BLOCK_S)
      res.status(200).send({ stat: false, text: "Usuario o clave inválida" })
      return
    } else {
      await global.redisClient.del(fails_key)
      // sesión nueva al loguearse (evita fijar un id de sesión de antemano). En la sesión solo
      // queda el id: estado, rol y datos se leen de la base en cada request
      await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()))
      req.session.isLogged = true
      req.session.u_info = { id: db_res[0].id }
      await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()))
      let ui = await return_user_info(db_res[0].id)
      var res_data = {
        stat: true,
        data: {
          u_info: ui,
          text: "Ingreso al sistema"
        }
      }
      res.status(200).send(res_data)
    }

  } catch (e) {

    res.status(500).send({ stat: false, text: "Error interno" })
    console.log("Error", e)
  }

})

// registro público: la cuenta queda `pending` hasta que la admita un admin.
// Intentos por IP (con datos válidos): a partir de REGISTER_MAX se rechaza por REGISTER_WINDOW_S
const REGISTER_MAX = 10
const REGISTER_WINDOW_S = 60 * 60
const REGISTER_OK_TEXT = "Solicitud recibida: tu cuenta queda pendiente de aprobación"
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// nombre público: letras, números, espacio, punto, guion y guion bajo
const NAME_RE = /^[\p{L}\p{N} ._-]+$/u
const BIO_MAX = 280
const PASSWORD_TEXT = "La clave debe tener entre 8 y 72 caracteres"

// clave nueva (registro y cambio de clave): 8 a 72; bcrypt solo usa los primeros 72 bytes
function valid_password(password) {
  return typeof password === "string" && password.length >= 8 && Buffer.byteLength(password) <= 72
}

router.post('/register', async (req, res) => {
  let body = req.body || {}
  let email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  let password = typeof body.password === "string" ? body.password : ""
  let name = typeof body.name === "string" ? body.name.trim() : ""
  let bio = typeof body.bio === "string" ? body.bio.trim() : ""

  // validación (no cuenta para el límite por IP)
  if (!EMAIL_RE.test(email) || email.length > 254) return res.send({ stat: false, text: "Email inválido" })
  if (!valid_password(password)) return res.send({ stat: false, text: PASSWORD_TEXT })
  if ([...name].length < 3 || [...name].length > 32 || !NAME_RE.test(name)) {
    return res.send({ stat: false, text: "El nombre debe tener entre 3 y 32 caracteres (letras, números, espacio, punto, guion o guion bajo)" })
  }
  if ([...bio].length > BIO_MAX) return res.send({ stat: false, text: `La bio puede tener hasta ${BIO_MAX} caracteres` })
  if (body.accept_license !== true) return res.send({ stat: false, text: "Hay que aceptar la licencia" })

  let key = "looper_register:" + req.ip
  try {
    let n = await global.redisClient.incr(key)
    // la ventana dura REGISTER_WINDOW_S desde el primer intento
    if (n == 1) await global.redisClient.expire(key, REGISTER_WINDOW_S)
    if (n > REGISTER_MAX) return res.send({ stat: false, text: "Demasiados intentos, probá de nuevo más tarde" })

    // el hash se calcula siempre (también con email repetido) para que el tiempo de respuesta no
    // delate si el email ya está registrado
    let hash = await bcrypt.hash(password, 10)
    // nombre único sin distinguir mayúsculas (el índice de la base sí las distingue)
    let name_taken = await global.knex("users").whereRaw("lower(name) = lower(?)", [name]).first()
    if (name_taken) return res.send({ stat: false, text: "Ese nombre ya está en uso" })
    // email repetido: misma respuesta que el éxito, sin tocar la cuenta existente
    let email_taken = await global.knex("users").where({ email: email }).first()
    if (email_taken) return res.send({ stat: true, text: REGISTER_OK_TEXT })

    try {
      await global.knex("users").insert({
        id: uuid(),
        email: email,
        password: hash,
        name: name,
        bio: bio || null,
        status: "pending",
        role: "user",
        ts: new Date().toISOString().slice(0, 19),
      })
    } catch (e) {
      // carrera con otro registro simultáneo: lo resuelven los índices únicos
      if (e.code !== "SQLITE_CONSTRAINT_UNIQUE") throw e
      if (String(e.message).includes("users.name")) return res.send({ stat: false, text: "Ese nombre ya está en uso" })
    }
    return res.send({ stat: true, text: REGISTER_OK_TEXT })
  } catch (e) {
    console.log("Error register", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// cambio de clave del propio usuario: pide la actual. Los fallos con la actual se cuentan por
// usuario (no por IP, para no bloquear el login de otros en la misma red): a partir de
// PWCHANGE_MAX_FAILS se rechaza por PWCHANGE_BLOCK_S. La sesión actual sigue abierta.
const PWCHANGE_MAX_FAILS = 10
const PWCHANGE_BLOCK_S = 15 * 60

router.put('/change_password', require_session, async (req, res) => {
  let body = req.body || {}
  let current = typeof body.current_password === "string" ? body.current_password : ""
  let password = typeof body.new_password === "string" ? body.new_password : ""
  if (!current) return res.send({ stat: false, text: "Falta la clave actual" })
  if (!valid_password(password)) return res.send({ stat: false, text: PASSWORD_TEXT })

  let fails_key = "looper_pwchange_fails:" + req.user.id
  try {
    let fails = Number(await global.redisClient.get(fails_key)) || 0
    if (fails >= PWCHANGE_MAX_FAILS) {
      return res.send({ stat: false, text: "Demasiados intentos, probá de nuevo en 15 minutos" })
    }
    let user = await global.knex("users").select("password").where({ id: req.user.id }).first()
    let ok = user && await bcrypt.compare(current, user.password)
    if (!ok) {
      // el bloqueo dura PWCHANGE_BLOCK_S desde el primer fallo
      if (await global.redisClient.incr(fails_key) == 1) await global.redisClient.expire(fails_key, PWCHANGE_BLOCK_S)
      return res.send({ stat: false, text: "La clave actual es incorrecta" })
    }
    await global.redisClient.del(fails_key)
    let hash = await bcrypt.hash(password, 10)
    await global.knex("users").update({ password: hash }).where({ id: req.user.id })
    return res.send({ stat: true, text: "Clave cambiada" })
  } catch (e) {
    console.log("Error change_password", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// perfil público del propio usuario: por ahora solo la bio (el nombre no se cambia)
router.put('/profile', require_session, async (req, res) => {
  let body = req.body || {}
  if (typeof body.bio !== "string" && body.bio !== null) return res.status(400).send({ stat: false, text: "Datos inválidos" })
  let bio = (body.bio || "").trim()
  if ([...bio].length > BIO_MAX) return res.send({ stat: false, text: `La bio puede tener hasta ${BIO_MAX} caracteres` })
  try {
    await global.knex("users").update({ bio: bio || null }).where({ id: req.user.id })
    return res.send({ stat: true })
  } catch (e) {
    console.log("Error profile", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// ---------- admin de usuarios ----------

// columnas de `users` que ve el admin (nunca `password` ni `props`)
const ADMIN_USER_COLUMNS = ["id", "email", "name", "bio", "status", "role", "max_seconds", "bytes_used", "ts"]
const USER_STATUSES = ["pending", "active", "blocked"]
// acciones de estado: de qué estados se puede partir y a cuál se llega
const ADMIN_STATUS_ACTIONS = {
  admit: { from: ["pending"], to: "active" },
  reject: { from: ["pending"], to: "blocked" },
  block: { from: ["active"], to: "blocked" },
  unblock: { from: ["blocked"], to: "active" },
}
// tope de max_seconds (un día de audio): solo para frenar valores absurdos
const MAX_SECONDS_LIMIT = 24 * 60 * 60

// lista de usuarios, filtrable por estado (?status=pending|active|blocked; sin status o vacío: todos)
router.get('/admin/users', require_admin, async (req, res) => {
  let status = req.query.status
  if (status !== undefined && status !== "" && !USER_STATUSES.includes(status)) {
    return res.status(400).send({ stat: false, text: "Estado inválido" })
  }
  try {
    let q = global.knex("users").select(ADMIN_USER_COLUMNS).orderBy("ts", "desc")
    if (status) q.where({ status: status })
    return res.send({ stat: true, data: await q })
  } catch (e) {
    console.log("Error admin/users", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// una acción sobre un usuario: body { action, password?, max_seconds? }
//  admit (pending → active), reject (pending → blocked), block (active → blocked),
//  unblock (blocked → active), reset_password (con `password`), set_max_seconds (con `max_seconds`,
//  entero >= 0 o null = default). Los cambios de estado no se aplican a usuarios `admin` (evita que
//  el admin se bloquee a sí mismo). Responde el usuario actualizado (sin hash).
router.put('/admin/users/:id', require_admin, async (req, res) => {
  let id = req.params.id
  let body = req.body || {}
  let action = body.action
  try {
    let user = await global.knex("users").select("id", "status", "role").where({ id: id }).first()
    if (!user) return res.status(404).send({ stat: false, text: "Usuario inexistente" })

    if (ADMIN_STATUS_ACTIONS[action]) {
      let { from, to } = ADMIN_STATUS_ACTIONS[action]
      if (user.role === "admin") return res.send({ stat: false, text: "No se puede cambiar el estado de un admin" })
      // update condicionado al estado de partida (si cambió entre la lectura y acá, no se aplica)
      let n = await global.knex("users").update({ status: to }).where({ id: id }).whereIn("status", from)
      if (n == 0) return res.send({ stat: false, text: `No se puede aplicar "${action}" a un usuario ${user.status}` })
    } else if (action === "reset_password") {
      if (!valid_password(body.password)) return res.send({ stat: false, text: PASSWORD_TEXT })
      let hash = await bcrypt.hash(body.password, 10)
      await global.knex("users").update({ password: hash }).where({ id: id })
      // la clave nueva no hereda los fallos de cambio de clave anteriores
      await global.redisClient.del("looper_pwchange_fails:" + id)
    } else if (action === "set_max_seconds") {
      let s = body.max_seconds
      if (s !== null && !(Number.isInteger(s) && s >= 0 && s <= MAX_SECONDS_LIMIT)) {
        return res.send({ stat: false, text: `La cuota debe ser un entero de 0 a ${MAX_SECONDS_LIMIT} segundos, o null (default)` })
      }
      await global.knex("users").update({ max_seconds: s }).where({ id: id })
    } else {
      return res.status(400).send({ stat: false, text: "Acción inválida" })
    }

    let data = await global.knex("users").select(ADMIN_USER_COLUMNS).where({ id: id }).first()
    return res.send({ stat: true, data: data })
  } catch (e) {
    console.log("Error admin/users/:id", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// ---------- moderación (tarea 5.1) ----------
// El admin modera, no edita: cierra o descarta denuncias, oculta o desoculta un archivo o un
// proyecto puntual (reversible, sin cascada: un archivo oculto queda fuera del catálogo, de los
// proyectos públicos y del sorteo, con available = false) y ve estadísticas. Todo con require_admin.

const REPORT_STATUSES = ["open", "resolved", "dismissed"]
const ADMIN_REPORTS_LIMIT = 500

// query de denuncias con los datos del target (archivo o proyecto, si todavía existe), de su dueño y
// del denunciante. Las denuncias sobre algo ya borrado quedan con las columnas del target en null
function admin_reports_query(db) {
  return db("reports as r")
    .leftJoin("users as ru", "ru.id", "r.reporter_user_id")
    .leftJoin("files as f", function () {
      this.on("f.id", "r.target_id").andOnVal("r.target_type", "=", "file")
    })
    .leftJoin("projects as p", function () {
      this.on("p.id", "r.target_id").andOnVal("r.target_type", "=", "project")
    })
    .leftJoin("users as ou", "ou.id", db.raw("coalesce(f.user_id, p.user_id)"))
    .select(["r.id", "r.target_type", "r.target_id", "r.reason", "r.status", "r.ts",
      "r.reporter_user_id", "ru.name as reporter_name",
      "f.id as file_id", "f.original_name as file_name", "f.hidden as file_hidden",
      "p.id as project_id", "p.name as project_name", "p.hidden as project_hidden",
      "ou.id as owner_id", "ou.name as owner_name", "ou.status as owner_status"])
}

// fila de admin_reports_query → denuncia para el admin. `target` es null si el archivo o proyecto
// ya no existe
function admin_report_out(r) {
  let target = null
  if (r.target_type === "file" && r.file_id) {
    target = { name: r.file_name, hidden: !!r.file_hidden }
  } else if (r.target_type === "project" && r.project_id) {
    target = { name: r.project_name, hidden: !!r.project_hidden }
  }
  if (target) target.owner = r.owner_id ? { id: r.owner_id, name: r.owner_name, status: r.owner_status } : null
  return {
    id: r.id, target_type: r.target_type, target_id: r.target_id, reason: r.reason, status: r.status, ts: r.ts,
    reporter: { id: r.reporter_user_id, name: r.reporter_name ?? null },
    target: target,
  }
}

// denuncias, las más nuevas primero (hasta ADMIN_REPORTS_LIMIT). ?status=open|resolved|dismissed
// (sin status o vacío: todas)
router.get('/admin/reports', require_admin, async (req, res) => {
  let status = req.query.status
  if (status !== undefined && status !== "" && !REPORT_STATUSES.includes(status)) {
    return res.status(400).send({ stat: false, text: "Estado inválido" })
  }
  try {
    let q = admin_reports_query(global.knex).orderBy([{ column: "r.ts", order: "desc" }, { column: "r.id" }])
      .limit(ADMIN_REPORTS_LIMIT)
    if (status) q.where("r.status", status)
    return res.send({ stat: true, data: (await q).map(admin_report_out) })
  } catch (e) {
    console.log("Error admin/reports", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// cambia el estado de una denuncia: body { status: "resolved" | "dismissed" | "open" } (open la
// reabre). Responde la denuncia actualizada (forma de GET /admin/reports)
router.put('/admin/reports/:id', require_admin, async (req, res) => {
  let status = (req.body || {}).status
  if (!REPORT_STATUSES.includes(status)) {
    return res.status(400).send({ stat: false, text: "status tiene que ser open, resolved o dismissed" })
  }
  let id = String(req.params.id)
  try {
    let n = await global.knex("reports").update({ status: status }).where({ id: id })
    if (n == 0) return res.status(404).send({ stat: false, text: "Denuncia inexistente" })
    let r = await admin_reports_query(global.knex).where("r.id", id).first()
    return res.send({ stat: true, data: admin_report_out(r) })
  } catch (e) {
    console.log("Error admin/reports/:id", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// oculta (true) o desoculta (false) un archivo o un proyecto: body { hidden: bool }. Responde
// { id, name, hidden } (y para archivos `available`, ya con el cambio)
router.put('/admin/files/:id/hidden', require_admin, async (req, res) => {
  let hidden = (req.body || {}).hidden
  if (typeof hidden !== "boolean") return res.status(400).send({ stat: false, text: "hidden tiene que ser true o false" })
  let id = String(req.params.id)
  try {
    let n = await global.knex("files").update({ hidden: hidden ? 1 : 0 }).where({ id: id })
    if (n == 0) return res.status(404).send(FILE_NOT_FOUND)
    let [f] = await get_catalog_files(global.knex, [id])
    return res.send({ stat: true, data: { id: f.id, name: f.original_name, hidden: !!f.hidden, available: file_available(f) } })
  } catch (e) {
    console.log("Error admin/files/:id/hidden", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

router.put('/admin/projects/:id/hidden', require_admin, async (req, res) => {
  let hidden = (req.body || {}).hidden
  if (typeof hidden !== "boolean") return res.status(400).send({ stat: false, text: "hidden tiene que ser true o false" })
  let id = String(req.params.id)
  try {
    let n = await global.knex("projects").update({ hidden: hidden ? 1 : 0 }).where({ id: id })
    if (n == 0) return res.status(404).send(PROJECT_NOT_FOUND)
    let p = await global.knex("projects").select("id", "name", "hidden").where({ id: id }).first()
    return res.send({ stat: true, data: { id: p.id, name: p.name, hidden: !!p.hidden } })
  } catch (e) {
    console.log("Error admin/projects/:id/hidden", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// estadísticas: tráfico de audio del mes UTC en curso (tabla `traffic`), disco de storage_path,
// usuarios por estado, archivos, proyectos y denuncias abiertas
router.get('/admin/stats', require_admin, async (req, res) => {
  try {
    let month = new Date().toISOString().slice(0, 7)
    let t = await global.knex("traffic").sum({ bytes: "bytes" }).sum({ requests: "requests" })
      .where("id", "like", month + "-%").first()

    let s = await fs.statfs(global.config.storage_path)
    let min_free_gb = config_number("disk_min_free_gb", DEFAULT_DISK_MIN_FREE_GB)
    let free_bytes = s.bavail * s.bsize

    let users = { pending: 0, active: 0, blocked: 0 }
    for (let r of await global.knex("users").select("status").count({ n: "*" }).groupBy("status")) {
      users[r.status ?? "null"] = Number(r.n) || 0
    }
    let count = async (table, where) => {
      let q = global.knex(table).count({ n: "*" })
      if (where) q.where(where)
      return Number((await q.first()).n) || 0
    }
    return res.send({
      stat: true,
      data: {
        traffic: { month: month, bytes: Number(t?.bytes) || 0, requests: Number(t?.requests) || 0 },
        disk: {
          free_bytes: free_bytes, total_bytes: s.blocks * s.bsize, min_free_gb: min_free_gb,
          uploads_allowed: free_bytes >= min_free_gb * 1024 * 1024 * 1024,
        },
        users: users,
        files: { total: await count("files"), hidden: await count("files", { hidden: 1 }) },
        projects: {
          total: await count("projects"),
          hidden: await count("projects", { hidden: 1 }),
        },
        reports: { open: await count("reports", { status: "open" }) },
      },
    })
  } catch (e) {
    console.log("Error admin/stats", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})


// ---------- proyectos ----------
// Un solo dueño por proyecto: toda query filtra por projects.user_id = req.user.id y un proyecto
// ajeno (o inexistente) responde 404, sin distinguir. Las pistas (user_track_groups) y tags
// (user_tags) son del proyecto (`project_id`); los archivos se asocian por project_files.
// `save_trackGroups` / `save_tags` se eliminaron: borraban todas las filas del usuario (de todos sus
// proyectos) y reinsertaban sin project_id. Los reemplazan PUT /projects/:id/track_groups y /tags.

const PROJECT_NAME_MAX = 64
const PROJECT_NOT_FOUND = { stat: false, text: "Proyecto inexistente" }
// config del proyecto (projects.props): solo se guardan estas claves (lista blanca), el resto se ignora
const PROJECT_PROPS_KEYS = ["tempo", "tempo_tol", "beats_x_bar", "tag_range", "delay"]
const PROPS_MAX_LENGTH = 4096 // tamaño de las columnas props

// Segundos de audio de un proyecto, para que el frontend estime la memoria que ocupa cargarlo
// (estimate_seconds_memory en composable.js). Los archivos sin duración medida (no debería pasar
// después de migrate_file_durations) se estiman por el tamaño del mp3 a 128 kbps, como el frontend.
const FALLBACK_BYTES_X_SECOND = 128000 / 8
const AUDIO_SECONDS_SQL = `coalesce(sum(coalesce(f.duration, f.size / ${FALLBACK_BYTES_X_SECOND}.0)), 0)`
function file_audio_seconds(f) {
  let d = Number(f.duration)
  if (Number.isFinite(d) && d > 0) return d
  return (Number(f.size) || 0) / FALLBACK_BYTES_X_SECOND
}

// columnas de la lista de proyectos (sin props: eso viene con GET /projects/:id), con la cantidad
// de archivos y sus segundos de audio (todos los del proyecto: el editor los carga todos)
const PROJECT_FILES_SQL = "from project_files pf join files f on f.id = pf.file_id where pf.project_id = p.id"
function project_list_columns(db) {
  return ["p.id", "p.name", "p.hidden", "p.ts",
    db.raw(`(select count(*) ${PROJECT_FILES_SQL}) as files_count`),
    db.raw(`(select ${AUDIO_SECONDS_SQL} ${PROJECT_FILES_SQL}) as audio_seconds`)]
}

// proyectos del usuario, del más viejo al más nuevo
async function list_projects(user_id) {
  let rows = await global.knex("projects as p").select(project_list_columns(global.knex))
    .where({ "p.user_id": user_id }).orderBy([{ column: "p.ts" }, { column: "p.name" }])
  return rows.map(project_summary)
}
// un proyecto del usuario en la forma de la lista (undefined si no es suyo)
async function get_project_summary(id, user_id) {
  let r = await global.knex("projects as p").select(project_list_columns(global.knex))
    .where({ "p.id": String(id), "p.user_id": user_id }).first()
  return r && project_summary(r)
}
function project_summary(r) {
  return {
    id: r.id, name: r.name, hidden: !!r.hidden, ts: r.ts,
    files_count: Number(r.files_count) || 0, audio_seconds: Number(r.audio_seconds) || 0,
  }
}

// el proyecto `id` si es del usuario; si no, undefined (→ 404)
async function own_project(db, id, user_id) {
  return await db("projects").select().where({ id: String(id), user_id: user_id }).first()
}

// nombre de proyecto: string recortado de 1 a PROJECT_NAME_MAX; undefined si es inválido
function parse_project_name(v) {
  if (typeof v !== "string") return undefined
  let name = v.trim()
  return name && [...name].length <= PROJECT_NAME_MAX ? name : undefined
}
const PROJECT_NAME_TEXT = `El nombre del proyecto debe tener entre 1 y ${PROJECT_NAME_MAX} caracteres`

// props del proyecto (lista blanca) serializadas; undefined si no es un objeto o es demasiado grande
function serialize_project_props(body) {
  if (!body || typeof body != "object" || Array.isArray(body)) return undefined
  let props = {}
  for (let k of PROJECT_PROPS_KEYS) {
    if (body[k] !== undefined) props[k] = body[k]
  }
  let text = JSON.stringify(props)
  return text.length <= PROPS_MAX_LENGTH ? text : undefined
}

router.get("/projects", require_session, async (req, res) => {
  try {
    return res.send({ stat: true, data: await list_projects(req.user.id) })
  } catch (e) {
    console.log("Error projects", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// crea un proyecto vacío: body { name, props? }. Responde el proyecto (forma de la lista)
router.post("/projects", require_session, async (req, res) => {
  let body = req.body || {}
  let name = parse_project_name(body.name)
  if (name === undefined) return res.send({ stat: false, text: PROJECT_NAME_TEXT })
  let props = serialize_project_props(body.props ?? {})
  if (props === undefined) return res.status(400).send({ stat: false, text: "Datos inválidos" })
  let row = {
    id: uuid(),
    user_id: req.user.id,
    name: name,
    props: props,
    ts: new Date().toISOString().slice(0, 19),
  }
  try {
    await global.knex("projects").insert(row)
    return res.send({ stat: true, data: project_summary(row) })
  } catch (e) {
    console.log("Error POST projects", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// ---------- archivos (catálogo) y archivos en proyectos ----------
// `files` es el catálogo global (un archivo = un mp3 con su dueño); `project_files` es el uso de un
// archivo en un proyecto (pista, tags y volumen). Un archivo está como mucho una vez por proyecto.
// Un archivo está disponible si no lo ocultó el admin y su dueño está activo (no bloqueado): los no
// disponibles siguen en los proyectos que ya los usan (available = false, fuera del sorteo), pero no
// se pueden importar.

// columnas de `files` que se devuelven (más el estado del dueño, para calcular `available`)
const FILE_COLUMNS = ["f.id", "f.user_id", "f.original_name", "f.size", "f.duration", "f.kind", "f.bpm",
  "f.beats", "f.music_key", "f.ts", "f.hidden", "u.status as owner_status"]
const FILE_NAME_MAX = 128
const FILE_ID_MAX = 36
// props de un archivo en un proyecto (project_files.props): solo estas claves (lista blanca)
const PROJECT_FILE_PROPS_KEYS = ["volume", "weight"]
// peso en el sorteo (de un archivo en el proyecto o de un Tag): entero 0..WEIGHT_MAX; 0 = no sale nunca
const WEIGHT_MAX = 32
function valid_weight(v) {
  return Number.isInteger(v) && v >= 0 && v <= WEIGHT_MAX
}
const FILE_NOT_FOUND = { stat: false, text: "Archivo inexistente" }

function file_available(r) {
  return !r.hidden && r.owner_status === "active"
}

// archivo del catálogo como lo ve el usuario `user_id` (sin user_id ni el estado del dueño)
function file_out(r, user_id) {
  return {
    id: r.id, original_name: r.original_name, size: r.size, duration: r.duration, kind: r.kind ?? "loop",
    bpm: r.bpm, beats: r.beats, music_key: r.music_key ?? null, ts: r.ts, name: r.id + ".mp3", own: r.user_id === user_id,
    available: file_available(r),
  }
}

// tonalidad que viene en un body (subida o PUT /files/:id): vacío → null (sin dato); "atonal" o una
// tonalidad en cualquier grafía (utils.normalize_key) → forma canónica; undefined si es inválida
function parse_music_key(v) {
  if (v === null || String(v).trim() === "") return null
  return utils.normalize_key(v) ?? undefined
}
const MUSIC_KEY_ERROR = "Tonalidad inválida: una nota (C, C#, Db... B) con \"m\" si es menor, \"atonal\" o vacío"

// archivos de un proyecto: los del catálogo más su pista, tags y props dentro del proyecto
async function list_project_files(db, project_id, user_id) {
  let rows = await db("project_files as pf")
    .join("files as f", "f.id", "pf.file_id")
    .leftJoin("users as u", "u.id", "f.user_id")
    .select([...FILE_COLUMNS, "pf.track_group", "pf.tags", "pf.props"])
    .where("pf.project_id", project_id)
  return rows.map(r => ({
    ...file_out(r, user_id),
    track_group: r.track_group ?? null, tags: parse_tags(r.tags), props: parse_props(r.props),
  }))
}

// archivos del catálogo por id (con el estado del dueño)
async function get_catalog_files(db, ids) {
  return await db("files as f").leftJoin("users as u", "u.id", "f.user_id")
    .select(FILE_COLUMNS).whereIn("f.id", ids)
}

// proyecto completo: datos, props (config), pistas, tags y archivos (con su pista, tags y volumen
// dentro del proyecto). Es lo que antes venía en get_user_info
router.get("/projects/:id", require_session, async (req, res) => {
  let user_id = req.user.id
  try {
    let p = await own_project(global.knex, req.params.id, user_id)
    if (!p) return res.status(404).send(PROJECT_NOT_FOUND)
    let data = project_summary(p)
    data.props = parse_props(p.props)

    let t = await global.knex("user_track_groups").select("id", "name", "color", "props").where({ project_id: p.id })
    data.track_groups = t.map(r => ({ ...r, props: parse_props(r.props) }))
    data.tags = await global.knex("user_tags").select("id", "name", "color", "weight").where({ project_id: p.id })

    // archivos del catálogo usados en el proyecto (propios o importados), con `own` y `available`
    data.files = await list_project_files(global.knex, p.id, user_id)
    data.files_count = data.files.length
    data.audio_seconds = data.files.reduce((t, f) => t + file_audio_seconds(f), 0)
    return res.send({ stat: true, data: data })
  } catch (e) {
    console.log("Error GET projects/:id", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// edita el proyecto: body { name?, props? } (solo lo que venga). `props` reemplaza la
// config completa (lista blanca). `hidden` no se edita acá (lo modera el admin). Responde el proyecto
router.put("/projects/:id", require_session, async (req, res) => {
  let body = req.body || {}
  let upd = {}
  if (body.name !== undefined) {
    upd.name = parse_project_name(body.name)
    if (upd.name === undefined) return res.send({ stat: false, text: PROJECT_NAME_TEXT })
  }
  if (body.props !== undefined) {
    upd.props = serialize_project_props(body.props)
    if (upd.props === undefined) return res.status(400).send({ stat: false, text: "Datos inválidos" })
  }
  try {
    let p = await own_project(global.knex, req.params.id, req.user.id)
    if (!p) return res.status(404).send(PROJECT_NOT_FOUND)
    if (Object.keys(upd).length) await global.knex("projects").update(upd).where({ id: p.id, user_id: req.user.id })
    return res.send({ stat: true, data: await get_project_summary(p.id, req.user.id) })
  } catch (e) {
    console.log("Error PUT projects/:id", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// borra el proyecto con sus pistas, tags y filas de project_files. Los archivos (catálogo) quedan
router.delete("/projects/:id", require_session, async (req, res) => {
  try {
    let found = await global.knex.transaction(async trx => {
      let p = await own_project(trx, req.params.id, req.user.id)
      if (!p) return false
      await trx("project_files").delete().where({ project_id: p.id })
      await trx("user_track_groups").delete().where({ project_id: p.id })
      await trx("user_tags").delete().where({ project_id: p.id })
      await trx("projects").delete().where({ id: p.id, user_id: req.user.id })
      return true
    })
    if (!found) return res.status(404).send(PROJECT_NOT_FOUND)
    return res.send({ stat: true })
  } catch (e) {
    console.log("Error DELETE projects/:id", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

router.put("/projects/:id/track_groups", require_session, async (req, res) => {
  await replace_project_rows("user_track_groups", req, res)
})
router.put("/projects/:id/tags", require_session, async (req, res) => {
  await replace_project_rows("user_tags", req, res)
})

// columnas que se guardan de cada objeto recibido (lista blanca): los campos que el cliente agrega
// a los objetos (o columnas sin uso como `silences`) se ignoran, si no romperían el insert.
// Las columnas JSON se serializan con JSON.stringify.
const PROJECT_ROWS_COLUMNS = {
  user_track_groups: { columns: ["id", "name", "color", "props"], json: ["props"] },
  user_tags: { columns: ["id", "name", "color", "weight"], json: [] },
}
const ROW_ID_MAX = 36

class RowsError extends Error { }

// reemplaza todas las pistas o tags del proyecto por las recibidas (array con la colección
// completa), en una transacción para no perder la colección si falla un insert. Los ids los genera
// el cliente (uuid) y son únicos en toda la tabla: un id repetido (en el array o usado en otro
// proyecto) responde 400 sin cambiar nada. Las referencias de project_files a pistas o tags que
// ya no están se limpian (pista → null; se quitan de `tags`)
async function replace_project_rows(table, req, res) {
  let rows = req.body
  if (!Array.isArray(rows)) return res.status(400).send({ stat: false, text: "Datos inválidos" })
  let { columns, json } = PROJECT_ROWS_COLUMNS[table]
  let ids = new Set()
  for (let r of rows) {
    if (!r || typeof r != "object" || typeof r.id != "string" || !r.id || r.id.length > ROW_ID_MAX) {
      return res.status(400).send({ stat: false, text: "Datos inválidos: cada elemento necesita un id" })
    }
    if (ids.has(r.id)) return res.status(400).send({ stat: false, text: "Id repetido: " + r.id })
    if (columns.includes("weight") && r.weight !== undefined && !valid_weight(r.weight)) {
      return res.status(400).send({ stat: false, text: `Peso inválido (entero de 0 a ${WEIGHT_MAX}): ` + r.id })
    }
    ids.add(r.id)
  }
  let user_id = req.user.id
  try {
    let found = await global.knex.transaction(async trx => {
      let p = await own_project(trx, req.params.id, user_id)
      if (!p) return false
      // un id que ya existe en otra fila (de otro proyecto o usuario) no se pisa
      let taken = await trx(table).select("id").whereIn("id", [...ids])
        .andWhere(q => q.whereNot({ project_id: p.id }).orWhereNull("project_id"))
      if (taken.length) throw new RowsError("Id ya usado: " + taken[0].id)

      await trx(table).delete().where({ project_id: p.id })
      for (let r of rows) {
        let row = { user_id: user_id, project_id: p.id }
        for (let c of columns) {
          if (r[c] === undefined) continue
          row[c] = json.includes(c) ? JSON.stringify(r[c] ?? {}) : r[c]
        }
        await trx(table).insert(row)
      }

      // limpia en project_files las referencias a filas que ya no están
      let pfs = await trx("project_files").select("id", "track_group", "tags").where({ project_id: p.id })
      for (let pf of pfs) {
        if (table === "user_track_groups") {
          if (pf.track_group && !ids.has(pf.track_group)) {
            await trx("project_files").update({ track_group: null }).where({ id: pf.id })
          }
        } else {
          let tags = parse_tags(pf.tags)
          let kept = tags.filter(t => ids.has(t))
          if (kept.length !== tags.length) {
            await trx("project_files").update({ tags: JSON.stringify(kept) }).where({ id: pf.id })
          }
        }
      }
      return true
    })
    if (!found) return res.status(404).send(PROJECT_NOT_FOUND)
    return res.send({ stat: true })
  } catch (e) {
    if (e instanceof RowsError) return res.status(400).send({ stat: false, text: e.message })
    console.log("Error guardando", table, e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
}

// id de archivo (o de pista/tag) recibido: string no vacío de hasta FILE_ID_MAX
function valid_row_id(v) {
  return typeof v == "string" && v.length > 0 && v.length <= FILE_ID_MAX
}

// campos de un archivo en un proyecto recibidos (solo los presentes): track_group (id o null),
// tags (array de ids, sin repetidos), props (lista blanca; volume = número). Lanza RowsError si algo
// es inválido. Devuelve los valores ya listos para la base
function parse_project_file_fields(o, file_id) {
  let out = {}
  if (o.track_group !== undefined) {
    if (o.track_group !== null && o.track_group !== "" && !valid_row_id(o.track_group)) {
      throw new RowsError("Pista inválida para " + file_id)
    }
    out.track_group = o.track_group || null
  }
  if (o.tags !== undefined) {
    if (!Array.isArray(o.tags) || !o.tags.every(valid_row_id)) throw new RowsError("Tags inválidos para " + file_id)
    out.tags = [...new Set(o.tags)]
  }
  if (o.props !== undefined) {
    if (!o.props || typeof o.props != "object" || Array.isArray(o.props)) throw new RowsError("Props inválidas para " + file_id)
    let props = {}
    for (let k of PROJECT_FILE_PROPS_KEYS) {
      if (o.props[k] !== undefined) props[k] = o.props[k]
    }
    if (props.volume !== undefined && !Number.isFinite(props.volume)) throw new RowsError("Volumen inválido para " + file_id)
    if (props.weight !== undefined && !valid_weight(props.weight)) throw new RowsError("Peso inválido para " + file_id)
    out.props = props
  }
  return out
}

// cambios en los archivos de un proyecto, todos en una transacción (si uno es inválido no se aplica
// ninguno; 400 con el motivo). Body { add?, update?, remove? }:
//  add: [file_id | { id, track_group?, tags?, props? }]  importa archivos del catálogo (propios o
//       ajenos) que estén disponibles y no estén ya en el proyecto
//  update: [{ id, track_group?, tags?, props? }]  edita archivos del proyecto (solo los campos que
//       vengan; props reemplaza las props completas)
//  remove: [file_id]  quita archivos del proyecto (el archivo sigue en el catálogo)
// Un mismo archivo no puede aparecer dos veces en el body. Pista y tags tienen que ser del proyecto.
// Responde los archivos del proyecto ya actualizados (forma de GET /projects/:id)
router.put("/projects/:id/files", require_session, async (req, res) => {
  let body = req.body || {}
  let add = body.add ?? [], update = body.update ?? [], remove = body.remove ?? []
  if (!Array.isArray(add) || !Array.isArray(update) || !Array.isArray(remove)) {
    return res.status(400).send({ stat: false, text: "Datos inválidos" })
  }
  let user_id = req.user.id
  try {
    // validación de forma (sin base)
    let seen = new Set()
    const check_id = id => {
      if (!valid_row_id(id)) throw new RowsError("Datos inválidos: cada archivo necesita un id")
      if (seen.has(id)) throw new RowsError("Archivo repetido: " + id)
      seen.add(id)
    }
    let adds = add.map(a => {
      let o = typeof a == "string" ? { id: a } : a
      if (!o || typeof o != "object") throw new RowsError("Datos inválidos")
      check_id(o.id)
      return { id: o.id, fields: parse_project_file_fields(o, o.id) }
    })
    let updates = update.map(o => {
      if (!o || typeof o != "object") throw new RowsError("Datos inválidos")
      check_id(o.id)
      return { id: o.id, fields: parse_project_file_fields(o, o.id) }
    })
    for (let id of remove) check_id(id)

    let files = await global.knex.transaction(async trx => {
      let p = await own_project(trx, req.params.id, user_id)
      if (!p) return null
      let in_project = new Set((await trx("project_files").select("file_id").where({ project_id: p.id })).map(r => r.file_id))

      // importar: el archivo existe, está disponible y no está ya en el proyecto
      if (adds.length) {
        let catalog = new Map((await get_catalog_files(trx, adds.map(a => a.id))).map(f => [f.id, f]))
        for (let a of adds) {
          let f = catalog.get(a.id)
          if (!f) throw new RowsError("Archivo inexistente: " + a.id)
          if (!file_available(f)) throw new RowsError("Archivo no disponible: " + a.id)
          if (in_project.has(a.id)) throw new RowsError("El archivo ya está en el proyecto: " + a.id)
        }
      }
      for (let id of [...updates.map(u => u.id), ...remove]) {
        if (!in_project.has(id)) throw new RowsError("El archivo no está en el proyecto: " + id)
      }

      // pista y tags tienen que ser de este proyecto
      let trgs = new Set((await trx("user_track_groups").select("id").where({ project_id: p.id })).map(r => r.id))
      let tags = new Set((await trx("user_tags").select("id").where({ project_id: p.id })).map(r => r.id))
      for (let { id, fields } of [...adds, ...updates]) {
        if (fields.track_group && !trgs.has(fields.track_group)) {
          throw new RowsError("La pista no es del proyecto: " + fields.track_group + " (archivo " + id + ")")
        }
        let bad = (fields.tags || []).find(t => !tags.has(t))
        if (bad) throw new RowsError("El tag no es del proyecto: " + bad + " (archivo " + id + ")")
      }

      for (let { id, fields } of adds) {
        await trx("project_files").insert({
          id: uuid(),
          project_id: p.id,
          file_id: id,
          track_group: fields.track_group ?? null,
          tags: JSON.stringify(fields.tags ?? []),
          props: JSON.stringify(fields.props ?? {}),
        })
      }
      for (let { id, fields } of updates) {
        let upd = {}
        if (fields.track_group !== undefined) upd.track_group = fields.track_group
        if (fields.tags !== undefined) upd.tags = JSON.stringify(fields.tags)
        if (fields.props !== undefined) upd.props = JSON.stringify(fields.props)
        if (Object.keys(upd).length) await trx("project_files").update(upd).where({ project_id: p.id, file_id: id })
      }
      if (remove.length) await trx("project_files").delete().where({ project_id: p.id }).whereIn("file_id", remove)

      return await list_project_files(trx, p.id, user_id)
    })
    if (!files) return res.status(404).send(PROJECT_NOT_FOUND)
    return res.send({ stat: true, data: files })
  } catch (e) {
    if (e instanceof RowsError) return res.status(400).send({ stat: false, text: e.message })
    console.log("Error PUT projects/:id/files", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})



router.put('/logout', async (req, res) => {
  if (req.session?.isLogged) {
    req.session.destroy()
  }
  res.clearCookie("looper_sid")
  //console.log("req.session", req.session)
  return res.send({ stat: true })

})

// metadatos de un archivo propio: body { original_name?, kind?, beats?, bpm?, music_key? } (solo lo que
// venga). kind / beats / bpm siguen las reglas de parse_timing (bpm se deduce de beats y la duración);
// music_key, las de parse_music_key.
// Solo el dueño: un archivo ajeno o inexistente responde 404.
// Pista, tags y volumen son de cada proyecto (PUT /projects/:id/files). Responde el archivo
// (forma del catálogo). Reemplaza a save_fileData
router.put('/files/:id', require_session, async (req, res) => {
  let body = req.body || {}
  let upd = {}
  if (body.original_name !== undefined) {
    let name = typeof body.original_name == "string" ? body.original_name.trim() : ""
    if (!name || [...name].length > FILE_NAME_MAX) {
      return res.send({ stat: false, text: `El nombre debe tener entre 1 y ${FILE_NAME_MAX} caracteres` })
    }
    upd.original_name = name
  }
  if (body.music_key !== undefined) {
    upd.music_key = parse_music_key(body.music_key)
    if (upd.music_key === undefined) return res.send({ stat: false, text: MUSIC_KEY_ERROR })
  }
  let user_id = req.user.id
  try {
    let id = String(req.params.id)
    let file = await global.knex("files").select("id", "duration", "kind", "beats").where({ id: id, user_id: user_id }).first()
    if (!file) return res.status(404).send(FILE_NOT_FOUND)
    if (body.kind !== undefined || body.beats !== undefined || body.bpm !== undefined) {
      let t = parse_timing(body, file.duration, file, null)
      if (t.error) return res.send({ stat: false, text: t.error })
      Object.assign(upd, t)
    }
    if (Object.keys(upd).length) await global.knex("files").update(upd).where({ id: id, user_id: user_id })
    let [row] = await get_catalog_files(global.knex, [id])
    return res.send({ stat: true, data: file_out(row, user_id) })
  } catch (e) {
    console.log("Error PUT files/:id", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// borra un archivo propio: en una transacción quita sus filas de project_files en **todos** los
// proyectos (propios y ajenos que lo importaron), la fila de `files` y descuenta su tamaño de
// bytes_used; después borra el mp3. Solo el dueño (ajeno o inexistente → 404). Responde
// { removed_from_projects: n } (filas de project_files borradas). Reemplaza a delete_file
router.delete('/files/:id', require_session, async (req, res) => {
  let user_id = req.user.id
  let id = String(req.params.id)
  try {
    let n = await global.knex.transaction(async trx => {
      let file = await trx("files").select("size").where({ id: id, user_id: user_id }).first()
      if (!file) return null
      let removed = await trx("project_files").delete().where({ file_id: id })
      await trx("files").delete().where({ id: id, user_id: user_id })
      // se descuenta el tamaño del archivo, sin bajar de 0
      await trx("users").where({ id: user_id }).update({
        bytes_used: trx.raw("max(coalesce(bytes_used, 0) - ?, 0)", [file.size || 0])
      })
      return removed
    })
    if (n === null) return res.status(404).send(FILE_NOT_FOUND)
    // el mp3 se borra con la fila ya borrada: si falla, queda un archivo huérfano en disco (inofensivo)
    // en vez de una fila que apunta a un mp3 inexistente. El id viene de la base (es un uuid)
    if (UUID_RE.test(id)) {
      await fs.unlink(global.config.storage_path + user_id + "/" + id + ".mp3").catch(e => {
        if (e.code !== "ENOENT") console.log("Error borrando el mp3", id, e.message)
      })
    }
    return res.send({ stat: true, data: { removed_from_projects: n } })
  } catch (e) {
    console.log("Error DELETE files/:id", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// catálogo: archivos disponibles (no ocultos, dueño activo) de todos los usuarios, para importar.
// Query (todo opcional): bpm + bpm_tol (± tolerancia), beats, key (tónica: trae esa tónica en mayor o
// menor) + atonal=1 (suma los atonales), creator (nombre público exacto, sin distinguir mayúsculas),
// q (texto en el nombre del archivo), page (desde 1) y per_page.
// Cada archivo trae el nombre público y la bio del creador y `uses` (proyectos que lo usan); nunca
// el email ni el id del dueño
const CATALOG_PER_PAGE = 50
const CATALOG_PER_PAGE_MAX = 100
const CATALOG_BPM_TOL = 2
const CATALOG_BPM_TOL_MAX = 50
const CATALOG_TEXT_MAX = 64

// filtros del catálogo leídos de la query: { f } o { error } (texto para el 400)
function parse_catalog_query(query) {
  let get = k => {
    let v = query[k]
    if (v === undefined) return { ok: true, v: "" }
    if (typeof v != "string") return { ok: false }
    return { ok: true, v: v.trim() }
  }
  let f = {}
  for (let k of ["bpm", "bpm_tol", "beats", "key", "atonal", "creator", "q", "page", "per_page"]) {
    let r = get(k)
    if (!r.ok) return { error: `Parámetro inválido: ${k}` }
    f[k] = r.v
  }
  let out = { page: 1, per_page: CATALOG_PER_PAGE }
  if (f.bpm) {
    out.bpm = parse_bpm(f.bpm)
    if (out.bpm === undefined) return { error: `BPM inválido: tiene que ser un número entre ${BPM_MIN} y ${BPM_MAX}` }
    let tol = f.bpm_tol ? Number(f.bpm_tol) : CATALOG_BPM_TOL
    if (!Number.isFinite(tol) || tol < 0 || tol > CATALOG_BPM_TOL_MAX) {
      return { error: `Tolerancia de BPM inválida: tiene que ser un número entre 0 y ${CATALOG_BPM_TOL_MAX}` }
    }
    out.bpm_tol = tol
  }
  if (f.beats) {
    out.beats = parse_beats(f.beats)
    if (out.beats === undefined) return { error: `Beats inválido: tiene que ser un entero entre 1 y ${BEATS_MAX}` }
  }
  if (f.key) {
    // se filtra por tónica: "Gm" o "G" traen los dos modos
    let k = utils.normalize_key(f.key)
    if (!k || k == utils.KEY_ATONAL) return { error: "Tonalidad inválida: tiene que ser una nota (C, C#, Db... B)" }
    out.key = k.replace(/m$/, "")
    if (f.atonal && !["0", "1"].includes(f.atonal)) return { error: "atonal tiene que ser 0 o 1" }
    out.atonal = f.atonal == "1"
  }
  if (f.creator) {
    if ([...f.creator].length > CATALOG_TEXT_MAX) return { error: "Creador inválido" }
    out.creator = f.creator.toLowerCase()
  }
  if (f.q) {
    if ([...f.q].length > CATALOG_TEXT_MAX) return { error: `El texto de búsqueda tiene más de ${CATALOG_TEXT_MAX} caracteres` }
    out.q = f.q
  }
  if (f.page) {
    out.page = Number(f.page)
    if (!Number.isInteger(out.page) || out.page < 1) return { error: "Página inválida" }
  }
  if (f.per_page) {
    out.per_page = Number(f.per_page)
    if (!Number.isInteger(out.per_page) || out.per_page < 1 || out.per_page > CATALOG_PER_PAGE_MAX) {
      return { error: `per_page tiene que ser un entero entre 1 y ${CATALOG_PER_PAGE_MAX}` }
    }
  }
  return { f: out }
}

// escapa los comodines de LIKE (se usa con ESCAPE '\')
function like_escape(s) {
  return s.replace(/[\\%_]/g, c => "\\" + c)
}

// query base del catálogo con los filtros aplicados (solo disponibles: lo mismo que file_available)
function catalog_query(db, f) {
  let qb = db("files as f").join("users as u", "u.id", "f.user_id")
    .where("u.status", "active").andWhere("f.hidden", 0)
  if (f.bpm !== undefined) qb.whereBetween("f.bpm", [f.bpm - f.bpm_tol, f.bpm + f.bpm_tol])
  if (f.beats !== undefined) qb.where("f.beats", f.beats)
  if (f.key !== undefined) {
    let keys = [f.key, f.key + "m"]
    if (f.atonal) keys.push(utils.KEY_ATONAL)
    qb.whereIn("f.music_key", keys)
  }
  if (f.creator !== undefined) qb.whereRaw("lower(u.name) = ?", [f.creator])
  if (f.q !== undefined) qb.whereRaw("f.original_name like ? escape '\\'", ["%" + like_escape(f.q) + "%"])
  return qb
}

router.get('/catalog', require_session, async (req, res) => {
  let { f, error } = parse_catalog_query(req.query || {})
  if (error) return res.status(400).send({ stat: false, text: error })
  let user_id = req.user.id
  try {
    let { total } = await catalog_query(global.knex, f).count({ total: "*" }).first()
    let rows = await catalog_query(global.knex, f)
      .select(["f.id", "f.user_id", "f.original_name", "f.duration", "f.kind", "f.bpm", "f.beats", "f.music_key", "f.ts",
        "u.name as creator_name", "u.bio as creator_bio",
        global.knex.raw("(select count(*) from project_files pf where pf.file_id = f.id) as uses")])
      // los más nuevos primero; los migrados sin ts al final
      .orderByRaw("f.ts is null, f.ts desc, f.id")
      .limit(f.per_page).offset((f.page - 1) * f.per_page)
    let items = rows.map(r => ({
      id: r.id, original_name: r.original_name, duration: r.duration, kind: r.kind ?? "loop", bpm: r.bpm,
      beats: r.beats, music_key: r.music_key ?? null, ts: r.ts, name: r.id + ".mp3", own: r.user_id === user_id,
      uses: Number(r.uses) || 0,
      creator: { name: r.creator_name, bio: r.creator_bio ?? null },
    }))
    return res.send({ stat: true, data: { items: items, total: Number(total) || 0, page: f.page, per_page: f.per_page } })
  } catch (e) {
    console.log("Error GET catalog", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// ---------- público (sin sesión) ----------
// Galería de proyectos públicos y lectura de un proyecto público, para visitantes sin cuenta (y la
// instalación en kiosko). Un proyecto es visible si es `public`, no lo ocultó el admin y su dueño
// está `active`; si no, 404 igual que un id inexistente (sin distinguir). Solo se exponen el nombre
// público y la bio del dueño: nunca su email ni su id.
// Límite de requests por IP en Redis (`looper_public:<ip>`): PUBLIC_MAX por ventana de
// PUBLIC_WINDOW_S desde el primero; después, 429.
const PUBLIC_MAX = 120
const PUBLIC_WINDOW_S = 60
const PUBLIC_PER_PAGE = 24
const PUBLIC_PER_PAGE_MAX = 100
const PROJECT_ID_MAX = 36

async function public_rate_limit(req, res, next) {
  let key = "looper_public:" + req.ip
  try {
    let n = await global.redisClient.incr(key)
    if (n == 1) await global.redisClient.expire(key, PUBLIC_WINDOW_S)
    if (n > PUBLIC_MAX) return res.status(429).send({ stat: false, text: "Demasiados pedidos, probá de nuevo en un minuto" })
    next()
  } catch (e) {
    console.log("Error public_rate_limit", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
}

// proyectos visibles al público (con el dueño unido como `u`): todos los proyectos son públicos;
// solo quedan afuera los ocultos por el admin y los de dueños no activos
function public_projects_query(db) {
  return db("projects as p").join("users as u", "u.id", "p.user_id")
    .where("p.hidden", 0).andWhere("u.status", "active")
}

// archivos disponibles (los que suenan) de un proyecto `p`
const PROJECT_AVAILABLE_FILES_SQL = `select count(*) from project_files pf join files f on f.id = pf.file_id
  join users fu on fu.id = f.user_id
  where pf.project_id = p.id and f.hidden = 0 and fu.status = 'active'`
// segundos de audio de esos archivos (los que carga el reproductor público)
const PROJECT_AVAILABLE_SECONDS_SQL = PROJECT_AVAILABLE_FILES_SQL.replace("count(*)", AUDIO_SECONDS_SQL)

// galería: proyectos públicos con al menos un archivo disponible (los vacíos no se listan, aunque
// su link /p/<id> funcione), los más nuevos primero. Query opcional: page (desde 1) y per_page
router.get('/public/projects', public_rate_limit, async (req, res) => {
  let q = req.query || {}
  let page = 1, per_page = PUBLIC_PER_PAGE
  for (let k of ["page", "per_page"]) {
    if (q[k] !== undefined && typeof q[k] != "string") return res.status(400).send({ stat: false, text: `Parámetro inválido: ${k}` })
  }
  if (q.page && q.page.trim()) {
    page = Number(q.page)
    if (!Number.isInteger(page) || page < 1) return res.status(400).send({ stat: false, text: "Página inválida" })
  }
  if (q.per_page && q.per_page.trim()) {
    per_page = Number(q.per_page)
    if (!Number.isInteger(per_page) || per_page < 1 || per_page > PUBLIC_PER_PAGE_MAX) {
      return res.status(400).send({ stat: false, text: `per_page tiene que ser un entero entre 1 y ${PUBLIC_PER_PAGE_MAX}` })
    }
  }
  try {
    let gallery_query = db => public_projects_query(db).whereRaw(`(${PROJECT_AVAILABLE_FILES_SQL}) > 0`)
    let { total } = await gallery_query(global.knex).count({ total: "*" }).first()
    let rows = await gallery_query(global.knex)
      .select(["p.id", "p.name", "p.props", "p.ts", "u.name as creator_name", "u.bio as creator_bio",
        global.knex.raw(`(${PROJECT_AVAILABLE_FILES_SQL}) as files`),
        global.knex.raw(`(${PROJECT_AVAILABLE_SECONDS_SQL}) as audio_seconds`)])
      .orderByRaw("p.ts is null, p.ts desc, p.id")
      .limit(per_page).offset((page - 1) * per_page)
    let items = rows.map(r => ({
      id: r.id, name: r.name, ts: r.ts, tempo: parse_props(r.props).tempo ?? null, files: Number(r.files) || 0,
      audio_seconds: Number(r.audio_seconds) || 0,
      creator: { name: r.creator_name, bio: r.creator_bio ?? null },
    }))
    return res.send({ stat: true, data: { items: items, total: Number(total) || 0, page: page, per_page: per_page } })
  } catch (e) {
    console.log("Error GET public/projects", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// proyecto público para reproducir: config, pistas, tags y solo los archivos disponibles (los no
// disponibles no se mandan: no se sortean ni se cargan), más el nombre público y la bio del dueño
router.get('/public/project/:id', public_rate_limit, async (req, res) => {
  let id = String(req.params.id)
  if (id.length > PROJECT_ID_MAX) return res.status(404).send(PROJECT_NOT_FOUND)
  try {
    let p = await public_projects_query(global.knex)
      .select(["p.id", "p.name", "p.props", "p.ts", "u.name as creator_name", "u.bio as creator_bio"])
      .where("p.id", id).first()
    if (!p) return res.status(404).send(PROJECT_NOT_FOUND)
    let data = {
      id: p.id, name: p.name, ts: p.ts, props: parse_props(p.props),
      creator: { name: p.creator_name, bio: p.creator_bio ?? null },
    }
    let t = await global.knex("user_track_groups").select("id", "name", "color", "props").where({ project_id: p.id })
    data.track_groups = t.map(r => ({ ...r, props: parse_props(r.props) }))
    data.tags = await global.knex("user_tags").select("id", "name", "color", "weight").where({ project_id: p.id })
    // forma de los archivos de GET /projects/:id, sin `own` (no hay usuario)
    let files = await list_project_files(global.knex, p.id, null)
    data.files = files.filter(f => f.available)
    for (let f of data.files) delete f.own
    return res.send({ stat: true, data: data })
  } catch (e) {
    console.log("Error GET public/project/:id", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

// Denuncias (tarea 4.4): solo usuarios logueados. Se puede denunciar lo que el usuario puede ver de
// otros: un archivo disponible del catálogo o un proyecto de la galería pública; lo propio no. Si ya
// tiene una denuncia abierta sobre lo mismo, responde éxito sin duplicarla (y sin contar para el
// límite). Límite por usuario en Redis (`looper_report:<user_id>`): REPORT_MAX denuncias nuevas por
// ventana de REPORT_WINDOW_S desde la primera; después, 429. Las revisa el admin (fase 5).
const REPORT_MAX = 20
const REPORT_WINDOW_S = 24 * 60 * 60
const REPORT_REASON_MAX = 500
const REPORT_TARGET_TYPES = ["file", "project"]
const REPORT_OK_TEXT = "Denuncia enviada: la va a revisar un admin"

router.post('/report', require_session, async (req, res) => {
  let user_id = req.user.id
  let body = req.body || {}
  if (!REPORT_TARGET_TYPES.includes(body.target_type)) {
    return res.status(400).send({ stat: false, text: "target_type tiene que ser file o project" })
  }
  let target_type = body.target_type
  if (typeof body.target_id !== "string" || !body.target_id) {
    return res.status(400).send({ stat: false, text: "Falta target_id" })
  }
  let target_id = body.target_id
  let not_found = target_type == "file" ? FILE_NOT_FOUND : PROJECT_NOT_FOUND
  if (target_id.length > ROW_ID_MAX) return res.status(404).send(not_found)
  let reason = typeof body.reason === "string" ? body.reason.trim() : ""
  if (!reason || [...reason].length > REPORT_REASON_MAX) {
    return res.send({ stat: false, text: `El motivo es obligatorio (hasta ${REPORT_REASON_MAX} caracteres)` })
  }
  try {
    // el target tiene que existir y estar a la vista; si no, 404 igual que un id inexistente
    let owner_id
    if (target_type == "file") {
      let [f] = await get_catalog_files(global.knex, [target_id])
      if (!f || !file_available(f)) return res.status(404).send(not_found)
      owner_id = f.user_id
    } else {
      let p = await public_projects_query(global.knex).select("p.user_id").where("p.id", target_id).first()
      if (!p) return res.status(404).send(not_found)
      owner_id = p.user_id
    }
    if (owner_id === user_id) return res.send({ stat: false, text: "No podés denunciar algo propio" })

    let open_report = db => db("reports").select("id")
      .where({ target_type: target_type, target_id: target_id, reporter_user_id: user_id, status: "open" }).first()
    if (await open_report(global.knex)) return res.send({ stat: true, text: REPORT_OK_TEXT, data: { duplicate: true } })

    let key = "looper_report:" + user_id
    let n = await global.redisClient.incr(key)
    if (n == 1) await global.redisClient.expire(key, REPORT_WINDOW_S)
    if (n > REPORT_MAX) return res.status(429).send({ stat: false, text: "Llegaste al límite de denuncias por hoy" })

    // se vuelve a chequear dentro de la transacción (dos envíos simultáneos no duplican)
    let duplicate = await global.knex.transaction(async trx => {
      if (await open_report(trx)) return true
      await trx("reports").insert({
        id: uuid(), target_type: target_type, target_id: target_id, reporter_user_id: user_id,
        reason: reason, status: "open", ts: new Date().toISOString().slice(0, 19),
      })
      return false
    })
    return res.send({ stat: true, text: REPORT_OK_TEXT, data: { duplicate: duplicate } })
  } catch (e) {
    console.log("Error POST report", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

router.get('/get_user_info', async (req, res) => {
  // sin sesión (o con una que el chequeo por request acaba de cortar) responde 200 { stat: false }
  if (!req.user) return res.send({ stat: false })
  try {
    let ui = await return_user_info(req.user.id)
    return res.send({ stat: true, u_info: ui })
  } catch (e) {
    console.log("Error get_user_info", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }

})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// los archivos son públicos: se sirven por id, sin sesión
router.get('/file/:id', async (req, res) => {
  let id = req.params.id
  // validar el formato antes de armar la ruta evita el path traversal
  if (!UUID_RE.test(id)) return res.status(404).end()
  try {
    let file = await global.knex("files").select("user_id").where({ id: id }).first()
    if (!file) return res.status(404).end()
    count_traffic(req, res)
    // el mp3 de un id nunca cambia: el navegador lo puede cachear para siempre
    res.sendFile(id + ".mp3", { root: global.config.storage_path + file.user_id, maxAge: "1y", immutable: true }, (err) => {
      if (err && !res.headersSent) res.status(404).end()
    })
  } catch (error) {
    console.log("Error file", error)
    return res.status(500).end()
  }
})

// suma a la tabla `traffic` (una fila por día UTC) los bytes que salieron por el socket para
// esta respuesta, incluidos headers y descargas cortadas a la mitad
function count_traffic(req, res) {
  let socket = req.socket
  let start = socket.bytesWritten
  res.once("close", async () => {
    let bytes = socket.bytesWritten - start
    if (bytes <= 0) return
    let day = new Date().toISOString().slice(0, 10)
    try {
      await global.knex("traffic")
        .insert({ id: day, bytes: bytes, requests: 1 })
        .onConflict("id")
        .merge({ bytes: global.knex.raw("bytes + ?", [bytes]), requests: global.knex.raw("requests + 1") })
    } catch (e) {
      console.log("Error traffic", e)
    }
  })
}

// ---------- subida de archivos ----------
// Un archivo por request (con su `kind`, `beats` y/o `bpm`, ver parse_timing, y `music_key`: si no viene
// el campo, se sugiere por el nombre con utils.suggest_key; vacío = sin dato). Orden de los chequeos:
//  1. antes de recibir el cuerpo (upload_precheck): sesión activa (require_session), una subida en
//     curso por usuario, disco libre y cuota no agotada. Así un rechazo no obliga a recibir el archivo.
//  2. con el archivo en un temporal: formato por extensión, ffprobe (¿es audio?, duración <= 60 s),
//     project_id (opcional) propio, kind/beats/bpm válidos y cuota con la duración real.
//  3. conversión a MP3 V0 en la cola global (concurrencia 1).
//  4. transacción: se vuelve a chequear la cuota (y el proyecto), se inserta la fila y, con
//     project_id, la de project_files (el archivo queda en ese proyecto, sin pista ni tags).

const UPLOAD_EXTENSIONS = ["mp3", "wav", "ogg", "flac", "m4a", "aiff", "aif"]
const UPLOAD_FORMATS_TEXT = "mp3, wav, ogg, flac, m4a o aiff"
// duración máxima por archivo; el margen cubre los ms de relleno que algunos formatos (mp3, m4a)
// suman a la duración que informa ffprobe
const UPLOAD_MAX_SECONDS = 60
const UPLOAD_SECONDS_MARGIN = 0.1
// tamaño máximo del archivo recibido: un minuto de wav/aiff estéreo de 192 kHz y 24 bits ocupa ~66 MB.
// Mismo límite que MAX_UPLOAD_MB en frontend/src/components/Uploader.vue y que client_max_body_size
// de nginx (con algo de margen para el multipart): cambiarlos juntos
const UPLOAD_MAX_MB = 80
const BPM_MIN = 20
const BPM_MAX = 400
const BEATS_MAX = 1024
// defaults si faltan en .env
const DEFAULT_MAX_SECONDS = 1200
const DEFAULT_DISK_MIN_FREE_GB = 10

const upload_parser = fileUpload({
  limits: { fileSize: UPLOAD_MAX_MB * 1024 * 1024 },
  abortOnLimit: true, // responde 413 en vez de guardar el archivo truncado
  responseOnLimit: JSON.stringify({ stat: false, text: `El archivo supera los ${UPLOAD_MAX_MB} MB` }),
  useTempFiles: true,
  tempFileDir: path.join(os.tmpdir(), "looper_upload"),
})

// subida en curso por usuario: user_id → token de la subida (en memoria: el backend corre en un
// solo proceso). El token evita que una subida vieja libere el lugar de otra más nueva
const uploads_in_progress = new Map()

// cola global de conversión con concurrencia 1: cada trabajo espera a que termine el anterior
let convert_queue = Promise.resolve()
function enqueue_conversion(job) {
  let p = convert_queue.then(job)
  convert_queue = p.catch(() => { })
  return p
}

// segundos → "m:ss"
function fmt_seconds(s) {
  s = Math.max(0, Math.floor(s))
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0")
}

// valor numérico de .env, o el default si falta, está vacío o no es un número >= 0
function config_number(key, def) {
  let v = global.config[key]
  if (v === undefined || String(v).trim() === "") return def
  let n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : def
}

// cuota del usuario en segundos (users.max_seconds; null = default_max_seconds de .env)
// y segundos ya usados (suma de files.duration de sus archivos). `db` es knex o una transacción
async function user_quota(db, user_id) {
  let user = await db("users").select("max_seconds").where({ id: user_id }).first()
  let max = user?.max_seconds ?? config_number("default_max_seconds", DEFAULT_MAX_SECONDS)
  let r = await db("files").sum({ s: "duration" }).where({ user_id: user_id }).first()
  return { max: max, used: Number(r?.s) || 0 }
}

// ¿queda al menos disk_min_free_gb libre en el disco de storage_path?
async function disk_free_ok() {
  let min_gb = config_number("disk_min_free_gb", DEFAULT_DISK_MIN_FREE_GB)
  let s = await fs.statfs(global.config.storage_path)
  return s.bavail * s.bsize >= min_gb * 1024 * 1024 * 1024
}

const DISK_FULL_TEXT = "El servidor está sin espacio: las subidas están suspendidas por ahora"

// chequeos previos a recibir el archivo. Toma el lugar de "subida en curso" del usuario; se libera
// al terminar el handler o, si el handler no llegó a empezar (rechazo, 413, conexión cortada), al
// cerrarse la respuesta
async function upload_precheck(req, res, next) {
  let user_id = req.user.id
  if (uploads_in_progress.has(user_id)) {
    return res.status(409).send({ stat: false, text: "Ya tenés una subida en curso: esperá a que termine" })
  }
  let token = {}
  uploads_in_progress.set(user_id, token)
  req.upload_token = token
  req.upload_release = () => {
    if (uploads_in_progress.get(user_id) === token) uploads_in_progress.delete(user_id)
  }
  res.once("close", () => { if (!req.upload_started) req.upload_release() })
  try {
    if (!await disk_free_ok()) return res.status(507).send({ stat: false, text: DISK_FULL_TEXT })
    let q = await user_quota(global.knex, user_id)
    if (q.used >= q.max) {
      return res.status(403).send({ stat: false, text: `Llegaste a tu cuota de ${fmt_seconds(q.max)} de audio` })
    }
    next()
  } catch (e) {
    console.log("Error upload (precheck)", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
}

// bpm: vacío → null; número entre BPM_MIN y BPM_MAX; undefined si es inválido
function parse_bpm(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null
  let n = Number(v)
  return Number.isFinite(n) && n >= BPM_MIN && n <= BPM_MAX ? Math.round(n * 100) / 100 : undefined
}
// beats: vacío → null; entero entre 1 y BEATS_MAX; undefined si es inválido
function parse_beats(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null
  let n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= BEATS_MAX ? n : undefined
}

// tipo y tempo de un archivo a partir del body (subida o PUT /files/:id), su duración (segundos) y
// lo que ya tiene (`current`: { kind, beats }). Devuelve { kind, beats, bpm } o { error }.
// - kind: "loop" | "shot" (si no viene, el actual). Un shot no tiene beats ni bpm.
// - loop: manda `beats`. Si no vienen beats pero sí bpm, beats = round(duración × bpm / 60); si no
//   viene ninguno, los actuales o, si no hay, suggest_beats con `tempo_hint` (tempo del proyecto).
//   El bpm se recalcula siempre: beats × 60 / duración.
const FILE_KINDS = ["loop", "shot"]
function parse_timing(body, duration, current, tempo_hint) {
  let kind = body.kind === undefined || body.kind === null || body.kind === "" ? current.kind ?? "loop" : body.kind
  if (!FILE_KINDS.includes(kind)) return { error: `Tipo inválido: tiene que ser ${FILE_KINDS.join(" o ")}` }
  if (kind == "shot") return { kind: kind, beats: null, bpm: null }
  let d = Number(duration)
  if (!Number.isFinite(d) || d <= 0) return { error: "El archivo no tiene duración: no se puede calcular su tempo" }
  let beats = parse_beats(body.beats)
  if (beats === undefined) return { error: `Beats inválido: tiene que ser un entero entre 1 y ${BEATS_MAX}` }
  if (beats === null) {
    let bpm = parse_bpm(body.bpm)
    if (bpm === undefined) return { error: `BPM inválido: tiene que ser un número entre ${BPM_MIN} y ${BPM_MAX}` }
    if (bpm !== null) beats = Math.max(1, Math.round(d * bpm / 60))
    else if (current.beats) beats = current.beats
    else beats = suggest_beats(d, tempo_hint)
  }
  let bpm = utils.loop_bpm(beats, d)
  if (bpm < BPM_MIN || bpm > BPM_MAX) {
    return { error: `Con ${beats} beats el loop queda en ${bpm} BPM: tiene que estar entre ${BPM_MIN} y ${BPM_MAX} (¿es un shot?)` }
  }
  return { kind: kind, beats: beats, bpm: bpm }
}
// beats sugeridos sin otro dato (misma regla que suggest_timing de frontend/src/helpers/TrackCtrl.js):
// la cantidad exacta si a ese tempo cierra a menos de 1 %; si no, la cantidad "redonda" que deja el
// loop más cerca del tempo (del proyecto, o SUGGEST_TEMPO_DEFAULT)
const SUGGEST_TEMPO_DEFAULT = 120
const NICE_BEATS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256]
function suggest_beats(duration, tempo) {
  tempo = Number(tempo) > 0 ? Number(tempo) : SUGGEST_TEMPO_DEFAULT
  let exact = Math.round(duration * tempo / 60)
  if (exact >= 1 && Math.abs(exact * 60 / duration / tempo - 1) < 0.01) return exact
  let best = null
  for (let n of NICE_BEATS) {
    let dev = Math.abs(Math.log(n * 60 / duration / tempo))
    if (!best || dev < best.dev) best = { n, dev }
  }
  return best.n
}

class QuotaError extends Error { }
class ProjectGoneError extends Error { }

router.post('/upload', require_session, upload_precheck, upload_parser, async (req, res) => {
  req.upload_started = true
  let user_id = req.user.id
  let files = Object.values(req.files || {}).flat()
  let out_file = null
  let committed = false
  // con la respuesta ya enviada (p. ej. el 413 de upload_parser) no se responde de nuevo
  const fail = (status, text) => {
    if (!res.headersSent) res.status(status).send({ stat: false, text: text })
  }
  try {
    // respuesta ya enviada, o lugar ya liberado: el cliente cortó la conexión mientras subía (el
    // parser llama igual al handler cuando vence su uploadTimeout). No se procesa nada
    if (res.headersSent || uploads_in_progress.get(user_id) !== req.upload_token) return
    if (files.length == 0) return fail(400, "No llegó ningún archivo")
    if (files.length > 1) return fail(400, "Se sube un archivo por vez")
    let file = files[0]
    if (file.truncated) return fail(413, `El archivo supera los ${UPLOAD_MAX_MB} MB`)
    let body = req.body || {}

    let ext = utils.get_file_extension(file.name)
    if (!UPLOAD_EXTENSIONS.includes(ext)) {
      return fail(400, `Formato no aceptado: ${file.name}. Se aceptan ${UPLOAD_FORMATS_TEXT}`)
    }
    // proyecto opcional al que se agrega el archivo subido (propio; si no, 404 como todo proyecto ajeno)
    let project_id = typeof body.project_id == "string" && body.project_id !== "" ? body.project_id : null
    let project = project_id ? await own_project(global.knex, project_id, user_id) : null
    if (project_id && !project) return fail(404, PROJECT_NOT_FOUND.text)

    // la duración se mide sobre la entrada (la del mp3 convertido suma el relleno del encoder)
    let info = await utils.probe(file.tempFilePath)
    if (!info.is_audio) return fail(400, `${file.name} no es un archivo de audio válido`)
    if (info.duration > UPLOAD_MAX_SECONDS + UPLOAD_SECONDS_MARGIN) {
      return fail(400, `${file.name} dura ${fmt_seconds(info.duration)}: el máximo es 1 minuto por archivo`)
    }
    let duration = info.duration
    // tipo y tempo (sin beats ni bpm, un loop toma los beats que da el tempo del proyecto)
    let tempo_hint = project ? parse_props(project.props).tempo : null
    let timing = parse_timing(body, duration, { kind: "loop", beats: null }, tempo_hint)
    if (timing.error) return fail(400, timing.error)
    let music_key = body.music_key === undefined ? utils.suggest_key(file.name) : parse_music_key(body.music_key)
    if (music_key === undefined) return fail(400, MUSIC_KEY_ERROR)

    let q = await user_quota(global.knex, user_id)
    if (q.used + duration > q.max) {
      return fail(403, `No te alcanza la cuota: te quedan ${fmt_seconds(q.max - q.used)} y ${file.name} dura ${fmt_seconds(duration)}`)
    }
    if (!await disk_free_ok()) return fail(507, DISK_FULL_TEXT)

    let dir = global.config.storage_path + user_id
    await fs.mkdir(dir, { recursive: true })
    let file_id = uuid()
    out_file = dir + "/" + file_id + ".mp3"
    // todo se recodifica (también los mp3) a MP3 VBR V0 44.1 kHz estéreo sin metadatos, normalizado
    // a -18 LUFS / -1 dBTP con ganancia fija
    try {
      let ln = await enqueue_conversion(() => utils.convert(file.tempFilePath, out_file))
      console.log("Convertido", file_id, `I=${ln.input_i} LUFS TP=${ln.input_tp} dBTP ganancia=${ln.gain} dB`)
    } catch (e) {
      console.log("Error convirtiendo", file.name, e.message)
      return fail(422, `No se pudo convertir ${file.name}`)
    }
    let size = (await fs.stat(out_file)).size

    let row = {
      id: file_id,
      user_id: user_id,
      original_name: file.name,
      size: size,
      tags: "[]",
      duration: duration,
      kind: timing.kind,
      bpm: timing.bpm,
      beats: timing.beats,
      music_key: music_key,
      ts: new Date().toISOString().slice(0, 19),
    }
    try {
      await global.knex.transaction(async trx => {
        // cuota con la duración real, dentro de la transacción (SQLite serializa las escrituras)
        let q2 = await user_quota(trx, user_id)
        if (q2.used + duration > q2.max) throw new QuotaError()
        // el proyecto pudo borrarse mientras se convertía
        if (project_id && !await own_project(trx, project_id, user_id)) throw new ProjectGoneError()
        await trx("files").insert(row)
        await trx("users").where({ id: user_id }).update({
          bytes_used: trx.raw("coalesce(bytes_used, 0) + ?", [size])
        })
        // con project_id, el archivo entra al proyecto sin pista ni tags
        if (project_id) {
          await trx("project_files").insert({
            id: uuid(), project_id: project_id, file_id: file_id, track_group: null, tags: "[]", props: "{}",
          })
        }
      })
    } catch (e) {
      if (e instanceof QuotaError) return fail(403, `No te alcanza la cuota para ${file.name}`)
      if (e instanceof ProjectGoneError) return fail(404, PROJECT_NOT_FOUND.text)
      throw e
    }
    committed = true

    // misma forma que los archivos de GET /projects/:id (sin pista ni tags); `project_id` = proyecto
    // al que se agregó (null si no se pidió ninguno)
    return res.send({
      stat: true,
      text: `${file.name} subido`,
      data: {
        ...file_out({ ...row, hidden: 0, owner_status: "active" }, user_id),
        track_group: null, tags: [], props: {}, project_id: project_id,
      }
    })
  } catch (e) {
    console.log("Error upload", e)
    return fail(500, "Error interno")
  } finally {
    // si no quedó registrado, el mp3 convertido sobra
    if (out_file && !committed) await fs.unlink(out_file).catch(() => { })
    for (let f of files) {
      if (f.tempFilePath) await fs.unlink(f.tempFilePath).catch(() => { })
    }
    req.upload_release()
  }
})

// columnas de `users` que se devuelven al front (nunca `password` ni `id`; `props` quedó obsoleta:
// la config es de cada proyecto)
const U_INFO_COLUMNS = ["email", "name", "ts", "bytes_used", "max_bytes_uploaded", "status", "role", "bio", "max_seconds"]

// datos del usuario leídos de la base en cada llamada (no de la sesión, que solo guarda el id):
// el usuario, su cuota y la lista de sus proyectos. Pistas, tags, archivos y config vienen de
// GET /projects/:id
async function return_user_info(user_id) {
  let u_info = await global.knex("users").select(U_INFO_COLUMNS).where({ id: user_id }).first()
  // cuota de audio efectiva (con el default de .env resuelto) y segundos usados, para la UI de subida
  let q = await user_quota(global.knex, user_id)
  u_info.quota = { max_seconds: q.max, used_seconds: q.used }
  u_info.projects = await list_projects(user_id)
  return u_info
}

// props JSON (de un track group, un archivo en un proyecto o un proyecto): {} si es null o inválido
function parse_props(text) {
  try {
    let props = JSON.parse(text)
    return props && typeof props == "object" && !Array.isArray(props) ? props : {}
  } catch {
    return {}
  }
}

function parse_tags(text) {
  try {
    let tags = JSON.parse(text)
    return Array.isArray(tags) ? tags : []
  } catch {
    return []
  }
}


