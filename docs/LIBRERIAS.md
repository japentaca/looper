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
3. Armar en local una carpeta con los audios renombrados y un `manifest.json`, con el anclaje de
   fills y one-shots decidido por la envolvente (y las colas recortadas, ver 3).
4. Probar la importación en local sobre una copia de la base. **La conversión a mp3 se hace acá,
   en la máquina de desarrollo**: de esa prueba salen los mp3 finales y un manifiesto `"converted": true`.
5. En el servidor: respaldar la base, copiar la carpeta **de mp3** (nunca los wav), dry-run, importar,
   borrar la carpeta.
6. Armar pistas y tags del proyecto (respaldo y dry-run otra vez).
7. Verificar e informar.
8. Acortar los loops que solo repiten el mismo patrón (`backend/trim_loops.js`; también sirve después,
   sobre un proyecto ya armado).

## 1. Relevamiento

- **Estructura y nombres.** Listar los archivos (`find`) sin MIDI ni imágenes. Las librerías suelen
  traer por kit: `Loops`, `One-Shots`, `Stems` y un `FullMix`; la tonalidad y el BPM suelen estar en
  el nombre de la carpeta del kit (`Kit_03_(Key_Bb)_(140BPM)`) y a veces en el del archivo
  (`FL_CPS_KIT03_140_Bb_Bass Loop.wav`).
- **Duraciones** con el `ffprobe` de `backend/node_modules/ffprobe-static`. El límite es 60 s por
  archivo: Stems y FullMix casi siempre pasan y quedan afuera. En un `while read` de bash, pasar
  `-nostdin` a ffmpeg (y redirigir la entrada de ffprobe): si no, se comen la lista de archivos.
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

**Anclaje (`anchor`) de fills y one-shots.** Un one-shot `end` **termina** en el punto de disparo
(cambio de Tag o inicio de frase, ver "One-shots" en `docs/ARCHITECTURE.md`); uno `start` empieza
ahí. Criterio:

- `end`: fills, risers, uplifters, crashes invertidos, redobles y pickups (lo que desemboca en el
  cambio). Van a una pista one-shot con `on_tag_change` (y `density` 0 si solo deben sonar en el
  cambio de Tag: así la pista no tiene candidatos `start` y solo dispara los `end`).
- `start`: golpes, impacts, downlifters, crashes, drones, texturas, atmósferas, shots tonales.
- No confiar solo en el nombre: medir la envolvente. Un one-shot que crece hacia el final
  (energía del último cuarto bien por encima del primero, pico al final) es candidato a `end`
  aunque el nombre no lo diga (en Deep Organic Percussion: pickups y Air Tubes).
- **Colas después del remate.** El motor alinea el **final del archivo** con el punto, no el
  clímax. Muchos risers suben, llegan al clímax y siguen 2–7 s con una cola de reverb; muchos
  fills terminan el golpe y dejan la cola del último. Con `end`, en el cambio cae la cola y el
  remate llega antes. En AVA: 17 de 30 risers/uplifters y 9 de 40 fills. Medirlo con el clímax =
  último bloque de 50 ms a menos de 6 dB del máximo (risers) o el beat donde termina el golpe
  (fills: nivel por beat a su BPM); si la cola pasa ~1,5 s, **recortar** antes de importar
  (`atrim=0:<t>,afade=t=out:st=<t-f>:d=<f>`, fundido de 20–30 ms; un fill de ecos, más largo) y
  escribir el recorte en `pcm_f32le`. La duración del manifiesto es la del recorte.

## 4. Carpeta y manifiesto (en local)

Carpeta nueva en el scratchpad, plana, con los audios ya renombrados y un `manifest.json` con el
formato de la cabecera de `backend/import_manifest.js`:

