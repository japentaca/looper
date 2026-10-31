// Capturas del manual (/manual): abre Chrome con puppeteer-core contra el sandbox (backend con una copia de
// storage/ y el usuario de demo, ver docs/MANUAL.md) y guarda cada toma en public/manual/<id>.webp.
//   npm run manual_shots                    # todas las tomas
//   npm run manual_shots -- overview gallery  # solo esas
// Supone el backend del sandbox (31200) y el frontend de desarrollo (31201) ya corriendo.
// Variables de entorno (opcionales): CHROME_PATH, MANUAL_BASE (frontend), MANUAL_BACKEND, MANUAL_EMAIL,
// MANUAL_PASSWORD, MANUAL_HEADFUL=1 (ver el navegador mientras trabaja).
// Para cada toma con `marks`, imprime la posición en % (centro del número) de cada elemento marcado, lista
// para pegar en los callouts de <ManualShot> de su sección.
import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import puppeteer from "puppeteer-core"

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe"
const BASE = process.env.MANUAL_BASE || "http://localhost:31201"
const BACKEND = process.env.MANUAL_BACKEND || "http://localhost:31200"
const LOGIN = { email: process.env.MANUAL_EMAIL || "demo@example.com", password: process.env.MANUAL_PASSWORD || "demo-looper" }
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/manual")
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 }
const QUALITY = 85
// px desde la esquina del elemento hasta el centro del número (marks con at = "tl" | "tr" | "bl" | "br")
const MARK_INSET = 16

// ---------- pasos reutilizables (cada uno es async (page) => ...) ----------
const sleep = ms => () => new Promise(r => setTimeout(r, ms))
const click = sel => page => page.click(sel)
// clic en el botón visible cuyo texto es `text` (dentro de `scope`: un selector CSS)
const click_text = (text, scope = "body") => page => page.evaluate((text, scope) => {
  let b = [...document.querySelectorAll(scope + " button")]
    .find(b => b.getClientRects().length && b.textContent.trim() == text)
  if (!b) throw new Error("no está el botón " + text)
  b.click()
}, text, scope)
// espera el diálogo de Element Plus visible con ese título y lo marca con data-shot (la toma usa
// selector: "[data-shot]"); después espera la animación de apertura
const wait_dialog = title => async page => {
  let find = `[...document.querySelectorAll(".el-dialog")].find(d => d.getClientRects().length
    && d.querySelector(".el-dialog__title")?.textContent.trim() == ${JSON.stringify(title)})`
  await page.waitForFunction(find, { timeout: 30000 })
  await page.evaluate(`document.querySelectorAll("[data-shot]").forEach(e => e.removeAttribute("data-shot"));
    ${find}.setAttribute("data-shot", "1")`)
  await sleep(700)()
}
// pregunta al entrar ("Open project"): abre el último proyecto y espera que carguen sus audios
const open_last = async page => {
  await wait_dialog("Open project")(page)
  await click_text("OPEN", "[data-shot]")(page)
  await sleep(1000)()
  await wait_ready(page)
  await wait_no_dialog(page)
}
// lleva el elemento arriba de todo de su contenedor con scroll (el de la columna principal de la app)
const scroll_to = (sel, i = 0) => page => page.$$eval(sel, (els, i) => els[i].scrollIntoView({ block: "start" }), i)
// recorte calculado en la página: el rectángulo que abarca los elementos `sels` ([selector, índice]), con margen
// `pad`; con `height`, alto fijo desde el borde de arriba
const clip_around = (sels, { pad = 8, height = 0 } = {}) => page => page.evaluate((sels, pad, height) => {
  let rs = sels.map(([s, i]) => document.querySelectorAll(s)[i || 0]?.getBoundingClientRect()).filter(Boolean)
  let x = Math.max(0, Math.min(...rs.map(r => r.left)) - pad)
  let y = Math.max(0, Math.min(...rs.map(r => r.top)) - pad)
  let right = Math.min(window.innerWidth, Math.max(...rs.map(r => r.right)) + pad)
  let bottom = Math.min(window.innerHeight, height ? y + height : Math.max(...rs.map(r => r.bottom)) + pad)
  return { x: Math.round(x), y: Math.round(y), width: Math.round(right - x), height: Math.round(bottom - y) }
}, sels, pad, height)
// LED de estado de la barra superior en "Ready" (terminó la carga de audios)
const wait_ready = page => page.waitForFunction(
  () => document.querySelector(".topbar .status")?.textContent.includes("Ready"), { timeout: 120000 })
// transporte en marcha: el botón grande de Tracks dice STOP
const wait_playing = page => page.waitForFunction(
  () => [...document.querySelectorAll(".g_transport")].some(e => e.textContent.includes("STOP")), { timeout: 30000 })
// sin diálogos de Element Plus abiertos (el de carga de un proyecto, por ejemplo)
const wait_no_dialog = page => page.waitForFunction(
  () => ![...document.querySelectorAll(".el-overlay")].some(e => getComputedStyle(e).display != "none"), { timeout: 60000 })

// abre la vista pública (/p/<id>) del proyecto de demo `name` (el id cambia en cada sandbox: se busca en la galería)
const goto_public = (name, query = "") => async page => {
  let id = await page.evaluate(async (backend, name) => {
    let r = await fetch(backend + "/api/public/projects?per_page=100")
    return (await r.json()).data.items.find(p => p.name == name)?.id
  }, BACKEND, name)
  if (!id) throw new Error(`no está el proyecto público "${name}" (¿se corrió manual_sandbox.js?)`)
  await page.goto(BASE + "/p/" + id + query, { waitUntil: "networkidle2" })
}
// diálogo de carga armado con PLAY (link ?play=1): ya cargó todo y espera el clic
const wait_play_armed = page => page.waitForFunction(
  () => [...document.querySelectorAll(".loading_dialog")].some(e => e.textContent.includes("PLAY")), { timeout: 120000 })
// PLAY del diálogo de carga armado
const click_play = page => page.evaluate(() => [...document.querySelectorAll(".loading_dialog button")]
  .find(b => b.textContent.includes("PLAY")).click())
// la vista pública terminó de cargar los audios (LED de estado en "Ready")
const wait_public_ready = page => page.waitForFunction(
  () => document.querySelector(".pub_bar .status")?.textContent.includes("Ready"), { timeout: 120000 })

// ---------- proyecto del tutorial ("Tu primer proyecto") ----------
// Lo arma la toma por la API en la cuenta de demo (como si el usuario hubiera seguido los pasos) y lo borra al
// terminar (after: [delete_tutorial]). Archivos del catálogo por nombre; track / tags = índices de tracks / tags
const TUTORIAL = {
  name: "My first project",
  tracks: [{ name: "Drums", color: "#6b8ebf" }, { name: "Bass", color: "#f53404" }],
  tags: [{ name: "Groove", color: "#39e30b" }, { name: "Break", color: "#4fb6e8" }],
  files: [
    { name: "Top_Loop_01.wav", track: 0, tags: [0] },
    { name: "Top_Loop_02.wav", track: 0, tags: [0] },
    { name: "G_Bass_Loop_29.wav", track: 1, tags: [0] },
    { name: "G_Bass_Loop_34.wav", track: 1, tags: [0, 1] },
  ],
}
const TRG_PROPS = { volume: 0, pan: 0, rest: 0, rest_len: [4, 4], mode: "loop", on_tag_change: false, density: 0,
  bars: 1, reverb: null, delay: null, fx: [] }
