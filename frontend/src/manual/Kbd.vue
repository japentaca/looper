<template>
  <!-- tecla: <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> (goma como los botones de la app) -->
  <kbd class="kbd"><slot /></kbd>
</template>

<style scoped>
.kbd {
  display: inline-block;
  min-width: 1.6em;
  padding: 0 6px;
  border: 1px solid #0c0c0d;
  border-radius: 4px;
  background: linear-gradient(180deg, var(--hw_rubber_hi), var(--hw_rubber));
  box-shadow: 0 2px 0 #0e0e0f, inset 0 1px 0 rgba(255, 255, 255, 0.18);
  color: var(--hw_rubber_ink);
  font-family: var(--font_mono);
  font-size: 0.8em;
  font-weight: 700;
  line-height: 1.6;
  text-align: center;
  white-space: nowrap;
}

@media print {
  .kbd {
    background: none;
    border-color: #555;
    box-shadow: none;
    color: #111;
  }
}
</style>