```json
[
 { "file": "FL_CPS_KIT03_140_Bb_Bass Loop.wav", "kind": "loop", "bpm": 140 },
 { "file": "FL_CPS_KIT03_140_Bb_Zap Loop.wav", "kind": "loop", "bpm": 140, "music_key": "atonal" },
 { "file": "FL_CPS_KIT03_140_Bb_Kick One-Shot.wav", "kind": "shot" },
 { "file": "FL_CPS_KIT03_140_Riser FX.wav", "kind": "shot", "music_key": "atonal", "anchor": "end" }
]
```

`anchor` (opcional, default `"start"`): `"end"` para los one-shots que tienen que **terminar** en el
punto de disparo (risers, crashes invertidos, redobles que desembocan en el cambio de Tag).

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

**Reemplazar audios ya importados** (un recorte que se decidió después, como en AVA): el audio se
sirve con `Cache-Control: immutable` por un año, así que pisar el mp3 con el mismo id no llega a
un navegador que ya lo cargó. Con un script de una sola vez, después de respaldar: copiar el mp3
nuevo (de `utils.convert`) con un **id nuevo**, y en una transacción cambiar `files.id`,
`duration` y `size` (y `beats`, `bpm`, `loudness`, `peak` si cambian), lo que referencia el id
(`project_files.file_id`, `files.parent_id` de las copias del editor, `reports.target_id` con
`target_type = 'file'`) y ajustar `users.bytes_used` por la diferencia; después borrar el mp3 viejo.
Buscar los archivos por `original_name` y dueño: los ids de la prueba local no son los de prod.
Para acortar loops que se repiten, `backend/trim_loops.js apply` hace todo esto (sección 8).

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

## 8. Acortar loops que se repiten (`backend/trim_loops.js`)

Muchos loops de las librerías repiten el mismo patrón en todo su largo (un bajo de 32 beats que es 8
veces el mismo compás, un hat de 32 que es el mismo compás). No aportan nada y pesan: todo se
decodifica al cargar (~350 MB de RAM por cada 1000 s) y cuentan en la cuota. Cortados a su período
real y con más `repeat`, suenan igual y pesan una fracción. Se aplicó por primera vez en Apex
Psytrance (2026-10-19): 110 de 142 loops, el proyecto pasó de 2063 a 881 s.

**Análisis** (`backend/loop_period.js`, funciones puras con tests en `loop_period.test.js`): para cada
P de 4, 8, 16, 32 que divide a `beats`, compara cada bloque de P beats contra el primero. El largo
del beat es muestras / beats (no el BPM del nombre): a 145 BPM son 18248,3 muestras, los bloques no
caen en muestras enteras y medio sample ya ensucia una resta en los agudos. Por eso decide una
medida espectral (magnitud con ventanas alineadas al inicio de cada bloque, en graves / medios /
agudos) y la diferencia del **peor beat** de cada bloque, no el promedio (un fill de un beat casi no
mueve el total). El residuo de forma de onda (Lanczos, ±3 muestras) se informa pero no decide: un
sampler arranca cada golpe en una muestra entera y la compresión de bus hace que capas iguales no
resten limpio. Decisiones:

| decisión | criterio (peor beat de cada bloque) | qué se hace |
|---|---|---|
| cortar | todos ≤ −28 dB | se corta (en Apex: bajos, capas de hats/perc/snare, −30 a −200 dB) |
| casi | todos ≤ −20 dB | se escucha; en Apex eran drum beats con un hat por compás que varía apenas, en agudos (graves y medios idénticos): se cortaron |
| variación | los bloques distintos lo son en pocos beats (un fill, un remate) | por defecto no: se pierde la variación |
| no cortar | ningún P se repite | synths, grooves con hats que cambian, barridos |

Calibración (umbrales en `THRESHOLDS`): un bloque repetido da < −100 dB (o −35…−50 en los agudos si
cae en otra fase de muestreo); +1 dB de ganancia por compás, −16; un beat reemplazado, > 0; un filtro
que abre a lo largo del loop, > 0 en todos los bloques. La distribución de Apex tiene huecos cerca
de −30 y −20. Con otra librería, mirar la tabla antes de confiar en los umbrales.

