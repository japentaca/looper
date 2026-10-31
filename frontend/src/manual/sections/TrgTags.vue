<template>
  <!-- sección "Track Groups y Tags" (id y título en ../sections.js): crear, renombrar, color, borrar, reordenar, asignar
    arrastrando, peso del Tag (components/SidebarItem.vue, TagDialog.vue; drop en Files.vue y Tracks.vue). Capturas:
    tomas "trg_tags", "tag_dialog" y "first_drag" de scripts/manual_shots.js -->
  <p>
    Las <Term t="track_group">pistas</Term> (Track Groups) y los <Term t="tag">Tags</Term> se crean en la barra de la
    izquierda, como pads de goma, y se asignan a los archivos arrastrando esos pads. Un archivo va en <b>una</b> pista
    y puede llevar <b>varios</b> Tags.
  </p>
  <ManualShot src="/manual/trg_tags.webp" :max_width="260" alt="Barra de la izquierda con dos pads de pistas y dos de Tags"
    :callouts="[
      { n: 1, x: 20.1, y: 18.8, text: 'Color de la pista: un clic en el cuadradito para elegirlo.' },
      { n: 2, x: 41, y: 20, text: 'Tacho: borra la pista o el Tag (aparece al pasar el mouse).' },
      { n: 3, x: 74.6, y: 43.4, text: '+ Track crea una pista.' },
      { n: 4, x: 19.1, y: 68.7, text: 'Lápiz: edita el Tag (nombre, color y peso).' },
      { n: 5, x: 74.6, y: 93.7, text: '+ Tag crea un Tag.' },
    ]" />

  <h4>Pistas</h4>
  <ul>
    <li>
      <Ui>+ Track</Ui> crea una pista llamada <i>Track</i>, con un color al azar. Cada pista tiene también su tira en el
      mixer (ver <a href="#mixer" @click.prevent="go('mixer')">Mixer</a>).
    </li>
    <li>
      Para <b>renombrarla</b>, hacé doble clic en el pad, escribí y hacé clic afuera (o <Kbd>Tab</Kbd>). Con
      <Kbd>Esc</Kbd> volvés al nombre anterior.
    </li>
    <li>El <b>color</b> se cambia con el cuadradito de arriba a la izquierda del pad.</li>
    <li>
      El <b>tacho</b> la borra. Si tiene archivos, Looper te pregunta antes; los archivos quedan en el proyecto, sin
      pista.
    </li>
  </ul>

  <h4>Tags</h4>
  <ul>
    <li><Ui>+ Tag</Ui> crea un Tag llamado <i>TG</i>, con un color al azar.</li>
    <li>El <b>lápiz</b> (o un doble clic en el pad) abre su diálogo de edición.</li>
    <li>El <b>tacho</b> lo borra; si algún archivo lo tiene, Looper pregunta antes y se lo saca.</li>
  </ul>
  <ManualShot src="/manual/tag_dialog.webp" :max_width="420" alt="Diálogo Edit tag del Tag Groove, con peso 16" :callouts="[
    { n: 1, x: 68.6, y: 29.1, text: 'Name: el nombre (Enter guarda).' },
    { n: 2, x: 21.9, y: 65.9, text: 'Color.' },
    { n: 3, x: 74.5, y: 72, to: 'engine',
      text: 'Weight: cuánto sale este Tag en el sorteo, de 0 a 32 (16 por defecto). Con 0 no sale nunca.' },
  ]" />
  <p>
    <Ui>SAVE</Ui> guarda los cambios y <Ui>CANCEL</Ui> los descarta. El <Term t="weight">peso</Term> es relativo:
    un Tag con 32 sale el doble de seguido que uno con 16. Sirve, por ejemplo, para que el <i>Breakdown</i> aparezca
    de vez en cuando y el <i>Groove</i> casi siempre.
  </p>
  <p>
    Las pistas y los Tags se <b>reordenan</b> arrastrando un pad sobre otro del mismo tipo (las pistas, también
    arrastrando las tiras del mixer). El orden de las pistas es el de las tiras.
  </p>

  <h4>Asignar arrastrando</h4>
  <p>
    Arrastrá un pad y soltalo sobre un archivo de la lista <Ui>Files</Ui>, en cualquiera de sus dos vistas: sobre un
    cartucho (vista Box) o sobre una fila (vista Table). Mientras lo tenés encima, el archivo se resalta en amarillo.
  </p>
  <ManualShot src="/manual/first_drag.webp" alt="El pad Bass arrastrado sobre un archivo sin pista ni Tags, que se resalta en amarillo"
    :callouts="[
      { n: 1, x: 18.4, y: 7.3, text: 'El pad que arrastrás.' },
      { n: 2, x: 98, y: 67.3, text: 'El archivo de destino, resaltado.' },
      { n: 3, x: 81.5, y: 80.6, text: 'Sus chips: no group y no tag hasta que le asignes una pista y Tags.' },
    ]" />
  <ul>
    <li>
      <b>Pad de pista</b>: el archivo pasa a esa pista (si estaba en otra, se cambia). También podés arrastrar la tira
      de una pista del mixer sobre el archivo.
    </li>
    <li><b>Pad de Tag</b>: le suma ese Tag. Si ya lo tenía, se lo saca.</li>
    <li>
      Las dos cosas se pueden hacer también desde el editor del archivo, con pads chicos de cada pista y Tag (ver
      <a href="#editor" @click.prevent="go('editor')">El editor de un vistazo</a>); ahí también se le puede sacar la
      pista.
    </li>
  </ul>
  <Note title="Sin pista o sin Tags">
    <p>Un archivo <b>sin pista</b> nunca suena: hay que asignarle una.</p>
    <p>
      Un archivo <b>sin Tags</b> vale para todas las secciones: su pista lo puede sortear con cualquier Tag, y nunca
      se corta en un cambio de Tag. Es útil para algo que tiene que estar siempre, como el bombo.
    </p>
  </Note>

  <h4>Los pads se encienden</h4>
  <p>
    Mientras el proyecto suena, el pad de cada pista se ilumina cuando la pista está tocando, y el del Tag activo
    queda encendido. Así ves de un vistazo qué está pasando (ver
    <a href="#play" @click.prevent="go('play')">Tocar</a>).
  </p>
</template>

<script setup>
import { useRouter } from "vue-router"
import ManualShot from "../ManualShot.vue"
import Note from "../Note.vue"
import Term from "../Term.vue"
import Ui from "../Ui.vue"
import Kbd from "../Kbd.vue"
import { go_anchor } from "../nav"

const router = useRouter()
const go = id => go_anchor(router, id)
</script>
