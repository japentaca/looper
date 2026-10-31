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
