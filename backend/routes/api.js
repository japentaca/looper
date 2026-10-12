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

router.post('/login', async function (req, res) {
  //res.send(200, 'piden login')
  //console.log("piden login", req.body)
  var email = req.body.email
  var password = req.body.password
  try {
    if (!email || !password) {
      res.status(200).send({ stat: false, text: "Por favor ingrese email o clave" })
      return
    }


    var db_res = await global.knex("users").select().where({ email: email })
    if (db_res[0] === undefined) {
      res.status(200).send({ stat: false, text: "Usuario o clave inválida" })
      return
    } else {
      var pwd = db_res[0].password
      var isValid = await bcrypt.compare(password, pwd)
      if (!isValid) {
        console.log("no es valido")
        res.status(200).send({ stat: false, text: "Usuario o clave inválida" })
        return
      }
      let u_info = db_res[0]
      delete u_info.password

      req.session.isLogged = true
      u_info.token = uuid()
      req.session.u_info = { ...u_info }
      global.redisClient.hset("TOKEN:", u_info.token, req.session.id)
      req.session.save()
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



router.put('/logout', async (req, res) => {
  if (req.session.isLogged) {
    req.session.destroy()
  }
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

router.get('/get_file', async (req, res) => {

  try {

    await req.sessionStore.all(async (error, sessions) => {
      //console.log(req.query, "error", error, "sess", sessions)

      let sess = sessions.find((sess) => { return sess.token = req.query.token })
      //console.log("sess", sess)
      return res.sendFile(global.config.storage_path + sess.u_info.id + "/" + req.query.file + ".mp3")
    })



  } catch (error) {
    console.log("error", error)
    //console.log(error)
    return res.status(500).end()

  }


})

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

// props JSON de un track group: {} si es null o inválido
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

