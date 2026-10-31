<template>
  <!-- sección "Atajos de teclado" (id y título en ../sections.js): tabla única de atajos, agrupados por contexto.
    Sacados del código: components/FileEditor.vue (on_editor_key), RegionEditor.vue y EditOps.vue (on_key), reglas de
    foco en helpers/utils.js (editor_key_ok, SPACE_TAKERS, ARROW_TAKERS, PAGE_TAKERS), controles de components/hw/ (Knob, Fader,
    RangePads, ToggleSwitch) y los @keyup.enter de los diálogos. Si se agrega o cambia un atajo, actualizar esta tabla
    y la sección que lo explica -->
  <p>
    Todos los atajos de Looper en un solo lugar. Casi todos son del editor de archivos; el resto de la app se maneja con
    el mouse, y con <Kbd>Tab</Kbd> se llega a cualquier botón o control (<Kbd>Espacio</Kbd> o <Kbd>Enter</Kbd> aprietan
    el botón que tiene el foco). En una Mac, donde dice <Kbd>Ctrl</Kbd> vale también <Kbd>⌘</Kbd>.
  </p>

  <table class="keys">
    <thead>
      <tr><th>Tecla</th><th>Qué hace</th></tr>
    </thead>
    <tbody v-for="g in GROUPS" :key="g.title">
      <tr class="group">
        <th colspan="2">
          {{ g.title }}<template v-if="g.to"> · <a :href="'#' + g.to" @click.prevent="go(g.to)">ver {{ g.to_text }}</a></template>
        </th>
      </tr>
      <tr v-for="(r, i) in g.rows" :key="i">
        <td class="combo">
          <template v-for="(alt, j) in r.keys" :key="j">
            <span v-if="j" class="or"> o </span>
            <template v-for="(k, n) in alt" :key="n"><template v-if="n">+</template><Kbd>{{ k }}</Kbd></template>
          </template>
        </td>
        <td>{{ r.text }}</td>
      </tr>
    </tbody>
  </table>

  <Note title="Cuándo andan los atajos del editor">
    <p>
      Solo con el editor abierto y sin otro cuadro encima (una confirmación, por ejemplo). Mientras escribís en un campo,
      como <Ui>Beats</Ui>, las teclas escriben. Y si el foco quedó en un botón o un control porque recién lo tocaste,
      <Kbd>Espacio</Kbd> aprieta ese botón, y las flechas (y en una perilla, <Kbd>RePág</Kbd> / <Kbd>AvPág</Kbd>) mueven
      ese control: hacé clic en un lugar vacío del editor y
      vuelven a ser atajos.
    </p>
  </Note>
  <p>
    El transporte (<Ui>START</Ui>, <Ui>RESET</Ui>) no tiene atajos propios. Para salir de Chrome en
    <a href="#kiosk" @click.prevent="go('kiosk')">modo instalación</a> se usa <Kbd>Alt</Kbd>+<Kbd>F4</Kbd>.
  </p>
</template>

<script setup>
import { useRouter } from "vue-router"
import Note from "../Note.vue"
import Ui from "../Ui.vue"
import Kbd from "../Kbd.vue"
import { go_anchor } from "../nav"

const router = useRouter()
const go = id => go_anchor(router, id)

