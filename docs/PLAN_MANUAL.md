# Plan: manual de uso (`/manual`)

Manual para el iniciado, con capturas, dentro de la misma app y con su estética. Decisiones acordadas
con el dueño el 2026-10-30. Se implementa por fases, un commit por fase (subagentes en secuencia);
las pruebas a mano en el navegador van al final.

## Decisiones

1. **Dónde vive:** ruta pública `/manual` del frontend (sin sesión, como `/gallery`), con `PublicBar`
   arriba. Una sola página larga con índice lateral y anclas (`/manual#editor_region`): sirve para buscar
   con Ctrl+F y para imprimir a PDF desde el navegador (hoja `@media print`).
2. **Estética:** la de la app: `style.css` (`--bg`, `--panel`, `--hw_*`...), texturas, DSEG7, `.hw_panel`,
   `.silk`. Donde ayude se muestran **componentes reales** de `components/hw/` (un `Knob`, un `LedButton`)
   funcionando al lado del texto. Sin librerías nuevas en runtime.
3. **Público, en tres niveles:** 0 · Escuchar (visitante sin cuenta), 1 · Armar un proyecto (usuario con
   cuenta), 2 · Afinar (avanzado). **Admin queda afuera** (ni se menciona). El **kiosko** va como apéndice
   orientado al usuario, con link a `docs/INSTALACION.md` del repo solo como referencia para el dueño.
4. **Idioma:** texto en español rioplatense con voseo ("arrastrá", "hacé clic"), como el resto de la
   documentación. Los rótulos de la UI se citan tal cual aparecen (en inglés: START, SYNC, KEY LOCK) con el
   componente `<Ui>`.
5. **Capturas:** generadas por un script (`frontend/scripts/manual_shots.js`, `puppeteer-core` como
   devDependency, usa el Chrome instalado) contra un **sandbox**: backend local con una copia de `storage/`
   fuera del repo y un usuario/proyecto de demo. Formato webp (calidad ~85), viewport fijo, en
   `frontend/public/manual/`. Los números de las anotaciones **no** se queman en la imagen: son elementos
   HTML posicionados en % sobre la captura (estilo LED/pad de la app), con su leyenda abajo.
6. **Acceso:** botón MANUAL en la barra superior de `App.vue` y en `PublicBar.vue`; además un `?` chico en
   los diálogos principales (editor de archivos, FX, Projects, Import) que abre `/manual#<sección>` en otra
   pestaña.
7. **Formato del contenido:** un SFC de Vue por sección (sin Markdown ni dependencias nuevas), así cada
   sección puede usar `ManualShot`, `Ui`, `Term`, `Kbd`, notas y controles reales.
8. **Mantenimiento:** regla en `AGENTS.md`: si un cambio altera lo que el usuario ve o hace, actualizar la
   sección del manual y, si cambió la pantalla, regenerar sus capturas con el script.

## Índice

**Introducción** — `intro` qué es Looper (Track Groups en paralelo, Tags, cambio cada 2^n beats; diagrama
SVG) · `overview` la pantalla de un vistazo (captura anotada) · `glossary` glosario (loop, one-shot, beat,
compás, BPM, tonalidad, anchor, Track Group, Tag, región, peso).

**Nivel 0 · Escuchar** — 1 `gallery` galería · 2 `public_project` proyecto público (link con PLAY y
diálogo de carga, START/STOP, RESET, tempo y Tol, master, mixer local que no se guarda).

**Nivel 1 · Armar un proyecto** — 3 `first_project` tu primer proyecto paso a paso · 4 `account` cuenta
(registro con licencia, espera de admisión, login, bio, clave) · 5 `projects` proyectos (crear, abrir,
renombrar, borrar, visibilidad, LINK, pregunta al entrar, RAM) · 6 `audio` traer audio (subir: formatos,
1 min, cuota; importar del catálogo) · 7 `trg_tags` Track Groups y Tags (crear, color, asignar arrastrando,
peso del Tag) · 8 `files` Files (Box/Table, filtro por tonalidad, escuchar, SYNC, borrar) · 9 `play` tocar
(START/STOP/RESET, tempo y Tol, Time sig, posición, Tag actual y cuenta regresiva, rango de cambio de Tag)
· 10 `engine` cómo elige el motor (azar, pesos, compatibilidad con el Tag, tolerancia de tempo) · 11
`mixer` mixer (tiras: volumen, mute, solo, vúmetros; master y su LED de reducción) · 12 `share`
compartir y denunciar.

**Nivel 2 · Afinar** — 13 `editor` el editor de un vistazo (tipo, beats, key, anchor) · 14
`editor_region` región (START/STOP, SNAP, NUDGE/AUTO, FADE, lupas) · 15 `editor_edits` ediciones (CUT,
SILENCE, DUPLICATE, REVERSE, GAIN, UNDO/REDO, SAVE AS COPY, STRETCH) · 16 `editor_pitch` tono (transpose,
KEY LOCK, DETECT, TUNE TO) · 17 `editor_level` volumen, loudness y MATCH; Weight y Repeat · 18
`editor_preview` preview (SYNC, MIX / IN CONTEXT / SOLO, PREV/NEXT) · 19 `fx` FX de transición (pad a una
pista, lead, prob, cond) · 20 `global_fx` delay, reverb y COMP del master.

