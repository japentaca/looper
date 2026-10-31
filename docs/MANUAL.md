# Mantener el manual (`/manual`)

El manual de uso es una ruta pública del frontend (`/manual`, `views/Manual.vue`), con una sección por archivo
en `frontend/src/manual/sections/*.vue` y la lista ordenada en `frontend/src/manual/sections.js`. El plan y las
decisiones están en `docs/PLAN_MANUAL.md`. Este documento explica cómo regenerar las capturas y cómo agregar
tomas.

## Reglas

- **Los ids de las secciones son anclas fijas** (`/manual#<id>`): una vez publicados no se cambian (los usan los
  links y los `?` de los diálogos). Se puede cambiar el título, no el id.
- Las capturas (`frontend/public/manual/<id>.webp`) se generan **solo** con `npm run manual_shots` contra el
  sandbox, nunca con los datos reales: el sandbox es una copia de `storage/` fuera del repo y la cuenta que se
  ve es la de demo. Antes de commitear una captura, mirarla: no tiene que mostrar datos privados (emails,
  proyectos de otros usuarios que no sean públicos, etc.).
- Los números de las anotaciones no van quemados en la imagen: son `callouts` de `<ManualShot>` en % sobre la
  captura. Si una captura cambia de diseño, actualizar también sus posiciones (las imprime el script).

## 1. Preparar el sandbox

```bash
node backend/manual_sandbox.js            # desde la raíz del repo
```

- Copia `storage/` (base y audios, ~40 MB) a `%TEMP%/looper_manual_sandbox/storage` (otro directorio: como
  argumento, `node backend/manual_sandbox.js <dir>`, o con la variable `LOOPER_SANDBOX`). El directorio tiene
  que estar fuera del repo; el script se niega si la base destino es `<repo>/storage/db.sqlite`.
- Escribe `<sandbox>/.env`: copia de `backend/.env` donde solo cambian `db_file` y `storage_path` (apuntan a la
  copia). No se imprime (tiene secretos). Redis es el mismo del desarrollo (solo sesiones).
- En la **copia** de la base crea el usuario de demo y su proyecto (ver abajo).
- Cada corrida rehace la copia desde cero: lo que se haya cambiado en el sandbox se pierde. Hay que bajar el
  backend del sandbox antes (en Windows la base abierta no se puede borrar).

El script está en `backend/` y no en `frontend/scripts/` porque usa knex, better-sqlite3 y bcrypt, que son
dependencias del backend.

### Datos de demo

- Usuario: email **`demo@example.com`**, clave **`demo-looper`**, nombre público `demo` (`active`, `user`). Solo
  existe en el sandbox.
- Proyecto **Demo Psy Groove** (138 BPM, cambio de Tag cada 32–64 beats, compresor encendido), con archivos del
  catálogo (son del dueño de la base; el demo los usa como si los hubiera importado):

| Pista | Modo | Archivos | Tags |
|---|---|---|---|
| Kick | loop | `bombo 138.wav` | Groove 4/4, Triplet |
| Drums | loop | `Top_Loop_*` (5 rectos, 3 triplet) | Groove 4/4 o Triplet |
| Perc | loop | `Top_Loop_*` (4 rectos, 1 triplet) | Groove 4/4 o Triplet |
| Bass | loop | `G_Bass_Loop_*` (3 rectos, 2 triplet) | Groove 4/4 (uno también Breakdown) o Triplet |
| Lead | loop | `G_Synth_Loop_*` (3 rectos, 3 triplet) | varios también en Breakdown |
| Impacts | one-shot (al cambiar de Tag) | `MB3_IMPACT_*`, `MB3_BOOM_*` | los tres |

  Tags: **Groove 4/4**, **Triplet** y **Breakdown** (sin batería). En total 29 archivos. La lista está al
  principio de `backend/manual_sandbox.js` (`TAGS`, `TRACKS`, `PROJECT_PROPS`), por nombre de archivo: si alguno
  no está en la base, se saltea con un aviso.
- Dos proyectos más del demo, para que la galería y la lista de proyectos no tengan uno solo
  (`EXTRA_PROJECTS`): **Triplet Night** (140 BPM, solo el Tag Triplet) y **Breakdown Sketch** (136 BPM, solo
  Breakdown), armados con las mismas pistas y archivos. Tienen un `ts` más nuevo: la app abre primero el más viejo,
  así que `/?autostart=1` sigue abriendo Demo Psy Groove (la galería, en cambio, muestra primero los nuevos).
- En la copia, los proyectos de los demás usuarios quedan ocultos (`hidden = 1`, `HIDE_OTHER_PROJECTS`): la
  galería del sandbox solo muestra los del demo, sin nombres ni proyectos reales.
- En la copia, los demás usuarios quedan anónimos (`ANONYMIZE_OTHER_USERS`): nombre `artist_<n>`, email
  `artist_<n>@example.com` y sin bio. El catálogo (diálogo IMPORT) muestra el creador de cada archivo.
- El proyecto del tutorial (*My first project*: pistas Drums y Bass, Tags Groove y Break, cuatro loops) no está en
  la base: lo crean por la API las tomas que lo usan (`tutorial_project` en `manual_shots.js`) y lo borran al
  terminar (`after: [delete_tutorial]`), así la galería y la lista de proyectos no cambian.

## 2. Levantar backend y frontend contra el sandbox

Los puertos son fijos (31200 el backend, 31201 el frontend con `strictPort`, por CORS). Si están ocupados (el
dev de siempre corriendo), bajar ese dev primero; un agente **no** mata procesos que no levantó: avisa y se
detiene.

