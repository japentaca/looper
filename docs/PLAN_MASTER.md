# Plan: dinámica del master (multibanda + limitador) con AudioWorklet

Reemplazar el `Tone.Limiter(-1)` del master por un procesador propio en un **AudioWorklet**:
crossover Linkwitz-Riley de 4.º orden (LR4) de 3 bandas con suma plana → compresor por banda →
limitador final con lookahead y techo −1 dBFS. El núcleo DSP es JS puro (sin APIs del navegador)
y se testea con Vitest en Node.

Leer antes: `AGENTS.md` (reglas, estilo), `docs/ARCHITECTURE.md` → "Mixer y vúmetros" (sobre
todo "Limitador master" y "Master"), `frontend/src/helpers/mixer.js`.

## Decisiones

- **Siempre** pasa por el worklet (cuando cargó): el limitador nuevo reemplaza al de Tone. El
  compresor multibanda tiene bypass (`comp.on`), **default `false`**: los proyectos existentes (y la
  instalación en kiosko) no se comprimen hasta que el dueño lo active en cada proyecto.
- Con COMP apagado el sonido cambia solo por: (a) el allpass del crossover (fase en 120 Hz y
  3 kHz, magnitud plana) y (b) el limitador nuevo, que **sí** garantiza el techo. El actual
  no: `Tone.Limiter` es un `Tone.Compressor` (DynamicsCompressorNode) con ratio 20 y el `knee`
  por defecto de Tone, **30 dB**, que en Chrome queda por encima del umbral: los picos sobre −1 dBFS
  pasan comprimidos suave, y Chrome además suma un makeup automático. Esperable: en proyectos
  calientes, transientes un poco más controlados.
- Respaldo: si el worklet no carga (contexto no seguro: `http://` que no sea localhost, navegador
  sin AudioWorklet, error de carga) o el procesador falla, suena el `Tone.Limiter(-1)` como hoy.
  El limitador de Tone queda **conectado siempre** como reserva caliente (ganancia 0 mientras
  manda el worklet; su costo es despreciable) para volver a él sin reconstruir nada.
- El volumen Master (`Destination.volume`) sigue **antes** de la dinámica, como hoy (subirlo empuja
  contra el limitador). Consecuencia nueva: con COMP prendido, el knob Master también cambia cuánto
  comprime (es la ganancia de entrada del bus). Se acepta y se documenta.
- Parámetros al worklet por **mensajes de `port`** (no AudioParams): cambian solo al mover un knob;
  el worklet suaviza internamente (sin clics). Más simple que AudioParams a través de
  standardized-audio-context.
- Empaquetado: `import url from "./master_dsp.worklet.js?worker&url"` (Vite 5). Ver "Empaquetado".
- Medición: el worklet manda la GR ~30 veces/s por `port`; `levels.gr` (limitador, LED LIM de
  `App.vue`) se mantiene y se agrega `levels.comp_gr = [low, mid, high]`.
- Config del proyecto: `TrackCtrl.comp`, guardado en `projects.props.comp` (el backend tiene **lista
  blanca** de claves: hay que agregar `comp`, ver F4). En modo lectura los controles no se muestran
  pero la config guardada se aplica igual.
- Cada fase en su propio commit (en español). F1 = este documento.

## Cadena de audio

Hoy: `Destination.input (Volume = Master) → master_limiter → Destination.output → salida`
(armado con `Tone.getDestination().chain(master_limiter)`); `master_meter` cuelga de
`Destination.output`.

Nueva (en `mixer.js`, cableado a mano en vez de `chain()`, porque `chain()` conecta en serie y acá
hay dos caminos en paralelo; es lo mismo que hace `chain()` por dentro):

```
canales, reverb_out, delay_out, preview
  → Destination.input (Tone.Volume, knob Master)
  → master_in (Tone.Gain)
       ├→ master_limiter (Tone.Limiter(-1)) → lim_gain (Tone.Gain, 1 → 0 al pasar al worklet)
       └→ dsp_node (AudioWorkletNode "looper-master") → dsp_gain (Tone.Gain, 0 → 1)
  → master_out (Tone.Gain) → Destination.output → rawContext.destination
                                               └→ master_meter (post-dinámica, como hoy)
```

```js
const dest = Tone.getDestination()
dest.input.disconnect()
dest.input.connect(master_in)
master_in.connect(master_limiter); master_limiter.connect(lim_gain); lim_gain.connect(master_out)
master_out.connect(dest.output)
```

Dentro del worklet (por canal, estéreo):

```
x ─┬─ LP(f1)·LP(f1) ── AP(f2) ─────────── low  ─ ×g_low  ─┐
   └─ HP(f1)·HP(f1) ─┬─ LP(f2)·LP(f2) ─── mid  ─ ×g_mid  ─┼─ Σ → limitador (lookahead) → y
                     └─ HP(f2)·HP(f2) ─── high ─ ×g_high ─┘
```

