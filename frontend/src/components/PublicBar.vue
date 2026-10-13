<template>
  <!-- barra superior de las vistas públicas (galería y proyecto público): placa de marca y links -->
  <!-- los links a la app son <a href> (recarga completa, ver router.js); entre vistas públicas, router-link -->
  <header class="pub_bar">
    <a class="nameplate" href="/" title="Looper">
      <span class="logo">LOOPER</span>
      <span class="model">Random loop player</span>
    </a>
    <slot />
    <span class="spacer"></span>
    <router-link v-if="gallery_link" class="silk link" to="/gallery">GALLERY</router-link>
    <a class="silk link" href="/">OPEN APP</a>
  </header>
</template>

<script setup>
defineProps({
  // muestra el link a la galería (no hace falta estando en la galería)
  gallery_link: { type: Boolean, default: true },
})
</script>

<style scoped>
.pub_bar {
  flex: none;
  min-height: 56px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.25)),
    var(--hw_tex_chassis) center / cover,
    var(--hw_chassis_dark);
  border-bottom: 1px solid #0c0c0d;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
}

.nameplate {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 5px 14px 6px;
  border-radius: 3px;
  background: var(--hw_tex_metal) center / cover, linear-gradient(180deg, #c4c6ca, #9a9da2);
  box-shadow: 0 2px 3px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.55);
  color: #232427;
  text-decoration: none;
  user-select: none;
}

.logo {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 5px;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.55);
}

.model {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.8px;
  text-transform: uppercase;
  opacity: 0.75;
}

.spacer {
  flex: 1;
}

.link {
  text-decoration: none;
}

.link:hover {
  color: var(--accent);
}
</style>
