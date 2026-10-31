<template>
  <!-- sección "Compartir y denunciar" (id y título en ../sections.js): proyectos públicos, LINK (/p/<id>?play=1),
    galería, qué hacen los visitantes, REPORT (components/ReportDialog.vue: galería, /p/:id e IMPORT; solo con sesión)
    y la marca hidden. Sin funciones de admin. Captura: toma "report" de scripts/manual_shots.js -->
  <p>
    En Looper todo es público: no hace falta configurar nada para compartir. Cada
    <Term t="project">proyecto</Term> se puede escuchar sin cuenta, y cada archivo que subís queda en el
    <Term t="catalog">catálogo</Term> para que otros lo usen.
  </p>

  <h4>Pasar el link de un proyecto</h4>
  <ol>
    <li>Abrí el proyecto en la app.</li>
    <li>Apretá <Ui>LINK</Ui> en la barra de arriba: el link queda copiado (aparece <i>Link copiado</i>).</li>
    <li>Pegalo donde quieras: un mensaje, una red, un mail.</li>
  </ol>
  <p>
    Si el navegador no deja copiar, Looper muestra el link en un cartel para que lo copies a mano. Es un link a la
    vista pública que termina en <code>?play=1</code>: quien lo abre ve cargar los audios y después un botón
    <Ui>PLAY</Ui> para empezar a escuchar. Siempre muestra el proyecto como está guardado en ese momento: si después
    lo cambiás, el que lo vuelva a abrir escucha la versión nueva.
  </p>

  <h4>La galería</h4>
  <p>
    No hace falta pasar el link: todos los proyectos que tienen al menos un archivo aparecen solos en la
    <a href="#gallery" @click.prevent="go('gallery')">galería</a>, los más nuevos primero. No hay proyectos privados;
    si estás probando algo que no querés mostrar, dejalo sin archivos o borralo al terminar.
  </p>

  <h4>Qué puede hacer quien lo abre</h4>
  <p>
    Escucharlo con el mismo motor que vos, arrancarlo y pararlo, cambiar el tempo, la tolerancia, el master y los
    volúmenes, mute y solo de cada pista. Nada de eso se guarda ni te cambia el proyecto: es solo para su sesión. Lo
    cuenta <a href="#public_project" @click.prevent="go('public_project')">Proyecto público</a>. Para dejarlo sonando
    solo en una pantalla, mirá el <a href="#kiosk" @click.prevent="go('kiosk')">modo instalación</a>.
  </p>

  <h4>Denunciar algo que no corresponde</h4>
  <p>
    Si encontrás un proyecto o un archivo que no debería estar (audio con derechos de otro, contenido ofensivo,
    spam), podés denunciarlo para que lo revise la moderación. Hace falta haber entrado con tu cuenta, y no se puede
    denunciar lo propio. El botón está en tres lugares:
  </p>
  <ul>
    <li>En la <a href="#gallery" @click.prevent="go('gallery')">galería</a>: <Ui>REPORT</Ui>, abajo a la derecha de cada tarjeta.</li>
    <li>En un proyecto público ajeno: <Ui>REPORT</Ui> en la barra de arriba.</li>
    <li>
      En el catálogo (<Ui>IMPORT</Ui>): el signo de exclamación al final de la fila de un archivo (ver
      <a href="#audio" @click.prevent="go('audio')">Traer audio</a>).
    </li>
  </ul>
  <ManualShot src="/manual_shots/report.webp" :max_width="460" alt="Diálogo Report file con el motivo escrito"
    caption="Denunciando un archivo del catálogo" :callouts="[
      { n: 1, x: 93, y: 29.3, text: 'Qué estás denunciando: un archivo (File) o un proyecto (Project).' },
      { n: 2, x: 92.2, y: 40.6, text: 'El motivo, obligatorio: hasta 500 caracteres.' },
      { n: 3, x: 77.5, y: 72, text: 'REPORT la envía; CANCEL cierra sin enviar.' },
    ]" />
  <p>
    Al enviarla aparece <i>Report sent: an admin will review it.</i> Si ya habías denunciado lo mismo y todavía no la
    revisaron, no se duplica (<i>You already reported this</i>). Hay un tope de 20 denuncias por día.
  </p>

  <h4>Lo oculto por moderación</h4>
  <p>Si la moderación decide que algo no corresponde, lo oculta:</p>
  <ul>
    <li>
      Un <b>proyecto oculto</b> sale de la galería y su link deja de andar (<i>Project not found</i>). Si es tuyo, lo
      seguís abriendo y editando: en <Ui>PROJECTS</Ui> aparece marcado <Ui>hidden</Ui> y <Ui>LINK</Ui> queda
      deshabilitado (ver <a href="#projects" @click.prevent="go('projects')">Proyectos</a>).
    </li>
    <li>
      Un <b>archivo oculto</b> sale del catálogo, y en los proyectos que lo usan queda atenuado como
      <Ui>unavailable</Ui>: ya no se sortea (ver <a href="#files" @click.prevent="go('files')">Files</a>).
    </li>
  </ul>
</template>

<script setup>
import { useRouter } from "vue-router"
import ManualShot from "../ManualShot.vue"
import Term from "../Term.vue"
import Ui from "../Ui.vue"
import { go_anchor } from "../nav"

const router = useRouter()
const go = id => go_anchor(router, id)
</script>

<style scoped>
code {
  font-family: var(--font_mono);
  color: var(--hw_silk);
}

@media print {
  code {
    color: #111;
  }
}
</style>
