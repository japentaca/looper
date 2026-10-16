# Incorporar una librería de loops

Guía para cargar una librería de loops/samples entera en producción y armar con ella un proyecto
listo para sonar. Está escrita para que la siga un agente (o una persona) cuando el dueño trae una
librería nueva. Se aplicó por primera vez con Function Loops "Psytrance Warriors" (2026-10-14):
proyecto **Psytrance Warriors**, armado a partir de **Progressive**.

Piezas que usa: la tonalidad de los archivos (`files.music_key`, ver `docs/ARCHITECTURE.md`), el
script `backend/import_manifest.js` y el procedimiento de respaldo de `docs/DEPLOY.md`.

## Resumen del flujo

1. Relevar la librería y lo que ya está cargado.
2. Acordar con el dueño qué entra, a qué proyecto y qué proyecto sirve de plantilla.
3. Armar en local una carpeta con los audios renombrados y un `manifest.json`.
4. Probar la importación en local sobre una copia de la base. **La conversión a mp3 se hace acá,
   en la máquina de desarrollo**: de esa prueba salen los mp3 finales y un manifiesto `"converted": true`.
5. En el servidor: respaldar la base, copiar la carpeta **de mp3** (nunca los wav), dry-run, importar,
   borrar la carpeta.
6. Armar pistas y tags del proyecto (respaldo y dry-run otra vez).
7. Verificar e informar.

## 1. Relevamiento

- **Estructura y nombres.** Listar los archivos (`find`) sin MIDI ni imágenes. Las librerías suelen
  traer por kit: `Loops`, `One-Shots`, `Stems` y un `FullMix`; la tonalidad y el BPM suelen estar en
  el nombre de la carpeta del kit (`Kit_03_(Key_Bb)_(140BPM)`) y a veces en el del archivo
  (`FL_CPS_KIT03_140_Bb_Bass Loop.wav`).
- **Duraciones** con el `ffprobe` de `backend/node_modules/ffprobe-static`. El límite es 60 s por
  archivo: Stems y FullMix casi siempre pasan y quedan afuera.
- **¿Ya está cargada?** Buscar en `files.original_name` (sobre una copia de `storage/db.sqlite` o con
  una consulta de solo lectura en el servidor) los nombres de la librería. Que el dueño crea que ya
  la usó no alcanza: en el primer caso, lo cargado venía de otro pack.
- **Cuota** del usuario destino: `sum(files.duration)` contra `users.max_seconds` (null = el default
  de `.env`, 1200 s). El dry-run del script también la informa. Si no alcanza, proponer subirla
  (`max_seconds`; con la cuenta del dueño se acordó 3600 s) antes que `--ignore-quota`, que lo deja
  pasado de cuota y sin poder subir desde la app.
- **Tempos y tonalidades presentes**: contar archivos por BPM y por tonalidad, separando lo que tiene
  nota de la percusión. Define el tempo del proyecto y los tags (ver 6).

## 2. Decisiones a acordar con el dueño

Preguntar (con opciones y una recomendada) solo lo que no esté decidido abajo:

- Qué entra: por defecto **Loops y One-Shots**; Stems y FullMix no.
- Destino: por defecto la cuenta del dueño y un **proyecto nuevo con el nombre de la librería**.
- Proyecto plantilla para pistas y configuración (en el primer caso, Progressive).
- Excepciones de tonalidad (FX que el nombre marca con nota pero suenan sin ella, ver 3).

## 3. Criterios de nombres, tipo, tempo y tonalidad

**Nombres** (`original_name`): únicos dentro de la librería y con la tonalidad escrita, para que
`suggest_key` la encuentre y para distinguirlos en la lista.

- Loops: el nombre original si ya trae kit, BPM y tonalidad.
- One-shots: suelen repetirse entre kits (`FL_CPS_Bass.wav` en todos): se les antepone el prefijo del
  kit y se les agrega ` One-Shot` → `FL_CPS_KIT03_140_Bb_Bass One-Shot.wav`. El sufijo evita choques
  con loops que se llaman igual (`..._Snare.wav`).

**Tipo y tempo:** lo de `Loops` entra como `loop` con el `bpm` del kit (el script calcula
`beats = round(duración × bpm / 60)`; un loop de 8 compases da 16 o 32 beats); lo de `One-Shots`
entra como `shot`, sin tempo. Si la librería no trae el BPM, mandar `beats`.

**Tonalidad** (`music_key`):

- Por defecto la sugiere el nombre (`suggest_key`): la nota como palabra suelta entre `_`, `-` o
  paréntesis, o la que sigue al tempo (`Bass 120bpm C Funk`), o `atonal` si el nombre dice percusión
  o ruido (kick, snare, hat, perc, top, crash, tom, tribal, noise, impact, upfilter...). Comprobar
  la sugerencia sobre todos los nombres antes de armar el manifiesto: si la librería usa otro
  formato, poner `music_key` en el manifiesto (o mejorar `suggest_key`, en back y front).