// keys: alternativas, cada una una combinación ([["Ctrl", "Y"], ["Ctrl", "Shift", "Z"]] = Ctrl+Y o Ctrl+Shift+Z)
const GROUPS = [
  {
    title: "Editor de archivos", to: "editor_preview", to_text: "Preview",
    rows: [
      { keys: [["Espacio"]], text: "PLAY / STOP del preview." },
      { keys: [["Q"]], text: "Prende o apaga SYNC." },
      { keys: [["M"]], text: "Pasa al modo de escucha siguiente: MIX → IN CONTEXT → SOLO (con SYNC y el motor tocando)." },
      { keys: [["RePág"], ["AvPág"]], text: "Archivo anterior / siguiente de la lista (PREV / NEXT)." },
      { keys: [["Esc"]], text: "Quita la selección; sin selección, cierra el editor (con ediciones sin guardar, pregunta antes)." },
    ],
  },
  {
    title: "Región y selección (pantalla de onda)", to: "editor_region", to_text: "Región",
    rows: [
      { keys: [["G"]], text: "Prende o apaga SNAP." },
      {
        keys: [["←"], ["→"]],
        text: "Mueve la última manija que tocaste (la roja), el anchor o el borde de la selección: con SNAP, al beat siguiente (en un one-shot, al cruce por cero o al golpe más cercano); sin SNAP, 1 ms.",
      },
      { keys: [["Shift", "←"], ["Shift", "→"]], text: "Lo mismo con SNAP invertido." },
      { keys: [["Shift"]], text: "Mantenido mientras arrastrás una manija o una selección: invierte SNAP por un momento." },
    ],
  },
  {
    title: "Ediciones (no en un proyecto ajeno)", to: "editor_edits", to_text: "Ediciones",
    rows: [
      { keys: [["Supr"], ["Retroceso"]], text: "CUT: quita el tramo seleccionado." },
      { keys: [["Ctrl", "D"]], text: "DUPLICATE: repite la selección (o todo el archivo) a continuación." },
      { keys: [["R"]], text: "REVERSE: da vuelta la selección (o todo el archivo)." },
      { keys: [["Ctrl", "Z"]], text: "UNDO: deshace el último paso." },
      { keys: [["Ctrl", "Y"], ["Ctrl", "Shift", "Z"]], text: "REDO: lo rehace." },
    ],
  },
  {
    title: "Perillas, faders y pads (con el foco en el control)", to: "public_project", to_text: "Perillas y faders",
    rows: [
      { keys: [["↑"], ["→"]], text: "Perilla o fader: un paso para arriba (↓ / ←, para abajo). También la rueda del mouse encima." },
      { keys: [["RePág"], ["AvPág"]], text: "Perilla: diez pasos para arriba / para abajo." },
      { keys: [["Shift"]], text: "Mantenido mientras arrastrás una perilla: ajuste fino." },
      { keys: [["←"], ["→"]], text: "Pads de rango (Tag change, descansos, Repeat): corre el rango entero un lugar." },
      { keys: [["Shift", "←"], ["Shift", "→"]], text: "Pads de rango: achica o agranda el rango por su extremo de arriba." },
      { keys: [["Shift"]], text: "Mantenido al hacer clic en un pad de rango: lleva hasta ahí el extremo más cercano." },
      { keys: [["Espacio"], ["Enter"]], text: "Llave Time sig: cambia de posición (← / → elige un lado)." },
    ],
  },
  {
    title: "Diálogos y nombres",
    rows: [
      { keys: [["Esc"]], text: "Cierra el diálogo abierto (el editor tiene su propio Esc, arriba)." },
      {
        keys: [["Enter"]],
        text: "En un campo: entra (LOGIN), crea el proyecto (CREATE), guarda el nombre del Tag, busca en IMPORT o cambia la clave.",
      },
      { keys: [["Tab"]], text: "Al renombrar una pista en su pad: guarda el nombre (también un clic afuera)." },
      { keys: [["Esc"]], text: "Al renombrar una pista: vuelve al nombre anterior." },
    ],
  },
]
</script>

<style scoped>
.keys {
  width: 100%;
  margin: 12px 0;
  border-collapse: collapse;
  font-size: 0.95em;
}

.keys th,
.keys td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

.keys thead th {
  color: var(--hw_silk);
  font-size: 0.85em;
  letter-spacing: 1px;
  text-transform: uppercase;
}

/* encabezado de cada grupo: serigrafía sobre una franja de chasis */
.keys .group th {
  padding-top: 14px;
  background: var(--hw_chassis_dark);
  color: var(--hw_silk);
  font-weight: 700;
}

.keys .group a {
  color: var(--accent);
  font-weight: 400;
}

.combo {
  width: 1%;
  white-space: nowrap;
}

.or {
  color: var(--muted);
  font-size: 0.85em;
}

/* en celular cada atajo es un bloque: las teclas arriba y el texto abajo */
@media (max-width: 600px) {
  .keys thead {
    display: none;
  }

  .keys tr {
    display: block;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }

  .keys th,
  .keys td {
    display: block;
    width: auto;
    padding: 2px 8px;
    border: 0;
  }

  .combo {
    white-space: normal;
  }
}

@media print {
  .keys thead th,
  .keys .group th {
    background: none;
    color: #111;
  }

  .keys tr {
    break-inside: avoid;
  }

  .or {
    color: #444;
  }
}
</style>