### Carga y cambio sin clic

1. Al importar `mixer.js` (no hace falta esperar a START: `addModule` funciona con el contexto
   suspendido) se llama `load_master_dsp()` (async, sin `await` en el nivel del módulo):
   - si `!window.isSecureContext` → no se intenta (queda el limitador de Tone, `levels.dsp = false`);
   - `await Tone.getContext().addAudioWorkletModule(worklet_url, "looper-master")`
     (Tone 14.7.77: `Context.addAudioWorkletModule(url, name)` cachea por `name` y hace un `assert`
     de `rawContext.audioWorklet`; si falla, la promesa se rechaza → `catch`);
   - `dsp_node = Tone.getContext().createAudioWorkletNode("looper-master", opts)` con
     `opts = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
     channelCountMode: "explicit", channelInterpretation: "speakers",
     processorOptions: { comp: { ...TrackCtrl.comp } } }`. `createAudioWorkletNode` de Tone crea el
     `AudioWorkletNode` de standardized-audio-context sobre el `rawContext` (importante: no usar
     `new AudioWorkletNode` nativo, no se conecta con los nodos de Tone);
   - conexión: `master_in.connect(dsp_node)` (Tone → nodo crudo: `connect` acepta AudioNode) y
     `Tone.connect(dsp_node, dsp_gain)` (o `dsp_node.connect(dsp_gain.input)`); `dsp_gain.connect(master_out)`.
2. Cambio: `lim_gain.gain.rampTo(0, 0.05)` y `dsp_gain.gain.rampTo(1, 0.05)` (fundido de 50 ms).
   Normalmente ocurre segundos antes del primer START (la carga del worklet es un archivo chico y
   local; la de los audios tarda mucho más), así que no se escucha. Si ya sonaba, el fundido evita
   el clic (durante 50 ms se suman dos señales desfasadas 3 ms: inaudible en la práctica).
   `levels.dsp = true`.
3. Falla en marcha: `dsp_node.onprocessorerror` o un mensaje `{ t: "error" }` del worklet → fundido
   inverso (`lim_gain` a 1, `dsp_gain` a 0, 50 ms), `levels.dsp = false`, `console.log`. No se
   reintenta hasta recargar la página.
4. Los mensajes al worklet se mandan con objetos planos: `{ ...TrackCtrl.comp }`. **No** mandar el
   reactive (un Proxy de Vue no es clonable: `DataCloneError`).

El contexto de Tone nunca se reemplaza (no hay `Tone.setContext`), así que el módulo se carga una
sola vez por página.

### Empaquetado (Vite 5.2)

Elegido: `import worklet_url from "./master_dsp.worklet.js?worker&url"` en `mixer.js`.

- En `build`, Vite empaqueta el worklet como entrada propia con Rollup (`bundleWorkerEntry`): un
  solo archivo `assets/master_dsp.worklet-[hash].js` con `master_dsp.js` **adentro** (formato
  `worker.format`, default `iife`: sin `import`, sin `importScripts`) y el import devuelve su URL.
- En `dev`, devuelve la URL del módulo fuente con `?worker_file&type=module`; Vite le antepone
  `import "/@vite/env"` (usa `globalThis`, existe en el AudioWorkletGlobalScope) y el import de
  `master_dsp.js` queda como import ES. standardized-audio-context descarga el fuente con `fetch`,
  separa los `import` (los resuelve a URL absolutas) y lo envuelve: funciona en Chrome.
- Alternativas descartadas: `new URL("./x.js", import.meta.url)` copia el archivo como asset **sin**
  resolver sus imports (se rompe en build); `?raw` + Blob obliga a que el worklet no importe nada
  (duplicar el DSP) o a armar el bundle a mano; `public/` deja el DSP fuera del bundle y de los tests.
- En `vite.config.js` se agrega `worker: { format: "iife" }` explícito (es el default) con un
  comentario: el worklet tiene que quedar en un solo archivo.
- Ojo: el `esbuild.drop` de `console` del build no garantiza aplicarse al bundle del worker; el
  worklet no usa `console` (los errores van por `port`).

## Archivos

