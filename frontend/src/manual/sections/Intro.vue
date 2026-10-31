<template>
  <!-- sección "Qué es Looper" (id y título en ../sections.js): Track Groups en paralelo, Tags, cambio cada 2^n beats;
    diagrama SVG (datos en LANES / TAGS de abajo, solo ilustrativos) -->
  <p>
    Looper es un <b>reproductor de loops aleatorio</b> (un <i>loop player</i>): vos le das los ingredientes, que son
    archivos de audio cortos, y él arma la música en el momento, combinándolos al azar. Nunca suena dos veces
    exactamente igual y puede tocar sin parar todo el tiempo que quieras.
  </p>

  <h4>Los ingredientes</h4>
  <ul>
    <li>
      <Term t="loop">Loops</Term>: fragmentos de audio pensados para repetirse (un compás de batería, una línea de bajo).
      También hay <Term t="one_shot">one-shots</Term>, golpes sueltos como un impacto o un efecto.
    </li>
    <li>
      <Term t="track_group">Track Groups</Term> (pistas): cada archivo pertenece a una pista, por ejemplo
      <i>Kick</i>, <i>Bass</i> o <i>Lead</i>. Todas las pistas suenan <b>a la vez</b>, y cada una toca un solo archivo
      por vez.
    </li>
    <li>
      <Term t="tag">Tags</Term>: las secciones de la música (por ejemplo <i>Groove</i> o <i>Breakdown</i>). Cada archivo
      lleva uno o varios Tags, que dicen en qué secciones puede sonar. Un archivo sin Tags vale para todas.
    </li>
    <li>
      El tempo, en <Term t="bpm">BPM</Term>: todo va sincronizado a ese pulso, contado en <Term t="beat">beats</Term>.
    </li>
  </ul>
  <p>
    Todo eso junto (las pistas, los Tags, los archivos elegidos y el tempo) forma un <Term t="project">proyecto</Term>.
  </p>

  <h4>Cómo arma la música</h4>
  <ol>
    <li>
      Al apretar <Ui>START</Ui>, Looper sortea un Tag y cuánto va a durar: una potencia de dos, entre 32 y 512 beats
      (32, 64, 128, 256 o 512, dentro del rango que elija el proyecto).
    </li>
    <li>
      Cada pista sortea uno de sus loops que lleve ese Tag y lo toca. Cuando termina, sortea otro (puede salir el
      mismo) o hace un <Term t="rest">descanso</Term> de algunos compases.
    </li>
    <li>
      Cuando se acaba el tiempo del Tag, entra otro, también sorteado. Las pistas cuyo loop no tiene el Tag nuevo
      cortan justo en ese beat y eligen uno que sí lo tenga; las que sí lo tienen siguen sonando como si nada.
      Si una pista no tiene nada para el Tag nuevo, se queda callada hasta el próximo cambio.
    </li>
    <li>
      Los loops se aceleran o se frenan un poco para coincidir con el tempo del proyecto, así todo cae en el beat.
    </li>
  </ol>

  <figure class="diagram">
    <div class="diagram_scroll">
      <svg :viewBox="`0 0 ${W} ${H}`" role="img"
        aria-label="Diagrama: cuatro pistas en paralelo a lo largo del tiempo; arriba, los Tags que se suceden; en cada pista, los loops sorteados">
        <!-- fondo de pantalla, como el LCD de la app pero oscuro -->
        <rect x="0" y="0" :width="W" :height="H" rx="6" class="screen" />

        <!-- banda de Tags -->
        <text :x="LABEL_X" :y="TAG_Y + 15" class="lane_label">TAG</text>
        <g v-for="t in TAGS" :key="t.name">
          <rect :x="bx(t.from) + 1" :y="TAG_Y" :width="bw(t.from, t.to) - 2" height="22" rx="3" :fill="t.color"
            class="tag_rect" />
          <text :x="bx(t.from) + 8" :y="TAG_Y + 15" class="tag_text">{{ t.name }} · {{ t.to - t.from }} beats</text>
        </g>

        <!-- cambios de Tag -->
        <g v-for="b in CHANGES" :key="b">
          <line :x1="bx(b)" :x2="bx(b)" :y1="TAG_Y - 6" :y2="AXIS_Y" class="change" />
        </g>
        <text :x="bx(CHANGES[0]) + 4" :y="TAG_Y - 8" class="change_text">cambio de Tag</text>
        <text :x="bx(CHANGES[1]) + 4" :y="TAG_Y - 8" class="change_text">cambio de Tag</text>

        <!-- pistas -->
        <g v-for="(lane, i) in LANES" :key="lane.name">
          <text :x="LABEL_X" :y="lane_y(i) + 17" class="lane_label">{{ lane.name }}</text>
          <line :x1="bx(0)" :x2="bx(TOTAL)" :y1="lane_y(i) + 12" :y2="lane_y(i) + 12" class="lane_line" />
          <g v-for="(c, j) in lane.clips" :key="j">
            <rect v-if="c.rest" :x="bx(c.from) + 2" :y="lane_y(i) + 2" :width="bw(c.from, c.to) - 4" height="20" rx="3"
              class="rest_rect" />
            <rect v-else :x="bx(c.from) + 1" :y="lane_y(i)" :width="bw(c.from, c.to) - 2" height="24" rx="3"
              :fill="lane.color" class="clip" />
            <text :x="bx(c.from) + 6" :y="lane_y(i) + 16" :class="c.rest ? 'rest_text' : 'clip_text'">{{ c.rest ?
              "descanso" : c.name }}</text>
            <!-- corte por cambio de Tag -->
            <path v-if="c.cut" :d="cut_path(bx(c.to), lane_y(i))" class="cut" />
          </g>
          <text v-if="lane.silent" :x="bx(lane.silent) + 8" :y="lane_y(i) + 16" class="silent_text">calla: sin loops</text>
        </g>

        <!-- eje de beats -->
        <line :x1="bx(0)" :x2="bx(TOTAL)" :y1="AXIS_Y" :y2="AXIS_Y" class="axis" />
        <g v-for="b in TICKS" :key="'t' + b">
          <line :x1="bx(b)" :x2="bx(b)" :y1="AXIS_Y" :y2="AXIS_Y + 5" class="axis" />
          <text :x="bx(b)" :y="AXIS_Y + 18" class="tick_text">{{ b }}</text>
        </g>
        <text :x="LABEL_X" :y="AXIS_Y + 18" class="lane_label">BEATS</text>
      </svg>
    </div>
    <figcaption>
      Cuatro pistas a lo largo de 128 beats. Cada bloque es un loop sorteado (el color es el de su pista); el corte en
      zigzag es un loop que se interrumpe porque no tiene el Tag que entra. El loop <i>L1</i> de <i>Lead</i> tiene los
      Tags <i>Groove</i> y <i>Triplet</i>, así que atraviesa el primer cambio sin cortarse. En <i>Breakdown</i>,
      <i>Kick</i> y <i>Drums</i> no tienen loops y se callan.
    </figcaption>
  </figure>

  <p>
    Los sorteos no tienen por qué ser parejos: cada Tag y cada archivo tienen un <Term t="weight">peso</Term> que
    hace que salgan más o menos seguido. Y una pista puede ser de one-shots: en vez de encadenar loops, dispara golpes
    sueltos de vez en cuando.
  </p>

  <Note title="Por dónde empezar">
    <p>
      Si solo querés escuchar, no necesitás cuenta: empezá por la <a href="#gallery" @click.prevent="go('gallery')">galería</a>
      (Nivel 0). Para armar tus propios proyectos, seguí con el Nivel 1; el Nivel 2 es para afinar cada archivo.
    </p>
  </Note>
