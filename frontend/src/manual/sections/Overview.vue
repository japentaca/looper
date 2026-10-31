<template>
  <!-- sección "La pantalla de un vistazo" (id y título en ../sections.js): captura anotada de la pantalla completa.
    La captura sale de scripts/manual_shots.js (toma "overview"); las posiciones de los números las imprime el
    script (marks), ver docs/MANUAL.md -->
  <p class="pending">Pendiente: el texto de esta sección.</p>
  <ManualShot src="/manual/overview.webp" alt="La pantalla principal de Looper con un proyecto sonando"
    caption="La pantalla principal, con el proyecto de demo sonando" :callouts="[
      { n: 1, x: 17.9, y: 1.3, text: 'Barra superior: estado, vúmetro master, proyecto activo y sesión' },
      { n: 2, x: 15.1, y: 5.9, text: 'Pads de las pistas (Track Groups)' },
      { n: 3, x: 15.1, y: 32.3, text: 'Pads de los Tags' },
      { n: 4, x: 15.1, y: 51.4, text: 'Pads de los FX de transición' },
      { n: 5, x: 95.8, y: 5.6, text: 'Transport: START/STOP, tempo, delay, reverb, cambio de Tag y master' },
      { n: 6, x: 76.5, y: 29.6, text: 'Mixer: una tira por pista' },
      { n: 7, x: 58.6, y: 81.7, text: 'Upload Files: subir audio' },
      { n: 8, x: 76.7, y: 84.7, text: 'Files: los archivos del proyecto' },
    ]" />
</template>

<script setup>
import ManualShot from "../ManualShot.vue"
</script>
