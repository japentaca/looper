<template>
  <!-- sección "Volumen, loudness, Weight y Repeat" (id y título en ../sections.js): fader Volume, lecturas de Loudness
    (Integrated y True peak) y MATCH, Weight (peso en el sorteo de su pista) y Repeat (components/FileEditor.vue,
    helpers/loudness.js, composable.js: WEIGHT_MAX, REPEAT_OPTIONS). Captura: toma "editor_level" de
    scripts/manual_shots.js -->
  <p>
    Las placas de la derecha del editor deciden <b>cuánto</b> suena un archivo y <b>cuántas veces</b> sale. Las cuatro
    son ajustes del proyecto: valen solo acá, se pueden cambiar en cualquier archivo (tuyo o importado) y se guardan
    solas al soltar el control.
  </p>
  <ManualShot src="/manual/editor_level.webp" :max_width="620"
    alt="Placas del editor de un loop de Lead: Volume en -8 dB, Loudness -28.8 LUFS y pico -8.0 dB, Weight 24 y Repeat de 1 a 4"
    caption="Un loop de Lead con el volumen bajado a −8 dB, peso 24 y de 1 a 4 vueltas por sorteo" :callouts="[
      { n: 1, x: 17.9, y: 20.9, text: 'Volume: el fader del archivo en este proyecto.' },
      { n: 2, x: 14.9, y: 72.3, text: 'Su valor en dB (--- = callado).' },
      { n: 3, x: 39.5, y: 15.8, text: 'Integrated: cuán fuerte suena, en LUFS, con el Volume aplicado.' },
      { n: 4, x: 39.5, y: 33.5, text: 'True peak: su pico más alto, en dB, con el Volume aplicado.' },
      { n: 5, x: 23.5, y: 60, text: 'MATCH: lo empareja con los otros archivos de su pista.' },
      { n: 6, x: 82, y: 12, to: 'engine', text: 'Weight: sus chances en el sorteo de su pista.' },
      { n: 7, x: 96.4, y: 90.6, text: 'Repeat: cuántas vueltas seguidas da al salir.' },
    ]" />

  <h4>Volume</h4>
  <p>
    El fader <Ui>Volume</Ui> es el volumen de este archivo en el proyecto, aparte del fader de su pista en el mixer:
    primero se aplica el del archivo y después el de la pista. Va de silencio (<Ui>-∞</Ui>, abajo del todo) a
    <Ui>+12</Ui> dB; abajo se lee el valor (<Ui lcd>-8</Ui>) y con el mouse encima, el exacto. Un archivo recién sumado a
    un proyecto arranca en −6 dB. También se mueve con la rueda del mouse.
  </p>
  <p>
    Sirve para equilibrar los archivos <b>dentro</b> de una pista: si un loop de bajo suena más fuerte que los otros,
    cada vez que sale se nota el salto. El volumen general de la pista se ajusta en el
    <a href="#mixer" @click.prevent="go('mixer')">mixer</a>. El preview usa el mismo volumen, así que lo que escuchás en
    el editor es lo que va a sonar.
  </p>

  <h4>Loudness: cuán fuerte suena</h4>
  <p>
    El oído no juzga el volumen por los picos sino por la energía a lo largo del tiempo: un pad sostenido puede sonar
    más fuerte que un golpe seco con el mismo pico. La placa <Ui>Loudness</Ui> muestra las dos cosas:
  </p>
  <ul>
    <li>
      <Ui>Integrated</Ui>: la <Term t="loudness">loudness</Term> del archivo, en LUFS (una medida estándar de cuán fuerte
      se percibe; −14 es muy fuerte, −30 bastante suave). Es la que importa para comparar archivos.
    </li>
    <li>
      <Ui>True peak</Ui>: el pico más alto, en dB. Si pasa de 0 no se rompe nada: el
      <Term t="limiter">limitador</Term> del master lo agarra (con el mouse encima, la placa lo avisa).
    </li>
  </ul>
  <p>
    Las mide el servidor una vez, sobre el archivo <b>entero</b> (no sobre la región), y la placa les suma el
    <Ui>Volume</Ui> del proyecto: al mover el fader, las lecturas lo siguen. Muestran <Ui>---</Ui> si el archivo
    todavía no se midió (uno recién subido se mide en segundo plano), si es silencio o si el fader está abajo del todo.
  </p>
  <p>
    Al subirse, Looper empareja la loudness de cada archivo (apunta a −18 LUFS), así que la mayoría arranca parecida;
    los que tienen golpes muy fuertes quedan algo más bajos, y las copias del editor se guardan tal como quedaron, sin
    emparejar.
  </p>

  <h4>MATCH</h4>
  <p>
    <Ui>MATCH</Ui> pone el <Ui>Volume</Ui> justo para que este archivo suene tan fuerte como el promedio de los
    <b>otros archivos de su pista</b> (con sus volúmenes). Es la forma rápida de que todos los bajos, o todas las
    baterías, salgan parejos. Con el mouse encima dice qué valor va a poner y contra cuántos archivos compara.
  </p>
  <ul>
    <li>Su LED se enciende cuando el volumen ya es ese: el archivo está emparejado.</li>
    <li>
      Queda apagado si no se puede calcular: el archivo no tiene pista, todavía no se midió o es el único medido de su
      pista.
    </li>
    <li>
      Si haría falta más de <Ui>+12</Ui> dB (o menos que el fondo del fader), queda en el tope y la placa lo dice
      debajo (<i>max +12 dB</i>).
    </li>
  </ul>
  <Note title="MATCH es un punto de partida">
    <p>
      Iguala la energía promedio, no cómo se siente cada sonido en la mezcla: un loop con mucho grave o con huecos puede
      necesitar un par de dB de más o de menos. Apretá MATCH, escuchalo en contexto (ver
      <a href="#editor_preview" @click.prevent="go('editor_preview')">Preview</a>) y retocá el fader de oído.
    </p>
  </Note>

  <h4>Weight</h4>
  <p>
    El knob <Ui>Weight</Ui> es el <Term t="weight">peso</Term> del archivo en el sorteo de su pista: de 0 a 32, 16 por
    defecto. Cuenta en relación con los otros candidatos: en una pista con cuatro loops de peso 16, cada uno sale un
    25 % de las veces; si a uno le ponés 32, ese sale un 40 % (32 de 80) y los otros un 20 %. Con 0 no sale nunca, sin
    sacarlo del proyecto: sirve para dejar un archivo "en el banco". Cómo se arma el sorteo está en
    <a href="#engine" @click.prevent="go('engine')">Cómo elige el motor</a>.
  </p>

  <h4>Repeat</h4>
  <p>
    Los pads <Ui>1</Ui> <Ui>2</Ui> <Ui>4</Ui> <Ui>8</Ui> <Ui>16</Ui> eligen cuántas <Term t="repeat">vueltas
    seguidas</Term> da el loop cada vez que sale sorteado. Un clic elige un valor; arrastrando sobre los pads marcás un
    rango (como los de <Ui>Tag change</Ui>), y en cada sorteo sale un valor de ese rango: debajo se lee
    <i>×1–4</i>. Por defecto, una vuelta.
  </p>
  <ul>
    <li>
      Mientras le quedan vueltas, la pista lo vuelve a tocar sin sortear ni descansar: un loop corto de 4 beats con
      Repeat 4 suena como uno de 16.
    </li>
    <li>Un cambio de Tag lo puede cortar antes, si el loop no tiene el Tag nuevo.</li>
    <li>Cuenta en las pistas de loops; una pista de one-shots toca cada disparo una sola vez.</li>
  </ul>
  <Note title="Weight o Repeat">
    <p>
      Los dos hacen que un archivo se escuche más, pero distinto: el peso lo hace salir más seguido, mezclado con los
      demás; Repeat lo deja sonar más tiempo cada vez que sale. Para un loop protagonista que querés oír entero varias
      veces, Repeat; para uno que conviene que aparezca seguido pero sin quedarse, Weight.
    </p>
  </Note>
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
