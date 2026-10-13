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


router.put("/save_trackGroups", require_session, async (req, res) => {
  await replace_user_rows("user_track_groups", req, res)
})
router.put("/save_tags", require_session, async (req, res) => {
  await replace_user_rows("user_tags", req, res)
})

// columnas que se guardan de cada objeto recibido (lista blanca): los campos que el cliente agrega
// a los objetos (o columnas sin uso como `silences`) se ignoran, si no romperían el insert.
// Las columnas JSON se serializan con JSON.stringify.
const USER_ROWS_COLUMNS = {
  user_track_groups: { columns: ["id", "name", "color", "props"], json: ["props"] },
  user_tags: { columns: ["id", "name", "color"], json: [] },
}

// reemplaza todas las filas del usuario en la tabla por las recibidas, en una transacción
// para no perder la colección si falla un insert
async function replace_user_rows(table, req, res) {
  if (!Array.isArray(req.body)) return res.status(400).send({ stat: false, text: "Datos inválidos" })
  let user_id = req.user.id
  let { columns, json } = USER_ROWS_COLUMNS[table]
  try {
    await global.knex.transaction(async trx => {
      await trx(table).delete().where({ user_id: user_id })
      for (let r of req.body) {
        let row = { user_id: user_id }
        for (let c of columns) {
          if (r[c] === undefined) continue
          row[c] = json.includes(c) ? JSON.stringify(r[c] ?? {}) : r[c]
        }
        await trx(table).insert(row)
      }
    })
    res.send({ stat: true })
  } catch (e) {
    console.log("Error guardando", table, e)
    res.status(500).send({ stat: false, text: "Error interno" })
  }
}



