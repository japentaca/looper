<template>
  <!-- sección "Región" (id y título en ../sections.js): pantalla de onda (grilla, cursores, manijas), START/STOP de la
    región, SNAP, NUDGE/AUTO, FADE, lupas, anchor de los shots, atajos G y flechas (components/WaveScreen.vue,
    RegionEditor.vue, WaveLoupe.vue, helpers/region.js). Capturas: tomas "editor_region" y "editor_tune" -->
  <p>
    La <Term t="region">región</Term> es la parte del archivo que suena en este proyecto. Sirve para usar solo un
    pedazo de un loop largo, sacar un silencio del principio o corregir un archivo que no empieza justo en el beat, sin
    tocar el audio: es un ajuste del proyecto, se guarda solo y en otro proyecto el mismo archivo puede sonar entero.
  </p>
  <ManualShot src="/manual_shots/editor_region.webp"
    alt="Pantalla de onda de un loop de 32 beats con la región recortada a los beats 8 a 24 y la barra de la región debajo"
    caption="Un loop de 32 beats recortado a los 16 del medio, con el preview sonando" :callouts="[
      { n: 1, x: 9.5, y: 13.8, text: 'Los beats del archivo (en un one-shot, el tempo de la grilla y el anchor).' },
      { n: 2, x: 27.8, y: 9.7, text: 'Manija de inicio de la región.' },
      { n: 3, x: 72.2, y: 9.7, text: 'Manija de fin: la última que tocaste se ve en rojo (la mueven las flechas).' },
      { n: 4, x: 86.6, y: 27.6, text: 'Lo que queda fuera de la región, atenuado: no suena.' },
      { n: 5, x: 91, y: 62, text: 'Qué cursor se ve: PREVIEW (el preview) o TRACK (el motor).' },
      { n: 6, x: 13.5, y: 83.8, text: 'El largo de la región.' },
      { n: 7, x: 17.3, y: 70, text: 'SNAP: las manijas se pegan a los beats.' },
      { n: 8, x: 24.4, y: 74, text: 'NUDGE (con AUTO): corre la grilla.' },
      { n: 9, x: 47.9, y: 74, text: 'FADE: entrada y salida suaves.' },
      { n: 10, x: 77.8, y: 78, text: 'Lupa START: el comienzo, ampliado.' },
      { n: 11, x: 94.6, y: 78, text: 'Lupa SEAM: la costura, donde el final se une con el principio.' },
    ]" />

  <h4>La pantalla de onda</h4>
  <ul>
    <li>
      La onda, con un carril por canal (<i>L</i> y <i>R</i> si es estéreo). Encima, la grilla: en un loop, una línea por
      <Term t="beat">beat</Term> y una más marcada por <Term t="bar">compás</Term>; arriba a la izquierda, los beats
      (<i>32 BEATS</i>). Si el motor lo toca al doble o a la mitad para que encaje, lo dice al lado
      (<i>in this project: 16 beats (×2)</i>).
    </li>
    <li>
      Dos cursores: el del <b>preview</b> (oscuro) mientras lo escuchás desde el editor, y el del <b>motor</b> (rojo)
      cuando el archivo suena en su pista. Abajo a la derecha se lee cuál está andando: <Ui>PREVIEW</Ui> o
      <Ui>TRACK</Ui>.
    </li>
    <li>
      Las manijas de inicio y fin de la región, con una lengüeta arriba. Lo de afuera se ve atenuado. Arrastrar sobre la
      onda <b>fuera</b> de las manijas no las mueve: marca una selección para las
      <a href="#editor_edits" @click.prevent="go('editor_edits')">ediciones</a>.
    </li>
  </ul>

  <h4>Marcar la región</h4>
  <ol>
    <li>Agarrá la manija de inicio por su lengüeta y arrastrala hasta donde querés que empiece.</li>
    <li>Lo mismo con la de fin. Si la llevás más allá de un borde, queda en el borde.</li>
    <li>Escuchala con <Ui>PLAY</Ui> (o <Kbd>Espacio</Kbd>) y ajustá con las flechas si hace falta.</li>
  </ol>
  <p>
    En un loop la región se mide en beats: el rótulo dice <i>REGION 16 BEATS</i>. El motor la toca como un loop de
    esos beats, al mismo BPM (recortar no lo acelera). Si no da un número entero de beats aparece <i>⚠</i>: el motor la
    redondea, y la vuelta se corta antes o deja un hueco. En un <Term t="one_shot">one-shot</Term> se mide en segundos
    (<i>REGION 0.84 S</i>). Para volver al archivo entero, llevá cada manija a su borde.
  </p>
  <ul>
    <li>
      <Ui>SNAP</Ui> (LED amarillo, atajo <Kbd>G</Kbd>): en un loop, las manijas se pegan a las líneas de beat (y la
      región dura al menos un beat); en un one-shot, al cruce por cero más cercano, para que el corte no haga click.
      Mantené <Kbd>Shift</Kbd> mientras arrastrás para invertirlo por un momento. Queda recordado en ese navegador.
    </li>
    <li>
      <Kbd>←</Kbd> / <Kbd>→</Kbd> mueven la última manija que tocaste (la roja): con SNAP, un beat (en un one-shot, al cruce por cero
      siguiente); sin SNAP, 1 ms.
      <Kbd>Shift</Kbd> invierte. Para elegir una manija sin moverla, hacé clic en su lengüeta.
    </li>
  </ul>

  <h4>NUDGE y AUTO (solo loops)</h4>
  <p>
    Muchos archivos traen unos milisegundos de silencio al principio (lo agrega el formato mp3), así que el primer golpe
    cae un poco después del beat. <Ui>Nudge</Ui> corre la grilla entera hacia la derecha, de 0 a 250 ms, hasta que el
    beat 0 coincida con el golpe; la región y lo que suena se corren con ella. <Ui>AUTO</Ui> lo calcula solo: busca el
    primer golpe del audio. Controlalo en la lupa <Ui>START</Ui> (abajo).
  </p>

  <h4>FADE</h4>
  <p>
    <Ui>Fade</Ui> hace una entrada y una salida suaves, de 0 a 50 ms, al principio y al final de la región. Es para los
    clicks: si un loop recortado hace "tic" cada vez que vuelve a empezar, unos pocos ms de fade lo resuelven. Más que eso
    se empieza a oír como un hueco.
  </p>

  <h4>Las lupas</h4>
  <ul>
    <li>
      <Ui>START</Ui>: los primeros 300 ms ampliados, con una línea en el beat 0 (después del nudge). El golpe tiene que
      arrancar sobre la línea. En un one-shot muestra el comienzo de la región.
    </li>
    <li>
      <Ui>SEAM</Ui>: la <Term t="seam">costura</Term>. El final de lo que suena pegado a su principio, con el fade
      aplicado, tal como pasa cuando el loop se repite. Si se ve un salto brusco en la línea del medio, ahí hay un click:
      mové un poco el fin o subí el fade.
    </li>
  </ul>

  <h4>En un one-shot: la grilla del proyecto y el anchor</h4>
  <ManualShot src="/manual_shots/editor_tune.webp"
    alt="El editor con un bombo suelto: grilla de trazos al tempo del proyecto, rótulo ANCHOR START y la nota detectada"
    caption="Un bombo suelto (one-shot): la grilla es la del proyecto y no hay NUDGE ni STRETCH" :callouts="[
      { n: 1, x: 19.5, y: 3.4, text: 'La grilla, de trazos, sigue al tempo del proyecto desde el anchor.' },
      { n: 2, x: 3.2, y: 22.9, text: 'La manija del anchor: la lengüeta de abajo.' },
      { n: 3, x: 37.7, y: 31.5, text: 'El anchor que vale (acá, el de catálogo: START) y DEFAULT para volver a él.' },
      { n: 4, x: 26.5, y: 79.5, to: 'editor_pitch', text: 'La nota detectada.' },
      { n: 5, x: 9.6, y: 85.5, to: 'editor_pitch', text: 'La nota destino de TUNE TO.' },
      { n: 6, x: 37.8, y: 86.6, to: 'editor_pitch', text: 'TUNE TO: transpone el sonido a esa nota.' },
      { n: 7, x: 69.6, y: 74, to: 'editor_pitch', text: 'El transpose que puso TUNE TO.' },
    ]" />
  <p>
    Un one-shot suena a su velocidad, así que no tiene beats propios: las líneas de trazos marcan el tempo del proyecto,
    contadas desde el <Term t="anchor">anchor</Term> (el punto que cae en el beat, marcado con un triangulito). Sirven
    para ver qué parte del sonido queda antes del golpe y cuánto dura en beats.
  </p>
  <p>
    El anchor tiene su propia manija, una línea de trazos con la lengüeta <b>abajo</b>. Por defecto está donde dice el
    dato de catálogo (<Ui>START</Ui> = inicio de la región, <Ui>END</Ui> = fin; ver
    <a href="#editor" @click.prevent="go('editor')">El editor de un vistazo</a>), pero en cada proyecto podés arrastrarla
    a cualquier punto de la región: por ejemplo, al golpe de un sonido que tiene una subida antes. Lo que queda antes del
    anchor suena antes del beat.
  </p>
  <ul>
    <li>Con <Ui>SNAP</Ui> se pega a los golpes del audio y a los bordes de la región. Las flechas también la mueven.</li>
    <li>
      El rótulo dice <i>ANCHOR START</i> / <i>ANCHOR END</i> (el de catálogo) o <i>ANCHOR 0.350 S</i> (el de este
      proyecto). <Ui>DEFAULT</Ui> borra el del proyecto y vuelve al de catálogo.
    </li>
    <li>
      Si después achicás la región y el anchor queda afuera, se avisa con <i>⚠ OUT OF REGION</i>: suena en el borde más
      cercano, y vuelve a su lugar si agrandás la región otra vez.
    </li>
  </ul>
  <Note title="Cuándo se oyen los cambios">
    <p>
      La región, el nudge, el fade y el anchor se guardan al soltar la manija o el knob, y valen desde la próxima vez que
      el archivo arranca, en el motor o en el preview: un loop que está sonando termina su vuelta como estaba.
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
