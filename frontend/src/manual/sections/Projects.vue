<template>
  <!-- sección "Proyectos" (id y título en ../sections.js): crear, abrir, renombrar, borrar, LINK, pregunta al entrar,
    RAM (components/Projects.vue, OpenProject.vue; helpers/composable.js: store_get_user_info, aviso de memoria).
    No hay visibilidad: todos los proyectos son públicos. Capturas: tomas "projects" y "open_project" de
    scripts/manual_shots.js -->
  <p>
    Cada cuenta puede tener varios <Term t="project">proyectos</Term>, y en la app tenés uno abierto por vez: su
    nombre se ve en el display <Ui>Project</Ui> de la barra de arriba. Todo lo que hacés (pistas, Tags, archivos,
    perillas) queda guardado en ese proyecto.
  </p>

  <h4>El diálogo PROJECTS</h4>
  <p>El botón <Ui>PROJECTS</Ui> de la barra muestra tus proyectos, cada uno como un cartucho:</p>
  <ManualShot src="/manual_shots/projects.webp" :max_width="760" alt="Diálogo Projects con los tres proyectos de la cuenta de demo"
    :callouts="[
      { n: 1, x: 90, y: 9, text: 'Nombre (hasta 64 caracteres) y CREATE (o Enter): crea un proyecto vacío y lo abre.' },
      { n: 2, x: 58, y: 33.5, text: 'El proyecto abierto: LED verde y LOADED.' },
      { n: 3, x: 45, y: 36, text: 'Cuánta memoria (RAM) ocupa al abrirlo, cuántos archivos tiene y la fecha.' },
      { n: 4, x: 64.8, y: 47.3, text: 'OPEN abre ese proyecto.' },
      { n: 5, x: 75.4, y: 47.3, text: 'RENAME le cambia el nombre.' },
      { n: 6, x: 85.9, y: 47.3, text: 'DELETE lo borra (pide confirmación).' },
      { n: 7, x: 63, y: 84.5, text: 'Recordatorio: todos los proyectos son públicos.' },
    ]" />
  <ul>
    <li>
      <b>Crear</b> y <b>abrir</b> cargan el proyecto en el acto. Si algo está sonando, Looper te avisa que va a parar
      la música (<Ui>Stop and continue</Ui>).
    </li>
    <li>
      <b>Borrar</b> saca el proyecto con sus pistas, sus Tags y su lista de archivos. Los audios <b>tuyos</b> que no
      use ningún otro proyecto también se borran (y vuelven a tu cuota, ver
      <a href="#audio" @click.prevent="go('audio')">Traer audio</a>). Los importados de otros usuarios quedan en el
      catálogo. No se puede deshacer.
    </li>
    <li>
      Si borrás tu único proyecto, Looper te crea uno vacío nuevo, <i>My project</i>, para que siempre tengas uno.
    </li>
  </ul>

  <h4>Todos son públicos</h4>
  <p>
    No hay proyectos privados: cualquiera puede abrir cualquier proyecto en modo lectura (escucharlo sin cambiar
    nada), y los que tienen al menos un archivo aparecen en la
    <a href="#gallery" @click.prevent="go('gallery')">galería</a>. Para pasarle uno a alguien, abrilo y apretá
    <Ui>LINK</Ui> en la barra: copia el link de la vista pública, que al cargar ofrece <Ui>PLAY</Ui> (ver
    <a href="#share" @click.prevent="go('share')">Compartir y denunciar</a>).
  </p>
  <p>
    Si un proyecto tuyo aparece marcado <Ui>hidden</Ui>, fue ocultado por moderación: no sale en la galería y su link
    no funciona (<Ui>LINK</Ui> queda deshabilitado), pero vos lo seguís abriendo y editando.
  </p>

  <h4>Al entrar: ¿abrir el último?</h4>
  <p>
    Cada vez que entrás a la app (al hacer login o al recargar la página), Looper te pregunta antes de cargar el
    último proyecto que usaste en ese navegador, así no carga audio que no vas a usar:
  </p>
  <ManualShot src="/manual_shots/open_project.webp" :max_width="440"
    alt="Diálogo Open project: pregunta si abrir Demo Psy Groove, con su RAM, archivos y fecha" />
  <ul>
    <li><Ui>OPEN</Ui> lo abre.</li>
    <li><Ui>OTHER...</Ui> abre el diálogo <Ui>PROJECTS</Ui> para elegir otro.</li>
    <li>
      <Ui>CANCEL</Ui> no abre ninguno: el display dice <Ui>NO PROJECT</Ui> hasta que abras uno desde
      <Ui>PROJECTS</Ui>.
    </li>
  </ul>

  <h4>La RAM</h4>
  <p>
    Para tocar sin cortes, el navegador tiene todos los audios del proyecto abierto en memoria (unos 21 MB por minuto
    de audio, sin importar el formato original). Por eso cada proyecto muestra su <Ui>RAM</Ui>. Si un proyecto pide
    más de lo recomendable para tu equipo, la cifra se marca en rojo y, al abrirlo, Looper te pregunta
    (<Ui>Large project</Ui>) si querés cargarlo igual: <Ui>Load anyway</Ui> lo abre, <Ui>Cancel</Ui> te deja en el
    que estabas.
  </p>
  <Note title="Proyectos livianos">
    <p>
      Unos pocos archivos por pista alcanzan para que suene variado. Si el proyecto crece mucho, el navegador puede
      ponerse lento o recargar la página, sobre todo en el celular.
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