// crea el proyecto del tutorial (los archivos de `unassigned`, por índice, quedan sin pista ni tags) y lo abre en
// la app sin la pregunta de entrada (con query = "?autostart=1", sonando)
const tutorial_project = ({ unassigned = [], query = "" } = {}) => async page => {
  let id = await page.evaluate(async (backend, spec, trg_props, unassigned) => {
    let api = async (method, url, body) => {
      let r = await fetch(backend + "/api" + url, { method, credentials: "include",
        headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
      let j = await r.json()
      if (!j.stat) throw new Error(url + ": " + j.text)
      return j
    }
    let p = (await api("POST", "/projects", { name: spec.name })).data
    let trg = spec.tracks.map(t => ({ id: crypto.randomUUID(), name: t.name, color: t.color, props: trg_props }))
    await api("PUT", `/projects/${p.id}/track_groups`, trg)
    let tags = spec.tags.map(t => ({ id: crypto.randomUUID(), name: t.name, color: t.color, weight: 16 }))
    await api("PUT", `/projects/${p.id}/tags`, tags)
    let add = []
    for (let [i, f] of spec.files.entries()) {
      let items = (await api("GET", "/catalog?per_page=10&q=" + encodeURIComponent(f.name))).data.items
      let c = items.find(it => it.original_name == f.name)
      if (!c) throw new Error("no está en el catálogo: " + f.name)
      add.push(unassigned.includes(i) ? { id: c.id }
        : { id: c.id, track_group: trg[f.track].id, tags: f.tags.map(t => tags[t].id) })
    }
    await api("PUT", `/projects/${p.id}/files`, { add })
    // se abre sin preguntar: último proyecto de este navegador + pedido de apertura (como OPEN IN EDITOR)
    localStorage.setItem("looper_project_id", p.id)
    sessionStorage.setItem("looper_open_project", p.id)
    return p.id
  }, BACKEND, TUTORIAL, TRG_PROPS, unassigned)
  page.tutorial_id = id
  await page.goto(BASE + "/" + query, { waitUntil: "networkidle2" })
  await sleep(800)()
  await wait_ready(page)
}
const delete_tutorial = async page => {
  if (!page.tutorial_id) return
  await page.evaluate((backend, id) => fetch(backend + "/api/projects/" + id, { method: "DELETE", credentials: "include" }),
    BACKEND, page.tutorial_id)
}

// ---------- audios sintéticos para la toma de la subida (no se suben: solo se eligen) ----------
// wav mono de 16 bits; fn(t) = muestra en -1..1
function wav(seconds, fn, rate = 22050) {
  let n = Math.round(seconds * rate)
  let b = Buffer.alloc(44 + n * 2)
  b.write("RIFF", 0)
  b.writeUInt32LE(36 + n * 2, 4)
  b.write("WAVEfmt ", 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write("data", 36)
  b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(32000 * Math.max(-1, Math.min(1, fn(i / rate)))), 44 + i * 2)
  return b
}
const BEAT = 60 / 138
const kick = t => {
  let u = t % BEAT
  return Math.sin(2 * Math.PI * (50 * u + 3 * (1 - Math.exp(-u * 30)))) * Math.exp(-u * 7)
}
// nombre → [segundos, señal]: dos loops de 16 beats y uno de 32 a 138 BPM, un golpe suelto y uno de más de 1 minuto
const UPLOAD_FILES = {
  "Kick_Loop_138.wav": [16 * BEAT, kick],
  "Bass_Loop_Am_138.wav": [16 * BEAT, t => 0.6 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-(t % (BEAT / 2)) * 6)],
  "Lead_Loop_Am_138.wav": [32 * BEAT, t => 0.3 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 523.25 * t))
    * Math.exp(-(t % BEAT) * 3)],
  "Impact_01.wav": [2.5, t => (Math.random() * 2 - 1) * Math.exp(-t * 2.5)],
  "Long_Jam_Take.wav": [70, t => 0.2 * Math.sin(2 * Math.PI * 220 * t)],
}
// escribe los wav en un temporal y los elige en el el-upload de Upload Files (abierto)
const choose_upload_files = async page => {
  let dir = path.join(os.tmpdir(), "looper_manual_upload")
  fs.mkdirSync(dir, { recursive: true })
  let paths = Object.entries(UPLOAD_FILES).map(([name, [s, fn]]) => {
    let p = path.join(dir, name)
    fs.writeFileSync(p, wav(s, fn))
    return p
  })
  let input = await page.$(".sections .el-upload input[type=file]")
  await input.uploadFile(...paths)
  // la duración la lee el navegador (y después detecta el pulso, de a un archivo)
  await page.waitForFunction(n => [...document.querySelectorAll(".queue .row .meta")]
    .filter(m => m.textContent.includes(":")).length >= n, { timeout: 30000 }, paths.length)
  await sleep(5000)()
}

// Files en la vista Box (el radio de arriba de la lista)
const files_box = page => page.evaluate(() => [...document.querySelectorAll(".view_switch .el-radio-button")]
  .find(b => b.textContent.trim() == "Box").click())
// arrastre a mitad de camino: el cartucho `i` de Files resaltado como destino (un dragover sintético) y una copia
// translúcida del pad `pad` de la sidebar encima, como la imagen que arrastra el navegador
const fake_drag = (pad, i) => page => page.evaluate((pad, i) => {
  let cart = document.querySelectorAll(".box .cart")[i]
  cart.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  let src = document.querySelectorAll(".sidebar .pads .pad")[pad]
  let r = src.getBoundingClientRect()
  let c = cart.getBoundingClientRect()
  let ghost = src.cloneNode(true)
  ghost.classList.add("shot_ghost")
  // abajo a la derecha del cartucho: no tapa el nombre ni los chips "no group" / "no tag"
  Object.assign(ghost.style, { position: "fixed", left: c.left + c.width * 0.45 + "px", top: c.top + c.height * 0.74 + "px",
    width: r.width + "px", height: r.height + "px", opacity: "0.75", zIndex: 9999, pointerEvents: "none" })
  document.body.appendChild(ghost)
}, pad, i)

// congela las animaciones CSS (CDP): cada destello de LED que arranca después queda en su primer cuadro, encendido.
// Va justo antes de capturar, con un sleep de más de un beat para que los LEDs del beat vuelvan a destellar
const freeze_leds = async page => {
  let cdp = await page.createCDPSession()
  await cdp.send("Animation.enable")
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 })
}
// los guardados (PUT/POST a /api/projects..., /api/files... y /api/upload) se contestan "ok" sin llegar al backend:
// la toma puede mover perillas sin cambiar el proyecto de demo del sandbox (las demás tomas lo verían cambiado).
// page.saves_blocked = false los deja pasar otra vez (para la limpieza de una toma)
const SAVE_URLS = ["/api/projects", "/api/files", "/api/upload"]
const block_saves = async page => {
  await page.setRequestInterception(true)
  page.saves_blocked = true
  page.on("request", r => {
    if (page.saves_blocked && ["PUT", "POST"].includes(r.method()) && SAVE_URLS.some(u => r.url().includes(u))) {
      r.respond({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": BASE,
        "Access-Control-Allow-Credentials": "true" }, body: JSON.stringify({ stat: true }) })
    } else r.continue()
  })
}
// el LCD del Tag actual muestra n beats restantes (el LCD rellena con "!", el dígito vacío de DSEG7)
const wait_tag_left = n => page => page.waitForFunction(
  n => document.querySelector(".g_tag .lcd .value")?.textContent.replace(/!/g, "").trim() == String(n), { timeout: 90000, polling: 20 }, n)
