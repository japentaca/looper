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
  await create_column_string("users", "props", 4096) // JSON: config global (tempo, beats_x_bar, delay)
  await migrate_users()

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

  // bytes servidos de audio por día (id = "YYYY-MM-DD" UTC), para controlar el tope de tráfico del VPS
  await create_table("traffic")
  await create_column_number("traffic", "bytes")
  await create_column_number("traffic", "requests")
}

// usuarios (fase 1 de publicación): estado, rol, bio y cuota; email y name únicos.
// Los usuarios que ya existían quedan `active` y el dueño original `admin`: eso se hace solo
// al crear cada columna, así que volver a migrar no pisa cambios posteriores.
const ADMIN_EMAIL = "jntaca@gmail.com"

async function migrate_users() {
  if (!await global.knex.schema.hasColumn("users", "status")) {
    await create_column_string("users", "status", 16) // pending | active | blocked
    await global.knex("users").update({ status: "active" })
  }
  if (!await global.knex.schema.hasColumn("users", "role")) {
    await create_column_string("users", "role", 16) // user | admin
    await global.knex("users").update({ role: "user" })
    await global.knex("users").whereRaw("lower(email) = ?", [ADMIN_EMAIL]).update({ role: "admin" })
  }
  await create_column_string("users", "bio", 512) // texto breve (~280), público
  await create_column_number("users", "max_seconds") // cuota de audio en segundos; null = default de .env

  // el email es el login y se guarda en minúsculas
  let n = await global.knex("users").whereRaw("email <> lower(email)").update({ email: global.knex.raw("lower(email)") })
  if (n) console.log(`Paso a minúsculas ${n} email(s) en tabla users`)

  await create_unique_index("users", "email")
  await create_unique_index("users", "name")
}

// índice único `<tabla>_<columna>_unique`; si hay valores repetidos falla y corta el arranque
// (hay que resolverlos a mano: no se elige cuál borrar). En SQLite los NULL no chocan entre sí.
async function create_unique_index(tabla, columna) {
  let index_name = `${tabla}_${columna}_unique`
  let existe = await global.knex("sqlite_master").where({ type: "index", name: index_name }).first()
  if (existe) return
  let repetidos = await global.knex(tabla).select(columna).count({ n: "*" })
    .whereNotNull(columna).groupBy(columna).havingRaw("count(*) > 1")
  if (repetidos.length) {
    throw new Error(`No se puede crear ${index_name}: hay ${repetidos.length} valor(es) repetido(s) en ${tabla}.${columna}`)
  }
  console.log(`Creo índice único ${index_name}`)
  await global.knex.schema.alterTable(tabla, function (table) {
    table.unique([columna], { indexName: index_name })
  })
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