</template>

<script setup>
import { useRouter } from "vue-router"
import Term from "../Term.vue"
import Ui from "../Ui.vue"
import Note from "../Note.vue"
import { go_anchor } from "../nav"

const router = useRouter()
const go = id => go_anchor(router, id)

// geometría del diagrama (unidades del viewBox)
const W = 720
const LABEL_X = 12
const X0 = 84 // beat 0
const X1 = 704 // beat TOTAL
const TOTAL = 128
const TAG_Y = 30
const LANE_Y0 = 70
const LANE_H = 36
const bx = b => X0 + (X1 - X0) * b / TOTAL
const bw = (from, to) => bx(to) - bx(from)
const lane_y = i => LANE_Y0 + i * LANE_H

// Tags que se suceden (duraciones 2^n) y pistas con sus loops; cut = cortado por el cambio de Tag; rest = descanso
const TAGS = [
  { name: "Groove", from: 0, to: 32, color: "#39e30b" },
  { name: "Triplet", from: 32, to: 96, color: "#928af5" },
  { name: "Breakdown", from: 96, to: 128, color: "#4fb6e8" },
]
const CHANGES = [32, 96]
const TICKS = [0, 16, 32, 48, 64, 80, 96, 112, 128]
const LANES = [
  { name: "KICK", color: "#f800a9", silent: 96,
    clips: [[0, 16, "K1"], [16, 32, "K1"], [32, 48, "K1"], [48, 64, "K1"], [64, 80, "K1"], [80, 96, "K1"]] },
  { name: "DRUMS", color: "#6b8ebf", silent: 96,
    clips: [[0, 16, "D1"], [16, 32, "D3"], [32, 48, "D7"], [48, 64, "D8"], [64, 80, null], [80, 96, "D7"]] },
  { name: "BASS", color: "#f53404",
    clips: [[0, 16, "B1"], [16, 32, "B2", true], [32, 48, "B4"], [48, 64, "B4"], [64, 80, "B5"], [80, 96, "B4"],
      [96, 112, "B3"], [112, 128, "B3"]] },
  { name: "LEAD", color: "#16e70b",
    clips: [[0, 16, "L3"], [16, 48, "L1"], [48, 80, "L5"], [80, 96, "L6", true], [96, 128, "L2"]] },
].map(l => ({ ...l, clips: l.clips.map(([from, to, name, cut]) => ({ from, to, name, cut, rest: name === null })) }))
const AXIS_Y = lane_y(LANES.length) + 4
const H = AXIS_Y + 28

