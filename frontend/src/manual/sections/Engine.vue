<template>
  <!-- sección "Cómo elige el motor" (id y título en ../sections.js): sorteo del Tag (peso y duración), sorteo de cada
    pista (candidatos, peso, Repeat), descansos (Rest / Again / largo), cambio de Tag, archivos sin Tags, pistas
    one-shot (Bars / Dens / Scat / TAG). Lo que hace hoy components/Tracks.vue, helpers/engine_oneshot.js y
    TrackCtrl.js (file_timing). Diagrama SVG del sorteo de una pista (STEPS de abajo). Captura: toma "strips" de
    scripts/manual_shots.js -->
  <p>
    Looper no sigue una partitura: en cada momento <b>sortea</b> qué va a sonar. Esta sección cuenta cómo, para que
    puedas llevar los sorteos para donde quieras con los <Term t="weight">pesos</Term>, los
    <Term t="tag">Tags</Term> y los controles de cada pista.
  </p>

  <h4>1 · El sorteo del Tag</h4>
  <p>Al apretar <Ui>START</Ui>, y cada vez que se acaba un Tag, Looper sortea dos cosas:</p>
  <ul>
    <li>
      <b>Qué Tag</b>, entre los que tiene al menos un archivo del proyecto (un Tag que no usa ningún archivo nunca
      sale). Cada uno tiene tantas chances como su peso, que se pone en el lápiz del pad (ver
      <a href="#trg_tags" @click.prevent="go('trg_tags')">Track Groups y Tags</a>). Puede volver a salir el mismo.
    </li>
    <li>
      <b>Cuánto dura</b>: un valor al azar entre los pads encendidos de <Ui>Tag change</Ui> (ver
      <a href="#play" @click.prevent="go('play')">Tocar</a>).
    </li>
  </ul>
  <p>Con los Tags del proyecto de demo, las chances quedan así:</p>
  <div class="odds" role="img" aria-label="Groove 4/4 con peso 16 sale el 47 % de las veces, Triplet con 12 el 35 % y Breakdown con 6 el 18 %">
    <div v-for="t in ODDS" :key="t.name" class="odd" :style="{ flexGrow: t.weight, background: t.color }">
      <span class="odd_name">{{ t.name }}</span>
      <span class="odd_pct">peso {{ t.weight }} · {{ pct(t.weight) }} %</span>
    </div>
  </div>
  <p>
    El Tag que viene se sortea apenas empieza el actual. Por eso, si cambiás un peso mientras suena, el cambio se nota
    a partir del sorteo siguiente (salvo que lo pongas en 0: ese Tag ya no entra). Si todos los Tags tienen peso 0, no
    hay Tag y suenan solo los archivos sin Tags (Looper lo avisa al dar START).
  </p>

  <h4>2 · El sorteo de cada pista</h4>
  <p>
    Cada <Term t="track_group">pista</Term> toca un archivo por vez y decide sola, en el beat en que termina su loop,
    qué hacer después:
  </p>
  <figure class="diagram">
    <div class="diagram_scroll">
      <svg :viewBox="`0 0 ${W} ${H}`" role="img"
        aria-label="Diagrama: lo que decide una pista al terminar un loop. Si le quedan vueltas, repite el mismo. Si no, tira el dado de descanso; si sale, descansa. Si no, arma los candidatos; si no hay ninguno, calla; si hay, sortea uno según su peso y lo toca.">
        <defs>
          <marker id="eng_arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"
            orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" class="arrow_head" />
          </marker>
        </defs>
        <rect x="0" y="0" :width="W" :height="H" rx="6" class="screen" />

        <!-- columna principal -->
        <g v-for="(s, i) in STEPS" :key="s.id">
          <rect :x="MX" :y="s.y" :width="MW" :height="s.h" rx="5" :class="s.lcd ? 'lcd_box' : 'box'" />
          <text :x="MX + 12" :y="s.y + 18" :class="s.lcd ? 'lcd_text' : 'box_text'">
            <tspan v-for="(line, j) in s.lines" :key="j" :x="MX + 12" :dy="j ? 15 : 0">{{ line }}</tspan>
          </text>
          <!-- flecha hacia el paso siguiente -->
          <template v-if="i < STEPS.length - 1">
            <line :x1="MX + 40" :x2="MX + 40" :y1="s.y + s.h" :y2="STEPS[i + 1].y - 2" class="arrow"
              marker-end="url(#eng_arrow)" />
            <text v-if="s.no" :x="MX + 48" :y="s.y + s.h + 17" class="arrow_text">{{ s.no }}</text>
          </template>
          <!-- salida a la derecha -->
          <template v-if="s.out">
            <line :x1="MX + MW" :x2="OX - 2" :y1="s.y + s.h / 2" :y2="s.y + s.h / 2" class="arrow"
              marker-end="url(#eng_arrow)" />
            <text :x="MX + MW + 8" :y="s.y + s.h / 2 - 6" class="arrow_text">{{ s.out.label }}</text>
            <rect :x="OX" :y="s.y + s.h / 2 - 20" :width="OW" height="40" rx="5" class="out_box" />
            <text :x="OX + 10" :y="s.y + s.h / 2 - 4" class="out_text">
              <tspan v-for="(line, j) in s.out.lines" :key="j" :x="OX + 10" :dy="j ? 14 : 0">{{ line }}</tspan>
            </text>
          </template>
        </g>
        <!-- vuelta: al terminar el loop sorteado empieza otra vez -->
        <path :d="`M ${MX} ${LAST.y + LAST.h / 2} H ${MX - 12} V ${STEPS[0].y + STEPS[0].h / 2} H ${MX - 2}`"
          class="arrow back" marker-end="url(#eng_arrow)" />
      </svg>
    </div>
    <figcaption>
      Lo que decide una pista cada vez que termina un loop (o un descanso). Las pistas no se ponen de acuerdo: cada una
      sortea por su cuenta, y todas caen en el beat.
    </figcaption>
  </figure>

  <h4>Los candidatos</h4>
  <p>Una pista solo sortea entre los archivos que cumplen todo esto:</p>
  <ul>
    <li>Son de esa pista (un archivo sin pista nunca suena).</li>
    <li>Tienen el Tag que está sonando, <b>o no tienen ningún Tag</b> (esos valen para todos).</li>
    <li>
      Entran en la <Term t="tolerance">tolerancia de tempo</Term>: no hace falta estirarlos más que lo que dice
      <Ui>Tol</Ui>. Looper prueba cada loop a su tempo, al doble y a la mitad, y usa el que menos lo estira.
    </li>
    <li>Tienen peso mayor que 0.</li>
    <li>
      Son loops: los <Term t="one_shot">one-shots</Term> solo los tocan las pistas en modo <Ui>SHOT</Ui> (ver abajo).
    </li>
  </ul>
  <p>
    Entre los candidatos, cada archivo tiene tantas chances como su peso (16 por defecto; se cambia en el editor con
    <Ui>Weight</Ui>). Puede salir el mismo que acaba de sonar. Al salir, se sortea también cuántas
    <Term t="repeat">vueltas seguidas</Term> va a dar, dentro de su rango <Ui>Repeat</Ui> (una, por defecto): mientras le queden, la pista lo vuelve a tocar sin
    sortear. Los dos se ajustan en
    <a href="#editor_level" @click.prevent="go('editor_level')">Volumen, loudness, Weight y Repeat</a>.
  </p>
  <p>
    Si no queda ningún candidato, la pista se calla hasta que vuelva a haber alguno: con el próximo Tag, otro tempo u
    otra tolerancia.
  </p>

  <h4>Descansos</h4>
  <p>
    Una pista que nunca para cansa. Con los controles de descanso de su tira, de vez en cuando se calla unos compases
    (un <Term t="rest">descanso</Term>), y la música respira:
  </p>
  <ManualShot src="/manual/strips.webp" :max_width="420"
    alt="Tiras Lead (modo loop) e Impacts (modo one-shot) con sus controles de descanso y de disparo" :callouts="[
      { n: 1, x: 6, y: 51.6,
        text: 'Rest: la chance de descansar al terminar cada loop (0 a 100 %). Again: la de encadenar otro descanso al terminar uno.' },
      { n: 2, x: 8, y: 59.3, text: 'Cuánto dura cada descanso: 4, 8, 16 o 32 compases. Elegí un valor o arrastrá un rango.' },
      { n: 3, x: 90, y: 9.7, text: 'LOOP / SHOT: cambia el modo de la pista.' },
      { n: 4, x: 96, y: 51.6, text: 'Bars: cada cuántos compases tira el dado. Dens: la chance de disparar en cada tirada.' },
      { n: 5, x: 56.8, y: 59.3, text: 'Scat: la chance de que el disparo caiga en un beat al azar de esos compases en vez del primero.' },
      { n: 6, x: 95, y: 63, text: 'TAG: dispara además al empezar cada Tag (con el LED rojo encendido).' },
    ]" />
  <ul>
    <li>
      <Ui>Rest</Ui> es la chance de descansar cada vez que termina un loop. En 0 (todo a la izquierda) la pista nunca
      descansa, y los otros controles de descanso quedan apagados.
    </li>
    <li>
      Cuánto dura el descanso se elige con los pads <Ui>4</Ui> <Ui>8</Ui> <Ui>16</Ui> <Ui>32</Ui> (en compases), igual que
      los de <Ui>Tag change</Ui>: si marcás un rango, cada descanso sortea un valor de ahí.
    </li>
    <li>
      <Ui>Again</Ui> es la chance de que, al terminar un descanso, venga otro (más largo en total). Mientras no lo
      toques vale lo mismo que <Ui>Rest</Ui>. Llega como mucho a 90 %: siempre queda chance de que la pista vuelva.
    </li>
    <li>
      Al dar <Ui>START</Ui> o <Ui>RESET</Ui> cada pista también tira el dado, así no arrancan siempre todas juntas.
      Si salen todas en descanso, una al azar arranca igual.
    </li>
  </ul>
  <p>
    Un descanso dura compases enteros, así que la pista vuelve justo en el comienzo de un compás. En la tira, el
    display dice <Ui>REST</Ui> y cuenta los compases que faltan.
  </p>

  <h4>3 · Cuando cambia el Tag</h4>
  <p>En el beat en que entra el Tag nuevo, cada pista mira el archivo que está tocando:</p>
  <ul>
    <li><b>Si tiene el Tag nuevo</b>, sigue sonando como si nada (con las vueltas que le queden).</li>
    <li><b>Si no lo tiene</b>, se corta justo en ese beat y la pista sortea entre los candidatos del Tag nuevo.</li>
    <li><b>Si no tiene Tags</b>, nunca se corta: vale para todos.</li>
    <li>Una pista que está descansando termina su descanso y después sortea con el Tag nuevo.</li>
    <li>Si el sorteo repitió el mismo Tag, no se corta nada.</li>
  </ul>
  <Note title="Ideas para usar los Tags">
    <p>
      Un loop con dos Tags (por ejemplo <i>Groove</i> y <i>Breakdown</i>) hace de puente: sigue sonando en el cambio y
      la transición queda más suave. Un archivo sin Tags, como el bombo, está siempre. Y una pista sin ningún archivo
      con cierto Tag se calla en esa sección: así se arma un <i>breakdown</i> sin batería.
    </p>
  </Note>

  <h4>4 · Pistas de one-shots</h4>
  <p>
    El botón <Ui>LOOP</Ui> de la tira pasa la pista a modo <Ui>SHOT</Ui> (LED amarillo). Una pista así no encadena
    loops: de vez en cuando dispara un sonido suelto, que suena entero una vez (impactos, platillos, efectos). Cuándo
    dispara lo deciden sus controles:
  </p>
  <ul>
    <li>
      <Ui>Bars</Ui>: cada cuántos compases tira el dado (1, 2, 4, 8, 16, 32 o 64). Los compases se cuentan desde el
      START, así que con 8 el disparo cae siempre al comienzo de una vuelta de 8 compases.
    </li>
    <li><Ui>Dens</Ui> (densidad): la chance de disparar en cada tirada. En 0 no dispara nunca por esta vía.</li>
    <li>
      <Ui>Scat</Ui> (dispersión): la chance de que ese disparo caiga en un beat al azar dentro de esos compases, en vez
      de en el primero. En 0, siempre en el primero.
    </li>
    <li>
      <Ui>TAG</Ui>: con el LED rojo encendido, dispara además cada vez que empieza un Tag (también al dar START y cuando
      el sorteo repite el mismo Tag). Ideal para un impacto que marque el cambio de sección.
    </li>
  </ul>
  <p>
    El sonido se sortea igual que en las otras pistas (candidatos del Tag activo, según su peso), pero acá entran los
    one-shots y también los loops que caigan en la tolerancia. El cambio de Tag no corta un disparo, y si el mismo
    archivo todavía está sonando, ese disparo se saltea. En el display de la tira se lee <Ui>Bars</Ui> con el rótulo
    <Ui>SHOT</Ui>, el LED destella con cada disparo y abajo queda el nombre del último.
  </p>
  <p>
    Los sonidos con algo antes del golpe (una subida, un <i>riser</i>) pueden arrancar antes para que el golpe caiga
    justo en el beat o en el cambio de Tag: se ajusta con su <Term t="anchor">anchor</Term>, en el editor (ver
    <a href="#editor" @click.prevent="go('editor')">El editor de un vistazo</a>).
  </p>
  <Note type="warn" title="Los cambios valen desde el próximo sorteo">
    <p>
      Pesos, Tags, tolerancia, descansos y modo de la pista se pueden tocar con el proyecto sonando: el motor los mira en
      cada sorteo. Lo que ya está sonando termina su vuelta (o su descanso) como estaba.
    </p>
  </Note>