// config global del usuario (users.props): solo se guardan estas claves (lista blanca), el resto
// se ignora. Reemplaza lo guardado (el front manda siempre la config completa).
const USER_PROPS_KEYS = ["tempo", "beats_x_bar", "tag_range", "delay"]
const USER_PROPS_MAX_LENGTH = 4096 // tamaño de la columna
router.put("/save_user_props", require_session, async (req, res) => {
  let body = req.body
  if (!body || typeof body != "object" || Array.isArray(body)) {
    return res.status(400).send({ stat: false, text: "Datos inválidos" })
  }
  let props = {}
  for (let k of USER_PROPS_KEYS) {
    if (body[k] !== undefined) props[k] = body[k]
  }
  let text = JSON.stringify(props)
  if (text.length > USER_PROPS_MAX_LENGTH) return res.status(400).send({ stat: false, text: "Datos inválidos" })
  try {
    await global.knex("users").update({ props: text }).where({ id: req.user.id })
    return res.send({ stat: true })
  } catch (e) {
    console.log("Error save_user_props", e)
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

router.put('/save_fileData', require_session, async (req, res) => {
  try {
    let file = req.body.file
    let upd_obj = {
      track_group: file.track_group ?? null,
      // array de ids de tags; se descarta lo que no sea string
      tags: JSON.stringify(Array.isArray(file.tags) ? file.tags.filter(t => typeof t == "string") : []),
      props: JSON.stringify(file.props)
    }
    let n = await global.knex("files").update(upd_obj).where({ id: file.id, user_id: req.user.id })
    if (n == 0) return res.status(403).send({ stat: false, text: "Archivo inexistente" })
    return res.send({ stat: true })
  } catch (e) {
    console.log("Error save_fileData", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }

})

router.put('/delete_file', require_session, async (req, res) => {
  let user_id = req.user.id
  try {
    let file = await global.knex("files").select().where({ user_id: user_id, id: req.body.id }).first()
    if (!file) {
      console.log("delete_file: archivo inexistente o de otro usuario", req.body.id)
      return res.status(403).send({ stat: false, text: "Archivo inexistente" })
    }
    try {
      await fs.unlink(global.config.storage_path + user_id + "/" + req.body.id + ".mp3")
    } catch (e) {
      // si ya no estaba en disco, igual se borra la fila
      if (e.code !== "ENOENT") throw e
    }
    await global.knex.transaction(async trx => {
      await trx("files").delete().where({ user_id: user_id, id: req.body.id })
      // se descuenta el tamaño del archivo, sin bajar de 0
      await trx("users").where({ id: user_id }).update({
        bytes_used: trx.raw("max(coalesce(bytes_used, 0) - ?, 0)", [file.size || 0])
      })
    })
    return res.send({ stat: true })
  } catch (e) {
    console.log("Error delete_file", e)
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
// Un archivo por request (con su `bpm` y `beats`). Orden de los chequeos:
//  1. antes de recibir el cuerpo (upload_precheck): sesión activa (require_session), una subida en
//     curso por usuario, disco libre y cuota no agotada. Así un rechazo no obliga a recibir el archivo.
//  2. con el archivo en un temporal: formato por extensión, ffprobe (¿es audio?, duración <= 60 s),
//     bpm/beats válidos y cuota con la duración real.
//  3. conversión a MP3 V0 en la cola global (concurrencia 1).
//  4. transacción: se vuelve a chequear la cuota y se inserta la fila.

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

class QuotaError extends Error { }

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
    let bpm = parse_bpm(body.bpm)
    if (bpm === undefined) return fail(400, `BPM inválido: tiene que ser un número entre ${BPM_MIN} y ${BPM_MAX}`)
    let beats = parse_beats(body.beats)
    if (beats === undefined) return fail(400, `Beats inválido: tiene que ser un entero entre 1 y ${BEATS_MAX}`)

    // la duración se mide sobre la entrada (la del mp3 convertido suma el relleno del encoder)
    let info = await utils.probe(file.tempFilePath)
    if (!info.is_audio) return fail(400, `${file.name} no es un archivo de audio válido`)
    if (info.duration > UPLOAD_MAX_SECONDS + UPLOAD_SECONDS_MARGIN) {
      return fail(400, `${file.name} dura ${fmt_seconds(info.duration)}: el máximo es 1 minuto por archivo`)
    }
    let duration = info.duration

    let q = await user_quota(global.knex, user_id)
    if (q.used + duration > q.max) {
      return fail(403, `No te alcanza la cuota: te quedan ${fmt_seconds(q.max - q.used)} y ${file.name} dura ${fmt_seconds(duration)}`)
    }
    if (!await disk_free_ok()) return fail(507, DISK_FULL_TEXT)

    let dir = global.config.storage_path + user_id
    await fs.mkdir(dir, { recursive: true })
    let file_id = uuid()
    out_file = dir + "/" + file_id + ".mp3"
    // todo se recodifica (también los mp3) a MP3 VBR V0 44.1 kHz estéreo sin metadatos
    try {
      await enqueue_conversion(() => utils.convert(file.tempFilePath, out_file))
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
      bpm: bpm,
      beats: beats,
      ts: new Date().toISOString().slice(0, 19),
    }
    try {
      await global.knex.transaction(async trx => {
        // cuota con la duración real, dentro de la transacción (SQLite serializa las escrituras)
        let q2 = await user_quota(trx, user_id)
        if (q2.used + duration > q2.max) throw new QuotaError()
        await trx("files").insert(row)
        await trx("users").where({ id: user_id }).update({
          bytes_used: trx.raw("coalesce(bytes_used, 0) + ?", [size])
        })
      })
    } catch (e) {
      if (e instanceof QuotaError) return fail(403, `No te alcanza la cuota para ${file.name}`)
      throw e
    }
    committed = true

    // misma forma que los archivos de get_user_info
    delete row.user_id
    return res.send({
      stat: true,
      text: `${file.name} subido`,
      data: { ...row, tags: [], props: {}, track_group: null, name: file_id + ".mp3" }
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

// columnas de `users` que se devuelven al front (nunca `password` ni `id`)
const U_INFO_COLUMNS = ["email", "name", "ts", "bytes_used", "max_bytes_uploaded", "props", "status", "role", "bio", "max_seconds"]

// datos del usuario leídos de la base en cada llamada (no de la sesión, que solo guarda el id)
async function return_user_info(user_id) {
  let u_info = await global.knex("users").select(U_INFO_COLUMNS).where({ id: user_id }).first()
  u_info.props = parse_props(u_info.props)
  // cuota de audio efectiva (con el default de .env resuelto) y segundos usados, para la UI de subida
  let q = await user_quota(global.knex, user_id)
  u_info.quota = { max_seconds: q.max, used_seconds: q.used }

  u_info.files =await global.knex("files").select().where({ user_id: user_id })
  u_info.files.map(f => {
    delete f.user_id
    if (f.props) {
      f.props = JSON.parse(f.props)
    } else { f.props = {} }
    f.tags = parse_tags(f.tags)
    delete f.tag // columna obsoleta, reemplazada por `tags`
    f.name = f.id + ".mp3"
  })


  //u_info.files.sort((a, b) => { return a.original_name < b.original_name })
  let t = await global.knex("user_track_groups").select().where({ user_id: user_id })
  u_info.track_groups = t.map(r => {
    delete r.user_id
    delete r.silences // columna sin uso
    r.props = parse_props(r.props)
    return r
  })
  t = await global.knex("user_tags").select().where({ user_id: user_id })
  u_info.tags = t.map(r => {
    delete r.user_id
    return r
  })




  return u_info

}

// props JSON (de un track group o del usuario): {} si es null o inválido
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


