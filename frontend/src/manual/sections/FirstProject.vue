<template>
  <!-- sección "Tu primer proyecto, paso a paso" (id y título en ../sections.js): de la cuenta al primer START, con
    links a las secciones de referencia. Capturas: tomas "trg_tags", "first_drag" y "first_playing" de
    scripts/manual_shots.js (el proyecto del tutorial lo arma la toma por la API y lo borra al terminar) -->
  <p>
    Un recorrido corto para armar un <Term t="project">proyecto</Term> desde cero y hacerlo sonar: dos pistas
    (<i>Drums</i> y <i>Bass</i>), dos <Term t="tag">Tags</Term> (<i>Groove</i> y <i>Break</i>) y cuatro loops. Cada
    paso tiene su sección de referencia con el detalle.
  </p>

  <h4>1 · Entrá con tu cuenta</h4>
  <ol>
    <li>
      Apretá <Ui>LOGIN</Ui> en la barra de arriba y, en el diálogo, <Ui>Create an account</Ui>. Completá los datos y
      aceptá la licencia.
    </li>
    <li>La cuenta queda <b>pendiente</b>: vas a poder entrar cuando la admitan.</li>
    <li>Ya admitida, entrá con <Ui>LOGIN</Ui>, tu email y tu clave.</li>
  </ol>
  <p>Detalle en <a href="#account" @click.prevent="go('account')">Cuenta</a>.</p>

  <h4>2 · Creá el proyecto</h4>
  <p>
    La primera vez que entrás, Looper te crea un proyecto vacío, <i>My project</i>, y lo abre: podés usar ese. Si
    preferís uno con otro nombre:
  </p>
  <ol>
    <li>Apretá <Ui>PROJECTS</Ui> en la barra de arriba.</li>
    <li>Escribí el nombre en <Ui>New project name</Ui> (por ejemplo <i>My first project</i>) y apretá <Ui>CREATE</Ui>.</li>
  </ol>
  <p>
    El proyecto nuevo se abre solo. Arranca a 138 <Term t="bpm">BPM</Term>: conviene elegir loops de un tempo
    parecido. Más en <a href="#projects" @click.prevent="go('projects')">Proyectos</a>.
  </p>

  <h4>3 · Traé tres o cuatro loops</h4>
  <p>Lo más rápido es importarlos del <Term t="catalog">catálogo</Term>, que ya tiene audios de otros usuarios:</p>
  <ol>
    <li>Apretá <Ui>IMPORT</Ui> en la barra de arriba.</li>
    <li>
      Apretá <Ui>= TEMPO</Ui> para ver solo los loops que andan cerca del tempo del proyecto, y si querés escribí
      algo en <Ui>Name contains…</Ui> (por ejemplo <i>Bass</i>).
    </li>
    <li>Escuchá con el botón ▶ de cada fila y tildá los que te gusten: un par de baterías y un par de bajos.</li>
    <li>Apretá <Ui>IMPORT</Ui> abajo a la derecha.</li>
  </ol>
  <p>
    Si tenés tus propios audios, subilos desde <Ui>Upload Files</Ui>, debajo del mixer. Los archivos llegan al
    proyecto sin pista ni Tags, y aparecen en la lista <Ui>Files</Ui>. Más en
    <a href="#audio" @click.prevent="go('audio')">Traer audio</a>.
  </p>

  <h4>4 · Creá dos pistas y dos Tags</h4>
  <ol>
    <li>
      En la barra de la izquierda, apretá <Ui>+ Track</Ui> dos veces. Aparecen dos pads <Ui>TRACK</Ui> (y dos tiras en
      el mixer).
    </li>
    <li>
      Hacé doble clic en cada pad, escribí el nombre (<i>Drums</i>, <i>Bass</i>) y hacé clic afuera para guardarlo.
    </li>
    <li>Apretá <Ui>+ Tag</Ui> dos veces.</li>
    <li>
      En cada pad de Tag, hacé clic en el lápiz, poné el nombre (<i>Groove</i>, <i>Break</i>) y apretá <Ui>SAVE</Ui>.
    </li>
  </ol>
  <ManualShot src="/manual/trg_tags.webp" :max_width="260" alt="Dos pads de pistas, Drums y Bass, y dos de Tags, Groove y Break"
    caption="Las dos pistas y los dos Tags del ejemplo" />

  <h4>5 · Asigná arrastrando</h4>
  <p>
    Cada archivo necesita una pista (si no, no suena) y puede llevar Tags. Se asignan arrastrando los pads de la
    izquierda sobre los archivos de la lista <Ui>Files</Ui>:
  </p>
  <ol>
    <li>Arrastrá el pad <i>Drums</i> sobre cada batería y el pad <i>Bass</i> sobre cada bajo.</li>
    <li>Arrastrá el pad <i>Groove</i> sobre los cuatro archivos.</li>
    <li>Arrastrá el pad <i>Break</i> solo sobre uno de los bajos: en esa sección la batería se va a callar.</li>
  </ol>
  <ManualShot src="/manual/first_drag.webp" alt="El pad Bass arrastrado sobre un archivo sin pista ni Tags, que se resalta en amarillo"
    caption="Arrastrando el pad Bass sobre el último archivo (en la vista Box de Files)" :callouts="[
      { n: 1, x: 18.4, y: 7.3, text: 'El pad que arrastrás.' },
      { n: 2, x: 98, y: 67.3, text: 'El archivo de destino se resalta en amarillo: soltalo ahí.' },
      { n: 3, x: 81.5, y: 80.6, text: 'Todavía sin pista ni Tags (no group, no tag). Al soltar, el chip toma el nombre y el color del pad.' },
    ]" />
  <p>
    Soltar un Tag que el archivo ya tiene se lo saca. Más en
    <a href="#trg_tags" @click.prevent="go('trg_tags')">Track Groups y Tags</a>.
  </p>

  <h4>6 · START</h4>
  <p>
    Apretá <Ui>START</Ui> arriba a la izquierda del panel <Ui>Transport</Ui>. Looper sortea un Tag y cada pista empieza
    con un loop al azar que lo lleve. Los pads se encienden mientras suenan; cada tanto el Tag cambia y las pistas
    eligen otros loops.
  </p>
  <ManualShot src="/manual/first_playing.webp" alt="El proyecto del tutorial sonando: pads encendidos, transporte y dos tiras en el mixer"
    caption="El proyecto del ejemplo sonando" :callouts="[
      { n: 1, x: 41.2, y: 7.7, to: 'play', text: 'START / STOP y RESET (cambia de Tag en el acto).' },
      { n: 2, x: 56, y: 35.7, to: 'play', text: 'El Tag que suena y cuántos beats le quedan.' },
      { n: 3, x: 18.2, y: 3, text: 'Se encienden los pads de las pistas que suenan y el del Tag actual.' },
      { n: 4, x: 45.8, y: 49.2, to: 'mixer', text: 'Una tira del mixer por pista, con el loop que está tocando.' },
    ]" />
  <p>
    Cuando sale <i>Break</i>, <i>Drums</i> se calla, porque no tiene ningún loop con ese Tag. Para seguir: el
    transporte en <a href="#play" @click.prevent="go('play')">Tocar</a>, cómo sortea en
    <a href="#engine" @click.prevent="go('engine')">Cómo elige el motor</a> y los volúmenes en
    <a href="#mixer" @click.prevent="go('mixer')">Mixer</a>.
  </p>
  <Note title="Se guarda solo">
    <p>
      No hay botón de guardar: cada cambio (pistas, Tags, asignaciones, perillas) se guarda en el momento. Tu proyecto
      ya aparece en la galería para que cualquiera lo escuche.
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
