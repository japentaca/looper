<template>
  <!-- sección "Preview" (id y título en ../sections.js): PLAY/STOP, qué suena (región, volumen, transpose, borrador de
    ediciones), SYNC, modos de escucha MIX / IN CONTEXT / SOLO, LCD de la barra de arriba, PREV/NEXT y atajos del
    editor (components/FileEditor.vue, helpers/toneLib.js, preview_sync.js, file_ui.js). Captura: toma
    "editor_preview" de scripts/manual_shots.js -->
  <p>
    El preview es escuchar un archivo solo, aparte del motor. En <Ui>Files</Ui> es el botón ▶ (ver
    <a href="#files" @click.prevent="go('files')">Files</a>); en el editor tiene más opciones, para escucharlo suelto, a
    tempo o en el lugar que va a ocupar en la mezcla.
  </p>
  <ManualShot src="/manual/editor_preview.webp" :max_width="1100"
    alt="Pie del editor: STOP encendido, SYNC encendido, modo IN CONTEXT encendido, DELETE, PREV, 15 / 29, NEXT y CLOSE"
    caption="El pie del editor con el preview sonando en sync, en modo IN CONTEXT, mientras el motor toca" />

  <h4>PLAY / STOP</h4>
  <ul>
    <li>
      <Ui>PLAY</Ui> (o <Kbd>Espacio</Kbd>) lo hace sonar y el botón pasa a <Ui>STOP</Ui>. Si está esperando el próximo
      compás para entrar (ver SYNC, abajo), su LED titila; apretarlo ahí lo cancela.
    </li>
    <li>
      Mientras suena, la barra de arriba de la app muestra <i>Preview</i> y el nombre del archivo, con su propio
      <Ui>STOP</Ui>; en la pantalla de onda corre el cursor <Ui>PREVIEW</Ui> (ver
      <a href="#editor_region" @click.prevent="go('editor_region')">Región</a>).
    </li>
    <li>Cerrar el editor corta el preview. Suena uno solo por vez: dar PLAY a otro archivo corta el anterior.</li>
  </ul>
  <p>Lo que suena es el archivo <b>como está en este proyecto</b>:</p>
  <ul>
    <li>Con su región (inicio, fin, nudge y fade) y con su <Ui>Volume</Ui>.</li>
    <li>
      Con su transpose. Si el transpose se está calculando todavía (<i>rendering…</i>), arranca sin transponer y vuelve a
      empezar solo cuando está listo.
    </li>
    <li>
      Con ediciones sin guardar, el borrador: lo que vas a guardar con <Ui>SAVE AS COPY</Ui> (ver
      <a href="#editor_edits" @click.prevent="go('editor_edits')">Ediciones</a>).
    </li>
  </ul>

  <h4>SYNC</h4>
  <p>
    El botón <Ui>SYNC</Ui> (o <Kbd>Q</Kbd>) cambia la forma de escuchar. Es el mismo de la lista <Ui>Files</Ui> y queda
    recordado en ese navegador. Cambiarlo con el preview sonando lo vuelve a arrancar en el modo nuevo.
  </p>
  <dl class="modes">
    <dt>SYNC apagado: suelto</dt>
    <dd>
      Suena una vez, a su velocidad original (sin estirarlo al tempo del proyecto), y sale directo al master, aparte de
      todo. Sirve para oír el sonido tal como es.
    </dd>
    <dt>SYNC encendido (LED amarillo): a tempo</dt>
    <dd>
      Un loop suena al tempo del proyecto, como lo toca el motor (con <Ui>KEY LOCK</Ui>, si lo tiene), y se repite hasta
      que lo pares. Con el motor tocando, espera al próximo compás para entrar a tiempo con el resto; con el motor
      parado, arranca enseguida. Un <Term t="one_shot">one-shot</Term> suena a su velocidad, repetido cada los beats que
      ocupa, con su <Term t="anchor">anchor</Term> cayendo en un beat: así se oye si el golpe queda a tiempo.
    </dd>
  </dl>
  <p>
    Dar <Ui>START</Ui>, <Ui>STOP</Ui> o <Ui>RESET</Ui> en el transporte corta un preview en sync (dependía del motor); uno
    suelto sigue sonando.
  </p>

  <h4>MIX, IN CONTEXT y SOLO</h4>
  <p>
    Con SYNC encendido y el motor tocando, los tres botones del medio eligen cómo se combina el preview con lo que suena
    (<Kbd>M</Kbd> pasa de uno al otro). En cualquier otro caso se ven atenuados y no cuentan.
  </p>
  <ul>
    <li>
      <Ui>MIX</Ui>: el preview suena encima de toda la mezcla. Si su pista está tocando otro archivo, se oyen los dos.
    </li>
    <li>
      <Ui>IN CONTEXT</Ui> (el de fábrica): el preview <b>reemplaza</b> lo que toca su pista y sale por su tira del mixer,
      con su fader, paneo, mute, solo, envíos a la reverb y al delay y sus FX de transición. Es la prueba más honesta:
      cómo sonaría si el motor lo sorteara ahora. Un archivo sin pista suena como en MIX.
    </li>
    <li>
      <Ui>SOLO</Ui>: solo el preview. El motor sigue andando en silencio, sorteando y contando, para volver a tiempo.
    </li>
  </ul>
  <p>
    Cambiar de modo con el preview sonando lo cambia en el momento. Al parar el preview, lo que se había callado vuelve
    en el próximo compás.
  </p>
  <Note title="Probar un archivo en su lugar">
    <p>
      Con el proyecto sonando, SYNC e IN CONTEXT, abrí un bajo y dale PLAY: escuchás ese bajo con la batería y el resto,
      en lugar del que tocaba. Después pasá con <Ui>NEXT ▶</Ui> (o <Kbd>AvPág</Kbd>) al siguiente: el preview sigue con
      el archivo nuevo, así recorrés todos los bajos sin dejar de escuchar. Es el momento de ajustar el volumen (o
      apretar <Ui>MATCH</Ui>, ver <a href="#editor_level" @click.prevent="go('editor_level')">Volumen, loudness,
      Weight y Repeat</a>).
    </p>
  </Note>

  <h4>Atajos del editor</h4>
  <p>
    Andan mientras el editor está abierto, salvo cuando estás escribiendo en un campo (como <Ui>Beats</Ui>): ahí las
    teclas escriben.
  </p>
  <table class="keys">
    <tbody>
      <tr><td><Kbd>Espacio</Kbd></td><td>PLAY / STOP del preview.</td></tr>
      <tr><td><Kbd>Q</Kbd></td><td>Prende o apaga <Ui>SYNC</Ui>.</td></tr>
      <tr><td><Kbd>M</Kbd></td><td>Pasa al modo de escucha siguiente (MIX → IN CONTEXT → SOLO).</td></tr>
      <tr><td><Kbd>RePág</Kbd> / <Kbd>AvPág</Kbd></td><td>Archivo anterior / siguiente de la lista (PREV / NEXT).</td></tr>
      <tr><td><Kbd>Esc</Kbd></td><td>Quita la selección; sin selección, cierra el editor.</td></tr>
    </tbody>
  </table>
  <p>
    Los de la región (<Kbd>G</Kbd> y las flechas) están en <a href="#editor_region" @click.prevent="go('editor_region')">Región</a>
    y los de las ediciones, en <a href="#editor_edits" @click.prevent="go('editor_edits')">Ediciones</a>.
  </p>
  <p>
    El preview del diálogo <Ui>IMPORT</Ui> es más simple: suena siempre suelto y con el archivo original, porque
    todavía no tiene ajustes en tu proyecto.
  </p>
</template>

<script setup>
import { useRouter } from "vue-router"
import ManualShot from "../ManualShot.vue"
import Note from "../Note.vue"
import Term from "../Term.vue"
import Ui from "../Ui.vue"
import Kbd from "../Kbd.vue"
import { go_anchor } from "../nav"

const router = useRouter()
const go = id => go_anchor(router, id)
</script>

<style scoped>
.modes {
  margin: 12px 0;
}

.modes dt {
  margin-top: 10px;
  color: var(--hw_silk);
  font-weight: 700;
}

.modes dd {
  margin: 2px 0 0 18px;
}

.keys {
  margin: 10px 0;
  border-collapse: collapse;
}

.keys td {
  padding: 4px 12px 4px 0;
  vertical-align: top;
}

.keys td:first-child {
  white-space: nowrap;
}

@media print {
  .modes dt {
    color: #111;
    break-after: avoid;
  }
}
</style>
