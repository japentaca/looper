<template>
  <!-- galería pública como diálogo dentro de la app (botón GALLERY). Se recarga en cada apertura
    (destroy-on-close). Abrir un proyecto navega a /p/<id> en esta pestaña: corta lo que suena -->
  <el-dialog v-model="visible" title="Public gallery" width="960px" align-center destroy-on-close>
    <el-scrollbar max-height="70vh">
      <GalleryGrid reload />
    </el-scrollbar>
  </el-dialog>
</template>

<script setup>
import GalleryGrid from "./GalleryGrid.vue"

const visible = defineModel({ type: Boolean, default: false })
</script>
