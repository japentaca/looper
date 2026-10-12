# Plan: Looper como instalación sonora

Plan para implementar en una sesión nueva con un agente orquestador. Looper va a correr horas sin
nadie al lado, así que se prioriza: no fatigar (variedad y evolución lenta), proteger el equipo
(nivel controlado) y robustez (que se recupere solo y recuerde su estado).

**Antes de empezar, leer:** `AGENTS.md` (reglas, estilo, verificación), `docs/ARCHITECTURE.md`
(motor y sección "Mixer y vúmetros"), `docs/KNOWN_ISSUES.md`.

## Cómo ejecutarlo

- **Las fases van en orden y una por vez.** Casi todas tocan los mismos archivos (`Tracks.vue`,
  `helpers/mixer.js`, `App.vue`), así que no conviene paralelizarlas entre agentes. Si se usa
  orquestador, que delegue **una fase por subagente, secuencialmente**, y que revise cada fase
  (diff + lint + build) antes de lanzar la siguiente.
- **Un commit por fase**, en `main`, en español, sin push.
- **Verificación por fase** (de `AGENTS.md`):
  - backend: `node --check` en cada archivo tocado, `npm run lint` y arrancar `node index.js`;
  - frontend: `npm run lint` y `npm run build`.
  - El audio no se puede verificar automáticamente: cada fase deja escrita una lista de
    **pruebas manuales** en el mensaje final.
- **Cada fase actualiza en el mismo commit** `docs/ARCHITECTURE.md`, `docs/API.md` (si cambia algo
  de endpoints o datos) y `docs/KNOWN_ISSUES.md` (si resuelve algo de ahí).
- **No tocar `storage/`.** Para probar migraciones, trabajar sobre una copia de `db.sqlite`.

## Estado actual relevante (al escribir este plan)

- **`helpers/mixer.js`:** un `Tone.Channel` (estéreo) por track group, creado lazy en
  `route_player(file_id)`, que llama `start_file`. Tiene mute/solo en `mixer` (reactive, **solo en
  memoria**), un vúmetro por canal (post-mute) y un vúmetro master colgado de `Tone.getDestination()`.
- **Tracks:** se arman en `start()` (`Tracks.vue`) **solo** desde los track groups que tienen
  archivos cargados (`temp_trg`). Están en `TrackCtrl.tracks`.
- **Motor:** `set_next_step(time)` corre cada `"4n"` con `Tone.Transport.scheduleRepeat`.
  - Cuando `track.remaining_beats == 0` elige un archivo al azar compatible con el Tag
    (`available_files_per_TRG`) y lo arranca.
  - El cambio de Tag ocurre cuando `current_TAG.remaining_beats == 1` y llama `selectTag()`.
- **`props.oneShot`:** existe por archivo (checkbox en `Files.vue`), pero el motor no lo usa.
- **`user_track_groups`:** tiene columnas `id, user_id, name, color, silences` (`silences` sin uso).
- **Guardado de track groups:** el frontend usa `save_trackGroups` (`helpers/composable.js` →
  `api.save_trackGroups`), que manda **toda la colección**. En el backend,
  `replace_user_rows("user_track_groups")` borra las filas del usuario e **inserta cada objeto tal
  cual** (`{ ...r, user_id }`).
  - ⚠ Cualquier campo extra que tenga el objeto en el cliente rompe el insert (columna
    inexistente), y un objeto anidado no se serializa.
- **`GET /get_user_info`:** devuelve `track_groups` con las filas tal cual
  (`backend/routes/api.js`, ~línea 289).

---

## Fase 1 — Limitador en el master

**Objetivo:** que nunca clipee la salida, aunque coincidan varios loops fuertes.

- En `helpers/mixer.js`, insertar un `Tone.Limiter(-1)` en la cadena del master con
  `Tone.getDestination().chain(limiter)`.
  - Ojo: `chain` desconecta lo previo del input de Destination; revisar que los canales y el
    preview sigan sonando.
- El vúmetro master tiene que medir **después** del limitador; hoy cuelga del output de
  Destination, así que debería seguir siendo así. Verificarlo.

**Pruebas manuales:** con todas las pistas a volumen alto, el master no pasa del rojo de forma
sostenida y no se oye distorsión digital. El preview sigue sonando.

## Fase 2 — Config persistente por track (`props` en `user_track_groups`)

**Objetivo:** que el track group sea "la pista", con configuración guardada. Es la base de las
fases 3, 4 y 6.

### Backend

- **Migración:** `create_column_string("user_track_groups", "props", 4096)` en `db_migrations.js`.
- **`get_user_info`:** parsear `props` de cada track group (`{}` si es null o inválido), igual que
  se hace con `files.props`.