| Archivo | Qué |
|---|---|
| `frontend/src/helpers/master_dsp.js` | **nuevo**. DSP puro: biquads, `Crossover3`, `knee_gain`, `BandComp`, `Limiter`, `MasterDsp`, `map_comp`, constantes y defaults. Sin `window`, `Tone`, `sampleRate` global ni Vue |
| `frontend/src/helpers/master_dsp.worklet.js` | **nuevo**. `class MasterProcessor extends AudioWorkletProcessor` + `registerProcessor("looper-master", …)`; importa `master_dsp.js` |
| `frontend/src/helpers/master_dsp.test.js` | **nuevo**. Tests Vitest del DSP (F2) |
| `frontend/src/helpers/master_dsp.worklet.test.js` | **nuevo** (F3). Humo del procesador con `AudioWorkletProcessor`/`registerProcessor`/`sampleRate` simulados en `globalThis` |
| `frontend/src/helpers/mixer.js` | cadena nueva, carga, cambio, `levels.comp_gr`, `levels.dsp`, watcher de `TrackCtrl.comp`, lectura de GR |
| `frontend/src/helpers/TrackCtrl.js` | `comp_default()`, `COMP_BAND_MIN/MAX`, `TrackCtrl.comp` |
| `frontend/src/helpers/composable.js` | `save_project_props` guarda `comp`; `apply_project_props` lo acota |
| `frontend/src/components/Tracks.vue` | grupo `g_comp` (COMP, GLUE, LOW/MID/HIGH, LEDs GR), grilla |
| `frontend/src/App.vue` | sin cambios funcionales: el LED LIM sigue leyendo `levels.gr` (revisar el `title`) |
| `backend/routes/api.js` | `"comp"` en `PROJECT_PROPS_KEYS` |
| `frontend/eslint.config.js` | bloque `files: ["**/*.worklet.js"]` con `globals.audioWorklet` (existe en `globals` 17: `registerProcessor`, `AudioWorkletProcessor`, `sampleRate`, `currentTime`, `port`…). Los tests importan `describe/it/expect` de `"vitest"` explícitamente: no hacen falta globals de vitest |
| `frontend/package.json` | devDependency `vitest` `^2.1` (la 2.x depende de `vite ^5`: se deduplica con el Vite del proyecto, no trae otro) y script `"test": "vitest run"` |
| `frontend/vite.config.js` | `worker: { format: "iife" }` (F3). Vitest lee este config; no hace falta bloque `test` (entorno `node` y patrón `**/*.test.js` por defecto) |
| `docs/ARCHITECTURE.md`, `docs/API.md`, `AGENTS.md` | ver fases |

## DSP (`master_dsp.js`)

Todo en `Number` (doble precisión) por muestra; buffers de E/S `Float32Array`. Ningún objeto se crea
dentro de `process` (nada de GC en el hilo de audio): todo se reserva en el constructor.

### Constantes (exportadas)

```js
export const XOVER_LOW_HZ = 120
export const XOVER_HIGH_HZ = 3000
export const BW_Q = Math.SQRT1_2            // Butterworth 2.º orden
export const LIMIT_CEILING_DB = -1
export const LIMIT_LOOKAHEAD_MS = 3
export const LIMIT_RELEASE_MS = 80
export const PARAM_SMOOTH_MS = 20           // makeup / trims
export const BYPASS_FADE_MS = 30            // on/off del compresor
export const GLUE_MAKEUP_DB = 4             // makeup fijo con amount = 1 (se escala con amount)
export const COMP_BANDS = [                 // por banda: umbral base, ratio máx, rodilla, tiempos, detector
  { thr: -6,  ratio_max: 4, knee: 6, attack_ms: 30, release_ms: 200, rms_ms: 25 }, // low
  { thr: -8,  ratio_max: 3, knee: 6, attack_ms: 15, release_ms: 150, rms_ms: 10 }, // mid
  { thr: -14, ratio_max: 3, knee: 6, attack_ms: 5,  release_ms: 100, rms_ms: 5 },  // high
]
```

Los umbrales son del nivel **de la banda** (dBFS). Los valores numéricos de `COMP_BANDS` y
`GLUE_MAKEUP_DB` se pueden recalibrar a oído en F5 (dentro de ±6 dB / ×1.5); si se cambian, se
actualizan acá y en `ARCHITECTURE.md`.

### Biquads y crossover

- Coeficientes RBJ (cookbook, transformada bilineal con prewarp en f0). `w0 = 2π·f/fs`,
  `c = cos w0`, `α = sin w0 / (2Q)`, `a0 = 1 + α`, `a1 = −2c`, `a2 = 1 − α`; normalizar todo por `a0`.
  - LP: `b0 = b2 = (1 − c)/2`, `b1 = 1 − c`
  - HP: `b0 = b2 = (1 + c)/2`, `b1 = −(1 + c)`
  - AP: `b0 = 1 − α`, `b1 = −2c`, `b2 = 1 + α`
- Forma transpuesta directa II: `y = b0·x + z1; z1 = b1·x − a1·y + z2; z2 = b2·x − a2·y`.
- LR4 = dos Butterworth (Q = 1/√2) iguales en cascada. LP y HP LR4 quedan **en fase** (se suman sin
  invertir). Identidad: `LP4 + HP4 = AP2(Q = 1/√2)` (en s: `1 + s⁴ = (s² + √2s + 1)(s² − √2s + 1)`); la
  bilineal es una sustitución y la conserva si los tres filtros usan el mismo f0 y fs.