</template>

<script setup>
import { useRouter } from "vue-router"
import ManualShot from "../ManualShot.vue"
import Note from "../Note.vue"
import Term from "../Term.vue"
import Ui from "../Ui.vue"
import { go_anchor } from "../nav"

const router = useRouter()
const go = id => go_anchor(router, id)

// chances de los Tags del proyecto de demo (peso / suma de los pesos)
const ODDS = [
  { name: "Groove 4/4", weight: 16, color: "#39e30b" },
  { name: "Triplet", weight: 12, color: "#928af5" },
  { name: "Breakdown", weight: 6, color: "#4fb6e8" },
]
const ODDS_TOTAL = ODDS.reduce((s, t) => s + t.weight, 0)
const pct = w => Math.round(100 * w / ODDS_TOTAL)

// geometría del diagrama (unidades del viewBox): columna principal (MX, MW) y salidas a la derecha (OX, OW)
const W = 640
const MX = 28
const MW = 310
const OX = 400
const OW = 226
// pasos de la columna principal; no = rótulo de la flecha hacia abajo; out = salida a la derecha
const STEPS = [
  { id: "end", y: 14, h: 30, lcd: true, lines: ["Termina el loop (o el descanso)"] },
  { id: "repeat", y: 72, h: 30, no: "no", lines: ["¿Le quedan vueltas? (Repeat)"],
    out: { label: "sí", lines: ["Vuelve a tocar el mismo loop"] } },
  { id: "rest", y: 130, h: 44, no: "no sale", lines: ["Dado de descanso: Rest", "(si venía de un descanso: Again)"],
    out: { label: "sale", lines: ["Descansa: 4, 8, 16 o 32", "compases (pads de la tira)"] } },
  { id: "candidates", y: 202, h: 74, no: "hay",
    lines: ["Candidatos: los archivos de la pista", "· con el Tag activo o sin Tags", "· dentro de la tolerancia de tempo",
      "· con peso mayor que 0"],
    out:{ label: "ninguno", lines: ["La pista se calla hasta", "que haya alguno"] } },
  { id: "pick", y: 304, h: 44, lines: ["Sortea uno según su peso (Weight)", "y cuántas vueltas da (Repeat)"] },
  { id: "play", y: 376, h: 30, lcd: true, lines: ["Lo toca hasta su último beat"] },
]
const LAST = STEPS[STEPS.length - 1]
const H = LAST.y + LAST.h + 16
</script>

