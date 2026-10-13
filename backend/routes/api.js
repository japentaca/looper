import express from 'express'
var router = express.Router()
export default router
import fs from "fs/promises"
import bcrypt from 'bcrypt'
import { v4 as uuid } from "uuid"
import fileUpload from 'express-fileupload'
import utils from "../utils.js"



router.use((req, res, next) => {
  //console.log(req.session)
  if (!req.session.isLogged) {
    //console.log("no logged", req.path)
  }
  next()
})

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
  var email = req.body.email
  var password = req.body.password
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
    if (!isValid) {
      // el bloqueo dura LOGIN_BLOCK_S desde el primer fallo
      if (await global.redisClient.incr(fails_key) == 1) await global.redisClient.expire(fails_key, LOGIN_BLOCK_S)
      res.status(200).send({ stat: false, text: "Usuario o clave inválida" })
      return
    } else {
      await global.redisClient.del(fails_key)
      let u_info = db_res[0]
      delete u_info.password

      // sesión nueva al loguearse (evita fijar un id de sesión de antemano)
      await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()))
      req.session.isLogged = true
      req.session.u_info = { ...u_info }
      await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()))
      let ui = await return_user_info(req)
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


router.put("/save_trackGroups", async (req, res) => {
  await replace_user_rows("user_track_groups", req, res)
})
router.put("/save_tags", async (req, res) => {
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
  if (!req.session.isLogged) return res.status(403).send({ stat: false, text: "Sin sesión" })
  if (!Array.isArray(req.body)) return res.status(400).send({ stat: false, text: "Datos inválidos" })
  let user_id = req.session.u_info.id
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
router.put("/save_user_props", async (req, res) => {
  if (!req.session.isLogged) return res.status(403).send({ stat: false, text: "Sin sesión" })
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
    await global.knex("users").update({ props: text }).where({ id: req.session.u_info.id })
    return res.send({ stat: true })
  } catch (e) {
    console.log("Error save_user_props", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }
})

router.put('/logout', async (req, res) => {
  if (req.session.isLogged) {
    req.session.destroy()
  }
  res.clearCookie("looper_sid")
  //console.log("req.session", req.session)
  return res.send({ stat: true })

})

router.put('/save_fileData', async (req, res) => {
  if (!req.session.isLogged) return res.status(403).send({ stat: false, text: "Sin sesión" })
  try {
    let file = req.body.file
    let upd_obj = {
      track_group: file.track_group ?? null,
      // array de ids de tags; se descarta lo que no sea string
      tags: JSON.stringify(Array.isArray(file.tags) ? file.tags.filter(t => typeof t == "string") : []),
      props: JSON.stringify(file.props)
    }
    let n = await global.knex("files").update(upd_obj).where({ id: file.id, user_id: req.session.u_info.id })
    if (n == 0) return res.status(403).send({ stat: false, text: "Archivo inexistente" })
    return res.send({ stat: true })
  } catch (e) {
    console.log("Error save_fileData", e)
    return res.status(500).send({ stat: false, text: "Error interno" })
  }

})

router.put('/delete_file', async (req, res) => {
  if (!req.session.isLogged) return res.status(403).send({ stat: false, text: "Sin sesión" })
  let user_id = req.session.u_info.id
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
  if (!req.session?.isLogged) return res.send({ stat: false })
  try {
    let ui = await return_user_info(req)
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

router.post('/upload', async (req, res) => {
  if (!req.session.isLogged) return res.status(403).send({ stat: false, text: "Sin sesión" })
  let user_id = req.session.u_info.id

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

async function return_user_info(req) {
  let u_info = { ...req.session.u_info }
  //console.log("erererer", u_info)
  delete u_info.id
  delete u_info.password
  delete u_info.token // sesiones viejas: el token ya no se usa
  // props se lee de la base (la copia de la sesión es la del login y puede estar desactualizada)
  let user = await global.knex("users").select("props").where({ id: req.session.u_info.id }).first()
  u_info.props = parse_props(user?.props)

  u_info.files = await global.knex("files").select().where({ user_id: req.session.u_info.id })
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
  let t = await global.knex("user_track_groups").select().where({ user_id: req.session.u_info.id })
  u_info.track_groups = t.map(r => {
    delete r.user_id
    delete r.silences // columna sin uso
    r.props = parse_props(r.props)
    return r
  })
  t = await global.knex("user_tags").select().where({ user_id: req.session.u_info.id })
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

