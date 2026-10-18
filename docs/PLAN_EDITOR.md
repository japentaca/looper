# Plan: editor gráfico de loops/samples

Estado: **acordado**; se implementa por fases (ver "Fases" al final), un commit por fase. Hechas: fases 1, 2,
3, 4 y 5 (lo vigente se documenta en "Preview", "Editor: pantalla de onda", "Editor: región", "Editor: anchor",
"Loudness" y "Editor: loudness y MATCH" de `ARCHITECTURE.md`).

## Decisiones

### 1. Sync on/off del preview

- **Off** (como hoy): el preview suena libre, a la velocidad original del archivo (sin `playbackRate`),
  una sola vez y directo a `Destination`. Sirve para escuchar el audio crudo (p. ej. verificar `beats`).
- **On**:
  - velocidad = `play_rate` del archivo (tempo del proyecto; resample, cambia el tono como en el motor);
  - arranque: con el motor andando, en el próximo compás del Transport (los shots, en el próximo beat
    respetando `anchor`); con el motor parado, ya, al tempo del proyecto;
  - queda en loop hasta STOP (para oír la costura y compararlo con la grilla);
  - con el motor andando, sale por el master (mismo nivel y dinámica que la mezcla).
- Un solo switch, global: vale en el editor y en el play de cartuchos y tabla.
- Se recuerda por navegador (`localStorage`), no en el proyecto.

### 2. Modo de escucha del preview (MIX / IN CONTEXT / SOLO)

Selector de 3 posiciones en el editor; solo importa con sync on y el motor andando (si no, el preview
suena solo de todos modos).

- **MIX**: el preview suena encima de toda la mezcla.
- **IN CONTEXT** (por defecto): el preview suena *en lugar* de lo que toca su pista. Entra por el canal
  de su pista (volumen, pan, sends de Rev/Dly, FX), así suena como si lo hubiera sorteado el motor; lo
  que se calla es el player que la pista tiene sonando, no el canal. Al soltar el preview, la pista
  vuelve en el próximo compás. Si el archivo no tiene pista asignada, se comporta como MIX.
- **SOLO**: solo el preview; el motor queda callado pero sigue andando (no pierde el tempo).
- Se recuerda por navegador (`localStorage`), como el sync.
- Descartado por ahora: "fijar" un loop en el motor (forzarlo en su pista ignorando tag, peso y
  descansos). IN CONTEXT cubre casi lo mismo sin tocar el sorteo de `Tracks.vue`.

### 3. Pantalla de onda, grilla y cursor

- **Ubicación**: el editor es el diálogo de edición actual de Files, agrandado: la pantalla de onda
  arriba a todo el ancho y debajo los datos y placas de hoy. El lápiz del cartucho abre el editor.
- **Pantalla**: canvas con estética de LCD (colores de `Lcd.vue`), picos min/max por píxel calculados
  en el cliente del buffer ya cargado en el `Tone.Player` (sin backend). Estéreo (dos carriles L/R) si el
  archivo es estéreo; un carril si es mono. Sin zoom en el MVP (1 min máx. ≈ 80 ms por píxel).
- **Grilla de loops**: línea por beat y más marcada por compás (`beats_x_bar` del proyecto), repartidas
  sobre los `beats` del archivo. Al cambiar `Beats` (el dueño) se redibuja en vivo, antes de guardar.
  Si el motor lo toca a ×2 o ×½ (`play_beats` ≠ `beats`), un rótulo lo dice ("en este proyecto: 16 beats (×2)").
- **Grilla de shots**: al tempo del proyecto, desde el `anchor` (desde el inicio, o hacia atrás desde el final).
- **Cursores**: el del preview (con `play_rate` en sync on) y, de otro color, el del motor cuando ese
  archivo suena en su pista. El clic en la onda no hace nada en el MVP ("reproducir desde acá" choca con el sync).

### 4. Dónde viven las ediciones: no destructivas vs destructivas

El criterio es si hace falta regenerar el audio.

- **`files`** (sin cambios): `beats`, `kind`, `music_key`, `anchor`; los cambia solo el dueño y valen
  para todos los proyectos que lo importaron.