// la tira i suena un loop (el LCD dice "/<beats>", no REST ni vacío)
const wait_strip_playing = i => page => page.waitForFunction(
  i => document.querySelectorAll(".strip")[i]?.querySelector(".lcd .unit")?.textContent.startsWith("/"),
  { timeout: 90000 }, i)
// clic en el botón `b` (0 = M, 1 = S) de la tira i
const strip_mute_solo = (i, b) => page => page.evaluate((i, b) =>
  document.querySelectorAll(".strip")[i].querySelectorAll(".mute_solo button")[b].click(), i, b)

// ---------- editor de archivos (FileEditor.vue) ----------
// Los pasos que necesitan el estado de la app importan sus módulos desde el servidor de desarrollo de Vite (la misma
// url que usa la app, así que es la misma instancia: store, edit_session...). Solo anda contra `npm run dev`.
// fn(m) recibe el módulo `src/helpers/<mod>.js`; args van serializados
const with_module = (mod, fn, ...args) => page => page.evaluate(new Function("mod", "args",
  `return import("/src/helpers/" + mod + ".js").then(m => (${fn})(m, ...args))`), mod, args)
// abre el editor del archivo `name` (lápiz de su fila en la vista Table de Files) y marca el diálogo con data-shot
const open_editor = name => async page => {
  await page.evaluate(name => {
    let row = [...document.querySelectorAll(".el-table__row")].find(r => r.textContent.includes(name))
    if (!row) throw new Error("no está en Files: " + name)
    row.querySelector(".icons[title=Edit]").click()
  }, name)
  await wait_dialog(name)(page)
  // la onda se dibuja cuando el buffer está cargado
  await page.waitForFunction(() => !document.querySelector("[data-shot] .wave_screen .status"), { timeout: 30000 })
  await sleep(500)()
}
// el demo no es dueño de ningún archivo (son del catálogo): para mostrar los controles del dueño (LOOP/SHOT, Beats,
// Key, Anchor, SET) se marca `own` en el store, solo en esta página. Va con block_saves: nada llega al backend
const as_owner = name => with_module("composable", (m, name) => {
  m.store.files.find(f => f.original_name == name).own = true
}, name)
// cambia props del archivo en el proyecto (región, fade, transpose...) sin guardarlas (no pasa por save_file)
const set_props = (name, props) => with_module("composable", (m, name, props) => {
  Object.assign(m.store.files.find(f => f.original_name == name).props, props)
}, name, props)
// arrastra sobre la pantalla de onda del diálogo, de la fracción `a` a la `b` del ancho (a media altura, fuera de las
// manijas: marca una selección). Con `handle` ("start" | "stop") arrastra esa manija hasta la fracción `b`
const wave_drag = (a, b, handle = null) => async page => {
  let box = await (await page.$("[data-shot] .wave_screen")).boundingBox()
  let from = { x: box.x + a * box.width, y: box.y + box.height / 2 }
  if (handle) {
    let g = await (await page.$(`[data-shot] .wave_screen .handle.${handle} .grip`)).boundingBox()
    from = { x: g.x + g.width / 2, y: g.y + g.height / 2 }
  }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let k = 1; k <= 10; k++) {
    await page.mouse.move(from.x + (box.x + b * box.width - from.x) * k / 10, from.y)
  }
  await page.mouse.up()
  await sleep(300)()
}
// suma el archivo `name` del catálogo a la pista `track` del proyecto abierto (por la API) y recarga la app en `url`;
// remove_added lo saca (en after). Para mostrar un archivo que la demo no tiene (un shot con altura definida)
const add_file = (name, track, url) => async page => {
  page.added_file = await with_module("api", async (api, name, track) => {
    let { store } = await import("/src/helpers/composable.js")
    let items = (await api.get_catalog({ q: name, per_page: 10 })).data.items
    let f = items.find(it => it.original_name == name)
    if (!f) throw new Error("no está en el catálogo: " + name)
    let trg = store.track_groups.find(t => t.name == track)
    let res = await api.save_project_files(store.project.id, { add: [{ id: f.id, track_group: trg.id }] })
    if (!res.stat) throw new Error(res.text)
    return { project: store.project.id, id: f.id }
  }, name, track)(page)
  await page.goto(BASE + url, { waitUntil: "networkidle2" })
  await wait_ready(page)
}
const remove_added = async page => {
  if (!page.added_file) return
  page.saves_blocked = false
  await with_module("api", (api, a) => api.save_project_files(a.project, { remove: [a.id] }), page.added_file)(page)
}

