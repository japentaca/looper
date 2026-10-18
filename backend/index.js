'use strict'
console.log("Start")
import * as dotenv from 'dotenv'
let config = dotenv.config()
//console.log("config", config)
global.config = config.parsed
if (!global.config.session_secret) {
  console.log("Falta session_secret en .env")
  process.exit(1)
}
import Knex from 'knex'
global.knex = Knex({
  client: 'better-sqlite3',
  useNullAsDefault: false,
  connection: {
    filename: global.config.db_file
  }
})
import express from 'express'
const app_server = express()
import Redis from 'ioredis'
app_server.use(express.json())
// detrás de nginx (en la misma máquina): req.ip y req.secure salen de X-Forwarded-For / X-Forwarded-Proto
app_server.set("trust proxy", "loopback")
import Session from "express-session"
import RedisStore from 'connect-redis'

let redisClient = new Redis({
  port: global.config.redis_port,
  host: global.config.redis_host,
  // usuario ACL de Redis (en el servidor, uno propio restringido a ~looper*; ver docs/DEPLOY.md).
  // Vacío = usuario default
  username: global.config.redis_username || undefined,
  password: global.config.redis_password

})
global.redisClient = redisClient
redisClient.on("error", function (err) {
  console.log("Redis error: " + err)
})
redisClient.on("connect", function () {
  console.log("Redis connected")
})
app_server.use(Session({
  store: new RedisStore({ client: redisClient, prefix: "looper_s:" }),
  name: "looper_sid",
  secret: global.config.session_secret,
  saveUninitialized: false,
  resave: false,
  rolling: true, // cada request renueva los 30 días (el chequeo de sesión del front la mantiene viva)
  cookie: {
    httpOnly: true,
    secure: "auto", // solo por HTTPS cuando el request llegó por HTTPS (en dev se usa http)
    sameSite: "lax", // no viaja en POST desde otros sitios (CSRF, sobre todo en /upload)
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}))
import cors from 'cors'
let cors_origin = (global.config.cors_origin || "http://localhost:31201").split(",")
var corsOptions = {
  credentials: true,
  origin: cors_origin
}
app_server.use(cors(corsOptions))
import api from './routes/api.js'
app_server.use("/api", api)

import do_migrations, { fill_file_loudness } from "./db_migrations.js"
// el esquema tiene que estar completo antes de aceptar requests
await do_migrations()

console.log("Listening on ", global.config.service_port)
app_server.listen(global.config.service_port, () => {
  // ya escuchando: loudness de los archivos sin medir, en segundo plano (no se espera; un error no corta nada)
  fill_file_loudness().catch(e => console.log("Error midiendo loudness", e))
})

