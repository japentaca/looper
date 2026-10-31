<template>
  <!-- sección "Ediciones" (id y título en ../sections.js): selección, CUT, SILENCE, DUPLICATE, REVERSE, GAIN, STRETCH,
    UNDO/REDO, SAVE AS COPY / SAVE SEL AS COPY, atajos, qué pasa con el original (components/EditOps.vue,
    helpers/edit_session.js, helpers/edit_ops.js). Capturas: tomas "editor_edits" y "editor_save_copy" -->
  <p>
    Las ediciones cambian el audio en sí: cortar un pedazo, invertirlo, repetirlo, estirarlo. A diferencia de la
    región, el resultado es un <Term t="copy">archivo nuevo</Term>: el original nunca se pisa. Mientras editás trabajás
    sobre un borrador que vive en el navegador; para quedártelo, lo guardás con <Ui>SAVE AS COPY</Ui>. No están en un
    proyecto ajeno (modo lectura).
  </p>
  <ManualShot src="/manual/editor_edits.webp"
    alt="La pantalla de onda de un bajo con los beats 4 a 8 seleccionados e invertidos, y la barra de ediciones"
    caption="Los beats 4 a 8 seleccionados e invertidos con REVERSE: hay un cambio sin guardar" :callouts="[
      { n: 1, x: 48.2, y: 7.4, text: 'La selección: arrastrando sobre la onda.' },
      { n: 2, x: 12.5, y: 75, text: 'Cuánto mide la selección (o NO SELECTION).' },
      { n: 3, x: 21.5, y: 67, text: 'ORIGINAL, o EDITED y cuántos pasos hay para deshacer.' },
      { n: 4, x: 54, y: 66, text: 'CUT, SILENCE, DUPLICATE y REVERSE.' },
      { n: 5, x: 80.5, y: 72, text: 'GAIN: sube o baja el volumen de la selección los dB del knob.' },
      { n: 6, x: 2, y: 84, text: 'STRETCH (solo loops): otro tempo sin cambiar el tono.' },
      { n: 7, x: 39.5, y: 85, text: 'UNDO / REDO.' },
      { n: 8, x: 64.5, y: 93, text: 'SAVE AS COPY y SAVE SEL AS COPY: guardar el resultado como archivo nuevo.' },
    ]" />

  <h4>La selección</h4>
  <p>
    Arrastrá sobre la onda, fuera de las manijas de la región: el tramo queda resaltado y el rótulo dice cuánto mide
    (<i>SEL 4 BEATS</i> en un loop, <i>SEL 0.250 S</i> en un one-shot).
  </p>
  <ul>
    <li>
      Con <Ui>SNAP</Ui> encendido, los bordes se pegan a los beats (en un one-shot, a los cruces por cero). Con
      <Kbd>Shift</Kbd> mientras arrastrás, al revés.
    </li>
    <li><Kbd>←</Kbd> / <Kbd>→</Kbd> mueven el último borde que soltaste: un beat con SNAP, 1 ms sin SNAP.</li>
    <li>Un clic en la onda, o <Kbd>Esc</Kbd>, la quita.</li>
  </ul>

  <h4>Las operaciones</h4>
  <table class="ops">
    <thead>
      <tr><th>Botón</th><th>Atajo</th><th>Qué hace</th><th>Sin selección</th></tr>
    </thead>
    <tbody>
      <tr>
        <td><Ui>CUT</Ui></td><td><Kbd>Supr</Kbd></td>
        <td>Quita el tramo: el archivo se acorta y lo de después se corre.</td><td>No anda</td>
      </tr>
      <tr>
        <td><Ui>SILENCE</Ui></td><td>—</td>
        <td>Lo deja en silencio, sin cambiar el largo.</td><td>No anda</td>
      </tr>
      <tr>
        <td><Ui>DUPLICATE</Ui></td><td><Kbd>Ctrl</Kbd>+<Kbd>D</Kbd></td>
        <td>Lo repite a continuación. La selección pasa a la copia: otro <Kbd>Ctrl</Kbd>+<Kbd>D</Kbd> lo repite otra vez.</td>
        <td>Todo el archivo</td>
      </tr>
      <tr>
        <td><Ui>REVERSE</Ui></td><td><Kbd>R</Kbd></td>
        <td>Lo da vuelta (suena al revés).</td><td>Todo el archivo</td>
      </tr>
      <tr>
        <td><Ui>GAIN</Ui></td><td>—</td>
        <td>Le suma los dB del knob <Ui>Gain</Ui>, de −24 a +12 (−3 por defecto).</td><td>Todo el archivo</td>
      </tr>
    </tbody>
  </table>
  <p>
    Las uniones se suavizan solas (unos pocos milisegundos), para que cortar o invertir no deje un click. Mientras haya
    cambios sin guardar, la onda, las lupas y el preview usan el borrador, pero el motor sigue tocando el original: en el
    proyecto no cambia nada hasta que guardes.
  </p>
  <p>
    <Ui>UNDO</Ui> (<Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd>) deshace el último paso y <Ui>REDO</Ui>
    (<Kbd>Ctrl</Kbd>+<Kbd>Y</Kbd> o <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd>) lo rehace. Se pueden deshacer los
    últimos 64 pasos; deshaciendo todos se vuelve a <Ui>ORIGINAL</Ui>.
  </p>
  <Note type="warn" title="Mientras editás, la región queda fija">
    <p>
      Con cambios sin guardar, las manijas de la región y del anchor desaparecen y <Ui>NUDGE</Ui> y <Ui>FADE</Ui> se
      bloquean: se ven llevadas al borrador, pero no se mueven hasta que guardes la copia o deshagas todo. La selección y
      el SNAP siguen andando.
    </p>
  </Note>

  <h4>STRETCH: otro tempo, el mismo tono (solo loops)</h4>
  <p>
    El motor ya acelera o frena cada loop para que encaje en el tempo, pero eso también lo hace más agudo o más grave.
    <Ui>STRETCH</Ui> cambia el tempo del loop entero <b>sin</b> tocar el tono, para guardarlo como una copia que ya está
    en el tempo que querés:
  </p>
  <ol>
    <li>Elegí el BPM destino con el knob <Ui>Stretch</Ui>. Arranca en el tempo del proyecto, que es lo más común.</li>
    <li>
      Apretá <Ui>STRETCH</Ui>. El cálculo tarda un momento: mientras tanto el rótulo dice <i>STRETCHING…</i> y la barra
      no acepta otras operaciones.
    </li>
    <li>Escuchalo y, si te gusta, guardalo con <Ui>SAVE AS COPY</Ui>. La copia conserva los beats y tiene el BPM nuevo.</li>
  </ol>
  <p>
    Llega hasta el doble o la mitad del tempo que tiene el loop; más lejos se pierde calidad. Como cualquier edición, se
    deshace con <Ui>UNDO</Ui>.
  </p>

  <h4>Guardar: SAVE AS COPY y SAVE SEL AS COPY</h4>
  <ManualShot src="/manual/editor_save_copy.webp" :max_width="420"
    alt="Cuadro Save as copy: dice que la copia reemplaza al archivo en el proyecto, su largo, y propone el nombre"
    caption="SAVE AS COPY pide el nombre de la copia" />
  <ul>
    <li>
      <Ui>SAVE AS COPY</Ui> guarda el resultado como un archivo nuevo que <b>reemplaza</b> al original en este proyecto,
      con su pista, sus Tags, volumen, peso, repetición, fade y transpose. La región se "hornea": la copia es solo lo que
      sonaba, y empieza en el beat 0. Por eso también sirve sin ediciones, para guardar como archivo una región recortada.
      Después de guardar, el editor pasa a mostrar la copia.
    </li>
    <li>
      <Ui>SAVE SEL AS COPY</Ui> guarda solo la selección como un archivo nuevo que se suma <b>al lado</b> del original
      (con la misma pista y Tags); el original queda. En un loop la selección se redondea a beats enteros.
    </li>
  </ul>
  <p>
    Antes de guardar se pide el nombre (por defecto el del original con <i>(edit)</i>) y se muestra el largo, los beats y
    el BPM. Si la copia supera 0 dB de pico, se avisa ahí mismo: se guarda tal como se escucha, sin limitarla, así que si
    no lo querés, bajala antes con <Ui>GAIN</Ui>.
  </p>
  <Note title="Qué pasa con el original">
    <p>
      Nada: sigue en el <Term t="catalog">catálogo</Term> tal cual, y en los otros proyectos que lo usen. Si es tuyo,
      sigue siendo tuyo (y ocupando tu cuota) aunque ya no esté en este proyecto. La copia es tuya aunque el original sea
      importado: cuenta en tu <Term t="quota">cuota</Term>, tiene el mismo límite de 1 minuto que una subida y en el
      editor dice <Ui>Derived from</Ui> con el nombre del original.
    </p>
  </Note>
</template>

<script setup>
import ManualShot from "../ManualShot.vue"
import Note from "../Note.vue"
import Term from "../Term.vue"
import Ui from "../Ui.vue"
import Kbd from "../Kbd.vue"
</script>

<style scoped>
.ops {
  width: 100%;
  margin: 12px 0;
  border-collapse: collapse;
  font-size: 0.95em;
}

.ops th,
.ops td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

.ops th {
  color: var(--hw_silk);
  font-size: 0.85em;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.ops td:nth-child(2) {
  white-space: nowrap;
}

/* en celular la tabla se apila: cada operación es un bloque */
@media (max-width: 600px) {
  .ops thead {
    display: none;
  }

  .ops tr {
    display: block;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }

  .ops td {
    display: inline-block;
    padding: 2px 8px 2px 0;
    border: 0;
  }

  .ops td:nth-child(3) {
    display: block;
  }

  .ops td:nth-child(4) {
    display: block;
    color: var(--muted);
  }

  .ops td:nth-child(4)::before {
    content: "Sin selección: ";
  }
}

@media print {
  .ops th {
    color: #111;
  }

  .ops tr {
    break-inside: avoid;
  }
}
</style>