- 3 bandas (por canal: 9 biquads): `low = AP(f2)·LP4(f1)·x`, `mid = LP4(f2)·HP4(f1)·x`,
  `high = HP4(f2)·HP4(f1)·x`. Suma = `AP(f1)·AP(f2)·x`: magnitud 1 en todas las frecuencias (el allpass
  en f2 sobre la banda baja compensa la fase del 2.º corte).
- `Crossover3(fs, f1, f2)`: `process(x, ch)` deja `this.low/mid/high` (escalares) para el canal `ch`;
  `reset()`; `flush()` (anti-denormales, abajo).

### Compresor por banda (`BandComp`)

- Detección con **stereo link total** (una sola ganancia por banda para los dos canales, la imagen no
  se corre): `d = max(xL², xR²)`.
  - `rms` (default en las 3 bandas): `ms += (1 − β)·(d − ms)`, `β = exp(−1/(τ_rms·fs))`;
    `L = 10·log10(ms + 1e-30)`.
  - `peak` (implementado y testeado, no expuesto): `L = 10·log10(d + 1e-30)`.
- Curva estática con rodilla suave (Giannoulis–Massberg–Reiss 2012), `knee_gain(L, T, R, W)` → dB ≤ 0:
  - `2(L − T) < −W` → `0`
  - `|2(L − T)| ≤ W` → `(1/R − 1)·(L − T + W/2)² / (2W)`
  - `2(L − T) > W` → `(1/R − 1)·(L − T)`
  - `W = 0` → rodilla dura (sin dividir por 0). `R = 1` → siempre 0.
- Suavizado de la GR en dB (balístico con ramas): `gc = knee_gain(...)`;
  si `gc < gr` → `gr = αA·gr + (1 − αA)·gc`, si no `gr = αR·gr + (1 − αR)·gc`, con
  `α = exp(−1/(τ·fs))` (τ = attack / release en s).
- Ganancia de la banda: `g = 10^((mix·(gr + makeup + trim)) / 20)`, donde
  - `mix` 0..1 es el bypass: va a `on ? 1 : 0` en rampa lineal de `BYPASS_FADE_MS` (paso por muestra
    `1/(0.03·fs)`). Con `mix = 0` la banda sale **intacta** (ni compresión, ni makeup, ni trim);
  - `makeup` y `trim` siguen a su objetivo con un polo de `PARAM_SMOOTH_MS`.
  - Con `on = false` y `mix` ya en 0 no se calcula la detección (ahorra CPU) y `ms`/`gr` quedan en 0:
    al prender arranca de cero y la rampa de `mix` evita el salto.
- Cambio de umbral o ratio: salta `gc`, pero `gr` lo sigue con attack/release: sin clic.

### Mapeo de los controles (`map_comp(comp)`, puro)

`comp = { on, amount, low, mid, high }` → por banda `i`:

- `T = COMP_BANDS[i].thr − 18·amount` (dB)
- `R = 1 + (ratio_max − 1)·amount` → con `amount = 0`, ratio 1 = no comprime (el GLUE "entra" desde cero)
- `makeup = GLUE_MAKEUP_DB·amount` (igual en las 3 bandas; sin makeup automático, para que no bombee
  el volumen)
- `trim = comp.low | comp.mid | comp.high` (dB, −6..+6): ganancia de la banda **después** del
  compresor (no cambia cuánto comprime). Es un "tilt" de 3 bandas; solo actúa con COMP prendido.
- Ejemplo con el default `amount = 0.5`: low T −15 / R 2.5, mid T −17 / R 2, high T −23 / R 2, makeup +2 dB.

### Limitador (`Limiter`)

Brickwall con lookahead, estéreo enlazado, techo `c = 10^(LIMIT_CEILING_DB/20)` (≈ 0.891).

- `N = max(1, round(LIMIT_LOOKAHEAD_MS/1000·fs))` (132 a 44.1 kHz, 144 a 48 kHz). Latencia = `N − 1`
  muestras (≈ 3 ms; la señal se demora en un buffer circular por canal).
- Por muestra:
  1. `p = max(|xL|, |xR|)`, `g_req = p > c ? c/p : 1`.
  2. `h = mínimo de g_req en las últimas N muestras` (ventana deslizante con cola monótona sobre un
     buffer circular: O(1) amortizado, sin alocar).
  3. Release: `r = h < r ? h : r + (1 − αR)·(h − r)` (`αR` con `LIMIT_RELEASE_MS`). Siempre `r ≤ h`.
  4. `b = promedio de r en las últimas N muestras` (suma corriente; se recalcula exacta cada vez que
     el índice del buffer vuelve a 0, para que no derive).
  5. Salida: `y = x[n − (N − 1)]·b`.
- Garantía: cada uno de los N valores promediados en `b` cubre la muestra `n − (N − 1)` en su ventana
  de mínimo, así que `b ≤ g_req[n − (N − 1)]` → `|y| ≤ c`. El ataque es una rampa de N muestras (sin
  clic), el release exponencial.
