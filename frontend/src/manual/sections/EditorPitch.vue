<template>
  <!-- sección "Tono" (id y título en ../sections.js): Transpose, KEY LOCK, tonalidad efectiva, DETECT (tonalidad de un
    loop / nota de un shot), SET, TUNE TO (components/FileEditor.vue, helpers/transpose.js, pitch.js, detect.js,
    detect_job.js). Capturas: tomas "editor_pitch" y "editor_tune" (esta última, en la sección Región) -->
  <p>
    Para que los bajos, los sintes y hasta el bombo combinen, cada archivo puede sonar más agudo o más grave en este
    proyecto, sin cambiar su velocidad. Y si no sabés en qué tonalidad o nota está, Looper te lo sugiere escuchándolo.
  </p>
  <ManualShot src="/manual/editor_pitch.webp"
    alt="Datos y placas del editor de un bajo en G: detectado Gm con SET Gm, transpuesto +2 con KEY LOCK encendido"
    caption="Un bajo transpuesto 2 semitonos (de G a A) con KEY LOCK; DETECT sugiere Gm" :callouts="[
      { n: 1, x: 10.6, y: 53.5, text: 'Key: la tonalidad del archivo (de catálogo; la cambia quien lo subió).' },
      { n: 2, x: 20.4, y: 53.5, text: 'La tonalidad con que suena en este proyecto, con el transpose.' },
      { n: 3, x: 33.8, y: 52.1, text: 'DETECT: analiza el audio.' },
      { n: 4, x: 9.2, y: 71, text: 'Lo que detectó y con qué confianza.' },
      { n: 5, x: 28.5, y: 74, text: 'SET: la guarda como Key del archivo (solo quien lo subió).' },
      { n: 6, x: 78.5, y: 20, text: 'Transpose: el knob y su valor, en semitonos.' },
      { n: 7, x: 68.5, y: 50.4, text: 'KEY LOCK: que el tempo no le cambie el tono (solo loops).' },
    ]" />

  <h4>Transpose</h4>
  <p>
    La placa <Ui>Transpose</Ui> <Term t="transpose">transpone</Term> el archivo: lo sube o lo baja de −12 a +12
    semitonos (un semitono es una tecla del piano; 12, una octava), en pasos de 0,1. Es un ajuste del proyecto: el
    archivo no cambia y en otro proyecto suena como siempre.
  </p>
  <ul>
    <li>
      El cambio se calcula al <b>soltar</b> el knob (o con la rueda o las flechas), y tarda un momento: mientras tanto la
      placa dice <i>rendering…</i> y el motor sigue con la versión anterior. El largo no cambia.
    </li>
    <li>
      Al lado de <Ui>Key</Ui> aparece la tonalidad con que suena (<i>G → A<sup>+2</sup></i>). También la muestran el
      cartucho y la tabla de <Ui>Files</Ui>, y el filtro por tonalidad usa esa.
    </li>
    <li>Al guardar una copia en el editor, el transpose no se graba en el audio: pasa a la copia como ajuste.</li>
  </ul>

  <h4>KEY LOCK (solo loops)</h4>
  <p>
    Para encajar en el tempo, el motor acelera o frena cada loop, y eso le cambia un poco el tono: un loop de 132 BPM en
    un proyecto de 138 suena casi un semitono más agudo. <Ui>KEY LOCK</Ui> compensa ese corrimiento para que suene en
    su tonalidad (más el transpose, si tiene). Cada vez que soltás el knob <Ui>Tempo</Ui>, los loops con KEY LOCK se
    recalculan. Conviene en bajos y sintes que tienen que combinar entre sí; en las baterías casi no se nota. Los
    one-shots no lo necesitan: suenan siempre a su velocidad original.
  </p>

  <h4>DETECT: qué tonalidad o qué nota</h4>
  <p>
    <Ui>DETECT</Ui>, al lado de <Ui>Key</Ui>, analiza el audio original (solo la región, si hay una) y muestra el
    resultado en una fila nueva, <Ui>Detected</Ui>. Mientras analiza dice <i>analyzing…</i>. Lo que detecta depende del
    tipo de archivo:
  </p>
  <ul>
    <li>
      <b>En un loop, la tonalidad</b>: por ejemplo <i>Gm · 0.74</i>, donde el número es la confianza (de 0 a 1). Si es
      baja dice <i>uncertain</i> con la mejor candidata (<i>uncertain · G#m?</i>): seguramente es un loop de batería o de
      ruido, o tiene tanta percusión que la armonía no se distingue.
    </li>
    <li>
      <b>En un one-shot, la nota</b>: por ejemplo <i>F#1 +8¢</i> (fa sostenido de la octava 1 y 8 cents arriba; un cent
      es la centésima parte de un semitono). Si el sonido no tiene una altura clara (ruido, platillos, golpes muy
      cortos) dice <i>no pitch</i>.
    </li>
  </ul>
  <p>
    Es una sugerencia, no una medición exacta: la confusión más común es entre tonalidades relativas, como C y Am, que
    usan las mismas notas. Con el mouse encima del resultado se ve la segunda candidata. El resultado desaparece si
    cambiás la región o el tipo (ya no corresponde a lo que suena).
  </p>
  <p>
    Si el archivo es tuyo, al lado aparece <Ui>SET Gm</Ui> (con la tonalidad sugerida): la guarda como <Ui>Key</Ui> del
    archivo, después de confirmar. Recordá que es un dato del catálogo: cambia en todos los proyectos que lo usan. Con
    una detección incierta hay dos opciones: <Ui>SET atonal</Ui> o la mejor candidata.
  </p>

  <h4>TUNE TO: afinar un one-shot</h4>
  <p>
    Un bombo, un bajo suelto o un golpe con nota suenan mejor afinados con el resto. Con un one-shot que tiene nota:
  </p>
  <ol>
    <li>Apretá <Ui>DETECT</Ui>: aparece la nota (<i>F#1 +8¢</i>) y, al lado, un selector de nota destino.</li>
    <li>
      Elegí la nota destino. Cada opción dice cuántos semitonos hay que moverlo (<i>G1 (+0.92)</i>); viene elegida la
      más cercana. La marcada con <i>· key</i> es la tónica de la tonalidad que más se repite entre los loops del
      proyecto: casi siempre, la buena.
    </li>
    <li>
      Apretá <Ui>TUNE TO</Ui>: pone ese valor en <Ui>Transpose</Ui> (reemplaza el que había) y al lado de la nota se
      lee cómo queda (<i>→ G1 ±0¢</i>).
    </li>
  </ol>
  <p>
    Como el transpose, es un ajuste de este proyecto: lo puede hacer cualquiera que edite el proyecto, sea o no dueño
    del archivo. La captura de un bombo afinado así está en
    <a href="#editor_region" @click.prevent="go('editor_region')">Región</a> (el one-shot).
  </p>
  <Note title="Los cálculos tardan un poco">
    <p>
      Transponer, KEY LOCK, STRETCH y DETECT procesan el audio aparte, sin cortar lo que suena. En un archivo corto es
      casi instantáneo; en uno de un minuto, alrededor de un segundo. Al abrir un proyecto con muchos archivos
      transpuestos, los primeros segundos algunos pueden sonar todavía sin transponer.
    </p>
  </Note>
</template>

<script setup>
import { useRouter } from "vue-router"
import ManualShot from "../ManualShot.vue"
import Note from "../Note.vue"
import Term from "../Term.vue"
import Ui from "../Ui.vue"
import { go_anchor } from "../nav"

const router = useRouter()
const go = id => go_anchor(router, id)
</script>
