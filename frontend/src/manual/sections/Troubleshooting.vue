<template>
  <!-- sección "Problemas frecuentes" (id y título en ../sections.js): síntoma → causas → qué hacer, con links a la
    sección que lo explica. Verificado contra el código: overlay "Click to start" y aviso de pesos en 0
    (components/Tracks.vue), atenuados de Files (helpers/file_ui.js), chequeos de la subida (components/Uploader.vue y
    POST /upload en backend/routes/api.js: formatos, 1 min, 80 MB, cuota), aviso de memoria (helpers/composable.js),
    bloqueo del login y cuentas pendientes (POST /login), ediciones sin guardar (helpers/edit_session.js). La maqueta
    del overlay usa el LedButton real, sin función -->
  <p>Lo que más suele pasar y cómo resolverlo. Cada problema lleva a la sección que lo explica en detalle.</p>

  <h4>No suena nada</h4>
  <ul>
    <li>
      <b>Aparece <Ui>Click to start</Ui> encima de todo.</b> El navegador no deja sonar una página que todavía no
      tocaste: hacé clic en cualquier parte y arranca (o sigue, si dice <Ui>RESUME</Ui>). En una instalación, mirá el
      <a href="#kiosk" @click.prevent="go('kiosk')">modo instalación</a> para que no haga falta.
    </li>
    <li>
      <b><Ui>START</Ui> no responde.</b> Se habilita cuando terminan de cargar los audios: esperá a que el LED de la
      barra de arriba pase de <i>Loading</i> (amarillo) a <i>Ready</i> (verde). Si dice <Ui>NO PROJECT</Ui>, abrí un
      proyecto (ver <a href="#projects" @click.prevent="go('projects')">Proyectos</a>).
    </li>
    <li>
      <b>Los vúmetros se mueven pero no se oye.</b> Mirá el <Ui>Master</Ui>, los faders y los botones <Ui>M</Ui> /
      <Ui>S</Ui> de las tiras: con una pista en solo, las demás se callan (ver
      <a href="#mixer" @click.prevent="go('mixer')">Mixer</a>). Y fuera de Looper: el volumen del equipo, la salida de
      audio elegida y que la pestaña no esté silenciada.
    </li>
    <li>
      <b>Al dar START avisa <i>All tags have weight 0</i>.</b> Todos los Tags tienen peso 0, así que no sale ninguno y
      solo suenan los archivos sin Tags. Subí el peso de alguno en el lápiz de su pad (ver
      <a href="#trg_tags" @click.prevent="go('trg_tags')">Track Groups y Tags</a>).
    </li>
    <li>
      <b>Se fueron callando las pistas al cambiar el tempo.</b> Los loops que quedan fuera de la
      <Term t="tolerance">tolerancia</Term> dejan de salir: volvé a un tempo cercano o subí <Ui>Tol</Ui> (ver
      <a href="#play" @click.prevent="go('play')">Tocar</a>).
    </li>
  </ul>
  <p>Así se ve el cartel (esta maqueta no suena):</p>
  <div class="overlay_demo" role="img" aria-label="Maqueta del cartel Click to start: un botón START grande con su LED verde">
    <LedButton size="big" led="green" :lit="true" text="START" />
    <span class="silk">Click to start</span>
  </div>

  <h4>Un archivo no suena nunca</h4>
  <p>El motor solo sortea un archivo si cumple todo (ver <a href="#engine" @click.prevent="go('engine')">Cómo elige el motor</a>). Revisá, en este orden:</p>
  <ol>
    <li>
      <b>¿Está atenuado en <Ui>Files</Ui>?</b> Con el mouse encima dice por qué. <Ui>out of tempo</Ui>: su tempo queda
      demasiado lejos del proyecto; mové el tempo, subí <Ui>Tol</Ui> o corregí sus <Ui>Beats</Ui> en el editor.
      <Ui>unavailable</Ui>: el archivo ya no está disponible en Looper (ver
      <a href="#files" @click.prevent="go('files')">Files</a>).
    </li>
    <li>
      <b>¿Tiene pista?</b> Un archivo sin <Term t="track_group">Track Group</Term> (<i>no group</i>) no suena nunca:
      arrastrale el pad de una pista.
    </li>
    <li>
      <b>¿Sus Tags salen?</b> Solo suena mientras está activo alguno de sus <Term t="tag">Tags</Term>. Si sus Tags
      tienen peso 0, o salen poco, casi no lo vas a oír. Sin Tags vale para todos.
    </li>
    <li><b>¿Tiene peso?</b> Con <Ui>Weight</Ui> en 0 no sale nunca; con un peso bajo, sale poco (ver
      <a href="#editor_level" @click.prevent="go('editor_level')">Volumen, loudness, Weight y Repeat</a>).</li>
    <li>
      <b>¿Es un one-shot en una pista de loops?</b> Los <Term t="one_shot">one-shots</Term> solo los tocan las pistas en
      modo <Ui>SHOT</Ui>. O al revés: si es un loop marcado como <Ui>SHOT</Ui>, cambiale el tipo en el editor (si
      el archivo es tuyo; si no, ponelo en una pista SHOT).
    </li>
    <li>
      <b>¿Su pista está en silencio?</b> Un <Ui>M</Ui> encendido, otra pista en solo, o un <Ui>Rest</Ui> muy alto que la
      hace descansar casi siempre.
    </li>
  </ol>
  <p>
    Para escucharlo sin esperar al sorteo, usá el preview del editor con <Ui>SYNC</Ui> e <Ui>IN CONTEXT</Ui> (ver
    <a href="#editor_preview" @click.prevent="go('editor_preview')">Preview</a>).
  </p>

  <h4>Un loop suena corrido o hace click</h4>
  <ul>
    <li>
      <b>Se adelanta o se atrasa respecto de las otras pistas:</b> probablemente sus <Ui>Beats</Ui> están mal (15 en
      vez de 16). Mirá si las líneas de la grilla caen sobre los golpes (ver
      <a href="#editor" @click.prevent="go('editor')">El editor de un vistazo</a>).
    </li>
    <li>
      <b>Entra apenas tarde:</b> trae silencio al principio. Corregilo con <Ui>NUDGE</Ui> o <Ui>AUTO</Ui> (ver
      <a href="#editor_region" @click.prevent="go('editor_region')">Región</a>).
    </li>
    <li>
      <b>Hace "tic" cada vez que vuelve a empezar:</b> la costura no empalma. Mirala en la lupa <Ui>SEAM</Ui> y subí
      unos ms de <Ui>FADE</Ui>.
    </li>
  </ul>

  <h4>La subida rechaza un archivo</h4>
  <p>El aviso dice el motivo. Los límites son por archivo (ver <a href="#audio" @click.prevent="go('audio')">Traer audio</a>):</p>
  <ul>
    <li><b>Formato no aceptado:</b> solo mp3, wav, ogg, flac, m4a y aiff. Convertilo antes con otro programa.</li>
    <li>
      <b>Dura más de 1 minuto:</b> el servidor lo rechaza. Cortalo antes con un editor de audio, en partes de hasta un
      minuto (los loops rara vez necesitan más).
    </li>
    <li><b>Supera los 80 MB:</b> pasa con wav o aiff de muy alta calidad; exportalo a 44,1 o 48 kHz, o en mp3.</li>
    <li>
      <b>Ya hay uno con ese nombre:</b> en un mismo proyecto no puede haber dos archivos con el mismo nombre. Renombralo
      antes de subirlo.
    </li>
    <li><b>No es un archivo de audio válido:</b> el archivo está dañado o no es audio aunque tenga esa extensión.</li>
  </ul>

  <h4>Se llenó la cuota</h4>
  <p>
    Arriba del recuadro de subida dice <i>Llegaste a tu cuota</i> y <Ui>UPLOAD</Ui> queda deshabilitado; o la subida
    avisa que no te alcanza para ese archivo. Tu <Term t="quota">cuota</Term> suma todo lo que subiste, en todos tus
    proyectos, más las copias que guardaste en el editor. Para liberar lugar:
  </p>
  <ul>
    <li>
      Borrá archivos tuyos que no uses, con el tacho de <Ui>Files</Ui>. Ojo: se borran de todos los proyectos que los
      usen, también de los de otros (ver <a href="#files" @click.prevent="go('files')">Files</a>).
    </li>
    <li>Borrá proyectos viejos: sus audios tuyos que no use otro proyecto se borran con ellos.</li>
    <li>Importá del <Term t="catalog">catálogo</Term> en vez de subir: importar no gasta cuota.</li>
  </ul>
  <p>
    Si el aviso dice que <i>el servidor está sin espacio</i>, no es tu cuota: las subidas están suspendidas para todos por
    un rato.
  </p>

  <h4>El proyecto es pesado</h4>
  <p>
    La <Ui>RAM</Ui> se marca en rojo, al abrirlo aparece <Ui>Large project</Ui>, o el navegador se pone lento y hasta
    recarga la página (sobre todo en el celular). Todos los audios del proyecto se tienen en memoria para tocar sin
    cortes, unos 21 MB por minuto de audio (ver <a href="#projects" @click.prevent="go('projects')">Proyectos</a>).
  </p>
  <ul>
    <li>Sacá archivos que casi no suenan: unos pocos por pista alcanzan para que sea variado.</li>
    <li>Dividilo en dos proyectos (por ejemplo, uno por estilo o por tonalidad).</li>
    <li>Cerrá otras pestañas pesadas, o abrilo en un equipo con más memoria.</li>
  </ul>

  <h4>No puedo entrar</h4>
  <ul>
    <li>
      <b><i>Tu cuenta está pendiente de aprobación</i>:</b> las cuentas nuevas esperan a que las admitan. No hay que
      hacer nada más: probá de nuevo más adelante (ver <a href="#account" @click.prevent="go('account')">Cuenta</a>).
    </li>
    <li>
      <b><i>Usuario o clave inválida</i>:</b> revisá el email y la clave (las mayúsculas cuentan en la clave, no en el
      email).
    </li>
    <li>
      <b><i>Demasiados intentos</i>:</b> después de 10 intentos fallidos el login se bloquea por 15 minutos, contados
      desde el primer fallo. Esperá y probá de nuevo con calma.
    </li>
    <li>
      <b>El LED de estado está rojo y dice <Ui>No session</Ui>:</b> se perdió la sesión; la música sigue, pero los
      cambios no se guardan. Pará el transporte y volvé a entrar con <Ui>LOGIN</Ui>.
    </li>
  </ul>

  <h4>Perdí cambios</h4>
  <ul>
    <li>
      <b>Ediciones del editor</b> (CUT, REVERSE, STRETCH...): viven solo en el navegador hasta que las guardás con
      <Ui>SAVE AS COPY</Ui>. Cerrar el editor o pasar a otro archivo pregunta antes de descartarlas, pero recargar la
      página o cerrar la pestaña las pierde sin aviso (ver <a href="#editor_edits" @click.prevent="go('editor_edits')">Ediciones</a>).
    </li>
    <li>
      <b>Mute y solo</b> no se guardan nunca, a propósito: al recargar vuelven a estar apagados.
    </li>
    <li>
      <b>En un proyecto ajeno o en la vista pública</b> no se guarda nada: es modo lectura (ver
      <a href="#public_project" @click.prevent="go('public_project')">Proyecto público</a>).
    </li>
    <li>
      Todo lo demás (perillas, pistas, Tags, región, volumen, transpose) se guarda solo al soltar el control. Si no
      quedó, mirá si el LED de estado dice <Ui>No session</Ui>.
    </li>
  </ul>
</template>

<script setup>
import { useRouter } from "vue-router"
import Term from "../Term.vue"
import Ui from "../Ui.vue"
import LedButton from "../../components/hw/LedButton.vue"
import { go_anchor } from "../nav"

const router = useRouter()
const go = id => go_anchor(router, id)
</script>

<style scoped>
/* maqueta del overlay de Tracks.vue (fondo oscuro, botón grande y la serigrafía), sin función: no tapa nada */
.overlay_demo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  max-width: 360px;
  margin: 12px 0 18px;
  padding: 24px 16px;
  border: 3px solid #0b0b0c;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.72);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

@media print {
  .overlay_demo {
    background: none;
    box-shadow: none;
    border-color: #999;
  }

  .overlay_demo .silk {
    color: #111;
  }
}
</style>