- **No destructivas → `project_files.props`** (dueño del proyecto, vale solo en ese proyecto):
  `volume`, `weight`, `repeat` (ya están) y las del editor:
  - **Start/stop**: en loops, en beats enteros sobre la grilla del archivo + un ajuste fino en ms que
    corre la grilla entera (compensa el silencio del encoder al inicio). Los beats efectivos del loop en
    el proyecto son `stop − start` (el motor los usa en vez de `beats`). En shots, start/stop libres.
  - **Micro-fade de costura** (anti-click; `fadeIn`/`fadeOut` de `Tone.Player`).
  - **Pitch** sin cambiar el playback rate (ver punto 5).
  - No hace falta que el recorte viva en `files`: el motor redispara el loop en cada tirada (no acumula
    desfase) y el error de BPM del catálogo por unos ms de silencio es despreciable (~0,4 %).
- **Destructivas → copia nueva** (nunca se pisa el original): cortes en el medio, efectos.
  - Archivo nuevo a nombre de quien edita, con `files.parent_id` = el original (atribución visible),
    cuenta en la cuota. Se permite copiar archivos ajenos: los archivos subidos son royalty free y los
    litigios van por la sección de denuncias (`reports`).
  - En el proyecto, la referencia pasa a la copia conservando pista, tags y props.
  - Render en el navegador (`OfflineAudioContext` con el mismo Tone que se escuchó) y subida por el
    endpoint de subida existente (valida, recodifica a mp3, descuenta cuota). Backend: solo `parent_id`.
    Costo: una generación más de mp3 (V0), casi inaudible.

### 5. Pitch sin cambiar el rate

- **Pre-render en memoria**: el proyecto guarda `transpose` (semitonos) en `project_files.props`; al
  cargar, el navegador calcula offline el buffer transpuesto y el motor lo toca como cualquier buffer
  (original intacto, calidad de render offline, motor sin cambios, sin CPU mientras suena; costo: CPU al
  cargar y un buffer extra por archivo transpuesto). Descartados: `Tone.PitchShift` en vivo (warble en
  percusión y retardo) y la copia destructiva.
- **KEY LOCK**: botón que compensa el cambio de tono del resample del motor (p. ej. loop de 128 a 138 BPM
  sube ~1,3 semitonos → transpose −1,3). Re-render al soltar el knob de tempo.
- **Tonalidad mostrada**: en el proyecto, la efectiva (`music_key` + transpose), con marca de transpuesto.
- **Detectar pitch**: dos detectores. Loops → tonalidad (sugerencia: confunde relativas; el dueño confirma
  y llena `music_key`). Shots → nota + cents, con botón "afinar a…" que calcula el `transpose`.
  Quien no es dueño solo ve el resultado.
- **Librerías** (el repo sigue MIT; sin copyleft, sin uso comercial previsto):
  - Pitch-shift: **Signalsmith Stretch** (npm `signalsmith-stretch`, MIT, WASM + AudioWorklet). Su
    latencia no importa en offline (se recorta). Más adelante sirve para cambiar tempo sin cambiar tono.
  - Análisis: **detectores propios** (cromagrama + perfiles de Krumhansl para tonalidad, YIN para nota),
    funciones puras en `helpers/` con tests Vitest, como `master_dsp.js`; librerías JS MIT (Meyda,
    Pitchy) si conviene. Descartados por licencia: Essentia.js (AGPL-3), aubio (GPL-3), Rubber Band (GPL-2).

### 6. Start/stop, NUDGE y costura (no destructivos, en `project_files.props`)

- **Marcadores start/stop**: dos manijas sobre la onda; lo de afuera se ve atenuado.
- **Imán (SNAP)**, desactivable: un `LedButton` SNAP en el editor, y mantener Shift lo invierte mientras
  se arrastra. En loops pega a las líneas de beat; en shots, al cruce por cero más cercano.
  - Start/stop se guardan en beats (float). Con imán, enteros; sin imán, fraccionarios.
  - Loop con región no entera: el motor usa `round(stop − start)` como beats de la tirada y el player
    toca la región exacta (si es más corta queda un hueco; si es más larga, la corta el disparo
    siguiente). El editor avisa ("región de 7,3 beats").
- **NUDGE**: knob en ms (0–250, paso 1) que corre la grilla entera a la derecha (silencio del encoder).
  Botón AUTO: primer golpe por umbral de amplitud (sin librería).
