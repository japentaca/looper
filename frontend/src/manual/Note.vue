<template>
  <!-- nota al margen del texto con un LED: tip (verde) o warn (amarillo, para avisos) -->
  <aside class="note" :class="type">
    <div class="head">
      <Led :color="type === 'warn' ? 'yellow' : 'green'" lit />
      <span class="silk">{{ title || (type === "warn" ? "Atención" : "Tip") }}</span>
    </div>
    <div class="body">
      <slot />
    </div>
  </aside>
</template>

<script setup>
import Led from "../components/hw/Led.vue"

defineProps({
  type: { type: String, default: "tip" }, // "tip" | "warn"
  // rótulo de la nota; por defecto "Tip" o "Atención"
  title: { type: String, default: "" },
})
</script>

<style scoped>
.note {
  margin: 14px 0;
  padding: 10px 14px 12px;
  border: 1px solid #111214;
  border-left: 3px solid var(--hw_green);
  border-radius: 4px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(0, 0, 0, 0.18)),
    var(--hw_tex_chassis) center / cover no-repeat,
    var(--hw_chassis_dark);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.note.warn {
  border-left-color: var(--hw_yellow);
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

/* .silk no corta líneas (nowrap, global): un título largo desbordaba la nota en celular */
.head .silk {
  min-width: 0;
  white-space: normal;
  line-height: 1.4;
}

.body :deep(p) {
  margin: 4px 0 0;
}

@media print {
  .note {
    background: none;
    box-shadow: none;
    border-color: #999;
    break-inside: avoid;
  }

  .note .silk {
    color: #111;
  }
}
</style>
