<template>
  <!-- sección "Files" (id y título en ../sections.js): vistas Box y Table, filtro por tonalidad, escuchar (preview y
    SYNC), editar, borrar (components/Files.vue, FileCart.vue, helpers/file_ui.js). Capturas: tomas "files_box" y
    "files_table" de scripts/manual_shots.js -->
  <p>
    El panel <Ui>Files</Ui>, debajo del mixer, lista los archivos del proyecto abierto. Desde ahí los escuchás, les
    asignás pista y <Term t="tag">Tags</Term> (arrastrando los pads, ver
    <a href="#trg_tags" @click.prevent="go('trg_tags')">Track Groups y Tags</a>) y los abrís en el editor. Tiene dos
    vistas, que se eligen con <Ui>Box</Ui> / <Ui>Table</Ui>: arranca en la tabla.
  </p>

  <h4>Vista Box: cartuchos</h4>
  <ManualShot src="/manual/files_box.webp" alt="Lista Files en la vista Box, con los archivos del proyecto de demo como cartuchos"
    caption="La vista Box con el proyecto de demo sonando" :callouts="[
      { n: 1, x: 4.5, y: 8.5, text: 'Box / Table: cambia de vista.' },
      { n: 2, x: 11, y: 8.5, text: 'SYNC: cómo suena el preview (ver abajo).' },
      { n: 3, x: 37, y: 14.6, text: 'Filtro por tonalidad.' },
      { n: 4, x: 15.6, y: 23.4, text: 'El LED se enciende mientras el archivo suena (en el motor o en el preview).' },
      { n: 5, x: 16.3, y: 47.6,
        text: 'Su pista y sus Tags, como chips y como bandas de color a la izquierda de la etiqueta (no group / no tag si no tiene).' },
      { n: 6, x: 19.2, y: 58.4, text: 'Escuchar (preview), abrir en el editor y borrar.' },
    ]" />
  <p>
    Cada archivo es un cartucho con una etiqueta: el nombre, la duración, los <Term t="beat">beats</Term> y el
    <Term t="bpm">BPM</Term> (o <i>shot</i> si es un <Term t="one_shot">one-shot</Term>) y la
    <Term t="key">tonalidad</Term>. Si el mouse queda encima del nombre, se ve completo.
  </p>

  <h4>Vista Table</h4>
  <ManualShot src="/manual/files_table.webp" alt="Lista Files en la vista Table" :callouts="[
    { n: 1, x: 18.7, y: 24.6, text: 'Las columnas con flechas ordenan la tabla (un clic, ascendente; otro, descendente).' },
    { n: 2, x: 46.9, y: 24.6, text: 'Duración en segundos, beats y BPM.' },
    { n: 3, x: 62.9, y: 24.6, text: 'Pista (Track Group) y Tags.' },
    { n: 4, x: 90.5, y: 24.6, text: 'State: PLAYING mientras suena en el motor.' },
    { n: 5, x: 91.2, y: 41.3, text: 'Escuchar, editar y borrar, como en los cartuchos.' },
  ]" />
  <p>
    La tabla muestra lo mismo que los cartuchos, en columnas, y es cómoda para ordenar por BPM o por tonalidad. Los
    pads también se pueden soltar sobre sus filas.
  </p>

  <h4>Atenuados: los que no suenan</h4>
  <p>Un archivo atenuado (en gris) está en el proyecto pero el motor no lo sortea. Puede ser porque:</p>
  <ul>
    <li>
      Dice <Ui>out of tempo</Ui> (o su BPM se ve marcado en la tabla): su tempo queda demasiado lejos del del
      proyecto, incluso al doble o a la mitad. Se arregla moviendo el tempo o subiendo la
      <Term t="tolerance">tolerancia</Term> (ver <a href="#play" @click.prevent="go('play')">Tocar</a>), o corrigiendo
      sus beats en el editor.
    </li>
    <li>Dice <Ui>unavailable</Ui>: el archivo ya no está disponible en Looper.</li>
  </ul>
  <p>Con el mouse encima, un cartel explica el motivo.</p>

  <h4>Filtrar por tonalidad</h4>
  <p>
    En <Ui>Key</Ui>, elegí una nota: la lista muestra solo los archivos en esa tonalidad, mayor o menor (con
    <i>A</i> aparecen <i>A</i> y <i>Am</i>). <Ui>+ atonal</Ui> suma los atonales (baterías, ruidos). Al lado se lee
    cuántos se ven sobre el total. El filtro solo cambia lo que ves: el motor sigue sorteando entre todos.
  </p>

  <h4>Escuchar un archivo: el preview</h4>
  <p>
    El botón ▶ de un archivo lo hace sonar solo, aparte del motor (es el <i>preview</i>): el display del proyecto,
    en la barra de arriba, muestra su nombre con un <Ui>STOP</Ui>, y el mismo botón, ahora en pausa, lo detiene. Cómo suena depende de
    <Ui>SYNC</Ui>:
  </p>
  <ul>
    <li><b>SYNC apagado</b>: suena una vez, a su velocidad original.</li>
    <li>
      <b>SYNC encendido</b> (LED amarillo): suena al tempo del proyecto y en loop hasta que lo pares. Si el motor está
      tocando, espera al próximo compás para entrar a tiempo con el resto; mientras espera, su LED titila.
    </li>
  </ul>
  <p>
    <Ui>SYNC</Ui> queda recordado en ese navegador, y es el mismo del editor, donde el preview tiene más opciones (ver
    <a href="#editor_preview" @click.prevent="go('editor_preview')">Preview</a>).
  </p>

  <h4>Editar y borrar</h4>
  <ul>
    <li>
      El lápiz abre el <b>editor</b> del archivo: tipo, beats, tonalidad, volumen, región y mucho más (ver
      <a href="#editor" @click.prevent="go('editor')">El editor de un vistazo</a>).
    </li>
    <li>
      El tacho lo borra, después de confirmar. Lo que pasa depende de quién lo subió:
      <ul>
        <li>
          Un archivo <b>tuyo</b> se borra del todo: el audio desaparece de Looper y de todos los proyectos que lo usan,
          también de los de otros usuarios. Su tiempo vuelve a tu cuota.
        </li>
        <li>Uno <b>importado</b> solo sale de este proyecto; sigue en el catálogo.</li>
      </ul>
    </li>
  </ul>
  <Note type="warn" title="Borrar no se deshace">
    <p>
      Si solo querés que no suene en este proyecto, sacale la pista desde el editor o bajale el peso a 0, en vez de
      borrarlo.
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