<style scoped>
/* barra de chances de los Tags */
.odds {
  display: flex;
  gap: 2px;
  margin: 10px 0 14px;
  border: 3px solid #0b0b0c;
  border-radius: 6px;
  overflow: hidden;
}

.odd {
  flex-basis: 0;
  min-width: 0;
  padding: 6px 8px;
  color: #111;
  font-family: var(--font_mono);
  font-size: 12px;
  line-height: 1.3;
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}

.odd_name {
  display: block;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.odd_pct {
  display: block;
  font-size: 11px;
}

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
  min-width: 520px;
  height: auto;
  font-family: var(--font_mono);
}

.screen {
  fill: var(--panel);
}

.box {
  fill: var(--hw_chassis_dark);
  stroke: var(--border);
}

.lcd_box {
  fill: var(--hw_lcd_bg);
  stroke: #0b0b0c;
  stroke-width: 2;
}

.out_box {
  fill: none;
  stroke: var(--muted);
  stroke-dasharray: 4 3;
}

.box_text {
  fill: var(--text);
  font-size: 12px;
}

.lcd_text {
  fill: var(--hw_lcd_ink);
  font-size: 12px;
  font-weight: 700;
}

.out_text {
  fill: var(--muted);
  font-size: 11px;
}

.arrow {
  fill: none;
  stroke: var(--hw_silk);
  stroke-width: 1.5;
}

.arrow.back {
  stroke-dasharray: 5 4;
}

.arrow_head {
  fill: var(--hw_silk);
}

.arrow_text {
  fill: var(--hw_yellow);
  font-size: 11px;
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