- Clip de seguridad final `y = clamp(y, −c, c)` (solo cubre error de redondeo). El constructor acepta
  `{ safety_clip: false }` para que el test verifique la garantía sin esa red.

### `MasterDsp`

- `new MasterDsp(fs, comp)`; `set_comp(comp)` (usa `map_comp`); `process(inL, inR, outL, outR, n)`;
  `take_meters()` → `{ comp: [l, m, h], lim }` = **máxima** GR (dB, positiva) desde la llamada anterior,
  y la resetea; `reset()`.
- Entrada saneada: `x !== x || !isFinite(x)` → 0 (un NaN aguas arriba no "pega" el estado de los filtros).
- Anti-denormales: al final de cada bloque, `flush()` pone en 0 los estados de los biquads con
  `|z| < 1e-15` (V8 no hace flush-to-zero; con silencio largo los estados decaen a subnormales y
  sube la CPU). Silencio → salida exactamente 0.
- Si la salida de un bloque no es finita (no debería), `reset()` y el bloque sale en silencio.

## Worklet (`master_dsp.worklet.js`)

- `constructor(options)`: `this.dsp = new MasterDsp(sampleRate, options.processorOptions.comp)`,
  `this.port.onmessage` → `{ t: "params", comp }` → `dsp.set_comp(comp)`; `{ t: "dispose" }` → el próximo
  `process` devuelve `false`.
- `process(inputs, outputs)`: sin entrada conectada (0 canales) → salida en 0; entrada mono → se usa
  el mismo canal para L y R. Todo el cuerpo en `try/catch`: ante una excepción se copia la entrada
  recortada a ±c, se manda `{ t: "error", text }` **una vez** y se sigue. Devuelve `true`.
- Medición: cada `ceil(sampleRate / 128 / 30)` bloques (12 a 44.1 kHz, 13 a 48 kHz: ~30/s)
  `port.postMessage({ t: "gr", comp: [l, m, h], lim })` con `take_meters()`. Si todo es < 0.05 dB y el
  envío anterior también lo era, no se manda (en silencio no hay tráfico; siempre sale un último 0).

## Medición e indicadores (`mixer.js`)

- `levels` suma `comp_gr: [0, 0, 0]` y `dsp: false` (true = suena el worklet).
- `dsp_node.port.onmessage`: guarda el último `{ comp, lim }` en una variable del módulo (no en el
  reactive: el reactive se escribe en el rAF, como los vúmetros).
- En `frame()`: `levels.gr = levels.dsp ? last.lim : Math.max(0, -master_limiter.reduction)`;
  `levels.comp_gr = levels.dsp ? last.comp : [0, 0, 0]` (asignar los tres valores, no reemplazar el
  array cada frame si no cambió). `showing` también mira `comp_gr`. Al cortarse el loop: todo a 0.
- El preview pasa por el master: también se ve la GR mientras suena un preview (el rAF corre).
- `App.vue`: LED LIM igual (`levels.gr`; amarillo > 1 dB, rojo > 3 dB). `title`: "Limiter GR".

## UI (`Tracks.vue`)

Grupo nuevo `g_comp` en el panel Transport, **debajo del master** (oculto en modo lectura, como delay
y reverb: `v-if="!store.read_only"`). Grilla ancha:

```
"transport tempo delay  range master"
"position  tag   reverb range comp"
```

(`g_master` deja de ocupar las dos filas; `align-self: stretch` queda solo para `g_range`.) Modo
lectura sin cambios: `"transport tempo master" / "position tag master"`. Si con el grupo nuevo la grilla
no entra en 1300 px (medir en el navegador, como se hizo para el valor actual), subir el
`@container (min-width: …)` al ancho medido. En panel angosto va en el flujo con wrap, después del master.

Contenido (izquierda a derecha):

- `LedButton` chico `text="COMP"`, `led="green"`, `:lit="TrackCtrl.comp.on"`, `label="Dynamics"` → toggle.
- `Knob` `GLUE` (`size 48`, 0..1, step 0.01, `title` "Glue 50%").
- Tres columnas `LOW` / `MID` / `HIGH`: arriba un `Led` (amarillo con GR > 1 dB, rojo > 6 dB, `:lit` con
  GR > 1 dB, `title` "Low GR 2.3 dB"), abajo un `Knob` `size 32`, `COMP_BAND_MIN..COMP_BAND_MAX`
  (−6..+6), step 0.5, `title` "Low +1.5 dB".
- Con COMP apagado, GLUE y LOW/MID/HIGH se atenúan (opacity), pero se pueden mover (se guardan).
- Si `!levels.dsp` (sin worklet) todo el grupo atenuado, COMP deshabilitado y `title`
  "Requires a secure context (https)".
