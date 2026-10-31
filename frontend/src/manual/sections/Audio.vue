<template>
  <!-- sección "Traer audio" (id y título en ../sections.js): subir (formatos, 1 min, 80 MB, cuota; components/Uploader.vue
    y POST /upload en backend/routes/api.js) e importar del catálogo (components/ImportFiles.vue). Capturas: tomas
    "upload" (con wav sintéticos elegidos y sin subir) e "import" de scripts/manual_shots.js -->
  <p>Hay dos maneras de sumar archivos al proyecto abierto:</p>
  <ul>
    <li><b>Subir</b> tus propios audios, desde el panel <Ui>Upload Files</Ui> (debajo del mixer).</li>
    <li>
      <b>Importar</b> audios que ya están en Looper, del <Term t="catalog">catálogo</Term>, con el botón
      <Ui>IMPORT</Ui> de la barra de arriba.
    </li>
  </ul>
  <p>
    En los dos casos el archivo entra al proyecto <b>sin pista ni Tags</b>: después se los asignás arrastrando los pads
    (ver <a href="#trg_tags" @click.prevent="go('trg_tags')">Track Groups y Tags</a>).
  </p>

  <h4>Subir</h4>
  <ol>
    <li>Abrí el panel <Ui>Upload Files</Ui> con un clic en su título.</li>
    <li>Arrastrá tus archivos al recuadro, o hacé clic en <Ui>Select files</Ui> para elegirlos. Podés elegir varios.</li>
    <li>Revisá cada fila de la lista (tipo, beats, tonalidad; ver abajo) y corregí lo que haga falta.</li>
    <li>Apretá <Ui>UPLOAD</Ui>. Se suben de a uno: cada fila muestra el avance, después <Ui>MP3…</Ui> mientras se convierte y al final <Ui>OK</Ui>.</li>
  </ol>
  <p>
    Antes de subir, cada fila avisa en rojo lo que el servidor rechazaría (un archivo de más de 1 minuto, o un loop
    cuyos beats dan un BPM fuera de 20 a 400): esos no se suben hasta que lo corrijas, y el número de
    <Ui>UPLOAD</Ui> cuenta solo los que sí. En amarillo, avisos que no frenan la subida: que el navegador no pudo
    leer el archivo, o que probablemente no entre en tu cuota. Si el servidor rechaza un archivo, el motivo queda en
    su fila.
  </p>
  <ManualShot src="/manual_shots/upload.webp" alt="Panel Upload Files con cinco archivos elegidos, todavía sin subir"
    caption="Cinco archivos elegidos, antes de apretar UPLOAD" :callouts="[
      { n: 1, x: 30.1, y: 7.5, text: 'Cuánto audio te queda en tu cuota.' },
      { n: 2, x: 98.6, y: 11.2, text: 'Soltá acá los archivos, o hacé clic en Select files.' },
      { n: 3, x: 69.2, y: 38.9,
        text: 'Type: Loop (se acomoda al tempo del proyecto) o Shot (un golpe suelto, suena a su velocidad original).' },
      { n: 4, x: 77.5, y: 38.9,
        text: 'Beats: cuántos beats dura el loop; abajo, el BPM que da. Viene una sugerencia: auto si se detectó el pulso en el audio.' },
      { n: 5, x: 85, y: 38.9,
        text: 'Key: la tonalidad, o atonal para baterías y ruidos. Si el nombre del archivo la trae, viene puesta (auto).' },
      { n: 6, x: 93.7, y: 38.9, to: 'editor', text: 'Anchor: solo para one-shots; si no sabés, dejá Start.' },
      { n: 7, x: 63.8, y: 83, text: 'Un archivo de más de 1 minuto: no se va a subir (UPLOAD lo saltea). La ✕ de la derecha lo saca de la lista.' },
      { n: 8, x: 10.8, y: 98.3, text: 'UPLOAD sube los que están en la lista.' },
    ]" />

  <h4>Qué se puede subir</h4>
  <ul>
    <li>Formatos: mp3, wav, ogg, flac, m4a y aiff.</li>
    <li>Hasta <b>1 minuto</b> y <b>80 MB</b> por archivo.</li>
    <li>No dos archivos con el mismo nombre en el mismo proyecto.</li>
    <li>
      Todo se convierte a MP3 y se nivela a un volumen parejo, así los archivos de distintas fuentes suenan
      parecido.
    </li>
  </ul>

  <h4>Beats, tipo y tonalidad</h4>
  <p>
    Lo más importante es que los <Term t="beat">beats</Term> de cada loop estén bien: con ellos Looper calcula su
    <Term t="bpm">BPM</Term> y lo acelera o lo frena para que entre en el tempo del proyecto. Un loop de 4
    <Term t="bar">compases</Term> de 4/4 dura 16 beats; uno de 8 compases, 32. Si el BPM que aparece abajo no es el que
    esperabas, corregí los beats.
  </p>
  <p>
    Las sugerencias pueden fallar. En la captura, <i>Impact_01.wav</i> es un golpe suelto, pero vino como un loop de 3
    beats: hay que cambiarlo a <Ui>Shot</Ui>. Los <Term t="one_shot">one-shots</Term> solo suenan en pistas en modo
    one-shot (ver <a href="#mixer" @click.prevent="go('mixer')">Mixer</a>).
  </p>
  <p>
    La <Term t="key">tonalidad</Term> no cambia cómo suena: sirve para filtrar la lista de archivos y el catálogo, y
    para que combines bajos y sintes que vayan juntos. Todo esto se puede corregir después en el editor (ver
    <a href="#editor" @click.prevent="go('editor')">El editor de un vistazo</a>).
  </p>

  <h4>La cuota</h4>
  <p>
    Cada cuenta tiene una <Term t="quota">cuota</Term>: un máximo de minutos de audio subido (por ejemplo, 20 minutos), que se cuenta sobre todos tus
    archivos, de todos tus proyectos. Arriba del recuadro dice cuánto te queda. Cuando borrás un archivo tuyo, ese
    tiempo vuelve a estar disponible. Importar del catálogo no gasta cuota.
  </p>
  <Note type="warn" title="Lo que subís es público">
    <p>
      Por la licencia que aceptaste al registrarte, todo lo que subís queda en el catálogo: otros usuarios pueden
      escucharlo e importarlo en sus proyectos (ver <a href="#account" @click.prevent="go('account')">Cuenta</a>).
    </p>
  </Note>

  <h4>Importar del catálogo</h4>
  <p>
    El catálogo son todos los archivos subidos a Looper, tuyos y de los demás. Importar no copia nada: tu proyecto usa
    el archivo tal como está. Con un proyecto abierto, apretá <Ui>IMPORT</Ui>:
  </p>
  <ManualShot src="/manual_shots/import.webp" :max_width="960" alt="Diálogo Import from catalog filtrado por Bass_Loop, con dos archivos elegidos"
    caption="Buscando bajos: dos elegidos para importar" :callouts="[
      { n: 1, x: 97, y: 11.2,
        text: 'Filtros: parte del nombre, creador, tipo, BPM (con su margen ±; = TEMPO usa el del proyecto), beats y tonalidad (+ atonal suma los atonales). SEARCH o Enter busca; CLEAR los borra.' },
      { n: 2, x: 3.4, y: 24.2, text: 'Tildá los archivos que querés importar (la selección se mantiene al cambiar de página o de filtro).' },
      { n: 3, x: 7.8, y: 24.2, text: 'Escuchá un archivo antes de importarlo.' },
      { n: 4, x: 76.9, y: 24.2, text: 'Quién lo subió (un clic en el nombre filtra por ese creador) y en cuántos proyectos se usa.' },
      { n: 5, x: 67, y: 88.6, text: 'Memoria: lo que ocupa el proyecto más lo elegido, sobre lo recomendable para tu equipo.' },
      { n: 6, x: 93, y: 88.5, text: 'IMPORT los suma al proyecto abierto.' },
    ]" />
  <ul>
    <li>
      La lista no muestra lo que ya está en el proyecto (abajo a la izquierda dice cuántos quedan). Los tuyos aparecen
      con la marca <Ui>mine</Ui>.
    </li>
    <li>Si lo elegido pasa la memoria recomendable, Looper te pregunta antes de importar (<Ui>Import anyway</Ui>).</li>
    <li>
      El signo de exclamación al final de cada fila sirve para denunciar un archivo que no corresponde (ver
      <a href="#share" @click.prevent="go('share')">Compartir y denunciar</a>).
    </li>
  </ul>
  <Note type="warn" title="Los importados son de otro">
    <p>
      Si su creador borra un archivo, desaparece también de tu proyecto. Y al revés: si sacás de tu proyecto un archivo
      importado, solo sale de tu proyecto; sigue en el catálogo.
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
