var express = require('express')
var router = express.Router()
module.exports = router
const fs = require("fs/promises")
const bcrypt = require('bcrypt');
const uuid = require("uuid")
const fileUpload = require('express-fileupload');



router.use((req, res, next) => {
  //console.log(req.session)
  if (!req.session.isLogged) {
    //console.log("no logged", req.path)
  }
  next()
})

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


    let db_res = await global.mongodb.collection("users").find({ email: email }).toArray()
    console.log("res", db_res[0])
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
      u_info.token = uuid.v4()
      req.session.u_info = { ...u_info }
      global.redisClient.hset("TOKEN:", u_info.token, req.session.id)
      req.session.save()
      let ui = return_user_info(req)
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

//var salt = 10, pp = "jape"
//var hashed = bcrypt.hash(pp, salt).then(p => { console.log("hashed", pp, p) })

router.put("/save_trackGroups", async (req, res) => {
  if (!req.session.isLogged) return res.status(403)

  let tgrs = [...req.body]
  let db_res = await global.mongodb.collection("users").updateMany({ id: req.session.u_info.id }, { $set: { "track_groups": tgrs } }, { upsert: true })

  res.status(200).end()

})
router.put("/save_tags", async (req, res) => {
  if (!req.session.isLogged) return res.status(403)

  let tags = [...req.body]
  let db_res = await global.mongodb.collection("users").updateMany({ id: req.session.u_info.id }, { $set: { "tags": tags } }, { upsert: true })
  res.status(200).end()

})



router.put('/logout', async (req, res) => {
  if (req.session.isLogged) {
    req.session.destroy()
  }
  //console.log("req.session", req.session)
  return res.send({ stat: true })

});

router.put('/save_fileData', async (req, res) => {
  if (!req.session.isLogged) {
    console.log("sin session")
    return res.status(403)
  }
  let file = req.body.file
  console.log(req.body)
  const allowedFields = ["track_group", "tag", "props"]
  let upd_obj = {}
  // upd_obj = { id: file.id }
  for (f of allowedFields) {
    //console.log("field", f, req.body.file[f])
    if (req.body.file[f]) {
      upd_obj["files.$." + f] = req.body.file[f]
    }
  }

  console.log(upd_obj)
  let db_res = await global.mongodb.collection("users").updateOne({ id: req.session.u_info.id, "files.id": file.id }, { $set: upd_obj }, { upsert: true })
  console.log(db_res)

  //console.log("req.session", req.body)
  return res.send({ stat: true })

});

router.put('/delete_file', async (req, res) => {
  //console.log(req.body, "u_id,", req.session.u_info.id)


  if (false) { // TODO: checkear hack
    // TODO: hack
    console.log("HACK ! ! ", req.body, req.session)
    return res.status(403)
  }

  console.log(req.body.id)
  let db_res = await global.mongodb.collection("users").updateOne({ id: req.session.u_info.id, }, { $pull: { "files": { "id": req.body.id } } })
  console.log("delete file", db_res)
  //await fs.unlink(global.config.storage_path + req.session.u_info.id + "/" + req.body.id + ".mp3")


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

router.get('/get_file', async (req, res) => {

  try {

    //await delayrandom()
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


});
async function delayrandom() {
  return new Promise(async (resolve) => {
    setTimeout(async () => {
      resolve()
    }, Math.random() * 100);

  })


}

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

  let total_bytes = req.session.u_info.total_bytes || 0

  for (index in req.files) {
    let file_id = uuid.v4()
    let file = req.files[index]
    //console.log(file.name, file.size)
    mv_files_prom_arr.push(move_file(file, global.config.storage_path + user_id + "/" + file_id + ".mp3"))
    total_bytes += file.size

    insert_files_arr.push(
      {
        id: file_id,
        size: file.size,
        original_name: file.name
      }
    )

  }

  await Promise.all(mv_files_prom_arr)
  await global.mongodb.collection("users").update({ id: req.session.u_info.id, }, { $push: { "files": { "$each": insert_files_arr } } }, { upsert: true })
  await global.mongodb.collection("users").update({ id: req.session.u_info.id }, { $set: { "total_bytes": total_bytes } }, { upsert: true })


  //console.log("check path", global.config.storage_path + user_id)


  return res.status(200).end()
});

async function return_user_info(req) {
  let u_info = await global.mongodb.collection("users").findOne({ id: req.session.u_info.id })
  //console.log("erererer", u_info)
  delete u_info.id
  delete u_info.password


  if (u_info.files) {
    u_info.files.map(f => {
      f.name = f.id + ".mp3"
    })
    //u_info.files.sort((a, b) => a.original_name.localeCompare(b.original_name))
  } else {
    u_info.files = []
  }


  //u_info.files.sort((a, b) => { return a.original_name < b.original_name })




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