- Handlers: `toggle_comp()` y `set_comp(key, v)` escriben `TrackCtrl.comp` y llaman a
  `save_project_props_debounced()`. `mixer.js` reacciona con un `watch(() => ({ ...TrackCtrl.comp }),
  c => dsp_node?.port.postMessage({ t: "params", comp: c }))`.

## Config y guardado

- `TrackCtrl.js`: `export const COMP_BAND_MIN = -6`, `COMP_BAND_MAX = 6`,
  `export function comp_default() { return { on: false, amount: 0.5, low: 0, mid: 0, high: 0 } }`,
  `TrackCtrl.comp = comp_default()`; actualizar el comentario de la config del proyecto.
- `composable.js`:
  - `save_project_props`: `comp: { ...TrackCtrl.comp }`; agregar "compresor" al texto del error.
  - `apply_project_props`: `c = p.comp` objeto o `{}`; `on: c.on === true`;
    `amount: clamp(c.amount, 0, 1, 0.5)`; `low/mid/high: Math.round(clamp(v, -6, 6, 0) * 2) / 2`.
    Con `Object.assign(TrackCtrl.comp, …)` (como delay y reverb: el watcher de `mixer.js` manda los
    parámetros al worklet). Proyectos sin `comp` → defaults (COMP apagado).
- Backend: `PROJECT_PROPS_KEYS` + `"comp"` (si no, `PUT /projects/:id` lo descarta en silencio). El
  backend no valida el contenido (como `delay`/`reverb`); el front acota al cargar. Tamaño: entra
  holgado en `PROPS_MAX_LENGTH` (4096).
- `docs/API.md`: forma de `props` del proyecto (líneas de `GET /projects/:id` y `PUT /projects/:id`).
- `docs/ARCHITECTURE.md`: `projects.props` en el modelo de datos (`comp`).

## Tests (Vitest, Node) — `master_dsp.test.js`

Helpers del test: generador de seno, ruido con semilla fija (LCG propio, determinístico), RMS en dB
sobre una ventana estable (descartando el transitorio inicial). Los marcados con *fs* corren con
`[44100, 48000]` (`describe.each`).

1. **Crossover plano** (*fs*): senos de 20, 50, 100, 120, 200, 500, 1000, 3000, 5000, 10000 y 18000 Hz
   (1 s, se mide el último 0.5 s): `|20·log10(rms(low+mid+high)/rms(x))| < 0.1 dB` (esperado ~1e-6).
   Además: en f1, `low` y `mid` a −6.02 dB ± 0.2; en f2, `mid` y `high` ídem; `low` a 1 kHz < −40 dB y
   `high` a 500 Hz < −40 dB.
2. **Curva estática** (`knee_gain`, exacto): T −20, R 4, W 0, L −8 → −9 dB; W 6, L = T →
   `(1/4 − 1)·6/8 = −0.5625`; continuidad en `L = T ± W/2` (diferencia < 1e-9); R 1 → 0.
3. **GR estática con seno** (`BandComp` sola, detector RMS, rodilla dura): seno de 1 kHz a −8 dBFS RMS,
   T −20, R 4 → GR en régimen 9 dB ± 0.5. Con `peak`: seno con pico −8 dBFS → GR máxima ≈ 9 dB ± 0.5.
4. **Tiempos**: escalón de −40 a −10 dBFS (peak, hard knee): la GR llega al 63 % de su valor final en
   `attack_ms` ± 30 %; al volver a −40, cae al 37 % en `release_ms` ± 30 %.
5. **Limitador nunca pasa el techo** (*fs*, `safety_clip: false`): ruido a +12 dBFS, impulsos aislados de
   amplitud 4 tras silencio, ráfagas de cuadrada a +6 dB, barrido de seno a +6 dB, un solo canal
   saturado y el otro en silencio: `max|y| ≤ c·(1 + 1e-9)`.
6. **Limitador transparente bajo el techo**: ruido con pico −6 dBFS → `y[n] = x[n − (N − 1)]` exacto
   (error < 1e-12); confirma la latencia `N − 1`.
7. **Bypass**: `MasterDsp` con `on: false` y señal bajo el techo = `Crossover3` (suma) del mismo input
   demorado `N − 1` (error < 1e-9). Lo mismo con `on: true, amount: 0` y trims 0 (ratio 1).
8. **Sin clics**: al pasar `on` false→true, `amount` 0→1 y un trim −6→+6 en medio de un seno, la
   ganancia por muestra de cada banda nunca cambia más de 0.5 % entre muestras consecutivas (exponer las
   ganancias de banda para el test, p. ej. `dsp.band_gain[i]`).
9. **Estabilidad**: 10 s de silencio → salida exactamente 0 y estados de biquads en 0 tras `flush()`;
   ruido seguido de 1 s de silencio → estados en 0; entrada con NaN/±Infinity → salida finita y vuelve
   a la normalidad en la muestra siguiente; entrada de amplitud 1e6 → finita y ≤ c; señal de 1e-30 → finita.
