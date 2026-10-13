import { stat } from 'fs/promises'
import utils from './utils.js'

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
  await create_column_float("files", "duration") // segundos (ffprobe); la cuota se mide con esto
  await create_column_float("files", "bpm") // lo carga el creador
  await create_column_number("files", "beats") // largo del loop en beats; lo carga el creador
  await migrate_file_ts()
  await migrate_file_durations()

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

// ruta en disco del mp3 de un archivo (mismo criterio que routes/api.js)
function audio_path(file) {
  return global.config.storage_path + file.user_id + "/" + file.id + ".mp3"
}

// `files.ts`: fecha de alta (ISO sin ms, como users.ts). Al crear la columna, los archivos que ya
// existían toman la fecha de modificación de su mp3 (solo corre una vez).
async function migrate_file_ts() {
  if (await global.knex.schema.hasColumn("files", "ts")) return
  await create_column_string("files", "ts", 21)
  let files = await global.knex("files").select("id", "user_id")
  for (let file of files) {
    try {
      let st = await stat(audio_path(file))
      await global.knex("files").where({ id: file.id }).update({ ts: st.mtime.toISOString().slice(0, 19) })
    } catch {
      // sin mp3 en disco: ts queda null
    }
  }
}

// `files.duration` de los mp3 que no la tengan, medida con ffprobe (no se recodifican).
// Corre en cada arranque pero solo sobre los null, así que después de la primera vez no hace nada
// (salvo con archivos cuyo mp3 falta o no es audio: se avisa y quedan null).
async function migrate_file_durations() {
  let files = await global.knex("files").whereNull("duration").select("id", "user_id")
  if (!files.length) return
  console.log(`Calculo duration de ${files.length} archivo(s) con ffprobe`)
  let fallidos = 0
  for (let file of files) {
    let info = await utils.probe(audio_path(file))
    if (!info.is_audio) {
      fallidos++
      console.warn(`  sin duración: ${file.id} (no existe o no es audio)`)
      continue
    }
    await global.knex("files").where({ id: file.id }).update({ duration: info.duration })
  }
  if (fallidos) console.warn(`  ${fallidos} archivo(s) quedaron sin duration`)
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
async function create_column_float(tabla, columna) {
  if (!await global.knex.schema.hasColumn(tabla, columna)) {
    console.log(`Creo columna ${columna}  en tabla ${tabla}`)
    await global.knex.schema.alterTable(tabla, function (table) {
      table.float(columna)
    })
  }
}
