<template>
  <!-- sección "Glosario" (id y título en ../sections.js). Cada término lleva id="g_<id>" (lo usa Term.vue con la
    prop t: <Term t="track_group">). Los ids no se cambian (los usan las otras secciones); en orden alfabético
    por el nombre que se ve -->
  <p>Las palabras que usa Looper (y este manual), en orden alfabético.</p>
  <dl class="glossary">
    <template v-for="g in TERMS" :key="g.id">
      <dt :id="'g_' + g.id">{{ g.term }}<span v-if="g.alt" class="alt"> · {{ g.alt }}</span></dt>
      <dd>{{ g.def }}</dd>
    </template>
  </dl>
</template>

<script setup>
// id: ancla (#g_<id>); term: como se lee; alt: otro nombre (el de la app o el castellano)
const TERMS = [
  { id: "anchor", term: "Anchor", alt: "ancla",
    def: "En un one-shot, el punto del sonido que tiene que caer justo en el beat. Sirve para sonidos que tienen algo antes del golpe (una subida, un \"swoosh\"): el disparo arranca antes para que el golpe quede a tiempo. Por defecto es el comienzo del sonido; se ajusta en el editor." },
  { id: "beat", term: "Beat", alt: "tiempo",
    def: "Cada pulso del tempo (en 4/4, una negra). Es la unidad con la que Looper cuenta todo: cuánto dura un loop, cuánto falta para el próximo cambio de Tag, en qué momento entra cada sonido." },
  { id: "bpm", term: "BPM",
    def: "Beats por minuto: la velocidad del tempo. El proyecto tiene su BPM y cada loop tiene el suyo (el de su grabación). Para que encajen, el loop se acelera o se frena; si queda muy lejos, se prueba al doble o a la mitad (un loop de 70 BPM entra en un proyecto de 140)." },
  { id: "catalog", term: "Catálogo",
    def: "Todos los archivos que subieron los usuarios de Looper y que se pueden usar. Desde el catálogo importás archivos a tus proyectos (propios o de otros) sin copiarlos: tu proyecto los usa tal como están." },
  { id: "bar", term: "Compás", alt: "bar",
    def: "Un grupo de beats: 4 en 4/4 (lo más común) o 3 en 3/4. Los loops vienen cortados a compás, y en la pantalla la posición se lee como compás.beat (por ejemplo 6.3 es el tercer beat del compás 6)." },
  { id: "rest", term: "Descanso", alt: "rest",
    def: "Un rato en que una pista se queda callada a propósito: al terminar un loop, con cierta probabilidad, la pista descansa algunos compases antes de sortear el siguiente. Le da aire a la música." },
  { id: "loop", term: "Loop",
    def: "Un archivo de audio pensado para repetirse sin que se note la costura, de una cantidad fija de beats (por ejemplo 16, que son 4 compases de 4/4). Es lo que tocan normalmente las pistas." },
  { id: "master", term: "Master",
    def: "La salida general, donde se suman todas las pistas. El knob Master controla el volumen de todo junto." },
  { id: "one_shot", term: "One-shot", alt: "shot",
    def: "Un sonido suelto que no se repite: un golpe, un impacto, un efecto. Suena siempre a su velocidad original. Lo tocan las pistas en modo one-shot, que lo disparan de vez en cuando en vez de encadenar loops." },
  { id: "weight", term: "Peso", alt: "weight",
    def: "Cuántas chances tiene algo de salir en un sorteo, de 0 a 32 (16 por defecto). Con el doble de peso sale el doble de seguido; con peso 0 no sale nunca. Lo tienen los Tags y cada archivo dentro de un proyecto." },
  { id: "project", term: "Proyecto",
    def: "Una pieza de Looper: sus pistas, sus Tags, los archivos que usa (con su pista, sus Tags y sus ajustes) y la configuración general (tempo, cada cuánto cambia el Tag, efectos). Cada usuario puede tener varios, y todos se pueden escuchar desde la galería." },
  { id: "region", term: "Región",
    def: "La parte del archivo que suena en un proyecto: dónde empieza y dónde termina. Sirve para usar solo un pedazo de un loop o recortar un silencio, sin modificar el archivo original. Se ajusta en el editor." },
  { id: "tag", term: "Tag",
    def: "Una sección de la música (Groove, Breakdown, Intro...). Cada archivo lleva los Tags de las secciones donde puede sonar; uno sin Tags vale para todas. Mientras suena, siempre hay un Tag activo, que cambia al azar cada tanto." },
  { id: "key", term: "Tonalidad", alt: "key",
    def: "La nota y el modo en que está un archivo con armonía (C, Am, F#m...). Sirve para que los bajos y los sintes de un proyecto combinen entre sí. Las baterías y los ruidos son atonales (no tienen tonalidad)." },
  { id: "tolerance", term: "Tolerancia de tempo", alt: "Tol",
    def: "Cuánto se puede acelerar o frenar un loop para que encaje en el tempo del proyecto, en %. Los loops que necesitarían más que eso no se sortean. Acelerar un loop también lo hace más agudo (6 % es casi un semitono): por eso conviene no pasarse." },
  { id: "track_group", term: "Track Group", alt: "pista",
    def: "Una pista de Looper: un grupo de archivos que se turnan en el mismo lugar (por ejemplo todos los bajos). Todas las pistas suenan en paralelo y cada una toca un archivo por vez, elegido al azar entre los suyos que tengan el Tag activo." },
]
</script>

<style scoped>
.glossary {
  margin: 12px 0;
}

.glossary dt {
  margin-top: 12px;
  color: var(--hw_silk);
  font-weight: 700;
  scroll-margin-top: 12px;
}

.glossary dt:target {
  color: var(--accent);
}

.alt {
  color: var(--muted);
  font-weight: 400;
}

.glossary dd {
  margin: 2px 0 0 18px;
}

@media print {
  .glossary dt {
    color: #111;
    break-after: avoid;
  }

  .alt {
    color: #444;
  }
}
</style>
