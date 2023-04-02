export default async function do_migrations() {

  let exists = false


  exists = await global.knex.schema.hasTable('users')
  if (!exists) {
    console.log("creo tabla users")
    await global.knex.schema.createTable('users', function (t) {
      t.string('id', 36).primary()
    })
  }

  exists = await global.knex.schema.hasTable('sets')
  if (!exists) {
    console.log("creo tabla sets")
    await global.knex.schema.createTable('sets', function (t) {
      t.string('id', 36).primary()
    })
  }
  exists = await global.knex.schema.hasTable('sets')
  if (!exists) {
    console.log("creo tabla sets")
    await global.knex.schema.createTable('sets', function (t) {
      t.string('id', 36).primary()
    })
  }

  create_column_string("sets", "user_id", 36)
  create_column_string("sets", "name", 64)
  create_column_string("sets", "tracks", 65535)
  create_column_string("sets", "tags", 65535)

  create_column_string("files", "original_name", 256)
  create_column_string("files", "track_group", 256)
  create_column_string("files", "tag", 256)
  create_column_number("files", "size")


  create_column_string("users", "password", 32)
  create_column_string("users", "email", 1024)
  create_column_string("users", "name", 32)
  create_column_string("users", "ts", 21)
  create_column_number("users", "bytes_used")
  create_column_number("users", "max_bytes_uploaded")


}


async function create_column_string(tabla, columna, length) {
  if (! await hasColumn(tabla, columna)) {
    console.log(`Creo columna ${columna}  en tabla ${tabla}`)
    await knex.schema.alterTable(tabla, function (table) {
      table.string(columna, length)
    })
  }
}
async function create_column_number(tabla, columna) {
  if (! await hasColumn(tabla, columna)) {
    console.log(`Creo columna ${columna}  en tabla ${tabla}`)
    await knex.schema.alterTable(tabla, function (table) {
      table.integer(columna)
    })
  }
}

async function hasColumn(table_name, column) {
  return new Promise(async (resolve, reject) => {
    global.knex.schema.hasColumn(table_name, column).then(exists => {
      resolve(exists)
    })

  })
}