// ---------- tomas ----------
// { id, url, login?, viewport?, steps?: [paso], selector? | clip?: { x, y, width, height } | paso que lo devuelve,
//   marks?: [{ n, sel, i?, at?, dx?, dy? }], after?: [paso] }
// Sin selector ni clip se captura el viewport entero. after: pasos que corren al final aunque la toma falle
// (limpieza, como borrar el proyecto del tutorial). El id es el nombre del archivo (public/manual/<id>.webp).
// marks: dónde va cada número de la captura. sel (con i = índice entre los que coinciden, default 0); at = "center"
// (default) o una esquina "tl" | "tr" | "bl" | "br" (a MARK_INSET px de cada borde); dx / dy = corrimiento en px
const SHOTS = [
  {
    id: "overview",
    url: "/?autostart=1", // abre el único proyecto del demo sin preguntar y hace START solo
    login: true,
    // alta, para que entren Tracks entero, Upload Files y el comienzo de Files
    viewport: { width: 1440, height: 1600 },
    steps: [wait_ready, wait_no_dialog, wait_playing, sleep(9000)], // ~5 compases: pasan los descansos del arranque
    marks: [
      { n: 1, sel: ".topbar .nameplate", at: "tr" },
      { n: 2, sel: ".sidebar .side_title", i: 0, at: "tr" },
      { n: 3, sel: ".sidebar .side_title", i: 1, at: "tr" },
      { n: 4, sel: ".sidebar .side_title", i: 2, at: "tr" },
      { n: 5, sel: ".tracks_panel .controls", at: "tr", dx: -24 },
      { n: 6, sel: ".tracks_panel .tracks_list", at: "tr", dx: -24 },
      { n: 7, sel: ".sections .el-collapse-item__header", i: 0 },
      { n: 8, sel: ".sections .el-collapse-item__header", i: 1, dx: 260 },
    ],
  },
  {
    id: "gallery",
    url: "/gallery", // sin sesión: lo que ve un visitante
    viewport: { width: 1100, height: 900 },
    steps: [page => page.waitForSelector(".grid .card"), sleep(500)],
    clip: { x: 0, y: 0, width: 1100, height: 250 },
    marks: [
      { n: 1, sel: ".pub_bar .link", i: 0, dx: -46 },
      // a la derecha de la última tarjeta (hay lugar libre): no tapan el texto
      { n: 2, sel: ".grid .card .lcd", i: 2, at: "tr", dx: 50, dy: -8 },
      { n: 3, sel: ".grid .card .meta", i: 4, at: "tr", dx: 60, dy: -14 },
      { n: 4, sel: ".grid .card .meta", i: 5, at: "tr", dx: 60, dy: 6 },
    ],
  },
  {
    id: "public_play",
    url: "/gallery",
    viewport: { width: 1100, height: 760 },
    steps: [goto_public("Demo Psy Groove", "?play=1"), wait_play_armed, sleep(800)],
    clip: { x: 300, y: 170, width: 500, height: 420 },
  },
  {
    id: "public_project",
    url: "/gallery",
    viewport: { width: 1100, height: 1160 },
    // con ?play=1 y el PLAY del diálogo de carga (como un visitante con el link LINK). Con ?autostart=1 Tracks.vue
    // se monta con isReady ya en true y el START inmediato falla (tag_starting antes de declararse)
    steps: [goto_public("Demo Psy Groove", "?play=1"), wait_play_armed, click_play, wait_public_ready, wait_playing,
      wait_no_dialog, sleep(9000)],
    marks: [
      { n: 1, sel: ".pub_bar .lcd", at: "tr", dx: 8, dy: -10 },
      { n: 2, sel: ".pub_bar .status", at: "tr", dx: 36, dy: -6 },
      { n: 3, sel: ".info", at: "tr" },
      { n: 4, sel: ".g_transport", at: "tr", dx: 14 },
      { n: 5, sel: ".g_tempo", at: "tr", dx: 4 },
      { n: 6, sel: ".g_tag", at: "tr", dx: 4 },
      { n: 7, sel: ".g_master", at: "tr", dx: 4 },
      { n: 8, sel: ".strip .fader", i: 0, at: "tr", dx: 14 },
      { n: 9, sel: ".strip .mute_solo", i: 0, at: "br", dx: 18, dy: 4 },
    ],
  },
  // --- nivel 1: cuenta, proyectos, audio, pistas y tags, Files ---
  {
    id: "login",
    url: "/", // sin sesión: el botón LOGIN de la barra
    viewport: { width: 1100, height: 760 },
    steps: [page => page.waitForSelector(".topbar"), click_text("LOGIN", ".topbar"), wait_dialog("Login")],
    selector: "[data-shot]",
    marks: [
      { n: 1, sel: "[data-shot] .wide_btn", at: "tr", dx: 4 },
      { n: 2, sel: "[data-shot] .switch_btn", at: "tr", dx: -60 },
    ],
  },
  {
    id: "register",
    url: "/",
    viewport: { width: 1100, height: 1000 },
    // datos inventados; no se manda (no se aprieta REGISTER)
    steps: [page => page.waitForSelector(".topbar"), click_text("LOGIN", ".topbar"), wait_dialog("Login"),
      click_text("Create an account", "[data-shot]"), wait_dialog("Create account"),
      async page => {
        let inputs = await page.$$("[data-shot] .el-input__inner, [data-shot] .el-textarea__inner")
        let values = ["you@example.com", "your_name", "una-clave-larga", "una-clave-larga", "Loops de percusión y bajos."]
        for (let [i, v] of values.entries()) await inputs[i].type(v)
        await page.click("[data-shot] .license .el-checkbox")
        await page.click("[data-shot] .el-dialog__title") // saca el foco de los campos
        await sleep(400)()
      }],
    selector: "[data-shot]",
    marks: [
      { n: 1, sel: "[data-shot] .el-form-item", i: 1, at: "tr", dx: -4 },
      { n: 2, sel: "[data-shot] .el-form-item", i: 4, at: "tr", dx: -4 },
      { n: 3, sel: "[data-shot] .license", at: "tr", dx: -4 },
      { n: 4, sel: "[data-shot] .wide_btn", at: "tr", dx: 4 },
    ],
  },
  {
    id: "account",
    url: "/",
    login: true,
    viewport: { width: 1100, height: 900 },
    steps: [wait_dialog("Open project"), click_text("CANCEL", "[data-shot]"), wait_no_dialog,
      click_text("ACCOUNT", ".topbar"), wait_dialog("Account")],
    selector: "[data-shot]",
    marks: [
      { n: 1, sel: "[data-shot] .who", at: "tr", dx: 40 },
      { n: 2, sel: "[data-shot] .section_title", i: 0, at: "tr" },
      { n: 3, sel: "[data-shot] .section_title", i: 1, at: "tr" },
    ],
  },
  {
    id: "open_project",
    url: "/", // al entrar con sesión: la pregunta por el último proyecto
    login: true,
    viewport: { width: 1100, height: 700 },
    steps: [wait_dialog("Open project")],
    selector: "[data-shot]",
    marks: [
      { n: 1, sel: "[data-shot] .label", at: "tr" },
      { n: 2, sel: "[data-shot] .footer .led_button", i: 2, at: "tl", dx: -10, dy: -14 },
      { n: 3, sel: "[data-shot] .footer .led_button", i: 1, at: "tl", dx: -10, dy: -14 },
      { n: 4, sel: "[data-shot] .footer .led_button", i: 0, at: "tl", dx: -10, dy: -14 },
    ],
  },
  {
    id: "projects",
    url: "/",
    login: true,
    viewport: { width: 1200, height: 900 },
    steps: [open_last, click_text("PROJECTS", ".topbar"), wait_dialog("Projects")],
    selector: "[data-shot]",
    marks: [
      { n: 1, sel: "[data-shot] .create", at: "tr", dx: 20 },
      { n: 2, sel: "[data-shot] .cart.active .grip" },
      { n: 3, sel: "[data-shot] .cart .specs", i: 0, at: "tr", dx: 20 },
      { n: 4, sel: "[data-shot] .cart .actions .led_button", i: 3, at: "tl", dy: -16 },
      { n: 5, sel: "[data-shot] .cart .actions .led_button", i: 4, at: "tl", dy: -16 },
      { n: 6, sel: "[data-shot] .cart .actions .led_button", i: 5, at: "tl", dy: -16 },
      { n: 7, sel: "[data-shot] .hint", at: "tr", dx: 10 },
    ],
  },
  {
    id: "upload",
    url: "/",
    login: true,
    steps: [open_last, click(".sections .el-collapse-item__header"), sleep(600), choose_upload_files,
      scroll_to(".sections .el-collapse-item", 0), sleep(400)],
    clip: clip_around([[".sections .el-collapse-item", 0]], { pad: 0 }),
    marks: [
      { n: 1, sel: ".quota", at: "tl", dx: 330 },
      { n: 2, sel: ".el-upload-dragger", at: "tr" },
      { n: 3, sel: ".queue .row.head .num", i: 0, dx: 26 },
      { n: 4, sel: ".queue .row.head .num", i: 1, dx: 30 },
      { n: 5, sel: ".queue .row.head .num", i: 2, dx: 24 },
      { n: 6, sel: ".queue .row.head .num", i: 3, dx: 36 },
      { n: 7, sel: ".queue .warn", at: "tr", dx: 30 },
      { n: 8, sel: ".upload_btn", at: "tr", dx: 30 },
    ],
  },
  {
    id: "import",
    url: "/",
    login: true,
    viewport: { width: 1200, height: 900 },
    steps: [open_last, click_text("IMPORT", ".topbar"), wait_dialog("Import from catalog"),
      page => page.waitForSelector("[data-shot] .el-table__row"),
      // filtro por nombre (bajos: tienen BPM, beats y tonalidad) y dos elegidos
      async page => {
        await page.type("[data-shot] .filters .f_text input", "Bass_Loop")
        await page.keyboard.press("Enter")
        await sleep(1200)()
      },
      async page => {
        let boxes = await page.$$("[data-shot] .el-table__row .el-checkbox")
        await boxes[0].click()
        await boxes[2].click()
        await sleep(400)()
      }],
    selector: "[data-shot]",
    marks: [
      { n: 1, sel: "[data-shot] .filters", at: "tr", dx: 4 },
      { n: 2, sel: "[data-shot] .el-table__row .el-checkbox", i: 0, dy: 26 },
      { n: 3, sel: "[data-shot] .el-table__row .icons", i: 0, dy: 26 },
      { n: 4, sel: "[data-shot] .el-table__header th", i: 7, at: "tr" },
      { n: 5, sel: "[data-shot] .memory", at: "tr" },
      { n: 6, sel: "[data-shot] .footer_right .led_button", i: 1, at: "tl", dx: -12 },
    ],
  },
  {
    id: "trg_tags",
    url: "/",
    login: true,
    // proyecto del tutorial (dos pistas y dos tags); el mouse encima del primer pad muestra su tacho
    steps: [tutorial_project(), page => page.hover(".sidebar .pads .pad"), sleep(400)],
    clip: clip_around([[".sidebar .side_title", 0], [".sidebar .add_btn", 1]], { pad: 12 }),
    after: [delete_tutorial],
    marks: [
      { n: 1, sel: ".sidebar .pads .pad .el-color-picker", i: 0, dx: 20, dy: 18 },
      { n: 2, sel: ".sidebar .pads .pad .icons", i: 0, dx: -18, dy: 18 },
      { n: 3, sel: ".sidebar .add_btn", i: 0, dx: 60 },
      { n: 4, sel: ".sidebar .pads .pad .edit_icon", i: 0, dx: 20, dy: 18 },
      { n: 5, sel: ".sidebar .add_btn", i: 1, dx: 60 },
    ],
  },
  {
    id: "tag_dialog",
    url: "/",
    login: true,
    viewport: { width: 1100, height: 700 },
    steps: [tutorial_project(), click(".sidebar .pads .pad .edit_icon"), wait_dialog("Edit tag")],
    selector: "[data-shot]",
    after: [delete_tutorial],
    marks: [
      { n: 1, sel: "[data-shot] .field", i: 0, at: "tr", dx: 4 },
      { n: 2, sel: "[data-shot] .field", i: 1, at: "tl", dx: 60, dy: 22 },
      { n: 3, sel: "[data-shot] .hw_plate", at: "tr", dx: 4 },
    ],
  },
  {
    id: "first_drag",
    url: "/",
    login: true,
    // bajo: así la lista de archivos (que va al final) queda más cerca de los pads de arriba
    viewport: { width: 1440, height: 780 },
    // el último archivo del tutorial todavía sin pista ni tags, con el pad Bass arrastrado encima
    steps: [tutorial_project({ unassigned: [3] }), files_box, sleep(500), scroll_to(".sections .el-collapse-item", 1),
      sleep(400), fake_drag(1, 3), sleep(400)],
    clip: clip_around([[".sidebar .side_title", 0], [".sidebar .add_btn", 1], [".box .cart", 3], [".shot_ghost", 0]],
      { pad: 12 }),
    after: [delete_tutorial],
    marks: [
      { n: 1, sel: ".sidebar .pads .pad", i: 1, at: "tr", dx: 4 },
      { n: 2, sel: ".box .cart", i: 3, at: "tr", dx: 4, dy: -4 },
      { n: 3, sel: ".box .cart .chip.empty", i: 0, at: "bl", dx: -26 },
    ],
  },
  {
    id: "first_playing",
    url: "/",
    login: true,
    viewport: { width: 1200, height: 1000 },
    steps: [tutorial_project({ query: "?autostart=1" }), wait_no_dialog, wait_playing, sleep(9000)],
    // sin la barra de arriba: a este ancho sus botones se pisan
    clip: { x: 0, y: 60, width: 1200, height: 840 },
    after: [delete_tutorial],
    marks: [
      { n: 1, sel: ".g_transport", at: "tr", dx: 14 },
      { n: 2, sel: ".g_tag", at: "tr", dx: 4 },
      { n: 3, sel: ".sidebar .side_title", i: 0, at: "tr" },
      { n: 4, sel: ".tracks_panel .tracks_list", at: "tr", dx: -24 },
    ],
  },
  {
    id: "files_box",
    url: "/?autostart=1",
    login: true,
    steps: [wait_ready, wait_no_dialog, wait_playing, files_box, scroll_to(".sections .el-collapse-item", 1),
      sleep(7000)],
    clip: clip_around([[".sections .el-collapse-item", 1]], { pad: 0, height: 470 }),
    marks: [
      { n: 1, sel: ".view_switch .el-radio-group", at: "tr", dx: 4 },
      { n: 2, sel: ".view_switch .led_button", at: "tr", dx: 6 },
      { n: 3, sel: ".key_filter", at: "tr", dx: 6 },
      { n: 4, sel: ".box .cart.playing .grip", dx: 18 },
      { n: 5, sel: ".box .cart .tags", i: 0, at: "tr", dx: 6 },
      { n: 6, sel: ".box .cart .actions", i: 0, at: "tr", dx: 20 },
    ],
  },
  {
    id: "files_table",
    url: "/?autostart=1",
    login: true,
    // más ancho: a 1440 la tabla no entra entera y la columna Actions queda fuera (scroll horizontal)
    viewport: { width: 1600, height: 900 },
    steps: [wait_ready, wait_no_dialog, wait_playing, scroll_to(".sections .el-collapse-item", 1), sleep(7000)],
    clip: clip_around([[".sections .el-collapse-item", 1]], { pad: 0, height: 470 }),
    marks: [
      { n: 1, sel: ".el-table__header th", i: 0, at: "tr", dx: -100 },
      { n: 2, sel: ".el-table__header th", i: 3, at: "tr" },
      { n: 3, sel: ".el-table__header th", i: 5, at: "tr" },
      { n: 4, sel: ".el-table__header th", i: 8, at: "tr" },
      { n: 5, sel: ".row_actions", i: 0, at: "tl", dx: -12 },
    ],
  },
  // --- nivel 1: tocar, cómo elige el motor, mixer, compartir ---
  {
    id: "transport",
    url: "/?autostart=1",
    login: true,
    // en los últimos beats del Tag: el LED CHANGE destella (congelado encendido con freeze_leds)
    steps: [wait_ready, wait_no_dialog, wait_playing, wait_tag_left(4), freeze_leds, sleep(600)],
    selector: ".tracks_panel .controls",
    marks: [
      { n: 1, sel: ".g_transport .led_button", i: 0, at: "tr", dx: 6 },
      { n: 2, sel: ".g_transport .led_button", i: 1, at: "tr", dx: 6 },
      { n: 3, sel: ".g_tempo .lcd", at: "tr", dx: 6, dy: -14 },
      { n: 4, sel: ".g_tempo .knob", i: 1, at: "tr", dx: 10 },
      { n: 5, sel: ".g_position .lcd", at: "tr", dx: 6, dy: -14 },
      { n: 6, sel: ".g_position .toggle", at: "tr", dx: 10 },
      { n: 7, sel: ".g_range .hw_plate", at: "tr", dx: 6, dy: -12 },
      { n: 8, sel: ".g_tag .lcd", at: "tr", dx: 6, dy: -14 },
      { n: 9, sel: ".g_tag .warn", at: "tr", dx: 10 },
      { n: 10, sel: ".g_master .knob", at: "tr", dx: 8 },
      { n: 11, sel: ".g_delay", at: "tl", dx: -16, dy: -14 },
    ],
  },
  {
    id: "strips",
    url: "/?autostart=1",
    login: true,
    // alta para que entren las tiras enteras; al doble de resolución porque la toma es chica
    viewport: { width: 1440, height: 1300, deviceScaleFactor: 2 },
    // Lead (tira 4) tocando un loop e Impacts (5, one-shot) con un disparo hecho
    steps: [wait_ready, wait_no_dialog, wait_playing, sleep(3000), wait_strip_playing(4), freeze_leds, sleep(600)],
    clip: clip_around([[".strip", 4], [".strip", 5]], { pad: 6 }),
    marks: [
      // tira loop (Lead)
      { n: 1, sel: ".strips > .strip:nth-child(5) .led_button", at: "tl", dx: -26, dy: -8 },
      { n: 2, sel: ".strips > .strip:nth-child(5) .meter", at: "tl", dx: -24 },
      { n: 3, sel: ".strips > .strip:nth-child(5) .lcd", at: "tl", dx: -26 },
      { n: 4, sel: ".strips > .strip:nth-child(5) .steps", at: "bl", dx: -26, dy: 16 },
      { n: 5, sel: ".strips > .strip:nth-child(5) .file_name", at: "bl", dx: -26, dy: 26 },
      { n: 6, sel: ".strips > .strip:nth-child(5) .rest_knobs", at: "tl", dx: -24 },
      { n: 7, sel: ".strips > .strip:nth-child(5) .rest_ctrls .range_pads", at: "bl", dx: -26, dy: 10 },
      // tira one-shot (Impacts)
      { n: 8, sel: ".strips > .strip:nth-child(6) .led_button", at: "tr", dx: 24, dy: -8 },
      { n: 9, sel: ".strips > .strip:nth-child(6) .lcd", at: "tr", dx: 24 },
      { n: 10, sel: ".strips > .strip:nth-child(6) .oneshot_ctrls .knob", i: 0, at: "tr", dx: 20 },
      { n: 11, sel: ".strips > .strip:nth-child(6) .oneshot_ctrls .knob", i: 1, at: "tr", dx: 20 },
      { n: 12, sel: ".strips > .strip:nth-child(6) .oneshot_ctrls .knob", i: 2, at: "tl", dx: -24 },
      { n: 13, sel: ".strips > .strip:nth-child(6) .oneshot_ctrls .led_button", at: "tr", dx: 20 },
    ],
  },
  {
    id: "mixer",
    url: "/?autostart=1",
    login: true,
    viewport: { width: 1440, height: 1300 },
    // Perc (tira 2) en mute: se atenúa
    steps: [wait_ready, wait_no_dialog, wait_playing, strip_mute_solo(2, 0), sleep(6000), freeze_leds, sleep(600)],
    selector: ".tracks_panel .tracks_list",
    marks: [
      { n: 1, sel: ".strip .strip_name", i: 0, at: "tr", dx: 30 },
      { n: 2, sel: ".strips_head", at: "tr", dx: 0 },
      { n: 3, sel: ".strip .meter", i: 0, at: "tl", dx: -24 },
      { n: 4, sel: ".strip .file_name", i: 1, at: "bl", dx: -6, dy: 22 },
      { n: 5, sel: ".strip .fader", i: 0, at: "tr", dx: 6 },
      { n: 6, sel: ".strip .fx_ctrls", i: 0, at: "bl", dx: -10, dy: 22 },
      { n: 7, sel: ".strip .fx_chips", i: 0, at: "bl", dx: -12, dy: 14 },
      { n: 8, sel: ".strip .mute_solo", i: 2, at: "br", dx: 20, dy: 4 },
    ],
  },
  {
    id: "master_meter",
    url: "/?autostart=1",
    login: true,
    viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
    // Master al máximo (+6 dB) para que el limitador trabaje y se encienda LIM; sin guardar (block_saves)
    steps: [block_saves, wait_ready, wait_no_dialog, wait_playing, sleep(2000),
      async page => {
        await page.evaluate(() => document.querySelector(".g_master .knob svg").focus())
        for (let k = 0; k < 5; k++) await page.keyboard.press("PageUp")
      },
      // el LED LIM parpadea con la música: cuando se enciende, los medidores se congelan en ese cuadro (sin más
      // requestAnimationFrame, el bucle de mixer.js deja de actualizarlos)
      sleep(3000), page => page.waitForFunction(() => {
        if (!document.querySelector(".topbar .gr .led.lit")) return false
        window.requestAnimationFrame = () => 0
        return true
      }, { timeout: 60000, polling: 10 }), sleep(300)],
    clip: clip_around([[".topbar .status", 0], [".topbar .master", 0]], { pad: 6 }),
  },
  {
    id: "report",
    url: "/",
    login: true,
    viewport: { width: 1200, height: 900 },
    // denuncia de un archivo ajeno del catálogo (IMPORT): se escribe el motivo, no se manda
    steps: [open_last, click_text("IMPORT", ".topbar"), wait_dialog("Import from catalog"),
      page => page.waitForSelector("[data-shot] .icons.report"),
      page => page.evaluate(() => document.querySelector("[data-shot] .icons.report").click()),
      wait_dialog("Report file"),
      async page => {
        await page.type("[data-shot] textarea", "Este sonido es de una librería comercial que no es royalty free.")
        await page.click("[data-shot] .el-dialog__title")
        await sleep(300)()
      }],
    selector: "[data-shot]",
    marks: [
      { n: 1, sel: "[data-shot] .target", at: "tr", dx: 0 },
      { n: 2, sel: "[data-shot] textarea", at: "tr", dx: -4, dy: -4 },
      { n: 3, sel: "[data-shot] .el-dialog__footer .el-button--danger", at: "tl", dx: -16, dy: -4 },
    ],
  },
  // --- nivel 2: el editor (vista general, región, ediciones, tono) ---
  // El diálogo mide 1120 px de ancho: viewport de 1300 (a 1200 se pisan los botones de la barra de arriba, que igual
  // queda fuera del recorte). Todas con block_saves: lo que se mueve no se guarda
  {
    id: "editor",
    url: "/?autostart=1",
    login: true,
    viewport: { width: 1300, height: 1000 },
    // un bajo, con los controles del dueño (as_owner) y el motor andando (el cursor TRACK si su pista lo toca)
    steps: [block_saves, wait_ready, wait_no_dialog, wait_playing, as_owner("G_Bass_Loop_29.wav"),
      open_editor("G_Bass_Loop_29.wav"), sleep(2500)],
    selector: "[data-shot]",
    marks: [
      { n: 1, sel: "[data-shot] .wave_screen", at: "tr", dx: -60 },
      { n: 2, sel: "[data-shot] .region_bar", at: "tr", dx: -10 },
      { n: 3, sel: "[data-shot] .edit_ops", at: "tr", dx: -10 },
      // botones del dueño en los datos: LOOP, SHOT, DETECT, START, END
      { n: 4, sel: "[data-shot] .edit_info .led_button", i: 1, at: "tr", dx: 14 },
      { n: 5, sel: "[data-shot] .edit_info .timing_row", i: 0, at: "tr", dx: 16 },
      { n: 6, sel: "[data-shot] .edit_info .led_button", i: 2, at: "tr", dx: 14 },
      { n: 7, sel: "[data-shot] .edit_info .led_button", i: 4, at: "tr", dx: 14 },
      { n: 8, sel: "[data-shot] .edit_plates .volume", at: "tl", dx: -26 },
      { n: 9, sel: "[data-shot] .edit_plates .pitch", at: "tr", dx: 6 },
      { n: 10, sel: "[data-shot] .edit_plates .repeat", at: "tr", dx: 6 },
      { n: 11, sel: "[data-shot] .assign", at: "tr" },
      { n: 12, sel: "[data-shot] .dialog_actions .led_button", i: 1, at: "tr", dx: 12, dy: -20 },
      { n: 13, sel: "[data-shot] .dialog_actions .danger", at: "tr", dx: 20 },
      { n: 14, sel: "[data-shot] .dialog_nav", at: "tl", dx: -30 },
    ],
  },
  {
    id: "editor_region",
    url: "/?autostart=1",
    login: true,
    viewport: { width: 1300, height: 1000 },
    // un loop de 32 beats recortado a los beats 8–24 arrastrando las manijas (con SNAP), fade de 8 ms y el preview
    // sonando (cursor PREVIEW)
    steps: [block_saves, wait_ready, wait_no_dialog, wait_playing, open_editor("G_Synth_Loop_01.wav"),
      wave_drag(0, 0.25, "start"), wave_drag(1, 0.75, "stop"), set_props("G_Synth_Loop_01.wav", { fade: 8 }),
      click_text("PLAY", "[data-shot] .dialog_footer"), sleep(2500)],
    clip: clip_around([["[data-shot] .wave_screen"], ["[data-shot] .region_bar"]], { pad: 10 }),
    marks: [
      { n: 1, sel: "[data-shot] .wave_screen .caption", at: "tr", dx: 6 },
      { n: 2, sel: "[data-shot] .wave_screen .handle.start .grip", dx: 20, dy: 4 },
      { n: 3, sel: "[data-shot] .wave_screen .handle.stop .grip", dx: -20, dy: 4 },
      { n: 4, sel: "[data-shot] .wave_screen .dim", i: 1, dy: -20 },
      { n: 5, sel: "[data-shot] .wave_screen .legend", at: "tl", dx: -24 },
      { n: 6, sel: "[data-shot] .region_bar .region_len", at: "tr", dx: 4 },
      { n: 7, sel: "[data-shot] .region_bar .led_button", i: 0, at: "tr", dx: 10 },
      { n: 8, sel: "[data-shot] .region_bar .hw_plate", i: 0, at: "tl", dx: -6 },
      { n: 9, sel: "[data-shot] .region_bar .hw_plate", i: 1, at: "tl", dx: -6 },
      { n: 10, sel: "[data-shot] .region_bar .loupe", i: 0, at: "tr", dx: 4 },
      { n: 11, sel: "[data-shot] .region_bar .loupe", i: 1, at: "tr", dx: 4 },
    ],
  },
  {
    id: "editor_edits",
    url: "/?autostart=1",
    login: true,
    viewport: { width: 1300, height: 1000 },
    // selección de los beats 4–8 del bajo arrastrando sobre la onda (SNAP a los beats) y REVERSE: queda EDITED
    steps: [block_saves, wait_ready, wait_no_dialog, wait_playing, open_editor("G_Bass_Loop_29.wav"),
      wave_drag(0.26, 0.49), click_text("REVERSE", "[data-shot] .edit_ops"), sleep(800)],
    clip: clip_around([["[data-shot] .wave_screen"], ["[data-shot] .edit_ops"]], { pad: 10 }),
    marks: [
      { n: 1, sel: "[data-shot] .wave_screen .selection", at: "tr", dx: -4 },
      { n: 2, sel: "[data-shot] .edit_ops .ops_lcd", i: 0, at: "tr", dx: 4 },
      { n: 3, sel: "[data-shot] .edit_ops .ops_lcd", i: 1, at: "tr", dx: 4 },
      { n: 4, sel: "[data-shot] .edit_ops .group", i: 0, at: "tr", dx: 6 },
      { n: 5, sel: "[data-shot] .edit_ops .hw_plate", i: 0, at: "tr", dx: 6 },
      { n: 6, sel: "[data-shot] .edit_ops .hw_plate", i: 1, at: "tr", dx: 6 },
      { n: 7, sel: "[data-shot] .edit_ops .group", i: 1, at: "tr", dx: 6 },
      { n: 8, sel: "[data-shot] .edit_ops .group", i: 2, at: "tr", dx: 6 },
    ],
  },
  {
    id: "editor_save_copy",
    url: "/?autostart=1",
    login: true,
    viewport: { width: 1300, height: 1000 },
    // la misma edición y SAVE AS COPY: el cuadro que pide el nombre (no se guarda)
    steps: [block_saves, wait_ready, wait_no_dialog, wait_playing, open_editor("G_Bass_Loop_29.wav"),
      wave_drag(0.26, 0.49), click_text("REVERSE", "[data-shot] .edit_ops"), sleep(500),
      click_text("SAVE AS COPY", "[data-shot] .edit_ops"),
      page => page.waitForFunction(() => document.querySelector(".el-message-box")?.getClientRects().length),
      sleep(700)],
    selector: ".el-message-box",
  },
  {
    id: "editor_pitch",
    url: "/?autostart=1",
    login: true,
    viewport: { width: 1300, height: 1000 },
    // el bajo como dueño: DETECT (sugiere Gm) y transpuesto +2 con KEY LOCK
    steps: [block_saves, wait_ready, wait_no_dialog, wait_playing, as_owner("G_Bass_Loop_29.wav"),
      open_editor("G_Bass_Loop_29.wav"), click_text("DETECT", "[data-shot]"),
      page => page.waitForSelector("[data-shot] .det_text", { timeout: 30000 }),
      set_props("G_Bass_Loop_29.wav", { transpose: 2, key_lock: true }), sleep(600)],
    clip: clip_around([["[data-shot] .edit_left"], ["[data-shot] .edit_plates"]], { pad: 10 }),
    marks: [
      { n: 1, sel: "[data-shot] .key_select", at: "tl", dx: -26 },
      { n: 2, sel: "[data-shot] .eff_key", at: "tl", dy: -20 },
      { n: 3, sel: "[data-shot] .edit_info .led_button", i: 2, at: "tr", dx: 36 },
      { n: 4, sel: "[data-shot] .det_text", at: "tr", dx: 24 },
      { n: 5, sel: "[data-shot] .edit_info .led_button", i: 3, at: "tr", dx: 36 },
      { n: 6, sel: "[data-shot] .edit_plates .pitch", at: "tr", dx: 4, dy: 40 },
      { n: 7, sel: "[data-shot] .edit_plates .pitch .led_button", at: "tl", dx: -30, dy: -20 },
    ],
  },
  {
    id: "editor_tune",
    url: "/?autostart=1",
    login: true,
    viewport: { width: 1300, height: 1000 },
    // un bombo suelto (shot con altura: F#1) sumado a Impacts; DETECT y TUNE TO a G1, la tónica de los loops (G).
    // El archivo se saca del proyecto al terminar
    steps: [wait_ready, add_file("MB3_KICK_Electronic_01 One-Shot.wav", "Impacts", "/?autostart=1"), block_saves,
      wait_no_dialog, wait_playing, open_editor("MB3_KICK_Electronic_01 One-Shot.wav"),
      click_text("DETECT", "[data-shot]"),
      page => page.waitForSelector("[data-shot] .tune_select", { timeout: 30000 }),
      click("[data-shot] .tune_select"), sleep(500),
      page => page.evaluate(() => [...document.querySelectorAll(".el-select-dropdown__item")]
        .find(o => o.getClientRects().length && o.textContent.includes("· key")).click()),
      sleep(400), click_text("TUNE TO", "[data-shot]"), sleep(800)],
    clip: clip_around([["[data-shot] .wave_screen"], ["[data-shot] .edit_plates"]], { pad: 10 }),
    after: [remove_added],
    marks: [
      { n: 1, sel: "[data-shot] .wave_screen .caption", at: "tr", dx: 6 },
      { n: 2, sel: "[data-shot] .wave_screen .handle.start .grip", dx: 18, dy: 130 },
      { n: 3, sel: "[data-shot] .region_bar .region_len", i: 1, at: "tr", dx: 4 },
      { n: 4, sel: "[data-shot] .det_text", at: "tr", dx: 14 },
      { n: 5, sel: "[data-shot] .tune_select", at: "tr", dx: 6, dy: -14 },
      { n: 6, sel: "[data-shot] .edit_info .led_button", i: 1, at: "tr", dx: 14 },
      { n: 7, sel: "[data-shot] .edit_plates .pitch .lcd", at: "tr", dx: 10 },
    ],
  },
]