- **`replace_user_rows`:** solo para `user_track_groups`, guardar únicamente las columnas conocidas
  (`id, name, color, props`) y hacer `JSON.stringify(props)`. Sin esto, campos del cliente rompen
  el insert. Hacerlo con una lista blanca de columnas por tabla (también sirve para `user_tags`:
  `id, name, color`).

### Frontend

- **Defaults** al cargar (`composable.js`, donde se arman `store.track_groups`):
  `props = { volume: 0, mute: false, solo: false, rest: 0, mode: "loop", ...lo_guardado }`.
  Los campos de fases futuras se agregan en su fase.
- **`mixer.js`:** el mute/solo pasa a leerse y escribirse en `trg.props.mute` / `trg.props.solo`, en
  lugar de `mixer.mute` / `mixer.solo`. `toggle_mute` / `toggle_solo` guardan con
  `save_trackGroups` (con un debounce corto si hace falta). Al crear el canal se aplica lo guardado.
- **Volumen por pista:** `props.volume` (dB) va al `channel.volume`. Agregar un `Fader` chico en
  la tira (o un `Knob`; elegir el que entre en 112px de ancho).
- **Tiras desde todos los track groups:** en `start()`, armar `tracks` desde `store.track_groups`
  (todos), no desde `temp_trg`. Una pista sin archivos queda en silencio.
  - Revisar que `set_next_step` no rompa con `available_files_per_TRG[id]` vacío o indefinido:
    hoy hace `return` si `length == 0`, pero hay que asegurar que el array exista para todos.
- **Tiras con el transporte detenido:** mostrarlas también antes de START, armadas desde
  `store.track_groups`, para poder configurar mute/solo/volumen antes de arrancar. Hoy
  `v-if="tracks.length"` las oculta. Una forma limpia es una lista computada de pistas a mostrar
  que combine `store.track_groups` con el estado de `TrackCtrl.tracks`.
- **UI:** rotular "Tracks" donde hoy dice "Track groups" en la sidebar. **No renombrar nada en la
  base ni en el código** (`track_group`, `trg` se quedan).
- **Docs:** `ARCHITECTURE.md` (modelo de datos y mixer), `API.md` (forma de `track_groups`).

**Pruebas manuales:**
- Mute, solo y volumen sobreviven a recargar la página.
- Las tiras aparecen antes de START y también las de grupos sin archivos.
- Renombrar o cambiar el color de un pad sigue guardando.
- Borrar un track group sigue funcionando.

## Fase 3 — Silencios / densidad por pista

**Objetivo:** que no suenen siempre todas las pistas. Es la mayor ganancia de variedad.

- **Parámetro:** `trg.props.rest`, de 0 a 1. Es la probabilidad de que, al terminar su loop, la
  pista descanse en vez de elegir otro.
- **Cuánto descansa:** la duración de un loop compatible elegido al azar, o 2^n beats con n en un
  rango chico. Elegir una opción y documentarla.
- **En el motor**, cuando `remaining_beats == 0`: con probabilidad `rest`, poner
  `track.resting = true` y `remaining_beats = N` sin arrancar archivo; `curr_file` queda null
  durante el descanso.
  - Que el LCD, los `StepLeds` y el LED de actividad lo reflejen: apagados, o un indicador
    "REST" en el LCD.
- **Control:** un `Knob` chico "Rest" en la tira, guardado en `props`.
- **Columna `silences`:** queda sin uso y se documenta así. No reutilizarla, para no confundir.
- Actualizar `KNOWN_ISSUES.md` (la parte de `silences`) y `ARCHITECTURE.md` (algoritmo del motor).

**Pruebas manuales:**
- Con Rest en 0 todo funciona como antes.
- Con Rest alto la pista calla seguido y vuelve a entrar siempre en un beat.
- Los descansos no desincronizan la pista: los loops siguen alineados al compás.

## Fase 4 — Pistas one-shot

**Objetivo:** efectos de un solo disparo, con un "cuándo" musical.

- **Modo de pista:** `trg.props.mode = "loop" | "oneshot"`, con un toggle en la tira o en un
  diálogo de config del pad.
  - El `props.oneShot` por archivo **deja de usarse**: quitar el checkbox de `Files.vue`, o
    documentar que se ignora. Elegir una opción, actualizar `KNOWN_ISSUES.md` y no borrar datos.
- **Disparadores** de una pista one-shot (configurables en `props`, se pueden combinar):
  - `on_tag_change` (bool): dispara en el **downbeat del Tag nuevo**, en el mismo `time` del
    beat donde se llama `selectTag()`.
  - `density`: probabilidad por compás (0..1). En cada downbeat (`beat.downbeat`, o calculado
    desde los ticks en el callback de audio, **no** desde el estado visual) se tira el dado.
