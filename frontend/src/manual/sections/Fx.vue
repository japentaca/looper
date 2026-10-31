<template>
  <!-- sección "FX de transición" (id y título en ../sections.js): pads FX de la sidebar, soltar en una tira, chips de
    la tira, cuándo se disparan (anticipación, fin de la tirada, prob, condición), FxDialog y el catálogo de tipos
    (components/FxPad.vue, FxDialog.vue, Tracks.vue; helpers/fx.js FX_TYPES, engine_fx.js, mixer.js fx_schedule).
    Capturas: tomas "fx_pads", "fx_strips" y "fx_dialog" de scripts/manual_shots.js -->
  <p>
    Cuando una pista pasa de un loop a otro, el cambio puede ser seco o puede anunciarse: un filtro que se cierra en los
    últimos compases, un corte justo antes de que entre lo nuevo, un eco que queda sonando. Eso hacen los
    <Term t="fx">FX de transición</Term>: efectos que el motor dispara solo, al final de lo que toca cada pista, con la
    frecuencia que elijas.
  </p>

  <h4>Agregar un FX a una pista</h4>
  <ManualShot src="/manual/fx_pads.webp" :max_width="240"
    alt="Los seis pads de FX de la barra lateral: CUT, LOW-PASS, HIGH-PASS, FADE, ECHO THROW y REVERB THROW"
    caption="Los pads FX, al pie de la barra lateral" />
  <ol>
    <li>Al pie de la barra lateral, debajo de los Tags, están los pads <Ui>FX</Ui>: uno por tipo de efecto.</li>
    <li>
      Arrastrá un pad y soltalo sobre la tira de una pista en el mixer (en cualquier parte de la tira). La pista recibe
      ese efecto con su configuración de fábrica.
    </li>
    <li>Hacé clic en su chip, en la tira, para ajustarlo (ver abajo).</li>
  </ol>
  <p>
    Cada pista admite hasta cuatro FX, y se puede repetir un tipo (dos filtros con distinta anticipación, por ejemplo).
    Se guardan con el proyecto.
  </p>
  <ManualShot src="/manual/fx_strips.webp" :max_width="420"
    alt="Parte de abajo de las tiras Bass y Lead: en Bass, los chips L (encendido), C y E y un zócalo vacío; en Lead, F y R y dos vacíos"
    caption="Bass con LOW-PASS (sonando), CUT y ECHO THROW; Lead con FADE y REVERB THROW" :callouts="[
      { n: 1, x: 3.5, y: 71.6, text: 'Un chip por FX, con su letra. Se enciende en amarillo mientras el efecto actúa.' },
      { n: 2, x: 55, y: 71.6, text: 'Con el mouse encima, el resumen (tipo, anticipación, probabilidad, condición); un clic lo edita.' },
      { n: 3, x: 94, y: 71.6, text: 'Zócalo vacío: lugar para otro FX.' },
    ]" />
  <p>
    En una pista en modo <Ui>SHOT</Ui> los chips se ven atenuados: los FX se conservan pero no suenan (los one-shots no
    tienen un "final de loop" que anunciar). Vuelven a andar si la pasás a <Ui>LOOP</Ui>.
  </p>

  <h4>Cuándo se disparan</h4>
  <p>
    Un FX trabaja sobre la <b>tirada</b> de la pista: desde que sale sorteado un loop hasta que la pista cambia a otra
    cosa, con todas sus vueltas (<Ui>Repeat</Ui>). La tirada termina de una de dos formas:
  </p>
  <ul>
    <li>Sola: en el último beat de su última vuelta (después viene otro loop o un descanso).</li>
    <li>
      Cortada por un cambio de <Term t="tag">Tag</Term>, si el loop no tiene el Tag nuevo. El Tag que viene se sortea de
      antemano, así que Looper sabe con tiempo si va a cortar.
    </li>
  </ul>
  <p>
    El efecto arranca su <b>anticipación</b> (<Ui>Lead</Ui>) antes de ese final y avanza de a poco hasta el último beat;
    justo en el beat en que entra lo siguiente, la pista vuelve a sonar normal. Si la tirada es más corta que la
    anticipación, el efecto arranca con la tirada y llega igual al final. En cada tirada, cada FX tira su dado una sola
    vez: con su probabilidad (<Ui>Prob</Ui>) y su condición (<Ui>When</Ui>) decide si esta vez suena o no.
  </p>
  <p><Ui>STOP</Ui> y <Ui>RESET</Ui> devuelven todas las pistas a la normalidad en el momento.</p>

  <h4>Ajustar un FX</h4>
  <ManualShot src="/manual/fx_dialog.webp" :max_width="560"
    alt="Diálogo Low-pass · Bass: Lead 4M, When TAG CHANGE, Prob 75 %, Freq 300 Hz, Q 1, botones REMOVE y CLOSE"
    caption="Un LOW-PASS en Bass que, 4 compases antes de un cambio de Tag, se dispara 3 de cada 4 veces" :callouts="[
      { n: 1, x: 94.8, y: 20.2, text: 'Lead: cuánto antes del final arranca.' },
      { n: 2, x: 94.8, y: 35.7, text: 'When: en qué finales puede sonar.' },
      { n: 3, x: 17.9, y: 51.2, text: 'Prob: la chance de dispararse en cada tirada.' },
      { n: 4, x: 40.9, y: 51.2, text: 'Los parámetros propios del tipo: acá, Freq, hasta dónde se cierra el filtro...' },
      { n: 5, x: 59.4, y: 51.2, text: '...y Q, su resonancia.' },
      { n: 6, x: 22.4, y: 90.9, text: 'REMOVE: lo saca de la pista.' },
    ]" />
  <p>
    Un clic en el chip abre su diálogo, con el tipo y la pista en el título. Los cambios se guardan solos y valen desde
    la próxima tirada (un efecto que ya está sonando termina como estaba).
  </p>
  <ul>
    <li>
      <Ui>Lead</Ui>: la anticipación. <Ui>1B</Ui> y <Ui>2B</Ui> son beats; <Ui>1M</Ui>, <Ui>2M</Ui>, <Ui>4M</Ui> y
      <Ui>8M</Ui>, compases (de 3 o 4 beats, según <Ui>Time sig</Ui>). Un filtro largo (4M) se siente como una
      preparación; un corte de 1B, como un golpe.
    </li>
    <li>
      <Ui>When</Ui>: <Ui>ANY</Ui> en cualquier final; <Ui>BEFORE REST</Ui> solo si después la pista va a descansar
      (necesita <Ui>Rest</Ui> mayor que 0 en la tira); <Ui>TAG CHANGE</Ui> solo si la tirada termina cortada por un
      cambio de Tag. Con TAG CHANGE el efecto marca las secciones de la música, y no cada vuelta.
    </li>
    <li><Ui>Prob</Ui>: de 0 a 100 %, en pasos de 5. En 100 % suena en todos los finales que cumplan la condición.</li>
  </ul>

  <h4>Los tipos</h4>
  <table class="fx_types">
    <thead>
      <tr><th>Pad</th><th>Qué hace</th><th>Parámetros (de fábrica)</th></tr>
    </thead>
    <tbody>
      <tr>
        <td><Ui>CUT</Ui> <span class="chip">C</span></td>
        <td>Silencio: la pista se calla desde el disparo hasta el final. El hueco clásico antes de que entre algo.</td>
        <td>Lead 1M.</td>
      </tr>
      <tr>
        <td><Ui>LOW-PASS</Ui> <span class="chip">L</span></td>
        <td>
          Un filtro que se va cerrando y deja pasar solo los graves: la pista suena cada vez más apagada, como del otro
          lado de una pared.
        </td>
        <td>
          <Ui>Freq</Ui>: hasta dónde se cierra, de 100 a 5000 Hz (300). <Ui>Q</Ui>: resonancia, un pico que "silba" en
          esa frecuencia, de 0 a 12 (1). Lead 2M.
        </td>
      </tr>
      <tr>
        <td><Ui>HIGH-PASS</Ui> <span class="chip">H</span></td>
        <td>
          Al revés: le va sacando los graves y la pista queda finita. Típico en bajos y bombos antes de un cambio, para
          que lo nuevo entre con todo el peso.
        </td>
        <td><Ui>Freq</Ui> de 100 a 5000 Hz (800) y <Ui>Q</Ui> de 0 a 12 (1). Lead 2M.</td>
      </tr>
      <tr>
        <td><Ui>FADE</Ui> <span class="chip">F</span></td>
        <td>Baja el volumen de a poco hasta el final.</td>
        <td><Ui>To</Ui>: hasta cuánto, de −60 dB (silencio) a −6 dB (−60). Lead 2M.</td>
      </tr>
      <tr>
        <td><Ui>ECHO THROW</Ui> <span class="chip">E</span></td>
        <td>
          Manda el final de la tirada al delay del proyecto: las repeticiones siguen sonando sobre lo que viene después.
        </td>
        <td><Ui>Level</Ui>: cuánto manda, de −24 a 0 dB (0). Lead 1B.</td>
      </tr>
      <tr>
        <td><Ui>REVERB THROW</Ui> <span class="chip">R</span></td>
        <td>Lo mismo con la reverb: el final queda flotando en una cola.</td>
        <td><Ui>Level</Ui> de −24 a 0 dB (0). Lead 1B.</td>
      </tr>
    </tbody>
  </table>
  <p>
    Las frecuencias del filtro se mueven en escala musical: la mitad del recorrido del knob es mucho más grave que la
    mitad en Hz. Al final de la tirada el filtro se abre de golpe, justo en el beat en que entra lo siguiente.
  </p>
  <Note title="Los throws">
    <p>
      Un <i>throw</i> ("tirar" un sonido al eco) usa el delay o la reverb del proyecto, con su tipo, tiempo y nivel (ver
      <a href="#global_fx" @click.prevent="go('global_fx')">Delay, reverb y COMP del master</a>), pero no depende de los
      knobs <Ui>Rev</Ui> y <Ui>Dly</Ui> de la tira: suena aunque estén en cero. Y toma la señal antes de
      <Ui>CUT</Ui> y <Ui>FADE</Ui>: con un CUT y un ECHO THROW en la misma pista, la pista se calla pero el eco del último
      golpe sigue repitiendo en el silencio. Es un truco clásico del dub.
    </p>
  </Note>
  <p>
    Si dos FX de una pista tocan lo mismo (un <Ui>CUT</Ui> y un <Ui>FADE</Ui>, que mueven el volumen), manda el último que
    se disparó, desde donde había dejado al otro. En un proyecto ajeno (en modo lectura) los FX suenan como los dejó su
    dueño, y los chips se ven pero no se editan.
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

<style scoped>
.fx_types {
  width: 100%;
  margin: 10px 0;
  border-collapse: collapse;
  font-size: 14px;
}

.fx_types th,
.fx_types td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

.fx_types th {
  color: var(--hw_silk);
}

.fx_types td:first-child {
  white-space: nowrap;
}

/* letra del chip, como en la tira */
.chip {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 1px solid #000;
  border-radius: 3px;
  background: linear-gradient(180deg, #2c2d30, #18191b);
  color: var(--hw_silk);
  font-family: var(--font_mono);
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

/* en celular la tabla se apila: cada fila es un bloque */
@media (max-width: 640px) {
  .fx_types thead {
    display: none;
  }

  .fx_types tr,
  .fx_types td {
    display: block;
  }

  .fx_types td {
    padding: 2px 0;
    border: none;
  }

  .fx_types tr {
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }

  .fx_types td:first-child {
    white-space: normal;
  }
}

@media print {
  .fx_types th {
    color: #111;
  }

  .fx_types th,
  .fx_types td {
    border-color: #999;
  }
}
</style>