**Apéndices** — A `shortcuts` atajos de teclado (tabla única) · B `kiosk` modo instalación · C
`troubleshooting` problemas frecuentes (no suena: falta el gesto; fuera de tempo; archivo largo; cuota;
proyecto pesado).

Los ids de arriba son las anclas (`/manual#<id>`) y no se cambian una vez publicados (los usan los `?`).

## Estructura de archivos

```
frontend/src/views/Manual.vue          # layout: PublicBar, índice lateral (plegable en celular), contenido
frontend/src/manual/sections.js        # lista ordenada: { id, level, num, title, component }
frontend/src/manual/sections/*.vue     # una sección por archivo (Intro.vue, Gallery.vue, ...)
frontend/src/manual/ManualShot.vue     # captura con marco (LCD/hw_panel), callouts numerados en %, leyenda
frontend/src/manual/Ui.vue             # rótulo de la UI (serigrafía/LCD)
frontend/src/manual/Term.vue           # término con link al glosario
frontend/src/manual/Kbd.vue            # tecla
frontend/src/manual/Note.vue           # nota / aviso con LED (tipo tip | warn)
frontend/public/manual/*.webp          # capturas generadas
frontend/scripts/manual_shots.js       # script de capturas (lista declarativa de tomas)
docs/MANUAL.md                         # cómo mantener el manual: sandbox, demo, correr el script
```

## Sandbox para las capturas

- **Nunca** se escribe en `storage/` del repo. Se copia `storage/` (db + audio, ~40 MB) a un directorio
  fuera del repo (por defecto el scratchpad del agente o `%TEMP%/looper_manual_sandbox`).
- El backend lee `.env` del directorio actual (`dotenv.config()`): se arranca desde el sandbox,
  `cd <sandbox> && node <repo>/backend/index.js`, con un `.env` copia del de `backend/` donde solo cambian
  `db_file` y `storage_path` (apuntando a la copia). No imprimir ni volcar el `.env` (secretos; en
  particular `redis_password`). Redis es el mismo del desarrollo (solo sesiones).
- Puertos: los de siempre (31200 backend, 31201 frontend con `strictPort`, por CORS). Si están ocupados
  (el dueño tiene el dev corriendo), **no** matar procesos ajenos: avisar y detenerse.
- Usuario de demo en la copia de la base (`demo`, `status = 'active'`, `role = 'user'`, clave conocida)
  y un proyecto de demo armado con archivos del catálogo (pistas y tags con nombres musicales claros).
  El script que prepara la demo valida que la base que toca no sea `<repo>/storage/db.sqlite`.
- Chrome con `--autoplay-policy=no-user-gesture-required` para poder capturar estados sonando
  (LEDs encendidos, LCD, vúmetros).
- Al terminar, el agente baja los procesos que levantó.

## Fases (un commit por fase)

1. **Esqueleto:** ruta `/manual` (lazy) y `scrollBehavior` para las anclas; `Manual.vue`, `sections.js`,
   componentes `ManualShot`/`Ui`/`Term`/`Kbd`/`Note`; todas las secciones creadas con título y un
   "pendiente"; responsive y `@media print`; botón MANUAL en `App.vue` y `PublicBar.vue`. Docs:
   `ARCHITECTURE.md` (rutas), `AGENTS.md` (estructura).
2. **Capturas:** `puppeteer-core` (devDependency), sandbox y demo, `manual_shots.js` (lista declarativa:
   id, url, pasos previos, selector o recorte, viewport) con un `npm run manual_shots`; `docs/MANUAL.md`.
   Primera toma real: `overview` (la pantalla completa) puesta en la sección `overview` con sus callouts.
3. **Introducción y nivel 0:** `intro` (con diagrama SVG), `overview`, `glossary`, `gallery`,
   `public_project`, con capturas.
4. **Nivel 1 (a):** `first_project`, `account`, `projects`, `audio`, `trg_tags`, `files`.
5. **Nivel 1 (b):** `play`, `engine`, `mixer`, `share`.
6. **Nivel 2 (a):** `editor`, `editor_region`, `editor_edits`, `editor_pitch`.
7. **Nivel 2 (b):** `editor_level`, `editor_preview`, `fx`, `global_fx`.
8. **Apéndices y cierre:** `shortcuts`, `kiosk`, `troubleshooting`; los `?` en los diálogos (FileEditor,
   FxDialog, Projects, ImportFiles); regla de mantenimiento en `AGENTS.md`; revisión de coherencia (links
   al glosario, anclas, numeración, capturas que falten o sobren).

Cada fase de contenido: leer el código de lo que documenta (el manual describe lo que la app hace hoy,
no lo que dicen los planes), agregar sus tomas a `manual_shots.js`, regenerarlas en el sandbox,
`npm run lint` y `npm run build` sin errores, y commit.

## Pruebas a mano (al final)

- `/manual` en escritorio y en celular (índice plegable), modo oscuro, anclas desde los `?`.
- Imprimir a PDF desde Chrome: sin barra ni índice, capturas sin cortar.
- Que los controles reales embebidos respondan y no disparen audio.
- Revisar que el texto coincida con la app (rótulos, comportamiento) y que las capturas no muestren datos
  que no deban ser públicos.
