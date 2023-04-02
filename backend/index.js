'use strict'
console.log("Start")
import * as dotenv from 'dotenv'
let config = dotenv.config()
//console.log("config", config)
global.config = config.parsed
import Knex from 'knex'
global.knex = Knex({
  client: 'better-sqlite3',
  useNullAsDefault: false,
  connection: {
    filename: global.config.db_file
  }
});
import express from 'express'
const app_server = express();
import http from 'http'
const server = http.Server(app_server);
import Redis from 'ioredis'
import bodyParser from "body-parser"
app_server.use(bodyParser.json());
import Session from "express-session"
import RedisStore from 'connect-redis'

let redisClient = new Redis({
  port: global.config.redis_port,
  host: global.config.redis_host,
  //username: global.config.redis_username,
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
  secret: 'session_secret',
  saveUninitialized: false,
  resave: true,
}))
import cors from 'cors'
let cors_origin = ["http://localhost:5173"]
var corsOptions = {
  credentials: true,
  origin: cors_origin
}
app_server.use(cors(corsOptions))
import api from './routes/api.js'
app_server.use("/api", api)
console.log("Listening on ", global.config.service_port)
app_server.listen(global.config.service_port)


import do_migrations from "./db_migrations.js"


setTimeout(async () => {
  //console.log("migrations start.")
  await do_migrations()
  //console.log("migrations ended")
}, 300);