10. **Mapeo**: `map_comp` con `amount 0` → ratio 1 en las 3 bandas; `amount 1` → `ratio_max` y
    `thr − 18`; `makeup = GLUE_MAKEUP_DB·amount`.

`master_dsp.worklet.test.js` (F3): con `globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {}, onmessage: null } } }`,
`globalThis.registerProcessor` que captura la clase y `globalThis.sampleRate = 48000`, importar el
worklet: se registra `"looper-master"`; `process` con 0 canales, mono y estéreo no lanza y devuelve
`true`; manda `{ t: "gr" }` con la cadencia esperada; `{ t: "params" }` cambia el estado.

## Fases

Cada fase = un commit en español; antes de cerrar: `cd frontend && npm run lint` (0 errores en lo
tocado), `npm test` (desde F2), `npm run build`; si se tocó el backend, `node --check` y arrancar
`node index.js`. Decir qué se verificó y qué no.

### F1 — este plan

`docs/PLAN_MASTER.md`. Commit: "Plan de la dinámica del master (multibanda + limitador en AudioWorklet)".

### F2 — DSP puro + tests

- Archivos: `master_dsp.js`, `master_dsp.test.js`, `package.json` (+ `package-lock.json`): `vitest ^2.1`,
  `"test": "vitest run"`. Agregar el comando a "Verificación" de `AGENTS.md` ya en esta fase (la regla
  de AGENTS lo pide al agregar tests).
- Nada importa todavía `master_dsp.js` desde la app: el build no cambia.
- Aceptación: los 10 grupos de tests pasan; lint sin errores; `npm run build` igual que antes.
- Commit: "master_dsp: crossover LR4 de 3 bandas, compresor por banda y limitador con lookahead (DSP puro) + tests con Vitest".

### F3 — worklet + integración en `mixer.js` con respaldo

- Archivos: `master_dsp.worklet.js`, `master_dsp.worklet.test.js`, `mixer.js` (cadena, carga, cambio,
  falla, medición, `levels.comp_gr`/`levels.dsp`), `eslint.config.js` (globals de worklet),
  `vite.config.js` (`worker.format`), `TrackCtrl.js` (solo `comp_default` y `TrackCtrl.comp`, para que el
  worklet reciba sus parámetros; sin UI ni guardado todavía).
- `docs/ARCHITECTURE.md`: reescribir "Limitador master" → "Dinámica del master" (cadena, respaldo,
  medición) en este mismo commit (regla de AGENTS: el motor y su doc van juntos).
- Aceptación: en dev (`localhost`) y en `npm run build && npm run preview`, al cargar la app el master
  pasa al worklet (verificable con un `console.log` en dev o con `levels.dsp` desde Vue devtools); el
  LED LIM se enciende con loops fuertes; abriendo la app por `http://<ip-de-la-LAN>:31201` (no seguro)
  suena con el limitador de Tone sin errores.
- Build: `ls frontend/dist/assets/master_dsp.worklet-*.js` existe y no contiene `import `,
  `importScripts` ni `self.` (grep).
- Commit: "mixer: dinámica del master en AudioWorklet (limitador con lookahead) con Tone.Limiter de respaldo".

### F4 — UI + TrackCtrl + guardado

- Archivos: `Tracks.vue` (grupo `g_comp`, grilla), `TrackCtrl.js` (`COMP_BAND_MIN/MAX`, comentario),
  `composable.js` (guardar + acotar), `backend/routes/api.js` (`PROJECT_PROPS_KEYS`), `App.vue` (title,
  si hace falta), `docs/API.md` (props del proyecto), `docs/ARCHITECTURE.md` (UI, `projects.props.comp`).
- Aceptación: COMP/GLUE/LOW/MID/HIGH cambian el sonido en vivo sin clics; los LEDs por banda se
  encienden; recargar el proyecto conserva los valores; un proyecto viejo abre con COMP apagado; en
  `/p/:id` el grupo no se ve pero un proyecto guardado con COMP prendido suena comprimido; en modo
  lectura no sale ningún `PUT`.
- Commit: "Tracks: controles COMP / GLUE / LOW-MID-HIGH del master, guardados en projects.props.comp".

### F5 — revisión + docs

- Revisión de todo el cambio (correctitud, clics, CPU con la pestaña de Performance de Chrome).
- Recalibrar a oído, si el dueño lo pide, `COMP_BANDS` / `GLUE_MAKEUP_DB` (dentro de lo previsto arriba).
- `AGENTS.md`: nuevos archivos en "Estructura" (`master_dsp.js`, `master_dsp.worklet.js`, tests),
  `master_dsp*.js` en la lista de archivos de reproducción del punto 3 de "Verificación".
  `docs/ARCHITECTURE.md` revisado completo. `docs/KNOWN_ISSUES.md`: anotar lo que quede (p. ej. sin
  true-peak). Marcar este plan como implementado (o borrarlo si el dueño prefiere).