async function login(page) {
  // desde una página del frontend (el origen que acepta CORS); la cookie de sesión queda en el contexto
  await page.goto(BASE + "/gallery", { waitUntil: "domcontentloaded" })
  let res = await page.evaluate(async (backend, body) => {
    let r = await fetch(backend + "/api/login", { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    return r.json()
  }, BACKEND, LOGIN)
  if (!res.stat) throw new Error(`login de ${LOGIN.email} falló (${res.text}): ¿el backend corre contra el sandbox?`)
}

// posición en % (centro del número) de cada mark, relativa al área capturada
async function mark_positions(page, marks, area) {
  let out = []
  for (let m of marks) {
    let box = await page.$$eval(m.sel, (els, i) => {
      let r = els[i]?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
    }, m.i || 0)
    if (!box) {
      out.push({ n: m.n, missing: m.sel + (m.i ? ` [${m.i}]` : "") })
      continue
    }
    let [v, h] = !m.at || m.at == "center" ? ["c", "c"] : m.at
    let x = (h == "l" ? box.x + MARK_INSET : h == "r" ? box.x + box.width - MARK_INSET : box.x + box.width / 2) + (m.dx || 0)
    let y = (v == "t" ? box.y + MARK_INSET : v == "b" ? box.y + box.height - MARK_INSET : box.y + box.height / 2)
      + (m.dy || 0)
    let pct = (v, o, s) => Math.round(1000 * (v - o) / s) / 10
    out.push({ n: m.n, x: pct(x, area.x, area.width), y: pct(y, area.y, area.height) })
  }
  return out
}

async function take(browser, shot) {
  let context = await browser.createBrowserContext() // aislado: cookies y localStorage propios por toma
  let page
  try {
    page = await context.newPage()
    await page.setViewport({ ...VIEWPORT, ...shot.viewport })
    page.on("pageerror", e => console.log(`  [${shot.id}] error en la página:`, e.message))
    if (shot.login) await login(page)
    await page.goto(BASE + shot.url, { waitUntil: "networkidle2" })
    for (let step of shot.steps || []) await step(page)

    let file = path.join(OUT_DIR, shot.id + ".webp")
    let opts = { path: file, type: "webp", quality: QUALITY }
    let area = { x: 0, y: 0, ...(shot.viewport || VIEWPORT) }
    if (shot.selector) {
      let el = await page.$(shot.selector)
      if (!el) throw new Error(`no está el selector ${shot.selector}`)
      area = await el.boundingBox()
      await el.screenshot(opts)
    } else {
      let clip = typeof shot.clip == "function" ? await shot.clip(page) : shot.clip
      if (clip) area = clip
      await page.screenshot({ ...opts, ...(clip ? { clip } : {}) })
    }
    console.log(`  ${shot.id}: ${path.relative(process.cwd(), file)} (${Math.round(area.width)}x${Math.round(area.height)})`)
    if (shot.marks) {
      for (let m of await mark_positions(page, shot.marks, area)) {
        console.log(m.missing ? `    n ${m.n}: no está ${m.missing}` : `    { n: ${m.n}, x: ${m.x}, y: ${m.y} },`)
      }
    }
  } finally {
    for (let step of shot.after || []) {
      await step(page).catch(e => console.log(`  [${shot.id}] error en la limpieza:`, e.message))
    }
    await context.close()
  }
}

async function check_up(url) {
  try {
    await fetch(url)
  } catch {
    throw new Error(`no responde ${url} (¿están corriendo el backend del sandbox y el frontend? ver docs/MANUAL.md)`)
  }
}

async function main() {
  let ids = process.argv.slice(2)
  let unknown = ids.filter(id => !SHOTS.some(s => s.id == id))
  if (unknown.length) {
    console.error("Tomas desconocidas:", unknown.join(", "), "\nHay:", SHOTS.map(s => s.id).join(", "))
    process.exit(1)
  }
  let shots = ids.length ? SHOTS.filter(s => ids.includes(s.id)) : SHOTS
  if (!fs.existsSync(CHROME)) throw new Error(`no está Chrome en ${CHROME} (definir CHROME_PATH)`)
  await check_up(BASE)
  await check_up(BACKEND + "/api/get_user_info")
  fs.mkdirSync(OUT_DIR, { recursive: true })

  let browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.MANUAL_HEADFUL != "1",
    // sin gesto del usuario el navegador no deja sonar: para capturar estados sonando (LEDs, LCD, vúmetros)
    args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", "--mute-audio"],
  })
  let failed = 0
  try {
    for (let shot of shots) {
      try {
        await take(browser, shot)
      } catch (e) {
        failed++
        console.error(`  ${shot.id}: ERROR`, e.message)
      }
    }
  } finally {
    await browser.close()
  }
  if (failed) process.exit(1)
}

main().catch(e => {
  console.error(e.message)
  process.exit(1)
})
