import utils from './utils.js'

// Migraciones idempotentes: crean lo que falte sin tocar lo existente.
// Sirven tanto para una base nueva como para las existentes. Para agregar una columna, sumarla
// acá con add_column. Las migraciones de datos de una sola vez (tags, ts, tonalidad y beats de
// files, proyectos, estado/rol de users) ya corrieron en todas las bases y se quitaron; las
// columnas viejas que dejaron (users.props, files.track_group/tag/tags/props, etc.) siguen en las
// bases existentes pero ya no se crean.
export default async function do_migrations() {

  await create_table("users")
  await add_column("users", "password", string(60)) // hash bcrypt
  await add_column("users", "email", string(1024)) // es el login: se guarda en minúsculas
  await add_column("users", "name", string(32))
  await add_column("users", "ts", string(21))
  await add_column("users", "bytes_used", integer())
  await add_column("users", "status", string(16)) // pending | active | blocked
  await add_column("users", "role", string(16)) // user | admin
  await add_column("users", "bio", string(512)) // texto breve (~280), público
  await add_column("users", "max_seconds", integer()) // cuota de audio en segundos; null = default de .env
  await create_unique_index("users", "email")
  await create_unique_index("users", "name")

  await create_table("files")
  await add_column("files", "user_id", string(36))
  await add_column("files", "original_name", string(256))
  await add_column("files", "size", integer())
  await add_column("files", "duration", float()) // segundos (ffprobe); la cuota se mide con esto
  await add_column("files", "bpm", float()) // deducido: beats × 60 / duración (solo loops)
  await add_column("files", "beats", integer()) // largo del loop en beats; lo carga el creador (solo loops)
  await add_column("files", "kind", string(8, "loop")) // "loop" (se ajusta al tempo) | "shot" (sample suelto)
  // anclaje de un disparo one-shot: "start" (empieza en el punto) | "end" (termina en el punto)
  await add_column("files", "anchor", string(8, "start"))
  await add_column("files", "music_key", string(8)) // tonalidad ("G", "C#m"...), "atonal" o null (sin dato)
  await add_column("files", "ts", string(21)) // fecha de alta (ISO sin ms, como users.ts)
  await migrate_file_durations()
  // oculto por el admin (moderación): 0 | 1. Fuera del catálogo y del sorteo, sin cascada
  await add_column("files", "hidden", integer(0))
  // loudness integrada (LUFS) y true peak (dBFS) del mp3 entero (ebur128, utils.measure_ebur128); null = sin
  // medir. Se miden al subir; los null los completa fill_file_loudness en segundo plano, después del listen
  await add_column("files", "loudness", float())
  await add_column("files", "peak", float())

  await create_table("user_track_groups")
  await add_column("user_track_groups", "user_id", string(36))
  await add_column("user_track_groups", "name", string(256))
  await add_column("user_track_groups", "color", string(32))
  await add_column("user_track_groups", "props", string(4096)) // JSON: config de la pista (volume, mute, solo...)
  await add_column("user_track_groups", "project_id", string(36))
  await create_index("user_track_groups", "project_id")

  await create_table("user_tags")
  await add_column("user_tags", "user_id", string(36))
  await add_column("user_tags", "name", string(256))
  await add_column("user_tags", "color", string(32))
  await add_column("user_tags", "project_id", string(36))
  // peso en el sorteo del próximo Tag (0 = no sale nunca, 32 = máximo); los existentes quedan en 16
  await add_column("user_tags", "weight", integer(16))
  await create_index("user_tags", "project_id")

  // proyectos (fase 3 de publicación): un solo dueño; pistas, tags y archivos son por proyecto
  await create_table("projects")
  await add_column("projects", "user_id", string(36))
  await add_column("projects", "name", string(256))
  await add_column("projects", "hidden", integer(0)) // oculto por el admin: 0 | 1
  await add_column("projects", "props", string(4096)) // JSON: tempo, beats_x_bar, tag_range, delay...
  await add_column("projects", "ts", string(21))
  await create_index("projects", "user_id")

  // archivos de cada proyecto (propios o importados del catálogo) con su pista, tags y volumen
  await create_table("project_files")
  await add_column("project_files", "project_id", string(36))
  await add_column("project_files", "file_id", string(36))
  await add_column("project_files", "track_group", string(36)) // id de user_track_groups del mismo proyecto
  await add_column("project_files", "tags", string(4096)) // JSON: array de ids de user_tags del mismo proyecto
  await add_column("project_files", "props", string(4096)) // JSON: { volume, weight, repeat } (weight sin dato = 16)
  await create_index("project_files", "project_id")
  await create_index("project_files", "file_id")

  // bytes servidos de audio por día (id = "YYYY-MM-DD" UTC), para controlar el tope de tráfico del VPS
  await create_table("traffic")
  await add_column("traffic", "bytes", integer())
  await add_column("traffic", "requests", integer())

  // denuncias (tarea 4.4): las hace un usuario logueado sobre un archivo o un proyecto; las revisa el
  // admin (fase 5). Sin claves foráneas: si el archivo o proyecto se borra, la denuncia queda
  await create_table("reports")
  await add_column("reports", "target_type", string(16)) // file | project
  await add_column("reports", "target_id", string(36)) // id de files o de projects
  await add_column("reports", "reporter_user_id", string(36))
  await add_column("reports", "reason", string(1024)) // texto del denunciante (hasta 500 caracteres)
  await add_column("reports", "status", string(16, "open")) // open | resolved | dismissed (los cambia el admin)
  await add_column("reports", "ts", string(21))
  await create_index("reports", "target_id")
  await create_index("reports", "reporter_user_id")
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
    let info = await utils.probe(utils.audio_path(file.user_id, file.id))
    if (!info.is_audio) {
      fallidos++
      console.warn(`  sin duración: ${file.id} (no existe o no es audio)`)
      continue
    }
    await global.knex("files").where({ id: file.id }).update({ duration: info.duration })
  }
  if (fallidos) console.warn(`  ${fallidos} archivo(s) quedaron sin duration`)
}