// zigzag vertical en el borde derecho de un loop cortado
function cut_path(x, y) {
  return `M ${x} ${y - 3} l -4 5 l 4 5 l -4 5 l 4 5 l -4 5 l 4 5`
}
</script>

<style scoped>
.diagram {
  margin: 18px 0;
}

/* en celular el diagrama no se achica hasta ser ilegible: se desplaza adentro de su caja */
.diagram_scroll {
  overflow-x: auto;
  border: 3px solid #0b0b0c;
  border-radius: 6px;
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.6);
}

.diagram svg {
  display: block;
  width: 100%;
  min-width: 560px;
  height: auto;
  font-family: var(--font_mono);
}

.screen {
  fill: var(--panel);
}

.lane_label {
  fill: var(--hw_silk);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.2px;
}

.lane_line {
  stroke: var(--border);
  stroke-width: 1;
}

.tag_rect {
  opacity: 0.85;
}

.tag_text,
.clip_text {
  fill: #111;
  font-size: 11px;
  font-weight: 700;
}

.clip {
  stroke: #000;
  stroke-width: 1;
  opacity: 0.9;
}

.rest_rect {
  fill: none;
  stroke: var(--muted);
  stroke-width: 1;
  stroke-dasharray: 4 3;
}

.rest_text,
.silent_text {
  fill: var(--muted);
  font-size: 10px;
  font-style: italic;
}

.cut {
  fill: none;
  stroke: var(--hw_red);
  stroke-width: 2;
}

.change {
  stroke: var(--hw_yellow);
  stroke-width: 1.5;
  stroke-dasharray: 5 4;
}

.change_text {
  fill: var(--hw_yellow);
  font-size: 10px;
}

.axis {
  stroke: var(--muted);
  stroke-width: 1;
}

.tick_text {
  fill: var(--muted);
  font-size: 10px;
  text-anchor: middle;
}

figcaption {
  margin-top: 8px;
  color: var(--muted);
  font-size: 13px;
}

@media print {
  .diagram {
    break-inside: avoid;
  }

  .diagram_scroll {
    overflow: visible;
    border-color: #999;
    box-shadow: none;
  }

  .diagram svg {
    min-width: 0;
  }

  figcaption {
    color: #111;
  }
}
</style>
