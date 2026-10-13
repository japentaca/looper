import { stat } from 'fs/promises'
import { v4 as uuid } from 'uuid'
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
  await create_column_string("users", "props", 4096) // obsoleto: pasó a projects.props (migrate_projects); queda como respaldo
  await migrate_users()

  await create_table("files")
  await create_column_string("files", "user_id", 36)
  await create_column_string("files", "original_name", 256)
  await create_column_string("files", "track_group", 256) // obsoleto: pasó a project_files (migrate_projects)
  await create_column_string("files", "tag", 256) // obsoleto: reemplazado por `tags`, queda como respaldo
  await create_column_number("files", "size")
  await create_column_string("files", "props", 4096) // obsoleto: pasó a project_files (migrate_projects)
  await migrate_file_tags() // `files.tags` también quedó obsoleto: pasó a project_files
  await create_column_float("files", "duration") // segundos (ffprobe); la cuota se mide con esto
  await create_column_float("files", "bpm") // lo carga el creador
  await create_column_number("files", "beats") // largo del loop en beats; lo carga el creador
  await migrate_file_ts()
  await migrate_file_durations()
  // oculto por el admin (moderación): 0 | 1. Fuera del catálogo y del sorteo, sin cascada
  await create_column_flag("files", "hidden")

  await create_table("user_track_groups")
  await create_column_string("user_track_groups", "user_id", 36)
  await create_column_string("user_track_groups", "name", 256)
  await create_column_string("user_track_groups", "color", 32)
  await create_column_string("user_track_groups", "silences", 4096) // sin uso
  await create_column_string("user_track_groups", "props", 4096) // JSON: config de la pista (volume, mute, solo...)
  await create_column_string("user_track_groups", "project_id", 36)
  await create_index("user_track_groups", "project_id")

  await create_table("user_tags")
  await create_column_string("user_tags", "user_id", 36)
  await create_column_string("user_tags", "name", 256)
  await create_column_string("user_tags", "color", 32)
  await create_column_string("user_tags", "project_id", 36)
  await create_index("user_tags", "project_id")

  // proyectos (fase 3 de publicación): un solo dueño; pistas, tags y archivos son por proyecto
  await create_table("projects")
  await create_column_string("projects", "user_id", 36)
  await create_column_string("projects", "name", 256)
  await create_column_string("projects", "visibility", 16, "private") // OBSOLETA: todos los proyectos son públicos
  await create_column_flag("projects", "hidden") // oculto por el admin: 0 | 1
  await create_column_string("projects", "props", 4096) // JSON: tempo, beats_x_bar, tag_range, delay (antes users.props)
  await create_column_string("projects", "ts", 21)
  await create_index("projects", "user_id")

  // archivos de cada proyecto (propios o importados del catálogo) con su pista, tags y volumen
  await create_table("project_files")
  await create_column_string("project_files", "project_id", 36)
  await create_column_string("project_files", "file_id", 36)
  await create_column_string("project_files", "track_group", 36) // id de user_track_groups del mismo proyecto
  await create_column_string("project_files", "tags", 4096) // JSON: array de ids de user_tags del mismo proyecto
  await create_column_string("project_files", "props", 4096) // JSON: { volume }
  await create_index("project_files", "project_id")
  await create_index("project_files", "file_id")
  await migrate_projects()

  await create_table("sets")
  await create_column_string("sets", "user_id", 36)
  await create_column_string("sets", "name", 64)
  await create_column_string("sets", "tracks", 65535)
  await create_column_string("sets", "tags", 65535)

  // bytes servidos de audio por día (id = "YYYY-MM-DD" UTC), para controlar el tope de tráfico del VPS
  await create_table("traffic")
  await create_column_number("traffic", "bytes")
  await create_column_number("traffic", "requests")

  // denuncias (tarea 4.4): las hace un usuario logueado sobre un archivo o un proyecto; las revisa el
  // admin (fase 5). Sin claves foráneas: si el archivo o proyecto se borra, la denuncia queda
  await create_table("reports")
  await create_column_string("reports", "target_type", 16) // file | project
  await create_column_string("reports", "target_id", 36) // id de files o de projects
  await create_column_string("reports", "reporter_user_id", 36)
  await create_column_string("reports", "reason", 1024) // texto del denunciante (hasta 500 caracteres)
  await create_column_string("reports", "status", 16, "open") // open | resolved | dismissed (los cambia el admin)
  await create_column_string("reports", "ts", 21)
  await create_index("reports", "target_id")
  await create_index("reports", "reporter_user_id")
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