- Commit: "Dinámica del master: revisión y documentación".

## Pruebas manuales a oído (al final, las hace el dueño)

1. Proyecto existente con COMP apagado: comparar con la versión anterior (otra pestaña con el deploy
   anterior o `git stash`): el sonido debería ser igual salvo picos algo más controlados. El LED LIM
   se enciende en los mismos momentos.
2. START/STOP/RESET varias veces, cambiar de proyecto, previews de Files e Import: sin clics ni cortes.
3. COMP on/off con el transporte sonando: sin clic, solo el cambio de dinámica.
4. GLUE de 0 a 1 despacio: de "igual que apagado" (0) a claramente pegado/denso (1); sin bombeo
   exagerado en 0.5 con los loops de Psytrance Warriors y Deep Organic Percussion.
5. LOW/MID/HIGH a ±6: el balance cambia como un EQ de 3 bandas; sin huecos ni resonancias en 120 Hz
   y 3 kHz (barrer con un loop de bajo y uno de hats).
6. Master a +6 dB con COMP prendido y apagado: no distorsiona (la salida no pasa −1 dBFS); el LED LIM rojo.
7. LEDs de GR por banda: el LOW reacciona al bombo, el HIGH a hats/platos.
8. Recargar: COMP, GLUE y bandas quedan como se dejaron. Abrir el link público `/p/<id>`: suena igual,
   sin los controles.
9. Kiosko (`/p/<id>?autostart=1` en Chrome): arranca solo y suena; una corrida larga (varias horas) sin
   glitches ni subida de CPU (Administrador de tareas de Chrome).
10. Si hay un Mac/iPhone a mano: Safari, mismo recorrido corto (1–4).

## Riesgos

- **CPU**: 18 biquads + 3 detectores (un `log10` y un `pow` por banda y muestra) + el limitador:
  estimado < 2 % de un núcleo a 48 kHz. Sin alocaciones en `process`. Con COMP apagado se ahorran los
  detectores. Si hiciera falta: calcular la ganancia de las bandas cada 8 muestras e interpolar.
- **Latencia**: el lookahead agrega ~3 ms a todo el master (la salida respecto del reloj de Tone). Es
  constante e inaudible para el loop player; los LEDs de beat (`Tone.Draw`) no se notan corridos.
- **Clics**: cambio limitador→worklet y vuelta con fundido de 50 ms; bypass con rampa de `mix`;
  parámetros suavizados; el limitador ataca en rampa de N muestras. Probado en el test 8.
- **Falla del worklet en el kiosko**: si el procesador se cae, el master quedaría mudo; por eso el
  `Tone.Limiter` de reserva conectado y el fundido de vuelta en `onprocessorerror`/`{ t: "error" }`, y el
  `try/catch` dentro de `process`. Un cuelgue sin error no se detecta (riesgo aceptado).
- **Navegadores**: Chrome/Edge (el objetivo, incluido el kiosko) sin problemas. Firefox y Safari ≥ 14.5
  tienen AudioWorklet; standardized-audio-context parchea diferencias. En dev el worklet usa `import`
  ES (lo resuelve standardized-audio-context); en build es un solo archivo. Contexto no seguro (`http`
  en la LAN) → respaldo.
- **Contexto suspendido / recuperación**: el nodo vive en el mismo `AudioContext`; `resume()` no lo
  afecta. No hay reemplazo de contexto en la app.
- **Preview**: pasa por la dinámica (como hoy por el limitador): con COMP prendido el preview de un
  archivo suelto también se comprime. Aceptado (es lo que se escucharía en la mezcla).
- **Master antes de la dinámica**: bajar el knob Master con COMP prendido comprime menos (cambia el
  carácter, no solo el volumen). Para bajar el volumen del kiosko conviene el del sistema/amplificador.
- **Sin true-peak**: el techo es por muestra; picos entre muestras pueden pasar −1 dBFS por décimas
  (por eso el techo no es 0). Anotarlo en `KNOWN_ISSUES.md`.
- **Vitest**: es devDependency; `deploy.sh` corre `npm ci` completo (el build necesita Vite, que también
  es dev), así que el VPS lo instala igual. Solo cuesta tiempo de instalación; no entra en `dist/`.

## Dudas abiertas

- Si el dueño prefiere que GLUE tenga makeup automático (compensar la GR media) en vez del fijo
  `GLUE_MAKEUP_DB·amount`.
- Si los knobs LOW/MID/HIGH deberían actuar también con COMP apagado (hoy: no; el bypass es total).
- Si conviene que el volumen Master vaya **después** de la dinámica (exigiría limitar el Master a ≤ 0 dB
  o un segundo techo).
