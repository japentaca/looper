exports.do_migrations = async function () {

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


  create_column_string("users", "password", 32)
  create_column_string("users", "name", 32)
  create_column_string("users", "ts", 21)


}


async function create_column_string(tabla, columna, length) {
  if (! await hasColumn(tabla, columna)) {
    console.log(`Creo columna ${columna}  en tabla ${tabla}`)
    await knex.schema.alterTable(tabla, function (table) {
      table.string(columna, length)
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