// proyectos (fase 3): pasa los datos de cada usuario a un primer proyecto propio.
// - projects: uno por usuario, con su `users.props` (config: tempo, compás, tag_range, delay)
// - project_id en sus pistas (user_track_groups) y tags (user_tags)
// - project_files: uno por cada archivo suyo, con `files.track_group/tags/props` tal cual
// Corre una sola vez: si ya hay algún proyecto, se da por migrado (los proyectos solo se crean
// acá o después desde la API). Todo en una transacción: si falla, no queda a medias y se reintenta
// en el próximo arranque. Las columnas viejas (`users.props`, `files.track_group/tags/props`) no
// se borran: quedan obsoletas, como respaldo.
const FIRST_PROJECT_NAME = "My project"

async function migrate_projects() {
  if (await global.knex("projects").first("id")) return
  let users = await global.knex("users").select("id", "props")
  if (!users.length) return
  console.log(`Migro datos a proyectos: un proyecto por usuario (${users.length})`)
  let ts = new Date().toISOString().slice(0, 19)
  await global.knex.transaction(async trx => {
    for (let user of users) {
      let project_id = uuid()
      await trx("projects").insert({
        id: project_id,
        user_id: user.id,
        name: FIRST_PROJECT_NAME,
        props: user.props ?? null,
        ts: ts,
      })
      let n_tg = await trx("user_track_groups").where({ user_id: user.id }).whereNull("project_id")
        .update({ project_id: project_id })
      let n_tags = await trx("user_tags").where({ user_id: user.id }).whereNull("project_id")
        .update({ project_id: project_id })
      let files = await trx("files").where({ user_id: user.id }).select("id", "track_group", "tags", "props")
      for (let f of files) {
        await trx("project_files").insert({
          id: uuid(),
          project_id: project_id,
          file_id: f.id,
          track_group: f.track_group,
          tags: f.tags,
          props: f.props,
        })
      }
      console.log(`  usuario ${user.id}: ${n_tg} pista(s), ${n_tags} tag(s), ${files.length} archivo(s)`)
    }
  })
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

// con `default_value`, la columna es NOT NULL con ese default (las filas existentes lo toman)
async function create_column_string(tabla, columna, length, default_value) {
  if (!await global.knex.schema.hasColumn(tabla, columna)) {
    console.log(`Creo columna ${columna}  en tabla ${tabla}`)
    await global.knex.schema.alterTable(tabla, function (table) {
      let col = table.string(columna, length)
      if (default_value !== undefined) col.notNullable().defaultTo(default_value)
    })
  }
}
// bandera 0 | 1, NOT NULL default 0: las filas existentes y los insert que no la mencionan quedan en 0
async function create_column_flag(tabla, columna) {
  if (!await global.knex.schema.hasColumn(tabla, columna)) {
    console.log(`Creo columna ${columna}  en tabla ${tabla}`)
    await global.knex.schema.alterTable(tabla, function (table) {
      table.integer(columna).notNullable().defaultTo(0)
    })
  }
}
// índice simple `<tabla>_<columna>_index` (para filtrar por dueño / proyecto / archivo)
async function create_index(tabla, columna) {
  let index_name = `${tabla}_${columna}_index`
  let existe = await global.knex("sqlite_master").where({ type: "index", name: index_name }).first()
  if (existe) return
  console.log(`Creo índice ${index_name}`)
  await global.knex.schema.alterTable(tabla, function (table) {
    table.index([columna], index_name)
  })
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