**Pasos** (respaldo y dry-run antes de escribir en prod, como siempre):

1. Servidor, solo lectura: `node trim_loops.js export --user=<email> --project=<nombre o id> > estado.json`
   (loops del proyecto que son del usuario, con pista y `props`). Bajarlo a local.
2. Local: un `fuentes.json` `{ "<original_name>": "<wav original>" }` armado con un script de una sola
   vez según cómo se renombró la librería (Apex: `"APEX_" + nombre sin " - APEXPSY Zenhiser"`). El wav
   tiene que ser el que se importó (mismo procesamiento del build): si dura distinto, se saltea.
3. Local: `node trim_loops.js analyze estado.json fuentes.json <dir> --min-beats=8 --listen`: escribe
   `<dir>/plan.json`, `<dir>/tabla.md` (beats antes → después, peor beat de cada bloque, decisión y
   motivo, ahorro en s y RAM) y en `<dir>/escuchar/` el A/B de los "casi" y las "variación" (A =
   original, B = el corte repetido). **El dueño escucha y decide** antes de seguir.
   `--min-beats=8` lo eligió el dueño en Apex: con 8 beats y `repeat` [4, 16] cada sorteo suena 32–128
   beats, igual que un loop de 32 con [1, 4]; a 4 beats la regla da 16–64 (cambia el doble de seguido).
4. Local: `node trim_loops.js cut <dir>/plan.json --accept=cortar,casi`: corta los primeros P beats
   exactos (`round(P × muestras / beats)`, sin fundido: la costura es la del bloque 2 → 1) del wav
   original y lo convierte con `utils.convert` **con la medición del original** (misma ganancia que en la
   importación: en Apex el mp3 nuevo decodifica idéntico, muestra a muestra, al importado en el tramo
   común). Escribe `<dir>/trim.json` y `<dir>/mp3/`.
5. Servidor: respaldo, copiar `trim.json` y `mp3/` a `/var/tmp`, `node trim_loops.js apply --user=<email>
   <trim.json> --dry-run`, revisar y aplicar sin `--dry-run`. Por archivo (buscado por `original_name` y
   dueño): id nuevo, `duration`, `size`, `beats`, `bpm`, `loudness`, `peak`; `project_files.file_id` de
   todos los proyectos que lo usan, `files.parent_id`, `reports.target_id`, `users.bytes_used`; borra el
   mp3 viejo. `props.repeat`: si era el de por defecto (`default_repeat`: ≤ 8 beats [4, 16], 16 [2, 8],
   32 [1, 4], más [1, 2]) pasa al del largo nuevo; si el dueño lo había tocado, se multiplica por
   viejo / nuevo con tope en 16. Volumen, peso y lo demás quedan. Un archivo con región (`region_beats`,
   `region_secs`, `nudge`, `fade`) o `anchor` numérico en algún proyecto **no se toca** (se avisa). Es
   repetible: lo ya cortado se saltea.
6. Verificar (`GET /api/file/<id>` = 200, conteos, mp3 en disco = filas) y avisar al dueño que **recargue
   la app**: una pestaña vieja pisa los cambios al guardar.

**Librerías estiradas en local con Signalsmith** (PsyTrance NRG a 145, Psytrance Evolution 2 a 142): el
phase vocoder cambia las fases y los bloques no son idénticos muestra a muestra. El análisis espectral
sirve igual (fuentes = los wav estirados del build); para cortar, cortar el wav **original** a su tempo
(P beats de su largo) y volver a estirarlo con el script del build (repitiendo el loop a los lados para
la costura, como `build_pm.mjs` / `build_nrg.mjs`), convertir con `utils.convert` y armar el `trim.json`
a mano (mismo formato que el de `cut`) para el paso 5.
