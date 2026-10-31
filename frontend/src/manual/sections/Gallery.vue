<template>
  <!-- sección "Galería" (id y título en ../sections.js): la galería de proyectos públicos (views/Gallery.vue,
    components/GalleryGrid.vue). Captura: toma "gallery" de scripts/manual_shots.js -->
  <p>
    La galería muestra los <Term t="project">proyectos</Term> de todos los usuarios de Looper. No hace falta cuenta:
    entrás con el link <Ui>GALLERY</Ui> de la barra de arriba (o con el botón <Ui>GALLERY</Ui> desde la app, si ya
    tenés cuenta). Los más nuevos aparecen primero, de a 24 por página.
  </p>
  <ManualShot src="/manual_shots/gallery.webp" alt="La galería con tres proyectos de demo" :callouts="[
    { n: 1, x: 85.3, y: 11.2, text: 'Links de la barra: MANUAL (este manual) y OPEN APP (la app, para entrar con tu cuenta).' },
    { n: 2, x: 77.8, y: 41.6, text: 'El nombre del proyecto (cada tarjeta es uno). Hacé clic en cualquier parte de la tarjeta para abrirlo.' },
    { n: 3, x: 78.8, y: 54.9, text: 'Quién lo hizo y su tempo, en BPM.' },
    { n: 4, x: 78.8, y: 72.5,
      text: 'Cuántos archivos usa, cuánta memoria (RAM) va a necesitar tu navegador para tocarlo y la fecha.' },
  ]" />

  <h4>Antes de abrir uno: la RAM</h4>
  <p>
    Para tocar sin cortes, el navegador tiene todos los audios del proyecto cargados en memoria (más o menos 21 MB por
    minuto de audio). La tarjeta muestra esa cuenta como <Ui>RAM</Ui>; si aparece en amarillo, el proyecto pide más
    de lo recomendable para tu equipo. Al abrirlo, Looper te pregunta si querés cargarlo igual.
  </p>
  <Note type="warn" title="En el celular">
    <p>
      Los celulares tienen menos memoria: con un proyecto que marca la RAM en amarillo, el navegador puede quedarse
      sin memoria y recargar la página. Probá primero con uno más liviano.
    </p>
  </Note>
  <p>
    Solo aparecen los proyectos que tienen al menos un archivo. Al hacer clic en una tarjeta se abre el proyecto en
    modo lectura: lo explica la sección siguiente. Si entraste con tu cuenta, las tarjetas de proyectos ajenos tienen
    además un botón chico <Ui>REPORT</Ui> para denunciar uno que no corresponda (ver
    <a href="#share" @click.prevent="go('share')">Compartir y denunciar</a>).
  </p>
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
