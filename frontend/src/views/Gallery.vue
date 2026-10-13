<template>
  <!-- galería pública (/gallery): proyectos públicos de todos los usuarios, sin sesión -->
  <div class="page">
    <PublicBar :gallery_link="false">
      <span class="silk">Public gallery</span>
    </PublicBar>

    <main class="main">
      <GalleryGrid />
    </main>
  </div>
</template>

<script setup>
import PublicBar from "../components/PublicBar.vue"
import GalleryGrid from "../components/GalleryGrid.vue"
</script>

<style scoped>
.page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.main {
  flex: 1;
  padding: 20px 16px;
}
</style>
