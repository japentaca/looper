var express = require('express')
var router = express.Router()
module.exports = router

const bcrypt = require('bcrypt');
const uuid = require("uuid")

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
      let u_data = db_res[0]
      delete u_data.password

      req.session.isLogged = true
      req.session.u_data = { ...u_data }
      delete u_data.id

      req.session.save()
      var res_data = {
        stat: true,
        data: {
          token: uuid.v4(),
          u_data: u_data,
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
  console.log("req.session", req.session)
  return res.send({ stat: true })

});

router.get('/get_user_info', async (req, res) => {
  console.log("req.sess", req.session)
  return res.send({ stat: true })

});