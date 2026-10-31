// Coherencia del manual (/manual): links al glosario y a las secciones, capturas y tomas. Lee las fuentes como texto
// (sin montar los componentes). Correr con: cd frontend && npm test
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...p) => fs.readFileSync(path.join(here, ...p), "utf8")
const all = (re, s) => [...s.matchAll(re)].map(m => m[1])

const SECTION_IDS = all(/\{ id: "([^"]+)", level/g, read("sections.js"))
const GLOSSARY_IDS = all(/\{ id: "([^"]+)", term/g, read("sections", "Glossary.vue"))
const SHOT_IDS = all(/^\s{4}id: "([^"]+)"/gm, read("..", "..", "scripts", "manual_shots.js"))
const PUBLIC = path.join(here, "..", "..", "public", "manual")
const WEBPS = fs.readdirSync(PUBLIC).filter(f => f.endsWith(".webp")).map(f => f.slice(0, -5))
const FILES = fs.readdirSync(path.join(here, "sections")).filter(f => f.endsWith(".vue"))
  .map(f => ({ name: f, src: read("sections", f) }))

// [archivo, valor] de cada coincidencia que no está en `ok`
function missing(re, ok) {
  return FILES.flatMap(f => all(re, f.src).filter(v => !ok.includes(v)).map(v => [f.name, v]))
}

describe("manual", () => {
  it("las secciones de sections.js tienen ids únicos", () => {
    expect(new Set(SECTION_IDS).size).toBe(SECTION_IDS.length)
    expect(SECTION_IDS.length).toBeGreaterThan(0)
  })
  it("cada <Term t> apunta a un término del glosario", () => {
    expect(missing(/<Term t="([^"]*)"/g, GLOSSARY_IDS)).toEqual([])
  })
  it("cada link interno apunta a una sección", () => {
    expect(missing(/go\('([^']+)'\)/g, SECTION_IDS)).toEqual([])
    expect(missing(/href="#([^"]+)"/g, SECTION_IDS)).toEqual([])
    // to: de los callouts de ManualShot y de las tablas armadas en el script (Shortcuts.vue)
    expect(missing(/\bto: ["']([^"']+)["']/g, SECTION_IDS)).toEqual([])
  })
  it("cada captura citada existe, y cada captura de public/manual se usa y tiene su toma", () => {
    let used = FILES.flatMap(f => all(/\/manual\/([a-z0-9_]+)\.webp/g, f.src))
    expect(used.filter(w => !WEBPS.includes(w))).toEqual([])
    expect(WEBPS.filter(w => !used.includes(w))).toEqual([])
    expect(WEBPS.filter(w => !SHOT_IDS.includes(w))).toEqual([])
    expect(SHOT_IDS.filter(s => !WEBPS.includes(s))).toEqual([])
  })
  it("no quedan secciones pendientes", () => {
    expect(FILES.filter(f => /class="pending"/.test(f.src)).map(f => f.name)).toEqual([])
  })
})
