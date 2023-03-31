'use strict'
console.log("Start")
var config = require('dotenv').config()
global.config = config.parsed
const { MongoClient } = require("mongodb");
const uri = global.config.mongo_uri
const mongo_conn = new MongoClient(uri);
global.mongodb = mongo_conn.db(global.config.mongo_dbname)



const app_admin = require('express')();
const server = require('http').Server(app_admin);

var bodyParser = require("body-parser")
app_admin.use(bodyParser.json());
var Session = require('express-session')
let RedisStore = require('connect-redis')(Session)
const Redis = require("ioredis")
let redisClient = new Redis({
  port: global.config.redis_port,
  host: global.config.redis_host,
  username: global.config.redis_username,
  password: global.config.redis_password

})
global.redisClient = redisClient
app_admin.use(Session({
  store: new RedisStore({ client: redisClient, prefix: "looper_s:" }),
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


