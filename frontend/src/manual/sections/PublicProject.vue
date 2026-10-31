<template>
  <!-- sección "Proyecto público" (id y título en ../sections.js): link con PLAY y diálogo de carga, START/STOP, RESET,
    tempo y Tol, master, mixer local que no se guarda (views/PublicProject.vue, LoadingDialog.vue, Tracks.vue con
    store.read_only). Capturas: tomas "public_play" y "public_project" de scripts/manual_shots.js -->
  <p>
    Un proyecto público se abre en <b>modo lectura</b>: lo escuchás con el mismo motor que usa su creador y podés
    tocar el transporte y el mixer, pero no cambiar el proyecto. No hace falta cuenta. Hay dos maneras de llegar:
  </p>
  <ul>
    <li>Desde la <a href="#gallery" @click.prevent="go('gallery')">galería</a>, con un clic en su tarjeta.</li>
    <li>
      Con un link que te pasaron: el botón <Ui>LINK</Ui> de la app copia el link del proyecto abierto, que termina en
      <code>?play=1</code>.
    </li>
  </ul>

  <h4>La carga y el PLAY</h4>
  <p>
    Primero se bajan todos los audios. Mientras tanto aparece un anillo de LEDs que se van encendiendo en verde a
    medida que llegan los archivos; uno amarillo gira encima para mostrar que sigue trabajando. Abajo están el nombre
    del proyecto, cuántos archivos van cargados y la RAM que ocupa.
  </p>
  <ManualShot src="/manual/public_play.webp" :max_width="520"
    alt="Diálogo de carga terminado: anillo de LEDs completo en verde, 100 % y los botones CLOSE y PLAY"
    caption="Con un link de LINK, al terminar la carga el diálogo queda esperando el PLAY" />
  <ul>
    <li>
      Si llegaste con un link de <Ui>LINK</Ui>, al terminar queda armado: apretá <Ui>PLAY</Ui> y empieza a sonar.
      <Ui>CLOSE</Ui> lo cierra sin tocar (después podés usar <Ui>START</Ui>).
    </li>
    <li>Si llegaste desde la galería, el diálogo se cierra solo al terminar: apretá <Ui>START</Ui>.</li>
  </ul>
  <Note type="warn" title="¿Por qué hay que hacer clic?">
    <p>
      Los navegadores no dejan que una página suene sin que la toques primero. Por eso el PLAY no es automático. Si
      alguna vez ves un botón grande con <Ui>Click to start</Ui> encima de todo, hacé clic en cualquier parte y sigue.
    </p>
  </Note>

  <h4>Qué ves y qué podés tocar</h4>
  <ManualShot src="/manual/public_project.webp" alt="Vista de un proyecto público sonando, en modo lectura"
    caption="El proyecto de demo sonando en modo lectura" :callouts="[
      { n: 1, x: 37.7, y: 1.1, text: 'Nombre del proyecto. READ ONLY: estás en modo lectura.' },
      { n: 2, x: 46.7, y: 2.7, text: 'Estado: Loading (amarillo, con los archivos cargados sobre el total) o Ready (verde).' },
      { n: 3, x: 70.4, y: 8, text: 'Quién lo hizo y su presentación, cuántos loops tiene, la RAM y sus Tags.' },
      { n: 4, x: 21.9, y: 26.2, text: 'START / STOP y RESET. Abajo, la posición en compás.beat.' },
      { n: 5, x: 50.7, y: 26.1, text: 'Tempo (en BPM) y tolerancia (Tol).' },
      { n: 6, x: 39.1, y: 35.7,
        text: 'Current tag: el Tag que suena y los beats que le quedan. El LED Change parpadea en los últimos 4.' },
      { n: 7, x: 49.3, y: 35.4, text: 'Master: el volumen de todo.' },
      { n: 8, x: 12.7, y: 80.9, text: 'Fader de volumen de la pista.' },
      { n: 9, x: 12.9, y: 94.2, text: 'M (mute) y S (solo) de la pista.' },
    ]" />
  <ul>
    <li>
      <Ui>START</Ui> / <Ui>STOP</Ui> arranca y detiene todo. Cada START empieza de cero, con un Tag sorteado de nuevo.
    </li>
    <li>
      <Ui>RESET</Ui> (<i>New tag</i>) cambia de <Term t="tag">Tag</Term> en el acto, sin esperar a que se termine el
      actual: todas las pistas cortan y vuelven a sortear.
    </li>
    <li>
      <Ui>Tempo</Ui> cambia la velocidad, de 10 a 160 <Term t="bpm">BPM</Term> (el número se lee en el display; lo que
      suena cambia al soltar la perilla). Los loops se aceleran o se frenan, y con eso también suben o bajan un poco de
      tono.
    </li>
    <li>
      <Ui>Tol</Ui> es la <Term t="tolerance">tolerancia de tempo</Term>: cuánto se puede estirar un loop, en %. Si
      llevás el tempo muy lejos del original del proyecto, los loops que no entran en la tolerancia dejan de salir en
      los sorteos y esas pistas se van callando. Subí la tolerancia para que vuelvan (sonando más estirados).
    </li>
    <li><Ui>Master</Ui> es el volumen de toda la mezcla.</li>
    <li>
      En cada pista: el fader <Ui>Vol</Ui>, <Ui>M</Ui> para silenciarla y <Ui>S</Ui> para escuchar solo esa (podés
      poner varias en solo).
    </li>
  </ul>
  <p>
    El resto es para mirar. En cada tira, el LED de arriba destella con cada <Term t="beat">beat</Term> (en rojo
    cuando el loop vuelve a empezar), el vúmetro muestra el nivel, el display dice en qué beat del loop va sobre su
    largo (arriba, en chiquito, la vuelta si el loop se repite), la fila de LEDs muestra el avance y abajo se lee el
    nombre del archivo. Cuando la pista hace un <Term t="rest">descanso</Term>, el display dice <Ui>REST</Ui> y
    cuenta los compases que faltan. Las pistas <Ui>SHOT</Ui> son de <Term t="one_shot">one-shots</Term>: muestran
    cada cuántos compases tiran el dado para disparar. Los cuadraditos debajo del fader se encienden cuando suena un
    efecto de transición.
  </p>

  <h4>Perillas y faders</h4>
  <p>Todos los controles de Looper funcionan igual. Probalos acá (no suenan):</p>
  <div class="hw_panel try">
    <div class="ctrl">
      <Knob v-model="knob" :min="0" :max="100" label="Knob" />
      <Lcd :value="knob" :digits="3" />
    </div>
    <div class="ctrl">
      <Fader v-model="fader" :min="0" :max="100" :length="96" label="Fader"
        :marks="[{ value: 100, label: '100' }, { value: 50, label: '50' }, { value: 0, label: '0' }]" />
      <Lcd :value="fader" :digits="3" />
    </div>
    <ul class="how">
      <li><b>Arrastrá</b> hacia arriba o hacia abajo (no en círculo). En una perilla, con <Kbd>Shift</Kbd>, más
        fino.</li>
      <li>O usá la <b>rueda del mouse</b> encima del control.</li>
      <li>En un fader, un clic en la ranura lo lleva directo ahí.</li>
      <li>
        Con el teclado: <Kbd>Tab</Kbd> hasta el control y las flechas; en las perillas, <Kbd>RePág</Kbd> /
        <Kbd>AvPág</Kbd> mueven de a diez pasos.
      </li>
    </ul>
  </div>

  <Note title="Nada se guarda">
    <p>
      Lo que cambies (tempo, volúmenes, mutes) vale solo mientras tengas la página abierta. Al recargarla, el proyecto
      vuelve a sonar como lo dejó su creador; nadie más ve tus cambios.
    </p>
  </Note>

  <h4>Con cuenta</h4>
  <p>
    Si entraste con tu cuenta y el proyecto es tuyo, en la barra aparece <Ui>OPEN IN EDITOR</Ui>, que lo abre en la
    app para editarlo. Si es de otra persona, aparece <Ui>REPORT</Ui> para denunciarlo (ver
    <a href="#share" @click.prevent="go('share')">Compartir y denunciar</a>). Para dejar un proyecto sonando solo
    durante horas, en una pantalla o una muestra, mirá el
    <a href="#kiosk" @click.prevent="go('kiosk')">modo instalación</a>.
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
import Knob from "../../components/hw/Knob.vue"
import Fader from "../../components/hw/Fader.vue"
import Lcd from "../../components/hw/Lcd.vue"
import { go_anchor } from "../nav"

const router = useRouter()
const go = id => go_anchor(router, id)

// controles de prueba: solo valores locales (no tocan el motor ni el audio)
const knob = ref(40)
const fader = ref(75)
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

.ctrl {
  display: flex;
  align-items: center;
  gap: 14px;
}

.how {
  flex: 1 1 260px;
  margin: 0;
  color: var(--hw_silk);
  font-size: 13px;
}

code {
  font-family: var(--font_mono);
  color: var(--hw_silk);
}

@media print {
  .try {
    background: none;
    box-shadow: none;
    border: 1px solid #999;
  }

  .how,
  code {
    color: #111;
  }
}
</style>
