<template>
  <!-- sección "Cuenta" (id y título en ../sections.js): registro con licencia, espera de admisión, login, bio, clave
    (components/Login.vue, Account.vue; límites en backend/routes/api.js). Capturas: tomas "login", "register" y
    "account" de scripts/manual_shots.js (el registro con datos inventados, sin mandar) -->
  <p>
    Para escuchar no hace falta cuenta, pero sí para armar tus propios proyectos, subir audio e importar del
    <Term t="catalog">catálogo</Term>.
  </p>

  <h4>Crear la cuenta</h4>
  <ol>
    <li>Apretá <Ui>LOGIN</Ui> en la barra de arriba y, abajo del diálogo, <Ui>Create an account</Ui>.</li>
    <li>Completá los datos y tildá <Ui>Acepto la licencia</Ui> (sin eso, <Ui>REGISTER</Ui> no se habilita).</li>
    <li>Apretá <Ui>REGISTER</Ui>. El diálogo vuelve al login con el aviso de que tu solicitud quedó pendiente.</li>
  </ol>
  <ManualShot src="/manual_shots/register.webp" :max_width="460" alt="Diálogo Create account completo con datos de ejemplo"
    caption="El registro, con datos de ejemplo" :callouts="[
      { n: 1, x: 92.2, y: 19.6,
        text: 'Public name: tu nombre en la galería y en el catálogo. De 3 a 32 caracteres (letras, números, espacio, punto, guion y guion bajo) y único.' },
      { n: 2, x: 92.2, y: 50.7, text: 'Bio: opcional y pública (hasta 280 caracteres); se ve junto a tus proyectos.' },
      { n: 3, x: 92.2, y: 66.3, text: 'La licencia: hay que aceptarla para registrarse.' },
      { n: 4, x: 93.9, y: 91, text: 'REGISTER manda la solicitud.' },
    ]" />
  <p>La clave tiene que tener entre 8 y 72 caracteres, y se escribe dos veces.</p>
  <Note title="La licencia">
    <p>
      Todo lo que subas queda en el catálogo público de Looper: cualquier usuario puede escucharlo, importarlo en sus
      proyectos y reproducirlo dentro de Looper, sin pedirte permiso ni pagarte. La licencia no cubre usos fuera de
      Looper. Subí solo audio que puedas compartir así.
    </p>
  </Note>

  <h4>La espera</h4>
  <p>
    Las cuentas nuevas no se activan solas: quedan <b>pendientes</b> hasta que las admiten. Mientras tanto, si
    intentás entrar, el login te avisa que tu cuenta está pendiente de aprobación. Cuando la admitan, entrás
    normalmente.
  </p>

  <h4>Entrar y salir</h4>
  <ManualShot src="/manual_shots/login.webp" :max_width="380" alt="Diálogo Login vacío" :callouts="[
    { n: 1, x: 92.6, y: 78, text: 'Con tu email y tu clave, LOGIN (o Enter).' },
    { n: 2, x: 78.9, y: 93.7, text: 'Create an account lleva al registro.' },
  ]" />
  <ul>
    <li>
      Al entrar, Looper te pregunta si querés abrir el último proyecto que usaste (ver
      <a href="#projects" @click.prevent="go('projects')">Proyectos</a>).
    </li>
    <li>
      Después de muchos intentos fallidos seguidos, el login se bloquea por 15 minutos.
    </li>
    <li><Ui>LOGOUT</Ui>, arriba a la derecha, cierra la sesión.</li>
  </ul>
  <Note type="warn" title="LED rojo: No session">
    <p>
      Si el LED de estado de la barra se pone rojo y dice <Ui>No session</Ui>, se perdió la sesión con el servidor (por
      ejemplo, si apretaste <Ui>LOGOUT</Ui> en otra pestaña). La música sigue sonando, pero <b>los cambios ya no se
      guardan</b>. Detené el transporte y volvé a entrar con <Ui>LOGIN</Ui>.
    </p>
  </Note>

  <h4>Tu cuenta: bio y clave</h4>
  <p>El botón <Ui>ACCOUNT</Ui> de la barra abre los datos de tu cuenta:</p>
  <ManualShot src="/manual_shots/account.webp" :max_width="440" alt="Diálogo Account de la cuenta de demo" :callouts="[
    { n: 1, x: 44, y: 10.6, text: 'Tu nombre público y tu email (no se cambian desde acá).' },
    { n: 2, x: 92.7, y: 17.8, text: 'Bio (public): editala y apretá SAVE BIO.' },
    { n: 3, x: 92.7, y: 42.9,
      text: 'Change password: la clave actual y dos veces la nueva (8 a 72 caracteres), y CHANGE PASSWORD. La sesión sigue abierta.' },
  ]" />
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
