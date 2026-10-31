<template>
  <!-- sección "El editor de un vistazo" (id y título en ../sections.js): cómo se abre, partes del diálogo, qué se guarda
    dónde (dato del archivo / ajuste del proyecto / copia), tipo, beats, key, anchor, pista y tags, PREV/NEXT
    (components/FileEditor.vue, helpers/file_ui.js). Captura: toma "editor" de scripts/manual_shots.js -->
  <p>
    El editor es la mesa de trabajo de un archivo: ahí ves su onda, elegís qué parte suena, lo afinás, lo nivelás y,
    si hace falta, lo cortás y lo guardás como un archivo nuevo. Se abre desde <Ui>Files</Ui> con el lápiz del cartucho
    o de la fila, o con un clic en el nombre del archivo que está sonando en una tira del mixer.
  </p>
  <ManualShot src="/manual_shots/editor.webp" alt="El editor de archivos con un loop de bajo del proyecto de demo"
    caption="Un loop de bajo, visto por quien lo subió (con los datos del archivo editables)" :callouts="[
      { n: 1, x: 91.7, y: 8.1, to: 'editor_region', text: 'La pantalla de onda, con la grilla de beats y la región.' },
      { n: 2, x: 96.2, y: 26.4, to: 'editor_region', text: 'La región: largo, SNAP, NUDGE, FADE y las lupas.' },
      { n: 3, x: 96.2, y: 35.2, to: 'editor_edits', text: 'Las ediciones: selección, CUT, REVERSE, STRETCH, UNDO, SAVE AS COPY...' },
      { n: 4, x: 24.6, y: 56.4, text: 'Tipo: LOOP o SHOT.' },
      { n: 5, x: 30.5, y: 60.1, text: 'Beats del loop y el BPM que resulta.' },
      { n: 6, x: 30.4, y: 65.6, to: 'editor_pitch', text: 'Key: la tonalidad, y DETECT para que Looper la sugiera.' },
      { n: 7, x: 24.6, y: 71.4, text: 'Anchor: en un one-shot, qué punto cae en el beat.' },
      { n: 8, x: 44.5, y: 51.2, to: 'editor_level', text: 'Volume y Loudness (con MATCH).' },
      { n: 9, x: 78.5, y: 51.2, to: 'editor_pitch', text: 'Transpose y KEY LOCK.' },
      { n: 10, x: 97.6, y: 66.9, to: 'editor_level', text: 'Weight y Repeat.' },
      { n: 11, x: 97.1, y: 81.6, text: 'Su pista y sus Tags en este proyecto.' },
      { n: 12, x: 11.6, y: 93.5, to: 'editor_preview', text: 'Preview: PLAY, SYNC y el modo de escucha.' },
      { n: 13, x: 39, y: 96.8, text: 'DELETE: lo borra (como el tacho de Files).' },
      { n: 14, x: 72.5, y: 97.2, text: 'PREV / NEXT: el archivo anterior o el siguiente de la lista; CLOSE cierra.' },
    ]" />

  <h4>Qué se guarda dónde</h4>
  <p>
    Es lo más importante del editor. Lo que tocás va a parar a uno de tres lugares, y cada uno tiene su alcance:
  </p>
  <dl class="where">
    <dt>Datos del archivo <span class="who">(solo quien lo subió)</span></dt>
    <dd>
      <Ui>Tipo</Ui>, <Ui>Beats</Ui>, <Ui>Key</Ui> y <Ui>Anchor</Ui>. Describen el audio y viajan con él al
      <Term t="catalog">catálogo</Term>: si los cambiás, cambian en <b>todos</b> los proyectos que lo usan, también en
      los de otros usuarios. Se guardan en el momento. Si el archivo no es tuyo los ves como texto, sin poder
      cambiarlos.
    </dd>
    <dt>Ajustes del proyecto <span class="who">(quien edita el proyecto)</span></dt>
    <dd>
      La pista y los Tags, el volumen, el peso, la repetición, la <Term t="region">región</Term> (con su nudge, fade y
      anchor) y el transpose. Valen <b>solo en este proyecto</b>: el mismo archivo puede sonar recortado y transpuesto
      acá y entero en otro. No modifican el audio, así que se pueden cambiar siempre, sea tuyo o importado. Se guardan
      solos, al soltar el control.
    </dd>
    <dt>Ediciones <span class="who">(una copia nueva)</span></dt>
    <dd>
      Cortar, silenciar, invertir, estirar... modifican el audio, pero nunca el original: trabajás sobre un borrador y,
      para quedártelo, lo guardás como un archivo nuevo con <Ui>SAVE AS COPY</Ui>. Hasta entonces no hay nada guardado
      (ver <a href="#editor_edits" @click.prevent="go('editor_edits')">Ediciones</a>).
    </dd>
  </dl>
  <p>
    Los cambios del proyecto valen desde la próxima vez que el archivo arranca: si está sonando, termina su vuelta como
    estaba.
  </p>
  <Note title="Proyecto ajeno">
    <p>
      En un proyecto de otro usuario (que se abre en modo lectura) el editor sirve para mirar y escuchar: se ven la
      onda, la región y los valores, y anda <Ui>DETECT</Ui>, pero no se cambia nada y no están las ediciones.
    </p>
  </Note>

  <h4>Tipo, beats y BPM</h4>
  <ul>
    <li>
      <Ui>Tipo</Ui>: <Ui>LOOP</Ui> para algo que se repite (tiene beats y BPM y se estira al tempo del proyecto) o
      <Ui>SHOT</Ui> para un golpe suelto (<Term t="one_shot">one-shot</Term>, que suena siempre a su velocidad).
    </li>
    <li>
      <Ui>Beats</Ui> (solo en loops): cuántos <Term t="beat">beats</Term> dura. El <Term t="bpm">BPM</Term> no se
      escribe: sale de los beats y la duración. Mientras cambiás el número, la grilla de la onda lo sigue; así ves si
      las líneas caen sobre los golpes antes de soltarlo. Si queda muy lejos del tempo del proyecto, aparece
      <Ui>out of tempo</Ui> al lado.
    </li>
  </ul>
  <Note title="Cómo saber si los beats están bien">
    <p>
      Mirá la grilla: con los beats correctos, las líneas de compás (las más marcadas) caen sobre los golpes fuertes. Con
      uno de más o de menos (15 en vez de 16), el loop se estira de más y queda corrido respecto de las otras pistas.
      Equivocarse al doble o a la mitad (8 en vez de 16) no es grave: el motor lo toca igual a tiempo, y la pantalla
      avisa <i>in this project: 16 beats (×2)</i>.
    </p>
  </Note>

  <h4>Key y Anchor</h4>
  <ul>
    <li>
      <Ui>Key</Ui>: la <Term t="key">tonalidad</Term> del archivo, o <i>atonal</i> (baterías, ruidos). Si en este
      proyecto está transpuesto, al lado aparece la tonalidad con que suena (<i>→ A<sup>+2</sup></i>). El botón
      <Ui>DETECT</Ui> la sugiere analizando el audio (ver <a href="#editor_pitch" @click.prevent="go('editor_pitch')">Tono</a>).
    </li>
    <li>
      <Ui>Anchor</Ui> (cuenta en los one-shots): el <Term t="anchor">anchor</Term> de catálogo, qué parte del sonido
      cae en el beat cuando lo dispara una pista one-shot:
      <ul>
        <li><Ui>START</Ui>: el sonido empieza en el beat (un golpe, un impacto). Es lo normal.</li>
        <li>
          <Ui>END</Ui>: el sonido <b>termina</b> en el beat (una subida, un platillo al revés): arranca antes, para
          llegar justo.
        </li>
      </ul>
      Cada proyecto puede elegir además un punto intermedio arrastrándolo sobre la onda (ver
      <a href="#editor_region" @click.prevent="go('editor_region')">Región</a>). Las pistas de loops lo ignoran.
    </li>
  </ul>
  <p>
    Si el archivo es una copia hecha en el editor, arriba de todo aparece <Ui>Derived from</Ui> con el nombre del
    original (o <i>(deleted file)</i> si ya no está).
  </p>

  <h4>Pista y Tags</h4>
  <p>
    Abajo están los pads de las pistas y de los <Term t="tag">Tags</Term> del proyecto, con sus colores. Es lo mismo que
    arrastrar pads sobre <Ui>Files</Ui>, pero a un clic:
  </p>
  <ul>
    <li><Ui>Track</Ui>: un clic asigna esa pista (una sola por archivo); otro clic en la encendida lo deja sin pista.</li>
    <li><Ui>Tags</Ui>: cada pad prende o apaga su Tag; puede tener varios, o ninguno (vale para todos).</li>
  </ul>

  <h4>Volumen, preview y lo demás</h4>
  <p>
    Las placas de la derecha ajustan cómo suena el archivo en el proyecto: <Ui>Volume</Ui>, <Ui>Loudness</Ui> (con
    <Ui>MATCH</Ui>), <Ui>Weight</Ui> y <Ui>Repeat</Ui> se explican en
    <a href="#editor_level" @click.prevent="go('editor_level')">Volumen, loudness, Weight y Repeat</a>, y
    <Ui>Transpose</Ui> en <a href="#editor_pitch" @click.prevent="go('editor_pitch')">Tono</a>. Al pie,
    <Ui>PLAY</Ui> lo escucha (con <Kbd>Espacio</Kbd>), con las opciones de
    <a href="#editor_preview" @click.prevent="go('editor_preview')">Preview</a>.
  </p>

  <h4>Pasar de un archivo a otro y cerrar</h4>
  <ul>
    <li>
      <Ui>◀ PREV</Ui> y <Ui>NEXT ▶</Ui> (o <Kbd>RePág</Kbd> / <Kbd>AvPág</Kbd>) pasan al archivo anterior o siguiente
      sin cerrar el editor. Recorren la lista tal como se ve en <Ui>Files</Ui>: con el filtro por tonalidad y, en la vista
      Table, en el orden de la tabla. Entre los dos botones se lee la posición (<i>15 / 29</i>). Si el preview estaba
      sonando, sigue con el archivo nuevo.
    </li>
    <li>
      <Ui>CLOSE</Ui>, la X o <Kbd>Esc</Kbd> lo cierran (con una selección marcada, <Kbd>Esc</Kbd> primero la quita). Al
      cerrar se corta el preview.
    </li>
  </ul>
  <Note type="warn" title="Ediciones sin guardar">
    <p>
      Si tenés ediciones sin guardar, cerrar o pasar a otro archivo pregunta antes de descartarlas. Recargar la página
      o cerrar la pestaña, no: se pierden sin aviso.
    </p>
  </Note>
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
.where {
  margin: 12px 0;
}

.where dt {
  margin-top: 10px;
  color: var(--hw_silk);
  font-weight: 700;
}

.who {
  color: var(--muted);
  font-weight: 400;
}

.where dd {
  margin: 2px 0 0 18px;
}

@media print {
  .where dt {
    color: #111;
    break-after: avoid;
  }

  .who {
    color: #444;
  }
}
</style>
