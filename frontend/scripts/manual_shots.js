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
// eslint-disable-next-line no-unused-vars -- para las tomas que abren un diálogo o un menú
const click = sel => page => page.click(sel)
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

// ---------- tomas ----------
// { id, url, login?, viewport?, steps?: [paso], selector? | clip?: { x, y, width, height },
//   marks?: [{ n, sel, i?, at?, dx?, dy? }] }
// Sin selector ni clip se captura el viewport entero. El id es el nombre del archivo (public/manual/<id>.webp).
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
  try {
    let page = await context.newPage()
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
      if (shot.clip) area = shot.clip
      await page.screenshot({ ...opts, ...(shot.clip ? { clip: shot.clip } : {}) })
    }
    console.log(`  ${shot.id}: ${path.relative(process.cwd(), file)} (${Math.round(area.width)}x${Math.round(area.height)})`)
    if (shot.marks) {
      for (let m of await mark_positions(page, shot.marks, area)) {
        console.log(m.missing ? `    n ${m.n}: no está ${m.missing}` : `    { n: ${m.n}, x: ${m.x}, y: ${m.y} },`)
      }
    }
  } finally {
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
