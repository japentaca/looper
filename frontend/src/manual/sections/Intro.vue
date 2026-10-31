<template>
  <!-- sección "Qué es Looper" (id y título en ../sections.js): Track Groups en paralelo, Tags, cambio cada 2^n beats; diagrama SVG -->
  <p class="pending">
    Pendiente. Looper toca en paralelo un loop por cada <Term t="track_group">Track Group</Term>, elegido al
    azar entre los compatibles con el <Term t="tag">Tag</Term> activo; se arranca con <Ui>START</Ui> y el
    tempo se lee en el <Ui lcd>120</Ui>. En el editor, <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> deshace.
  </p>
  <Note>Pendiente: diagrama SVG de las pistas y los Tags.</Note>
  <Note type="warn" title="Sin sonido">Pendiente: el navegador no deja sonar sin un clic primero.</Note>
</template>

<script setup>
import Term from "../Term.vue"
import Ui from "../Ui.vue"
import Kbd from "../Kbd.vue"
import Note from "../Note.vue"
</script>
