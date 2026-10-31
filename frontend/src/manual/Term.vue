<template>
  <!-- término con link al glosario: <Term t="track_group">Track Group</Term> va a #g_track_group;
    sin t, al glosario entero (#glossary) -->
  <a class="term" :href="'#' + target" :title="'Ver en el glosario'" @click.prevent="go_anchor(router, target)">
    <slot />
  </a>
</template>

<script setup>
import { computed } from "vue"
import { useRouter } from "vue-router"
import { go_anchor } from "./nav"

const props = defineProps({
  // id del término en el glosario (el ancla es g_<t>); si todavía no tiene ancla, router.js cae en #glossary
  t: { type: String, default: "" },
})

const router = useRouter()
const target = computed(() => props.t ? "g_" + props.t : "glossary")
</script>

<style scoped>
.term {
  color: inherit;
  text-decoration: underline dotted var(--accent);
  text-underline-offset: 3px;
}

.term:hover {
  color: var(--accent);
}

@media print {
  .term {
    color: inherit;
    text-decoration: none;
  }
}
</style>
