<template>
  <!-- sección "La pantalla de un vistazo" (id y título en ../sections.js): captura anotada de la pantalla completa -->
  <p class="pending">Pendiente. La captura de la pantalla completa llega con el script de capturas.</p>
  <ManualShot alt="La pantalla de Looper" caption="La pantalla principal (captura pendiente)" :callouts="[
    { n: 1, x: 12, y: 6, text: 'Barra superior: placa, LED de estado, master y sesión' },
    { n: 2, x: 8, y: 50, text: 'Sidebar: pads de Track Groups y Tags' },
    { n: 3, x: 60, y: 45, text: 'Tracks: transporte y mixer' },
  ]" />
</template>

<script setup>
import ManualShot from "../ManualShot.vue"
</script>