- **FX con nota en el nombre pero sin nota real** → `atonal` explícito en el manifiesto. En el
  primer caso: Glitch Element, Bandpass Seq Loop, Main Psy SFX, Zap, Zap Delay, Glitch SFX. Para
  decidir, además del nombre, medir la planitud espectral (cerca de 0 = con nota; 0,3 o más =
  ruidoso o barrido):

  ```bash
  ffmpeg -hide_banner -i "<archivo>" -af "pan=mono|c0=c0,aspectralstats=measure=flatness,ametadata=print:file=-" -f null - 2>/dev/null \
    | awk -F= '/flatness/{s+=$2;n++} END{printf "%.3f\n", s/n}'
  ```

- Ante la duda, dejarlo con la nota del kit: es el criterio conservador para el filtro.

## 4. Carpeta y manifiesto (en local)

Carpeta nueva en el scratchpad, plana, con los audios ya renombrados y un `manifest.json` con el
formato de la cabecera de `backend/import_manifest.js`:

```json
[
 { "file": "FL_CPS_KIT03_140_Bb_Bass Loop.wav", "kind": "loop", "bpm": 140 },
 { "file": "FL_CPS_KIT03_140_Bb_Zap Loop.wav", "kind": "loop", "bpm": 140, "music_key": "atonal" },
 { "file": "FL_CPS_KIT03_140_Bb_Kick One-Shot.wav", "kind": "shot" }
]
```

Se arma con un script de una sola vez (no va al repo) que recorre los kits, saca kit/tonalidad/BPM
del nombre de la carpeta, copia y renombra, y aplica las excepciones de tonalidad. Comprobar que la
cantidad de archivos de la carpeta coincida con la de entradas (si no, hubo nombres repetidos).

Si el script procesa el audio (recortar a compás, doblar la cola sobre el inicio, `atempo`),
**medir el nivel de cada archivo de salida** (`volumedetect`: `mean_volume` y `max_volume`) y
compararlo con el original antes de importar: en Curve, doblar la cola con `asplit` + `amix` dejó 30
loops en silencio sin ningún error de ffmpeg (se arregló con dos `-i` del mismo archivo en vez de
`asplit`). Escribir la salida en `pcm_f32le`: al sumar la cola el pico puede pasar 0 dBFS y en
entero recortaría (la conversión final lo normaliza).

## 5. Prueba local e importación en el servidor

**Local, sobre una copia** (nunca sobre `storage/`): un directorio de prueba con su `.env`
(`storage_path` a un `audio/` vacío, `db_file` a una copia de la base ya migrada) y desde ahí:

```bash
node <repo>/backend/import_manifest.js --user=<email> --project="<proyecto>" --dry-run <carpeta>/manifest.json
node <repo>/backend/import_manifest.js --user=<email> --project="<proyecto>" <carpeta>/manifest.json
```

Revisar en la copia: cantidades por `kind` y `music_key`, `beats`/`bpm` de algunos loops, filas en
`project_files`. Correrlo una segunda vez tiene que saltear todo (es repetible).

**Subir los mp3 ya convertidos, no los wav** (es el procedimiento habitual desde Curve: el servidor
no convierte nada en una importación en lote). La prueba local deja en su `audio/` los mp3 finales
(misma `utils.convert`: V0, normalizados) y en la copia de la base la `duration` de cada original.
Con eso se arma una carpeta con esos mp3 y un manifiesto con `"converted": true` y `"duration"` por
entrada (más `original_name`, `kind`, `beats`, `music_key` tal cual); el script los copia sin
recodificar. Pesan ~10 veces menos que los wav (Curve: 115 MB contra 1,1 GB) y no hay una segunda
compresión. La `duration` tiene que ser la del original: el mp3 mide 25–55 ms más por el relleno del
encoder y el bpm de los loops quedaría corrido.

**Servidor** (`docs/DEPLOY.md`, "Importar audios en lote"): si hubo cambios de código, desplegar
antes. Después: respaldar la base, copiar la carpeta a **`/var/tmp`** (`tar -cf - carpeta | ssh jape-pruebas 'tar -xf - -C /var/tmp'`,
`chmod -R a+rX`; **no a `/tmp`**: en el servidor es un tmpfs de ~1 GB en RAM, se llena y le quita
memoria a la app), dry-run, importación real como `looper` con `nice`, revisar el resumen (errores 0)
y borrar la carpeta.

## 6. Pistas y tags del proyecto

Se escriben **directo en la base** con un script de una sola vez (en una transacción, con
`--dry-run` que imprime el reparto), corrido en el servidor como `looper` después de otro respaldo.
El script se niega a seguir si el proyecto ya tiene pistas. Al terminar, el dueño tiene que
**recargar la app** si tenía el proyecto abierto: guardar desde una pestaña vieja pisa las pistas
(los PUT de pistas y tags reemplazan la colección completa).