```bash
# backend: desde el directorio del sandbox (dotenv lee el .env del directorio actual)
cd "$TEMP/looper_manual_sandbox" && node <repo>/backend/index.js

# frontend: el dev de siempre (frontend/.env.local con VITE_APP_BACKEND=http://localhost:31200)
cd frontend && npm run dev
```

En PowerShell: `cd $env:TEMP\looper_manual_sandbox; node <repo>\backend\index.js`.

## 3. Sacar las capturas

```bash
cd frontend
npm run manual_shots                       # todas las tomas
npm run manual_shots -- overview gallery   # solo esas
```

- Usa el Chrome instalado (`C:/Program Files/Google/Chrome/Application/chrome.exe`; otro con `CHROME_PATH`),
  en modo headless, con `--autoplay-policy=no-user-gesture-required` (para capturar estados sonando: LEDs, LCD,
  vúmetros) y `--mute-audio` (suena sin salir por los parlantes).
- Cada toma corre en un contexto aislado del navegador (cookies y `localStorage` propios); las que piden login
  entran como demo por la API.
- Guarda `frontend/public/manual/<id>.webp` (calidad 85, viewport 1440×900 salvo que la toma diga otro,
  `deviceScaleFactor` 1).
- Para cada toma con `marks` imprime las posiciones de los números, listas para pegar en los `callouts`:
  `{ n: 3, x: 15.1, y: 32.3 },`.
- Otras variables: `MANUAL_BASE` (frontend, default `http://localhost:31201`), `MANUAL_BACKEND` (default
  `http://localhost:31200`), `MANUAL_EMAIL` / `MANUAL_PASSWORD` (default el demo), `MANUAL_HEADFUL=1` (ver el
  navegador mientras trabaja, para depurar una toma).

Al terminar, bajar el backend del sandbox y el dev del frontend.

## 4. Agregar una toma

Las tomas son una lista declarativa (`SHOTS`) en `frontend/scripts/manual_shots.js`:

```js
{
  id: "overview",               // archivo: public/manual/overview.webp
  url: "/?autostart=1",         // ruta del frontend
  login: true,                  // entra como demo antes de abrir la url
  viewport: { width: 1440, height: 1600 }, // opcional (default 1440×900)
  steps: [wait_ready, wait_no_dialog, wait_playing, sleep(9000)], // pasos previos, en orden
  // selector: ".el-dialog",    // opcional: captura solo ese elemento
  // clip: { x, y, width, height }, // opcional: recorte del viewport (o un paso que lo devuelve: clip_around)
  // after: [delete_tutorial],  // opcional: pasos de limpieza, corren aunque la toma falle
  marks: [                      // opcional: dónde van los números (las posiciones se imprimen)
    { n: 1, sel: ".topbar .nameplate", at: "tr" },
    { n: 2, sel: ".sidebar .side_title", i: 1, at: "tr", dx: -24 },
  ],
}
```

- **Pasos:** funciones `async (page) => ...` de puppeteer. Hay helpers: `sleep(ms)`, `click(selector)`,
  `wait_ready` (LED de estado en *Ready*: terminaron de cargar los audios), `wait_playing` (el transporte
  corre), `wait_no_dialog` (no hay diálogos de Element Plus abiertos), `goto_public(nombre, query)` (abre
  `/p/<id><query>` del proyecto de demo con ese nombre: el id cambia en cada sandbox), `wait_play_armed` y
  `click_play` (diálogo de carga armado con PLAY, link `?play=1`), `wait_public_ready` (LED de la vista pública
  en *Ready*), `click_text(texto, scope)` (botón visible por su texto), `wait_dialog(título)` (espera el diálogo
  de Element Plus con ese título y lo marca con `data-shot`: la toma usa `selector: "[data-shot]"`), `open_last`
  (contesta OPEN a la pregunta de entrada y espera la carga), `scroll_to(sel, i)`, `files_box` (vista Box de Files),
  `tutorial_project({ unassigned, query })`, `choose_upload_files` (elige wav sintéticos en Upload Files, sin
  subirlos) y `fake_drag(pad, i)` (un pad "arrastrado" sobre un cartucho de Files, a mitad de camino). Para recortes
  calculados en la página, `clip: clip_around([[selector, índice], ...], { pad, height })`. Para algo puntual se
  escribe la función en la misma toma.
- Para la vista pública sonando se usa `?play=1` + `click_play`, no `?autostart=1`: con este último el START
  inmediato falla en la vista pública (ver `docs/KNOWN_ISSUES.md`).
- **Marks:** `sel` (selector CSS; `i` = cuál de los que coinciden, default 0), `at` = `center` (default) o una
  esquina `tl` | `tr` | `bl` | `br` (a 16 px de los bordes), `dx` / `dy` = corrimiento en px. Elegir lugares
  que no tapen lo que se explica y que no queden pegados entre sí (en celular la captura se achica y los
  números no).
- `/?autostart=1` abre el proyecto del demo (Demo Psy Groove) sin la pregunta de entrada y hace START solo.
- `<ManualShot>` también acepta `to` en cada callout (id de una sección: la leyenda termina con un link a esa
  sección) y `max_width` (px) para capturas chicas, como un diálogo, que no conviene estirar.
- Después de sacarla: mirar el webp, ponerlo en su sección con
  `<ManualShot src="/manual/<id>.webp" alt="..." :callouts="[...]" />` (las posiciones que imprimió el script,
  con su `text`) y revisar `/manual#<sección>` en el navegador.