- **Lupa de inicio**: recuadro con los primeros ~200 ms ampliados y la línea del beat 0.
- **Lupa de costura**: final de la región pegado a su inicio (lo que suena al repetir); un click se ve
  como un salto.
- **FADE**: in/out en ms (`fadeIn`/`fadeOut` de `Tone.Player`), 0–50, por defecto 0 (nada cambia).
- **Motor**: el largo del beat sale del BPM del archivo (recortar no cambia BPM ni tolerancia, solo los
  beats que ocupa). Player con `offset = nudge + start × beat` y `duration = (stop − start) × beat`.
  Región de beats impares → no puede ir a ×½ (`file_timing` ya lo contempla).

### 7. Anchor de los shots como punto

- **Marcador arrastrable** "esto cae en el beat". Con SNAP: al golpe más cercano (umbral, como AUTO) o a
  los bordes de la región.
- **Dónde**: `files.anchor` (`start`/`end`, del dueño) queda como default del catálogo; el proyecto puede
  guardar un punto propio en `project_files.props.anchor` (segundos desde el inicio del archivo). Vive
  con el recorte: un anchor del catálogo podría quedar fuera de la región del proyecto.
- **Motor** (`engine_oneshot.js`): se unifican los dos caminos. Pre-roll = `anchor − start`: 0 → se
  dispara en el beat (los `start` de hoy); > 0 → se agenda por adelantado con ese pre-roll (generaliza
  `end_step`). `end` = caso "anchor = stop". (Ajuste posterior: un pre-roll chico, menos de
  `PREROLL_ON_BEAT` = 0,1 s, va por el camino del beat arrancando antes; ver "Pistas one-shot" en `ARCHITECTURE.md`.)
- Si el anchor queda fuera de la región (se movió start/stop), se ajusta al borde más cercano, con aviso.
- Los loops no llevan anchor (anacrusa): se resuelve con NUDGE y start/stop.

### 8. Gain: loudness y MATCH

- **Medición en el backend**: ffmpeg `ebur128` (loudness integrada en LUFS y true peak) → columnas
  `files.loudness` y `files.peak`, calculadas al subir y completadas por una migración para los
  existentes (como `duration`). Sobre el archivo entero, no la región recortada.
- **Editor**: muestra LUFS y pico con el `volume` del proyecto aplicado.
- **MATCH**: lleva el `volume` del archivo a la loudness promedio de los otros archivos de su pista.
- **Tope**: `FILE_VOL_MAX_DB` pasa de 0 a **+12 dB** (el limitador del master cubre el clip). Cambia la
  escala del Fader (el 0 deja de estar arriba del todo).
- Para después: preview del catálogo/importar nivelado con `files.loudness` (hoy fijo en −6 dB).

### 9. Ediciones destructivas

- **Selección**: arrastrar sobre la onda (fuera de las manijas) marca un rango; respeta SNAP (beats en
  loops, cruce por cero en shots).
- **Operaciones del MVP**: CUT (quita el rango, acorta), SILENCE (rango a cero, mismo largo), DUPLICATE
  (repite el rango a continuación), REVERSE (rango o todo), GAIN (rango en dB), STRETCH (tempo sin
  cambiar tono, con Signalsmith).
- **Para después**: CHOP (rebanadas por beat, reordenables) y efectos de Tone renderizados (filtros,
  distorsión, bitcrusher; se superponen con los FX de pista).
- **Pila de edición**: las operaciones se apilan sobre un buffer de trabajo en memoria (el preview toca
  ese buffer), con UNDO/REDO; nada se sube hasta SAVE AS COPY. Al cerrar con cambios, pregunta.
- **SAVE AS COPY** renderiza lo que se escucha:
  - se hornea la región del proyecto (`nudge` + start/stop): la copia arranca en el beat 0;
  - quedan como props del proyecto sobre la copia (no se hornean): `volume`, `weight`, `repeat`,
    `transpose`, `fade` y `anchor` (recalculado al nuevo inicio);
  - copia: nombre `"<original> (edit)"` (editable antes de guardar), `kind` y `music_key` heredados,
    `beats` recalculado (región ± CUT/DUPLICATE; STRETCH → BPM nuevo), `parent_id` = el original;
  - el original no se borra (sigue en el catálogo); solo deja de usarse en este proyecto.
