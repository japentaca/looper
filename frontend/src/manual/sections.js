// Secciones del manual (/manual), en el orden en que se leen. Ver docs/PLAN_MANUAL.md.
// id: ancla (/manual#<id>); NO se cambia una vez publicado (lo usan los links y los "?" de los diálogos).
// level: grupo del índice (LEVELS); num: número del índice (null en la introducción, letra en los apéndices).
// component: el cuerpo de la sección (sections/*.vue); el título lo pone Manual.vue.
import Intro from "./sections/Intro.vue"
import Overview from "./sections/Overview.vue"
import Glossary from "./sections/Glossary.vue"
import Gallery from "./sections/Gallery.vue"
import PublicProject from "./sections/PublicProject.vue"
import FirstProject from "./sections/FirstProject.vue"
import Account from "./sections/Account.vue"
import Projects from "./sections/Projects.vue"
import AudioSection from "./sections/Audio.vue"
import TrgTags from "./sections/TrgTags.vue"
import Files from "./sections/Files.vue"
import Play from "./sections/Play.vue"
import Engine from "./sections/Engine.vue"
import Mixer from "./sections/Mixer.vue"
import Share from "./sections/Share.vue"
import Editor from "./sections/Editor.vue"
import EditorRegion from "./sections/EditorRegion.vue"
import EditorEdits from "./sections/EditorEdits.vue"
import EditorPitch from "./sections/EditorPitch.vue"
import EditorLevel from "./sections/EditorLevel.vue"
import EditorPreview from "./sections/EditorPreview.vue"
import Fx from "./sections/Fx.vue"
import GlobalFx from "./sections/GlobalFx.vue"
import Shortcuts from "./sections/Shortcuts.vue"
import Kiosk from "./sections/Kiosk.vue"
import Troubleshooting from "./sections/Troubleshooting.vue"

// grupos del índice, en orden
export const LEVELS = [
  { id: "intro", title: "Introducción" },
  { id: "0", title: "Nivel 0 · Escuchar" },
  { id: "1", title: "Nivel 1 · Armar un proyecto" },
  { id: "2", title: "Nivel 2 · Afinar" },
  { id: "appendix", title: "Apéndices" },
]

export const SECTIONS = [
  { id: "intro", level: "intro", num: null, title: "Qué es Looper", component: Intro },
  { id: "overview", level: "intro", num: null, title: "La pantalla de un vistazo", component: Overview },
  { id: "glossary", level: "intro", num: null, title: "Glosario", component: Glossary },

  { id: "gallery", level: "0", num: 1, title: "Galería", component: Gallery },
  { id: "public_project", level: "0", num: 2, title: "Proyecto público", component: PublicProject },

  { id: "first_project", level: "1", num: 3, title: "Tu primer proyecto, paso a paso", component: FirstProject },
  { id: "account", level: "1", num: 4, title: "Cuenta", component: Account },
  { id: "projects", level: "1", num: 5, title: "Proyectos", component: Projects },
  { id: "audio", level: "1", num: 6, title: "Traer audio", component: AudioSection },
  { id: "trg_tags", level: "1", num: 7, title: "Track Groups y Tags", component: TrgTags },
  { id: "files", level: "1", num: 8, title: "Files", component: Files },
  { id: "play", level: "1", num: 9, title: "Tocar", component: Play },
  { id: "engine", level: "1", num: 10, title: "Cómo elige el motor", component: Engine },
  { id: "mixer", level: "1", num: 11, title: "Mixer", component: Mixer },
  { id: "share", level: "1", num: 12, title: "Compartir y denunciar", component: Share },

  { id: "editor", level: "2", num: 13, title: "El editor de un vistazo", component: Editor },
  { id: "editor_region", level: "2", num: 14, title: "Región", component: EditorRegion },
  { id: "editor_edits", level: "2", num: 15, title: "Ediciones", component: EditorEdits },
  { id: "editor_pitch", level: "2", num: 16, title: "Tono", component: EditorPitch },
  { id: "editor_level", level: "2", num: 17, title: "Volumen, loudness, Weight y Repeat", component: EditorLevel },
  { id: "editor_preview", level: "2", num: 18, title: "Preview", component: EditorPreview },
  { id: "fx", level: "2", num: 19, title: "FX de transición", component: Fx },
  { id: "global_fx", level: "2", num: 20, title: "Delay, reverb y COMP del master", component: GlobalFx },

  { id: "shortcuts", level: "appendix", num: "A", title: "Atajos de teclado", component: Shortcuts },
  { id: "kiosk", level: "appendix", num: "B", title: "Modo instalación", component: Kiosk },
  { id: "troubleshooting", level: "appendix", num: "C", title: "Problemas frecuentes", component: Troubleshooting },
]
