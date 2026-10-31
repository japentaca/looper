<template>
  <!-- sección "Modo instalación" (id y título en ../sections.js): Chrome en kiosko con el link público
    /p/<id>?autostart=1, sin login; el flag de autoplay, qué esperar, cómo se recupera sola. Lo que hacen hoy
    views/PublicProject.vue (reintento de la carga), components/Tracks.vue (autostart, overlay, reanudar el
    AudioContext) y helpers/composable.js (sin aviso de memoria con autostart). El detalle técnico está en
    docs/INSTALACION.md (para el dueño) -->
  <p>
    Looper puede quedar sonando solo durante horas, sin nadie al lado: en una muestra, un local, una pantalla en una
    sala. Para eso se usa el link público del <Term t="project">proyecto</Term> con un agregado,
    <code>?autostart=1</code>, abierto en Chrome a pantalla completa (el modo <i>kiosko</i>). No hace falta cuenta ni
    login en ese equipo.
  </p>

  <h4>1 · Prepará el proyecto</h4>
  <ul>
    <li>
      Armalo desde la app, con tu cuenta, como cualquier otro: pistas, Tags, volúmenes, descansos, FX, tempo y compás.
      Todo eso queda guardado y es lo que va a sonar.
    </li>
    <li>
      Escuchalo un buen rato antes: que ninguna pista quede muy fuerte, que los Tags cambien como querés (los pads
      <Ui>Tag change</Ui>, ver <a href="#play" @click.prevent="go('play')">Tocar</a>) y que nada quede callado por la
      <Term t="tolerance">tolerancia</Term>.
    </li>
    <li>
      Preferí un proyecto liviano (mirá su <Ui>RAM</Ui> en <a href="#projects" @click.prevent="go('projects')">Proyectos</a>):
      en modo instalación no se pregunta por la memoria, se carga igual.
    </li>
  </ul>

  <h4>2 · Armá el link</h4>
  <p>
    Abrí el proyecto y apretá <Ui>LINK</Ui> (ver <a href="#share" @click.prevent="go('share')">Compartir y denunciar</a>):
    copia el link de la vista pública, que termina en <code>?play=1</code>. Cambiá ese final por
    <code>?autostart=1</code>:
  </p>
  <pre class="cmd">https://looper.jape.com.ar/p/<i>&lt;id del proyecto&gt;</i>?autostart=1</pre>
  <p>Las dos terminaciones hacen cosas distintas:</p>
  <dl class="modes">
    <dt><code>?play=1</code> · para compartir</dt>
    <dd>
      Al terminar de cargar espera que alguien apriete <Ui>PLAY</Ui>, y si el proyecto es pesado, pregunta antes de
      cargarlo.
    </dd>
    <dt><code>?autostart=1</code> · para una instalación</dt>
    <dd>
      Apenas terminan de cargar los audios (el LED de la barra pasa a <i>Ready</i>) hace <Ui>START</Ui> solo, sin
      preguntar nada. Es una vez por carga de la página: si alguien aprieta <Ui>STOP</Ui>, no vuelve a arrancar hasta
      que se recargue.
    </dd>
  </dl>

  <h4>3 · Abrilo en Chrome en modo kiosko</h4>
  <p>
    Los navegadores no dejan sonar una página que nadie tocó. Para una instalación hay que abrir Chrome con un permiso
    especial, <code>--autoplay-policy=no-user-gesture-required</code>, que le deja arrancar el audio solo. Con
    <code>--kiosk</code> queda a pantalla completa, sin barras. En Windows, un acceso directo con este comando (en una
    sola línea, con tu link al final):
  </p>
  <pre class="cmd">"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required --user-data-dir=C:\looper-chrome --no-first-run --hide-crash-restore-bubble "<i>tu link con ?autostart=1</i>"</pre>
  <ul>
    <li>
      <code>--user-data-dir</code> usa un perfil de Chrome solo para Looper. Sin eso, si ya había un Chrome abierto, el
      comando abre una pestaña común y no aplica los permisos.
    </li>
    <li>Para salir del modo kiosko: <Kbd>Alt</Kbd>+<Kbd>F4</Kbd>.</li>
    <li>
      Configurá el equipo para que no se suspenda (apagar la pantalla no corta el audio) y, si querés que vuelva solo
      después de un corte de luz, que Chrome se abra al iniciar la sesión, con unos segundos de demora para que haya red.
    </li>
  </ul>
  <Note type="warn" title="Si aparece Click to start">
    <p>
      Si Chrome no tiene el permiso de autoplay (por ejemplo, porque se abrió sin el acceso directo), la página carga
      pero no puede sonar sola: muestra un botón grande con <Ui>Click to start</Ui> encima de todo. Un clic en cualquier
      parte arranca. Para que no haga falta, revisá el comando de arriba.
    </p>
  </Note>

  <h4>Qué esperar</h4>
  <ul>
    <li>
      Se ve la <a href="#public_project" @click.prevent="go('public_project')">vista pública</a> del proyecto, en modo
      lectura: carga los audios (el anillo de LEDs) y arranca solo, sin diálogos.
    </li>
    <li>
      Lo que alguien toque ahí (tempo, volúmenes, mute) no se guarda: al recargar, vuelve a sonar como está guardado.
    </li>
    <li>
      Los cambios que hagas al proyecto desde la app llegan a la instalación la próxima vez que se cargue la página
      (recargala, o cerrá y abrí el acceso directo).
    </li>
  </ul>

  <h4>Cómo se recupera sola</h4>
  <ul>
    <li>
      <b>El audio se cortó</b> (otra aplicación tomó la placa de sonido, cambió la salida, el sistema lo suspendió):
      Looper reintenta solo, cada vez más espaciado (hasta cada 30 segundos), sin rendirse. Mientras tanto la música
      queda congelada y al volver sigue donde estaba. Si los primeros intentos fallan, aparece además el botón
      <Ui>RESUME</Ui>: un clic lo reanuda.
    </li>
    <li>
      <b>Se cayó la red o el servidor mientras suena</b>: no pasa nada, los audios ya están en el equipo.
    </li>
    <li>
      <b>El servidor no responde al cargar</b>: la página muestra el error con <i>Retrying in N s...</i> y vuelve a
      probar sola (hasta cada 60 segundos); cuando responde, carga y arranca. Si Chrome ni siquiera pudo bajar la página
      (sin red al abrirse), muestra su propia página de error: por eso conviene la demora al iniciar.
    </li>
    <li>
      <b>Project not found</b>: el proyecto se borró o se ocultó. Eso no se reintenta; hay que arreglar el link y
      recargar.
    </li>
    <li><b>Algún audio no cargó</b>: aparece un aviso con los archivos que fallaron y el resto suena igual.</li>
  </ul>

  <Note title="Antes de dejarla sola">
    <p>
      Hacé una prueba larga, de varias horas, con el proyecto tal cual va a quedar: que arranque solo con el acceso
      directo, que los Tags cambien, que no haya cortes ni pistas trabadas. Los detalles técnicos (arranque con Windows,
      la prueba larga, la recuperación) están en <code>docs/INSTALACION.md</code>, en el repositorio de Looper, para
      quien administra el equipo.
    </p>
  </Note>
</template>

<script setup>
import { useRouter } from "vue-router"
import Note from "../Note.vue"
import Term from "../Term.vue"
import Ui from "../Ui.vue"
import Kbd from "../Kbd.vue"
import { go_anchor } from "../nav"

const router = useRouter()
const go = id => go_anchor(router, id)
</script>

<style scoped>
code {
  font-family: var(--font_mono);
  color: var(--hw_silk);
}

/* comando o link para copiar: pantalla hundida, corta líneas para no desbordar en celular */
.cmd {
  margin: 10px 0;
  padding: 10px 12px;
  border: 2px solid #0b0b0c;
  border-radius: 4px;
  background: var(--bg);
  box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.6);
  color: var(--hw_silk);
  font-family: var(--font_mono);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.cmd i {
  color: var(--accent);
}

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

@media print {
  .cmd {
    background: none;
    box-shadow: none;
    border-color: #999;
  }

  .cmd,
  .cmd i,
  code,
  .modes dt {
    color: #111;
  }
}
</style>
