'use strict'
console.log("Start")
var config = require('dotenv').config()
global.config = config.parsed

global.knex = require('knex')({
  client: 'sqlite3',
  useNullAsDefault: false,
  connection: {
    filename: global.config.db_file
  }
});

const app_admin = require('express')();
const server = require('http').Server(app_admin);

var bodyParser = require("body-parser")
app_admin.use(bodyParser.json());
var Session = require('express-session')
let RedisStore = require('connect-redis')(Session)
const Redis = require("ioredis")
let redisClient = new Redis({
  port: global.config.redis_port,
  host: global.config.redis_host
})
global.redisClient = redisClient
app_admin.use(Session({
  store: new RedisStore({ client: redisClient, prefix: "s_admin:" }),
  secret: 'session_secret',
  saveUninitialized: false,
  resave: true,
}))
var cors = require('cors')
let cors_origin = ["http://localhost:5173"]
var corsOptions = {
  credentials: true,
  origin: cors_origin
}
app_admin.use(cors(corsOptions))
app_admin.use("/api", require("./routes/api"))
console.log("Listening on ", global.config.service_port)
app_admin.listen(global.config.service_port)

let migrations = require("./migrations/db_migrations")

setTimeout(async () => {
  //console.log("migrations start.")
  await migrations.do_migrations()
  //console.log("migrations ended")
}, 300);

