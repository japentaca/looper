<template>
  <!-- sección "Mixer" (id y título en ../sections.js): tiras (nombre y arrastre, vúmetro, Vol, Pan / Rev / Dly, zócalos de
    FX, M / S), LEDs de beat, Master, vúmetro master y LED LIM (components/Tracks.vue, helpers/mixer.js, App.vue).
    Delay, reverb y COMP quedan para global_fx. Capturas: tomas "mixer" y "master_meter" de scripts/manual_shots.js -->
  <p>
    Debajo del transporte, el panel <Ui>Tracks</Ui> tiene una tira por <Term t="track_group">pista</Term>, en el orden
    de los pads de la izquierda. Las tiras están siempre, aunque el transporte esté detenido o la pista no tenga
    archivos, así que podés dejar la mezcla lista antes de tocar.
  </p>
  <ManualShot src="/manual_shots/mixer.webp" alt="El mixer del proyecto de demo sonando, con la pista Perc en mute"
    caption="El mixer del proyecto de demo, con Perc en mute (atenuada)" :callouts="[
      { n: 1, x: 13.8, y: 9.8, to: 'trg_tags', text: 'Nombre de la pista: de ahí se agarra la tira para arrastrarla.' },
      { n: 2, x: 20.5, y: 3.6, text: 'Beat: el LED verde destella con cada beat y el rojo con el primero de cada compás.' },
      { n: 3, x: 5.5, y: 21.5, text: 'Vúmetro: lo que se escucha de la pista.' },
      { n: 4, x: 16.6, y: 48.8, to: 'editor', text: 'El archivo que suena: un clic lo abre en el editor.' },
      { n: 5, x: 16, y: 70, text: 'Vol: el volumen de la pista.' },
      { n: 6, x: 4.4, y: 82, to: 'global_fx', text: 'Pan, Rev y Dly: paneo y cuánto manda a la reverb y al delay.' },
      { n: 7, x: 16.7, y: 88.5, to: 'fx', text: 'Zócalos de los FX de transición (vacíos si no tiene).' },
      { n: 8, x: 47, y: 94.3, text: 'M (mute) y S (solo).' },
    ]" />
  <p>
    Los controles de descansos y disparos (entre el nombre del archivo y el fader) son del motor: están en
    <a href="#engine" @click.prevent="go('engine')">Cómo elige el motor</a>.
  </p>

  <h4>Volumen y paneo</h4>
  <ul>
    <li>
      El fader <Ui>Vol</Ui> va de silencio (<Ui>-∞</Ui>, abajo del todo) a <Ui>+6</Ui> dB. Las marcas están en dB;
      <Ui>0</Ui> deja la pista como viene. Con el mouse encima se lee el valor exacto.
    </li>
    <li>
      <Ui>Pan</Ui> la lleva a la izquierda o a la derecha; con doble clic vuelve al centro.
    </li>
    <li>
      <Ui>Rev</Ui> y <Ui>Dly</Ui> mandan la pista a la reverb y al delay del proyecto (todo a la izquierda = nada). Cómo
      suenan esos efectos se elige en el transporte: ver
      <a href="#global_fx" @click.prevent="go('global_fx')">Delay, reverb y COMP del master</a>.
    </li>
  </ul>
  <p>
    Todo esto se guarda con el proyecto. El volumen de cada archivo, aparte del de su pista, se ajusta en el editor
    (ver <a href="#editor_level" @click.prevent="go('editor_level')">Volumen, loudness, Weight y Repeat</a>).
  </p>

  <h4>Mute y solo</h4>
  <ul>
    <li><Ui>M</Ui> calla la pista (LED rojo). Su nombre y su archivo se atenúan y el vúmetro queda quieto.</li>
    <li>
      <Ui>S</Ui> la deja sonando sola (LED amarillo): todas las que no estén en solo se callan. Podés poner varias en
      solo a la vez.
    </li>
    <li>Una pista callada tampoco manda nada a la reverb ni al delay.</li>
  </ul>
  <Note title="Mute y solo no se guardan">
    <p>
      Son para escuchar mientras armás: al recargar la página o abrir otra vez el proyecto, todas las pistas vuelven a
      sonar. Para que una pista suene más baja siempre, usá su fader.
    </p>
  </Note>
  <p>
    El motor sigue sorteando en las pistas calladas: al sacar el mute, la pista sigue en el punto en que va, con el
    resto.
  </p>

  <h4>Arrastrar una tira</h4>
  <p>Agarrá la tira desde su nombre (el resto tiene perillas y faders) y soltala:</p>
  <ul>
    <li>Sobre <b>otra tira</b> o sobre el pad de otra pista: cambia el orden de las pistas.</li>
    <li>
      Sobre un <b>archivo</b> de la lista <Ui>Files</Ui>: le asigna esa pista, igual que el pad (ver
      <a href="#trg_tags" @click.prevent="go('trg_tags')">Track Groups y Tags</a>).
    </li>
  </ul>
  <p>
    Al revés, un pad de FX de la izquierda soltado sobre una tira le agrega ese efecto de transición, hasta cuatro por
    pista (ver <a href="#fx" @click.prevent="go('fx')">FX de transición</a>).
  </p>

  <h4>El master</h4>
  <p>
    La perilla <Ui>Master</Ui> del transporte es el volumen de todo junto, de silencio a <Ui>+6</Ui> dB (0 dB queda
    a un 80 % del recorrido). Se guarda con el proyecto. Lo que sale se ve arriba, en la barra
    de la app:
  </p>
  <ManualShot src="/manual_shots/master_meter.webp" :max_width="440"
    alt="Vúmetro master de la barra superior, con los dos canales y el LED LIM encendido en amarillo"
    caption="El vúmetro master (L y R) con el LED LIM encendido: el limitador está trabajando" />
  <ul>
    <li>
      <Ui>Master</Ui> <Ui>L</Ui> / <Ui>R</Ui>: el nivel de los canales izquierdo y derecho de todo lo que sale,
      también del preview de <Ui>Files</Ui>.
    </li>
    <li>
      <Ui>LIM</Ui>: el LED del <Term t="limiter">limitador</Term>, que no deja que la salida pase de un tope y
      distorsione. Se enciende en amarillo cuando está bajando el volumen más de 1 dB y en rojo cuando baja más de 3.
    </li>
  </ul>
  <Note type="warn" title="Si LIM se pone rojo seguido">
    <p>
      La mezcla está muy fuerte y el limitador la está aplastando: se pierde golpe. Bajá un poco el
      <Ui>Master</Ui> o los faders de las pistas más fuertes hasta que LIM solo destelle de vez en cuando.
    </p>
  </Note>
  <p>
    El compresor del master (<Ui>COMP</Ui>, al lado del <Ui>Master</Ui>) está en
    <a href="#global_fx" @click.prevent="go('global_fx')">Delay, reverb y COMP del master</a>. En un proyecto
    ajeno, abierto en modo lectura, las tiras solo tienen <Ui>Vol</Ui>, <Ui>M</Ui> y <Ui>S</Ui>, y no se guarda nada (ver <a href="#public_project" @click.prevent="go('public_project')">Proyecto público</a>).
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
