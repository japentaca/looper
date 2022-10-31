var express = require('express')
var router = express.Router()
module.exports = router
const fs = require("fs/promises")
const bcrypt = require('bcrypt');
const uuid = require("uuid")
const fileUpload = require('express-fileupload');

router.use(fileUpload({
  limits: { fileSize: 5 * 1024 * 1024 },
  //safeFileNames: true,
  useTempFiles: true,
  tempFileDir: global.config.storage_path
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
    //console.log("res", db_res[0])
    if (db_res[0] === undefined) {
      res.status(200).send({ stat: false, text: "Usuario o clave inválida" })
      return
    } else {
      var pwd = db_res[0].password
      var isValid = await bcrypt.compare(password, pwd)
      if (!isValid) {
        res.status(200).send({ stat: false, text: "Usuario o clave inválida" })
        return
      }
      let u_info = db_res[0]
      delete u_info.password

      req.session.isLogged = true
      req.session.u_info = { ...u_info }

      req.session.save()
      let ui = return_user_info(req)
      var res_data = {
        stat: true,
        data: {
          token: uuid.v4(),
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

//var salt = 10, pp = "jape"
//var hashed = bcrypt.hash(pp, salt).then(p => { console.log("hashed", pp, p) })

router.get('/get_user_data', async (req, res) => {
  //console.log("req.session", req.session)
  return res.send({ stat: true })

});

router.put('/logout', async (req, res) => {
  if (req.session.isLogged) {
    req.session.destroy()
  }
  //console.log("req.session", req.session)
  return res.send({ stat: true })

});

router.put('/delete_file', async (req, res) => {
  console.log(req.body)

  let file = await global.knex("files").select().where({ user_id: req.session.u_info.id, id: req.body.id }).first()
  if (!file) {
    // TODO: hack
    console.log("HACK ! ! ", req.body, req.session)
    return res.status(403)
  }
  await fs.unlink(global.config.storage_path + req.session.u_info.id + "/" + req.body.id + ".mp3")
  await global.knex("files").delete().where({ user_id: req.session.u_info.id, id: req.body.id })


  //console.log("req.session", req.session)
  return res.send({ stat: true })

});

router.get('/get_user_info', async (req, res) => {
  //console.log("req.sess", req.session)
  if (req.session?.isLogged) {
    let ui = await return_user_info(req)
    return res.send({ stat: true, u_info: ui })
  } else {
    return res.send({ stat: false })
  }

});

router.post('/upload', async (req, res) => {
  if (!req.session.isLogged) {
    console.log("sin session")
    return res.status(403)
  }
  let user_id = req.session.u_info.id

  let exists = await isDirExist(global.config.storage_path + user_id)
  if (!exists) {
    console.log("creo path", global.config.storage_path + user_id)
    await fs.mkdir(global.config.storage_path + user_id)
  }



  //console.log("uploadaaa", req.files); // the uploaded file object

  let mv_files_prom_arr = []
  let insert_files_arr = []
  let temp = await global.knex("users").select("bytes_used").where({ id: user_id }).first()
  let total_bytes = temp.bytes_used
  let trx = await global.knex.transaction()
  for (index in req.files) {
    let file_id = uuid.v4()
    let file = req.files[index]
    console.log(file.name, file.size)
    mv_files_prom_arr.push(move_file(file, global.config.storage_path + user_id + "/" + file_id + ".mp3"))
    total_bytes += file.size
    insert_files_arr.push(
      trx("files").insert({
        id: file_id,
        user_id: user_id,
        size: file.size,
        original_name: file.name
      }))
  }
  await Promise.all(mv_files_prom_arr)
  await Promise.all(insert_files_arr)
  await trx("users").update({ bytes_used: total_bytes })
  await trx.commit()

  //console.log("check path", global.config.storage_path + user_id)


  return res.status(200).end()
});
async function return_user_info(req) {
  let u_info = { ...req.session.u_info }
  delete u_info.id
  delete u_info.password
  u_info.files = await global.knex("files").select().where({ user_id: req.session.u_info.id })
  //u_info.files.sort((a, b) => { return a.original_name < b.original_name })
  console.time()
  u_info.files.sort((a, b) => a.original_name.localeCompare(b.original_name))
  console.timeEnd()

  return u_info

}

const isDirExist = async path => await fs.access(path).then(() => true).catch(() => false);

async function move_file(file, dest) {
  return new Promise(async (resolve, reject) => {
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