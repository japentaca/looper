<template>
  <!-- sección "Tocar" (id y título en ../sections.js): START/STOP, RESET, tempo y Tol, Time sig, posición, Tag actual y
    cuenta regresiva, rango de cambio de Tag; displays de las tiras (components/Tracks.vue, hw/RangePads.vue).
    Capturas: tomas "transport" y "strips" de scripts/manual_shots.js -->
  <p>
    El panel <Ui>Transport</Ui>, arriba del mixer, es donde se toca: arranca y para el
    <Term t="project">proyecto</Term>, fija el tempo y dice qué <Term t="tag">Tag</Term> está sonando y cuánto le
    falta. Todo lo que cambies acá se guarda con el proyecto (salvo en un proyecto ajeno, que se abre en modo lectura).
  </p>
  <ManualShot src="/manual_shots/transport.webp" alt="Panel Transport con el proyecto de demo sonando, a tres beats de un cambio de Tag"
    caption="El proyecto de demo sonando: faltan 3 beats para que termine Breakdown y el LED CHANGE destella" :callouts="[
      { n: 1, x: 3, y: 11, text: 'START / STOP: arranca y para todo.' },
      { n: 2, x: 19.5, y: 18, text: 'RESET (New tag): cambia de Tag en el acto.' },
      { n: 3, x: 28, y: 11, text: 'Tempo: la perilla y su display, en BPM.' },
      { n: 4, x: 47.6, y: 13, text: 'Tol: la tolerancia de tempo, en %.' },
      { n: 5, x: 62.8, y: 12, text: 'Bar . beat: la posición, en compás.beat.' },
      { n: 6, x: 73.5, y: 13, text: 'Time sig: compás de 3/4 o de 4/4.' },
      { n: 7, x: 66.3, y: 39.5, text: 'Tag change: entre cuántos beats dura cada Tag.' },
      { n: 8, x: 32.5, y: 74, text: 'Current tag: el Tag que suena, los beats que le quedan y su duración.' },
      { n: 9, x: 38, y: 80, text: 'Change: destella en los últimos 4 beats antes del cambio.' },
      { n: 10, x: 47.5, y: 74, to: 'mixer', text: 'Master: el volumen de todo.' },
      { n: 11, x: 2.3, y: 42.8, to: 'global_fx', text: 'Delay, Reverb y la dinámica del master (COMP).' },
    ]" />

  <h4>START, STOP y RESET</h4>
  <ul>
    <li>
      <Ui>START</Ui> se habilita cuando terminaron de cargar los audios (el LED de la barra de arriba dice
      <i>Ready</i>). Cada START empieza de cero: la posición vuelve a 1.1 y se sortea un Tag nuevo.
    </li>
    <li><Ui>STOP</Ui> (el mismo botón) corta todo en el acto.</li>
    <li>
      <Ui>RESET</Ui> (<i>New tag</i>) sortea otro Tag sin esperar a que termine el actual: los loops y los
      <Term t="rest">descansos</Term> se cortan ahí mismo y cada pista vuelve a sortear. Los
      <Term t="one_shot">one-shots</Term> que estén sonando terminan solos. Puede volver a salir el mismo Tag.
    </li>
  </ul>
  <Note type="warn" title="Si no suena">
    <p>
      Los navegadores no dejan sonar una página que todavía no tocaste. Si aparece un botón grande con
      <Ui>Click to start</Ui>, hacé clic en cualquier parte. Si suena pero alguna pista no, mirá la tolerancia (abajo) y
      <a href="#engine" @click.prevent="go('engine')">Cómo elige el motor</a>.
    </p>
  </Note>

  <h4>Tempo y tolerancia</h4>
  <ul>
    <li>
      <Ui>Tempo</Ui> va de 10 a 160 <Term t="bpm">BPM</Term>. El display cambia mientras girás la perilla; lo que suena,
      recién al soltarla (todo junto, sin perder el beat). Los loops se aceleran o se frenan para seguirlo, y con eso
      suben o bajan un poco de tono.
    </li>
    <li>
      <Ui>Tol</Ui> es la <Term t="tolerance">tolerancia de tempo</Term>, de 0 a 12 % (6 por defecto): cuánto se puede
      estirar un loop. Los que necesitarían más no se sortean y aparecen en <Ui>Files</Ui> como
      <Ui>out of tempo</Ui>. Con el mouse encima de la perilla se ve cuántos quedan afuera.
    </li>
  </ul>
  <p>
    Si alejás mucho el tempo del de tus loops, las pistas se van callando: subí <Ui>Tol</Ui> (suenan más estirados) o
    volvé a un tempo cercano. Los cambios de tolerancia valen desde el próximo sorteo: lo que está sonando termina su
    vuelta.
  </p>

  <h4>Posición y compás</h4>
  <p>
    El display <Ui>Bar . beat</Ui> cuenta desde el START en <Term t="bar">compás</Term>.<Term t="beat">beat</Term>:
    <Ui lcd>6.3</Ui> es el tercer beat del compás 6. <Ui>Time sig</Ui> elige compases de 3 o de 4 beats; cambia cómo se
    cuentan los compases (la posición, los descansos, las frases de los one-shots), no el largo de los loops, que se
    mide en beats. Conviene cambiarlo con el transporte detenido.
  </p>

  <h4>El Tag actual y la cuenta regresiva</h4>
  <p>
    El display <Ui>Current tag</Ui> muestra el nombre y el color del Tag que suena, los beats que le quedan (cuenta
    para atrás) y cuánto dura en total, por ejemplo <Ui lcd>42</Ui> <Ui>/64 BEATS</Ui>. En los últimos 4 beats destella el
    LED <Ui>Change</Ui>: el Tag está por cambiar. Además, en la barra de la izquierda queda encendido el pad del Tag
    activo.
  </p>

  <h4>Cada cuánto cambia el Tag</h4>
  <p>
    Los pads <Ui>Tag change</Ui> marcan entre cuántos beats puede durar cada Tag: 32, 64, 128, 256 o 512. En cada
    cambio, Looper elige al azar uno de los valores del rango (todos con la misma chance). Los extremos del rango se
    ven en rojo y los del medio en verde. Probalo acá:
  </p>
  <div class="hw_panel try">
    <div class="hw_plate">
      <span class="silk">Tag change</span>
      <RangePads v-model="range" :options="RANGE_OPTIONS" />
      <span class="silk">{{ 2 ** range[0] }}–{{ 2 ** range[1] }} beats</span>
    </div>
    <ul class="how">
      <li>Un <b>clic</b> en un pad: siempre ese largo.</li>
      <li><b>Arrastrá</b> de un pad a otro: un rango.</li>
      <li><Kbd>Shift</Kbd> + clic: lleva hasta ahí el extremo más cercano.</li>
      <li>
        A 138 BPM, 32 beats son unos 14 segundos y 512, casi 4 minutos. Con rangos cortos la música cambia seguido;
        con largos, cada sección tiene tiempo de desarrollarse.
      </li>
    </ul>
  </div>

  <h4>Qué muestra cada tira</h4>
  <p>Mientras suena, cada tira del mixer cuenta qué está haciendo su pista:</p>
  <ManualShot src="/manual_shots/strips.webp" :max_width="420"
    alt="Dos tiras del mixer: Lead tocando un loop de 32 beats e Impacts, una pista de one-shots"
    caption="Lead (loop) en el beat 11 de 32; Impacts (one-shot) tira el dado cada 4 compases" :callouts="[
      { n: 1, x: 10, y: 9.7, to: 'engine', text: 'LOOP o SHOT: el modo de la pista (loops encadenados o golpes sueltos).' },
      { n: 2, x: 17, y: 13.2, text: 'Destella con cada beat (en rojo cuando el loop vuelve a empezar); en una pista SHOT, con cada disparo.' },
      { n: 3, x: 14, y: 25, to: 'mixer', text: 'Vúmetro: el nivel de la pista.' },
      { n: 4, x: 9.5, y: 38.9,
        text: 'En qué beat del loop va, sobre su largo. Arriba, en chiquito, la vuelta si el loop se repite (2/4). En un descanso dice REST y cuenta los compases que faltan.' },
      { n: 5, x: 5, y: 44.2, text: 'El avance dentro del loop, en LEDs.' },
      { n: 6, x: 47.5, y: 46.9, text: 'El archivo que suena (en SHOT, el último disparo). Con un clic se abre en el editor.' },
      { n: 7, x: 90, y: 38.9, text: 'En una pista SHOT, cada cuántos compases tira el dado para disparar.' },
    ]" />
  <p>
    Los controles de abajo de cada tira (descansos, disparos, volumen y efectos) se explican en
    <a href="#engine" @click.prevent="go('engine')">Cómo elige el motor</a> y en
    <a href="#mixer" @click.prevent="go('mixer')">Mixer</a>.
  </p>
</template>

<script setup>
import { ref } from "vue"
import { useRouter } from "vue-router"
import ManualShot from "../ManualShot.vue"
import Note from "../Note.vue"
import Term from "../Term.vue"
import Ui from "../Ui.vue"
import Kbd from "../Kbd.vue"
import RangePads from "../../components/hw/RangePads.vue"
import { go_anchor } from "../nav"

const router = useRouter()
const go = id => go_anchor(router, id)

// pads de prueba (exponentes de 2^n beats, como los del transporte): solo un valor local
const RANGE_OPTIONS = [5, 6, 7, 8, 9].map(n => ({ value: n, label: 2 ** n }))
const range = ref([5, 6])
</script>

<style scoped>
.try {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 18px 28px;
  margin: 12px 0;
  padding: 18px 24px;
}

.how {
  flex: 1 1 260px;
  margin: 0;
  color: var(--hw_silk);
  font-size: 13px;
}

@media print {
  .try {
    background: none;
    box-shadow: none;
    border: 1px solid #999;
  }

  .how {
    color: #111;
  }
}
</style>