- **Archivo:** se elige al azar entre los compatibles con el Tag actual (misma lógica que los
  loops).
  - No se corta al terminar el beat: suena entero.
  - Si ya está sonando ese mismo player, decidir entre reiniciarlo o saltear el disparo; saltear
    es más seguro.
- **Programación:** con el `time` del callback (regla del motor, ver `ARCHITECTURE.md`). Nunca
  `setTimeout`.
- **Tira:** muestra el nombre del último disparo y el LED destella al disparar. La fila de pasos no
  aplica: ocultarla o dejarla apagada.

**Pruebas manuales:**
- Una pista one-shot con `on_tag_change` suena exactamente al empezar cada Tag.
- Con `density` en 0.25, dispara más o menos uno de cada 4 compases, siempre en el downbeat.
- Respeta mute y solo y mueve su vúmetro.

## Fase 5 — Efectos por pista con modulación lenta

**Objetivo:** que el mismo material suene distinto a lo largo de horas.

- **Cadena por pista** en `mixer.js`: `player → Filter → Channel`. Agregar un `Tone.Filter`
  (lowpass) por pista. Con el filtro abierto (frecuencia alta) suena igual que antes.
- **Reverb compartida por send:** un único `Tone.Reverb` (decay de unos 6 s, `wet = 1`)
  conectado a Destination. Cada `Channel` hace `channel.send("reverb", db)` y la reverb hace
  `reverb.receive("reverb")` (API de buses de `Tone.Channel`).
  - Nivel de send por pista en `props.reverb` (dB, `-Infinity` = nada).
- **Modulación lenta:** por pista, `props.drift` de 0 a 1.
  - Una caminata al azar suave sobre la frecuencia del filtro y sobre el nivel del send.
  - Se actualiza cada pocos segundos con `rampTo` (por ejemplo, un `Tone.Loop` cada `"1m"` que
    hace `filter.frequency.rampTo(nuevo, "1m")`).
  - Con `drift = 0` no se modula nada.
- **Controles en la tira:** knobs chicos "Rev" y "Drift". Si no entran en la tira, ir a un diálogo
  de configuración de la pista: doble clic largo o botón en el pad. Decidir y documentar.
- **CPU:** una sola reverb y un filtro por pista es barato. **No** poner efectos por archivo.

**Pruebas manuales:**
- Con Rev y Drift en 0 suena idéntico a antes.
- Con Rev la cola de reverb se escucha y sigue mute y solo (el send sale del canal: verificar si
  es pre o post mute y documentarlo).
- Con Drift el timbre cambia lentamente en minutos, sin saltos ni clics.

## Fase 6 — Robustez para correr solo

**Objetivo:** que la instalación arranque y se mantenga sin intervención.

- **Autostart:** opción para que, al terminar de cargar los audios, se haga START automáticamente.
  - Puede ser un parámetro en la URL (`?autostart=1`) o una preferencia guardada en
    `localStorage` con try/catch.
  - El navegador bloquea el audio sin un gesto del usuario. Documentar en `AGENTS.md` o en un
    `docs/INSTALACION.md` cómo lanzar Chrome en modo kiosko con
    `--autoplay-policy=no-user-gesture-required`.
  - Si `Tone.context.state != "running"`, mostrar un botón grande "Click to start" como respaldo.
- **Recuperación:** si el `AudioContext` pasa a `suspended` o `interrupted`, intentar
  `Tone.context.resume()`. Si se pierde la sesión (401/403 del backend), mostrar el estado en el
  LED de la barra sin romper la reproducción, porque los audios ya están en memoria.
- **Fuga de memoria:** revisar lo que crece con el tiempo.
  - Los `Tone.Draw.schedule` se ejecutan y se descartan; verificarlo.
  - `beat.n` crece sin límite (ya se trunca para el LCD).
  - Listeners y `Tone.Loop` que se crean en cada START tienen que eliminarse en STOP.
  - Dejar anotado en `KNOWN_ISSUES.md` lo que no se pueda medir sin una corrida larga.
- **Prueba larga (manual):** dejarlo correr 8 a 12 horas y comparar la memoria del tab en el Task
  Manager de Chrome al principio y al final.

---

## Prompt sugerido para lanzar la sesión nueva

> Leé `docs/PLAN_instalacion.md` y ejecutalo fase por fase, en orden. Delegá cada fase a un
> subagente, de a una, y revisá su diff, lint y build antes de pasar a la siguiente. Hacé un commit
> por fase en `main`, sin push. Al final, resumime qué se hizo, qué se verificó y la lista de
> pruebas manuales de cada fase. Si una decisión del plan dice "elegir", elegí la opción más
> simple y anotala en el resumen.
