<template>
  <!-- sección "Delay, reverb y COMP del master" (id y título en ../sections.js): delay global (TYPE, TIME, Feedback,
    Level), reverb por convolución (impulsos con ◀ ▶, Level), envíos Rev / Dly de las tiras, dinámica del master (COMP,
    GLUE, LOW / MID / HIGH y sus LEDs, limitador) y qué se guarda (components/Tracks.vue, helpers/TrackCtrl.js,
    mixer.js, master_dsp.js; docs/ARCHITECTURE.md "Dinámica del master"). Capturas: tomas "global_fx" y "master_comp"
    de scripts/manual_shots.js -->
  <p>
    Un proyecto tiene <b>un</b> delay y <b>una</b> reverb, compartidos por todas las pistas, y una etapa de dinámica a
    la salida. Se ajustan en el panel <Ui>Transport</Ui>; cada pista decide cuánto les manda con sus knobs <Ui>Rev</Ui>
    y <Ui>Dly</Ui>. Compartirlos hace que todo suene en el mismo "lugar", y es más liviano que un efecto por pista.
  </p>
  <ManualShot src="/manual_shots/global_fx.webp" :max_width="760"
    alt="Grupos Delay (PING 1/8., TYPE, TIME, Feedback, Level) y Reverb (ROOM XL, flechas, Level) del panel Transport"
    caption="El delay y la reverb del proyecto de demo" :callouts="[
      { n: 1, x: 4.8, y: 46.9, text: 'El tipo de delay y su tiempo.' },
      { n: 2, x: 3.3, y: 74.4, text: 'TYPE y TIME: pasan al siguiente.' },
      { n: 3, x: 39.3, y: 31.9, text: 'Feedback: cuántas repeticiones.' },
      { n: 4, x: 51.9, y: 31.9, text: 'Level: el volumen de los ecos.' },
      { n: 5, x: 60.5, y: 46.9, text: 'La sala de la reverb.' },
      { n: 6, x: 81.5, y: 74.4, text: '◀ ▶: la sala anterior o la siguiente.' },
      { n: 7, x: 92.6, y: 31.9, text: 'Level: el volumen de la reverb.' },
    ]" />

  <h4>Delay</h4>
  <p>
    El delay repite lo que le llega, como un eco, siempre a tempo: si cambiás el tempo del proyecto, los ecos lo siguen.
    El display dice el tipo y el tiempo (<i>PING 1/8.</i>).
  </p>
  <ul>
    <li>
      <Ui>TYPE</Ui> pasa por los cuatro tipos:
      <ul>
        <li><Ui>PING</Ui>: ping-pong, los ecos saltan de izquierda a derecha. Abre mucho la mezcla.</li>
        <li><Ui>STEREO</Ui>: el mismo eco de los dos lados, más centrado y discreto.</li>
        <li>
          <Ui>DOTTED</Ui>: a la izquierda con el tiempo elegido y a la derecha una vez y media más largo; los ecos se
          cruzan y forman un ritmo galopante.
        </li>
        <li><Ui>TAPE</Ui>: cada repetición sale más oscura que la anterior, como los ecos de cinta.</li>
      </ul>
      Al cambiar de tipo, los ecos que venían sonando se apagan en un instante.
    </li>
    <li>
      <Ui>TIME</Ui> pasa por los tiempos, en figuras musicales: <Ui>1/16</Ui>, <Ui>1/8T</Ui> (tresillo), <Ui>1/8</Ui>,
      <Ui>1/8.</Ui> (con puntillo: tres semicorcheas), <Ui>1/4</Ui> (un beat), <Ui>1/4.</Ui> y <Ui>1/2</Ui> (dos beats).
      El <Ui>1/8.</Ui> es el clásico del trance: los ecos caen entre los golpes y se entrelazan con el ritmo.
    </li>
    <li>
      <Ui>Feedback</Ui>: cuánto de cada eco vuelve a entrar, de 0 a 90 %. Poco, dos o tres repeticiones; mucho, una cola
      larga. Nunca llega a 100 %, así que los ecos siempre terminan apagándose.
    </li>
    <li><Ui>Level</Ui>: el volumen con que vuelven los ecos a la mezcla, de −24 a +6 dB.</li>
  </ul>
  <p>Un proyecto nuevo arranca con <i>PING 1/8.</i>, feedback 40 % y level 0 dB.</p>

  <h4>Reverb</h4>
  <p>
    La reverb pone las pistas en un espacio. Looper usa grabaciones de espacios reales (salas, placas de reverb,
    lugares enormes) y las aplica al sonido. Con <Ui>◀</Ui> y <Ui>▶</Ui> pasás por las 17 que hay, en este orden (después
    de la última vuelve a la primera):
  </p>
  <ul>
    <li><Ui>PLATE DRY</Ui>, <Ui>PLATE S</Ui>, <Ui>PLATE M</Ui>, <Ui>PLATE L</Ui>: placas, brillantes y densas; quedan bien en sintes, cajas y percusión.</li>
    <li><Ui>PRIME S</Ui>, <Ui>PRIME M</Ui>, <Ui>PRIME L</Ui>, <Ui>PRIME XL</Ui>: reverbs de estudio, de corta a muy larga.</li>
    <li><Ui>ROOM M</Ui>, <Ui>HALL</Ui>, <Ui>ROOM L</Ui>, <Ui>ROOM XL</Ui>: salas, más naturales.</li>
    <li>
      <Ui>POOL</Ui>, <Ui>HANGAR</Ui>, <Ui>BLASTOFF</Ui>, <Ui>STADIUM</Ui>, <Ui>AIRPORT</Ui>: lugares enormes, con colas
      de varios segundos (la de AIRPORT pasa de 15).
    </li>
  </ul>
  <p>
    Con el mouse sobre el display se ve cuánto dura la cola de la sala elegida. La primera vez que elegís una se
    descarga (un momento); mientras tanto sigue la anterior, y su cola se apaga sola. <Ui>Level</Ui> es el volumen de
    la reverb en la mezcla, de −24 a +6 dB. Un proyecto nuevo arranca con <i>ROOM XL</i> y level 0 dB.
  </p>

  <h4>Cuánto manda cada pista</h4>
  <p>
    En cada tira del mixer, <Ui>Rev</Ui> y <Ui>Dly</Ui> deciden cuánto de esa pista llega a la reverb y al delay: todo a
    la izquierda no manda nada (así arranca una pista nueva), todo a la derecha manda la pista entera. Lo que se manda
    sale después del fader, así que al bajar una pista o callarla con <Ui>M</Ui> también se apaga lo que mandaba (la cola
    que ya estaba sonando termina sola). Ver <a href="#mixer" @click.prevent="go('mixer')">Mixer</a>.
  </p>
  <Note title="Poca reverb en los graves">
    <p>
      Una regla que casi siempre funciona: bombo y bajo secos (Rev y Dly a cero) y la reverb y el delay en lo que tiene
      aire (sintes, percusión, golpes sueltos). Los graves con reverb ensucian toda la mezcla. Si querés un eco puntual
      en el bajo, mejor un ECHO THROW al final de su loop (ver
      <a href="#fx" @click.prevent="go('fx')">FX de transición</a>).
    </p>
  </Note>

  <h4>La dinámica del master: COMP</h4>
  <ManualShot src="/manual_shots/master_comp.webp" :max_width="640"
    alt="Knob Master, botón COMP encendido (Dynamics), knob Glue y las bandas Low, Mid y High con sus LEDs; Low y Mid encendidos en amarillo"
    caption="COMP encendido, comprimiendo los graves y los medios (LEDs amarillos)" :callouts="[
      { n: 1, x: 7.5, y: 24.5, to: 'mixer', text: 'Master: el volumen de todo.' },
      { n: 2, x: 31.5, y: 64.3, text: 'COMP: prende o apaga el compresor.' },
      { n: 3, x: 61.3, y: 67.3, text: 'Glue: cuánto comprime.' },
      { n: 4, x: 62.5, y: 21.4, text: 'Un LED por banda: se enciende cuando esa banda se está bajando.' },
      { n: 5, x: 92.9, y: 67.3, text: 'Low, Mid y High: el balance de graves, medios y agudos.' },
    ]" />
  <p>
    Un compresor es como una mano en el volumen que baja un poco los momentos más fuertes. La mezcla queda más pareja y
    compacta: las pistas dejan de sonar cada una por su lado y suenan como una sola pieza (de ahí el nombre del knob,
    <i>glue</i>, "pegamento"). El de Looper trabaja en tres bandas por separado: <b>graves</b> (bombo y bajo, debajo de
    unos 120 Hz), <b>medios</b> y <b>agudos</b> (platillos, brillo, arriba de unos 3000 Hz). Así un bombo fuerte no le
    baja el volumen a los platillos.
  </p>
  <ul>
    <li>
      <Ui>COMP</Ui> (<Ui>Dynamics</Ui>) lo prende (LED verde) o lo apaga. Apagado, los knobs se ven atenuados, pero se
      pueden ajustar igual y se guardan. Un proyecto nuevo arranca con COMP apagado.
    </li>
    <li>
      <Ui>Glue</Ui>, de 0 a 100 % (50 % de fábrica): cuánto comprime. Más glue, mezcla más densa y pareja, pero con
      menos golpe; demasiado, y se la oye "respirar" (el volumen sube y baja con el bombo). Además sube un poco el volumen
      general (hasta unos 4 dB con todo el recorrido): al comparar prendido y apagado, lo más fuerte siempre parece mejor,
      así que compará con cuidado.
    </li>
    <li>
      <Ui>Low</Ui>, <Ui>Mid</Ui> y <Ui>High</Ui>, de −6 a +6 dB: suben o bajan cada banda después de comprimirla, como
      un ecualizador simple (más graves, menos brillo). No cambian cuánto comprime.
    </li>
    <li>
      Los LEDs sobre cada banda muestran cuánto la está bajando el compresor: amarillo cuando baja más de 1 dB, rojo
      cuando baja más de 6. Unos destellos amarillos con los golpes es lo normal; rojo fijo es demasiado.
    </li>
  </ul>
  <Note type="warn" title="El knob Master también cuenta">
    <p>
      El compresor reacciona a lo que le llega, y el <Ui>Master</Ui> está antes que él: si subís el Master o las pistas,
      comprime más; con una mezcla suave casi no actúa, aunque Glue esté alto. Mirá los LEDs para saber si está
      trabajando.
    </p>
  </Note>
  <p>
    Al final de todo, con COMP prendido o apagado, está siempre el <Term t="limiter">limitador</Term>, que no deja que
    la salida distorsione; su LED <Ui>LIM</Ui> está en la barra de arriba (ver
    <a href="#mixer" @click.prevent="go('mixer')">Mixer</a>). Si el botón COMP aparece deshabilitado y con el mouse
    encima dice <i>Requires a secure context (https)</i>, la página se abrió de una forma en que el navegador no permite
    el compresor: suena solo un limitador más simple.
  </p>

  <h4>Qué se guarda</h4>
  <p>
    Todo esto es parte del proyecto y se guarda solo: el delay (tipo, tiempo, feedback y level), la reverb (sala y
    level), el Master y COMP (encendido, Glue y las tres bandas); y en cada pista, sus <Ui>Rev</Ui> y <Ui>Dly</Ui>. En un
    proyecto ajeno (en modo lectura) el delay, la reverb, COMP y los knobs Rev y Dly no se ven, pero el proyecto suena
    con los ajustes de su dueño.
  </p>
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
</script>
