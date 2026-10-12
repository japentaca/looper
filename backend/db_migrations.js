// Migraciones idempotentes: crean lo que falte sin tocar lo existente.
// Sirven tanto para una base nueva como para la base actual (donde algunas tablas
// se crearon a mano). Para agregar una columna, sumarla acá con create_column_*.
export default async function do_migrations() {

  await create_table("users")
  await create_column_string("users", "password", 60) // hash bcrypt
  await create_column_string("users", "email", 1024)
  await create_column_string("users", "name", 32)
  await create_column_string("users", "ts", 21)
  await create_column_number("users", "bytes_used")
  await create_column_number("users", "max_bytes_uploaded")

  await create_table("files")
  await create_column_string("files", "user_id", 36)
  await create_column_string("files", "original_name", 256)
  await create_column_string("files", "track_group", 256)
  await create_column_string("files", "tag", 256) // obsoleto: reemplazado por `tags`, queda como respaldo
  await create_column_number("files", "size")
  await create_column_string("files", "props", 4096) // JSON
  await migrate_file_tags()

  await create_table("user_track_groups")
  await create_column_string("user_track_groups", "user_id", 36)
  await create_column_string("user_track_groups", "name", 256)
  await create_column_string("user_track_groups", "color", 32)
  await create_column_string("user_track_groups", "silences", 4096) // sin uso
  await create_column_string("user_track_groups", "props", 4096) // JSON: config de la pista (volume, mute, solo...)

  await create_table("user_tags")
  await create_column_string("user_tags", "user_id", 36)
  await create_column_string("user_tags", "name", 256)
  await create_column_string("user_tags", "color", 32)

  await create_table("sets")
  await create_column_string("sets", "user_id", 36)
  await create_column_string("sets", "name", 64)
  await create_column_string("sets", "tracks", 65535)
  await create_column_string("sets", "tags", 65535)
}

// un archivo puede tener varios tags: `files.tags` es un array JSON de ids de user_tags.
// Al crear la columna se copia el `tag` único de cada archivo (solo corre una vez).
async function migrate_file_tags() {
  if (await global.knex.schema.hasColumn("files", "tags")) return
  console.log("Creo columna tags en tabla files y migro files.tag")
  await global.knex.schema.alterTable("files", function (table) {
    table.string("tags", 4096)
  })
  await global.knex("files").update({ tags: "[]" })
  await global.knex("files").whereNotNull("tag").whereNot("tag", "")
    .update({ tags: global.knex.raw("json_array(tag)") })
}

// crea la tabla solo con la PK `id` (uuid); las columnas se agregan con create_column_*
async function create_table(tabla) {
  if (!await global.knex.schema.hasTable(tabla)) {
    console.log(`Creo tabla ${tabla}`)
    await global.knex.schema.createTable(tabla, function (t) {
      t.string('id', 36).primary()
    })
  }
}

async function create_column_string(tabla, columna, length) {
  if (!await global.knex.schema.hasColumn(tabla, columna)) {
    console.log(`Creo columna ${columna}  en tabla ${tabla}`)
    await global.knex.schema.alterTable(tabla, function (table) {
      table.string(columna, length)
    })
  }
}
async function create_column_number(tabla, columna) {
  if (!await global.knex.schema.hasColumn(tabla, columna)) {
    console.log(`Creo columna ${columna}  en tabla ${tabla}`)
    await global.knex.schema.alterTable(tabla, function (table) {
      table.integer(columna)
    })
  }
}