- **SAVE REGION AS COPY**: guarda la selección como copia nueva **sin reemplazar** al original: la copia
  se agrega al proyecto al lado, en la misma pista y con los mismos tags (después se reasigna).

### 10. Rebanadas virtuales: para después

Variantes de un mismo archivo en el proyecto (rango de beats con tags y peso propios, sin subir otro
archivo). No cuestan cómputo (un `Tone.Player` con `offset`/`duration`; pueden compartir el
`ToneAudioBuffer`), pero sí un refactor transversal: hoy todo se identifica por `file.id` (el backend no
deja repetir un archivo en un proyecto; `audio_players`, `files_by_id`, el motor, Files y los cartuchos
también), y habría que pasar a la fila de `project_files`. Mientras tanto, SAVE REGION AS COPY cubre lo
mismo a cambio de cuota. Revisar si la cuota se vuelve un problema.

### 11. Atajos de teclado

Solo con el editor abierto, y se ignoran si el foco está en un input, knob o fader (no robarles flechas
ni escritura). Cada fase agrega los atajos de lo que implementa.

| Tecla | Acción |
|---|---|
| Espacio | play/stop del preview |
| Q | sync on/off |
| M | modo de escucha MIX → IN CONTEXT → SOLO |
| G | SNAP on/off (Shift lo invierte mientras se arrastra) |
| ← / → | mueve el último marcador tocado (start, stop, anchor, borde de selección): un beat con SNAP, 1 ms sin SNAP; Shift invierte |
| Ctrl+Z / Ctrl+Shift+Z, Ctrl+Y | undo / redo de la pila destructiva |
| Supr / Backspace | CUT de la selección |
| Ctrl+D | DUPLICATE |
| R | REVERSE (selección o todo) |
| Esc | quita la selección; sin selección, cierra el editor (pregunta si hay cambios sin guardar). Hay que interceptar el Esc del `el-dialog` |

- Cada atajo aparece en el `title` de su botón ("CUT (Supr)"); un "?" en el editor muestra la tabla.
- Para después: Espacio global para START/STOP del motor (choca con el del editor y con ToggleSwitch).

## Fases

Cada fase se puede usar sola, lleva su propio commit y actualiza `ARCHITECTURE.md` / `API.md` en el
mismo cambio. Las que tocan la reproducción (2, 3, 4, 7) cierran con una lista de pruebas manuales.

| Fase | Contenido | Motor | Backend |
|---|---|---|---|
| **1. Pantalla** | Diálogo agrandado, onda (estéreo/mono), grilla de loops y shots, grilla en vivo al cambiar `beats`, cursor del preview y del motor, rótulo ×2/×½ | no (solo lee) | no |
| **2. Preview** | Sync on/off, loop en sync, salida por el master, MIX / IN CONTEXT / SOLO, `localStorage`, atajos Espacio/Q/M | `toneLib.js`, `mixer.js` | no |
| **3. Región** | Start/stop, SNAP, NUDGE + AUTO, FADE, lupas de inicio y costura; el motor usa `offset`/`duration` y los beats efectivos | `Tracks.vue`, `TrackCtrl.js` (`file_timing`) | lista blanca de `project_files.props` |
| **4. Anchor** | Anchor como punto; unificar los dos caminos de `engine_oneshot.js` | `engine_oneshot.js` | idem |
| **5. Loudness** | `ebur128` al subir + migración, LUFS/pico en el editor, MATCH, `FILE_VOL_MAX_DB` a +12 | no | `files.loudness`, `files.peak` |
| **6. Destructivo** | Selección, pila con UNDO/REDO, CUT/SILENCE/DUPLICATE/REVERSE/GAIN, SAVE AS COPY y SAVE REGION AS COPY | no (render offline) | `files.parent_id`, subida con `parent_id`, cambio de referencia |
| **7. Signalsmith** | Dependencia nueva: `transpose` con pre-render, tonalidad efectiva, KEY LOCK, operación STRETCH | carga de buffers (`composable.js`) | lista blanca |
| **8. Detectores** | Tonalidad (cromagrama + Krumhansl) y nota (YIN) puras con tests Vitest; "afinar a…" | no | no |