// `files.loudness` / `files.peak` de los archivos que no las tengan, medidas con ebur128. No es parte de
// do_migrations: index.js la lanza sin esperarla después del listen (con ~1000 archivos tarda minutos y no
// tiene que demorar el arranque). Secuencial, de a un ffmpeg con prioridad baja, así no le saca CPU a las
// subidas ni a los requests. Tolerante a errores: un archivo que falla (mp3 que falta, ffmpeg que no lo lee)
// se avisa y queda null; se reintenta en el próximo arranque (cada intento falla rápido). Un archivo silencioso
// no es un error: queda medido con el piso (-70, ver utils.parse_ebur128) y no se vuelve a medir.
const FILL_WARN_MAX = 10 // avisos individuales de archivos fallidos; el resto solo cuenta en el resumen
const FILL_PROGRESS_EVERY = 100
export async function fill_file_loudness() {
  let files = await global.knex("files").whereNull("loudness").select("id", "user_id")
  if (!files.length) return
  console.log(`Mido loudness de ${files.length} archivo(s) con ebur128, en segundo plano`)
  let t0 = Date.now()
  let ok = 0
  let failed = 0
  for (let [n, file] of files.entries()) {
    try {
      let m = await utils.measure_ebur128(utils.audio_path(file.user_id, file.id), true)
      // si se borró mientras tanto, el update no toca nada
      await global.knex("files").where({ id: file.id }).update({ loudness: m.loudness, peak: m.peak })
      ok++
    } catch (e) {
      failed++
      if (failed <= FILL_WARN_MAX) {
        let reason = String(e.stderr || e.message || e).trim().split("\n").pop()
        console.warn(`  sin loudness: ${file.id} (${reason})`)
      }
    }
    if ((n + 1) % FILL_PROGRESS_EVERY == 0) console.log(`  loudness: ${n + 1}/${files.length}`)
  }
  let secs = Math.round((Date.now() - t0) / 1000)
  console.log(`Loudness: ${ok} medido(s), ${failed} fallido(s), en ${secs} s`)
}

// crea la tabla solo con la PK `id` (uuid); las columnas se agregan con add_column
async function create_table(tabla) {
  if (!await global.knex.schema.hasTable(tabla)) {
    console.log(`Creo tabla ${tabla}`)
    await global.knex.schema.createTable(tabla, function (t) {
      t.string('id', 36).primary()
    })
  }
}

// agrega la columna si no existe; `build(table, columna)` la define (ver string, integer, float)
async function add_column(tabla, columna, build) {
  if (await global.knex.schema.hasColumn(tabla, columna)) return
  console.log(`Creo columna ${columna} en tabla ${tabla}`)
  await global.knex.schema.alterTable(tabla, table => build(table, columna))
}

// con `default_value`, la columna es NOT NULL con ese default: las filas existentes y los insert que
// no la mencionan lo toman (las banderas 0 | 1 son integer(0))
function string(length, default_value) {
  return (table, columna) => not_null_default(table.string(columna, length), default_value)
}
function integer(default_value) {
  return (table, columna) => not_null_default(table.integer(columna), default_value)
}
function float() {
  return (table, columna) => table.float(columna)
}
function not_null_default(col, default_value) {
  if (default_value !== undefined) col.notNullable().defaultTo(default_value)
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
