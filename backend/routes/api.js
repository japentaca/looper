import express from 'express'
var router = express.Router()
export default router
import fs from "fs/promises"
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

// mismo límite que MAX_UPLOAD_MB en frontend/src/components/Uploader.vue
router.use(fileUpload({
  limits: { fileSize: 40 * 1024 * 1024 },
  abortOnLimit: true, // responde 413 en vez de guardar el archivo truncado
  //safeFileNames: true,
  useTempFiles: true,
  //tempFileDir: global.config.storage_path
}))

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

router.post('/upload', require_session, async (req, res) => {
  let user_id = req.user.id

  let failed = []
  let total_bytes
  let trx
  try {
    let exists = await isDirExist(global.config.storage_path + user_id)
    if (!exists) {
      console.log("creo path", global.config.storage_path + user_id)
      await fs.mkdir(global.config.storage_path + user_id)
    }

    let temp = await global.knex("users").select("bytes_used").where({ id: user_id }).first()
    total_bytes = temp.bytes_used || 0
    trx = await global.knex.transaction()
  } catch (e) {
    console.log("Error upload", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
  try {
    for (let index in req.files) {
      let file_id = uuid()
      let file = req.files[index]

      let fn = global.config.storage_path + user_id + "/" + file_id + ".mp3"
      let ok
      if (utils.get_file_extension(file.name) == "wav") {
        ok = await utils.convert_file(file.tempFilePath, fn).then(() => true, (err) => {
          console.log("Error convirtiendo", file.name, err.message)
          return false
        })
      } else {
        ok = await move_file(file, fn)
      }
      // solo se registra el archivo si quedó en disco
      if (!ok) {
        failed.push(file.name)
        continue
      }

      // tamaño real en disco (en wav es el del mp3 convertido)
      let size = (await fs.stat(fn)).size
      total_bytes += size
      await trx("files").insert({
        id: file_id,
        user_id: user_id,
        size: size,
        original_name: file.name,
        tags: "[]"
      })
    }
    await trx("users").update({ bytes_used: total_bytes }).where({ id: user_id })
    await trx.commit()
  } catch (e) {
    await trx.rollback()
    console.log("Error upload", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }

  if (failed.length > 0) {
    return res.status(500).send({ stat: false, text: "No se pudieron guardar: " + failed.join(", ") })
  }
  return res.status(200).end()
})

// columnas de `users` que se devuelven al front (nunca `password` ni `id`)
const U_INFO_COLUMNS = ["email", "name", "ts", "bytes_used", "max_bytes_uploaded", "props", "status", "role", "bio", "max_seconds"]

// datos del usuario leídos de la base en cada llamada (no de la sesión, que solo guarda el id)
async function return_user_info(user_id) {
  let u_info = await global.knex("users").select(U_INFO_COLUMNS).where({ id: user_id }).first()
  u_info.props = parse_props(u_info.props)

  u_info.files = await global.knex("files").select().where({ user_id: user_id })
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

const isDirExist = async path => await fs.access(path).then(() => true).catch(() => false)

async function move_file(file, dest) {
  return new Promise((resolve, reject) => {
    file.mv(dest, function (err) {
      if (err) {
        console.log(err)
        resolve(false)
        return
      }
      resolve(true)

    })

  })
}

