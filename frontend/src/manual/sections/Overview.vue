<template>
  <!-- sección "La pantalla de un vistazo" (id y título en ../sections.js): captura anotada de la pantalla completa.
    La captura sale de scripts/manual_shots.js (toma "overview"); las posiciones de los números las imprime el
    script (marks), ver docs/MANUAL.md -->
  <p>
    Esta es la pantalla de la app cuando entrás con tu cuenta y abrís un proyecto. A la izquierda están los pads, que
    representan las piezas del proyecto; en el centro, el transporte y el mixer, que es donde se toca; abajo, los
    archivos. Cada número te lleva a la sección que lo explica.
  </p>
  <ManualShot src="/manual/overview.webp" alt="La pantalla principal de Looper con un proyecto sonando"
    caption="La pantalla principal, con el proyecto de demo sonando" :callouts="[
      { n: 1, x: 8.4, y: 1.6, to: 'projects',
        text: 'Barra superior: el LED de estado (Ready cuando terminaron de cargar los audios), el vúmetro master, el proyecto abierto con PROJECTS, IMPORT y LINK, y tu cuenta.' },
      { n: 2, x: 15.1, y: 5.9, to: 'trg_tags',
        text: 'Pads de las pistas (Track Groups): se iluminan mientras su pista suena.' },
      { n: 3, x: 15.1, y: 32.3, to: 'trg_tags', text: 'Pads de los Tags: se ilumina el Tag que está sonando.' },
      { n: 4, x: 15.1, y: 51.4, to: 'fx', text: 'Pads de los FX de transición: se arrastran a una pista del mixer.' },
      { n: 5, x: 95.8, y: 5.6, to: 'play',
        text: 'Transport: START/STOP, RESET, tempo, delay y reverb, cada cuánto cambia el Tag, el Tag actual, master y compresor.' },
      { n: 6, x: 76.5, y: 29.6, to: 'mixer',
        text: 'Mixer: una tira por pista con lo que está sonando, su vúmetro, volumen, mute y solo.' },
      { n: 7, x: 58.6, y: 81.7, to: 'audio', text: 'Upload Files: para subir tus archivos de audio.' },
      { n: 8, x: 76.7, y: 84.7, to: 'files',
        text: 'Files: los archivos del proyecto, para escucharlos, asignarles pista y Tags y abrirlos en el editor.' },
    ]" />
  <p>
    En un proyecto público, sin cuenta, se ve una versión reducida de esta pantalla: solo el transporte y el mixer
    (ver <a href="#public_project" @click.prevent="go('public_project')">Proyecto público</a>).
  </p>
</template>

<script setup>
import { useRouter } from "vue-router"
import ManualShot from "../ManualShot.vue"
import { go_anchor } from "../nav"

const router = useRouter()
const go = id => go_anchor(router, id)
</script>