**Pistas:** se copian las de la plantilla (nombre, color y `props`: volumen, descanso, modo,
reverb, delay, FX de transición) con ids nuevos, más las que hagan falta. Reparto por nombre del archivo, en
este orden (la primera regla que coincide):

| Pista | Loops cuyo nombre dice |
|---|---|
| bombos | Kick |
| Bajos | Bass |
| Perc | Percussion, Tribal, Toms |
| Drums | Hat, Snare, Crash, Top |
| FX (nueva; props de Synth con `rest` 0,6 y `delay` -14) | Glitch, Impact, Zap, Psy SFX, Voice |
| Synth | todo lo demás (Synth, Seq, Theme, Melody, Airy, Riff...) |

Shots → pista **one shots** (modo one-shot) solo los que funcionan sueltos sobre los loops: Crash,
Upfilter, Noise, Reverse Voice, Glitch, Zap, Sitar, Snare Up, Airy, Cinematic Tom. Los one-shots
de kick, snare, hat, bass y secuencias cortas quedan **sin pista** (en el proyecto, sin sonar): se
encimarían con los loops; el dueño los asigna si quiere.

**Tags:** uno por tonalidad presente (`C#`, `Bb`, `G#`), no por kit, así se mezclan kits de la misma
tonalidad.

- Archivo con nota → el tag de su `music_key`.
- Bombos → el tag de la tonalidad de su kit aunque sean `atonal` (en psytrance el kick está afinado
  con el bajo).
- Atonales → **sin tags**: el motor los considera compatibles con cualquier Tag.
- Muchas tonalidades con poco material cada una (caso Ocean: 24): **un tag por tonalidad exacta, sin
  juntar relativas** (lo prefiere el dueño), con el peso del tag según cuántos loops con nota tiene
  (las de 1–3 loops salen poco, como interludio). Así todo lo que tiene nota puede ir a una pista.

**Configuración del proyecto:** se copian las `props` de la plantilla (tempo, tolerancia, compás,
rango de cambio de Tag, delay). Con kits de distinto BPM, conviene un tempo dentro de la tolerancia
de todos (140 con 6 % cubre 140–144; a 140 los de 142/144 suenan hasta ~0,7 semitonos más grave).

**Varios tempos con material con nota** (caso Funk N Groove: 110, 115 y 120 BPM). El motor ajusta
el tempo cambiando la velocidad, que también cambia la altura: dos loops en C de 110 y 120 BPM,
tocados juntos a 115, quedan ~1,5 semitonos desafinados entre sí. Criterio:

- Tempo del proyecto = el BPM donde está la mayoría de lo que tiene nota.
- Lo que tiene nota a otro BPM se importa pero queda **sin pista** (sirve para otro proyecto a ese tempo).
- La percusión atonal de los otros BPM sí va a pistas: subir la tolerancia para que entre (120 con
  9 % cubre 110–130). Un drum acelerado no desafina nada.
- Tags solo para las tonalidades con material suficiente para una sección (bajo + synth/voz); las
  que tienen 1–2 archivos quedan sin pista.

**Repetición de los loops** (`project_files.props.repeat`, `[min, max]` de 1, 2, 4, 8, 16; ver
`docs/ARCHITECTURE.md`): cuántas veces seguidas suena un loop al salir sorteado. Sin dato = `[1, 1]`,
y una pista de loops cortos (1–2 compases) cambia de loop en cada vuelta y suena nerviosa. Criterio:

- Loops de 4–8 beats en pistas en modo loop → `[4, 16]` (se asientan antes de cambiar). Se aplicó a
  todos los loops de Deep Organic Percussion.
- Loops largos (16 beats o más, full mix, frases) → `[1, 4]` o sin dato.
- Archivos de pistas one-shot (fills, golpes) → sin `repeat`: esas pistas disparan un archivo por vez
  y no lo usan.
- Revisar contra el rango de Tag: beats del loop × repetición máxima conviene que no supere mucho
  `2^n` del rango, porque el cambio de Tag corta las repeticiones (4 beats × 16 = 64 beats contra
  escenas de 32–128 beats: muchas quedan cortadas). Si se quieren enteras, subir el rango de Tag.
- Se escribe junto con el volumen, en el mismo script de pistas y tags (`props: { volume, repeat }`).

## 7. Verificación e informe

- En el servidor: conteos por pista y tags del proyecto, y que `GET /api/file/<id>` de un archivo
  nuevo responda 200.
- Informar: qué entró y qué no (y por qué), reparto por pista y tag, archivos sin pista, rutas de
  los respaldos, y que la mezcla (volúmenes) y la escucha quedan para el dueño. Nada de esto se
  puede verificar de oído desde acá.
