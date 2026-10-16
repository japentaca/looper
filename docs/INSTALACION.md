# Looper como instalación: arranque solo y recuperación

Cómo dejar Looper corriendo horas sin nadie al lado (fase 6 de `docs/PLAN_instalacion.md`; desde la
fase 4 de `docs/PLAN_PUBLICACION.md` la instalación usa el **link público** del proyecto).
Detalle técnico en `docs/ARCHITECTURE.md`, secciones "Autostart y recuperación" y "Modo lectura".

## Requisitos

- Un proyecto con sus archivos, Tracks y Tags ya configurados (volumen, Rest, modo, Rev, Dly, FX,
  tempo y compás se guardan en el proyecto y se recuperan al cargar). Se configura desde la app
  (`https://looper.jape.com.ar/`, con sesión), como siempre.
- Todos los proyectos son públicos; el del kiosko no tiene que estar oculto por el
  admin, con el dueño `active`. Si no, el link da "Project not found" y no suena nada.
- El id del proyecto: es el `<id>` del link público (`/p/<id>`), el mismo que se ve en la galería
  (`/gallery`) al abrir el proyecto.
- El equipo con conexión a internet y sin suspensión ni hibernación (Windows: Configuración →
  Sistema → Inicio/apagado y suspensión → "Nunca"). Apagar la pantalla no corta el audio.

**No hace falta login**: el link público funciona sin sesión, en modo lectura (START/STOP, tempo y
mixer local; nada se guarda).

## Autostart: `?autostart=1`

Con `?autostart=1` en la URL, apenas terminan de cargar los audios (el LED de la barra superior
pasa de amarillo "Loading" a verde "Ready") se hace START solo. El link de la instalación es:

```
https://looper.jape.com.ar/p/<id>?autostart=1
```

(En desarrollo: `http://localhost:31201/p/<id>?autostart=1`. El link viejo de la app,
`/?autostart=1`, sigue funcionando pero necesita sesión: ver "Sin link público" abajo.)

- Es una vez por carga de página: si después se hace STOP, no vuelve a arrancar solo hasta recargar.
- Con `?autostart=1` no se muestra el aviso de memoria de un proyecto grande ("Load anyway?"): se
  carga igual, porque en una instalación no hay nadie para contestarlo. En el modo lectura tampoco
  hay diálogos de login: nada bloquea el arranque.
- Los cambios que se hagan en el kiosko (tempo, volúmenes, mute/solo) no se guardan: al recargar
  vuelve a lo guardado en el proyecto. Para cambiar la instalación, editar el proyecto desde la app.
  Los cambios guardados ahí se ven en el kiosko en la próxima carga de la página.

El navegador **no deja sonar audio sin un gesto del usuario**. Si el AudioContext no arranca, en vez
de hacer START se muestra un cartel "Click to start" que cubre la ventana: un clic en cualquier
parte arranca. Para que no haga falta ese clic hay que lanzar Chrome
con `--autoplay-policy=no-user-gesture-required`.

## Lanzar Chrome en modo kiosko (Windows)

Comando (una sola línea; reemplazar `<id>`):

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required --user-data-dir=C:\looper-chrome --no-first-run --hide-crash-restore-bubble "https://looper.jape.com.ar/p/<id>?autostart=1"
```

- `--kiosk`: pantalla completa sin barras (se sale con Alt+F4).
- `--autoplay-policy=no-user-gesture-required`: permite que el audio arranque sin clic.
- `--user-data-dir=...`: un perfil de Chrome **solo para Looper**. Hace falta para que los flags se
  apliquen aunque haya otro Chrome abierto (si Chrome ya está corriendo con el perfil normal, el
  comando abre una pestaña en esa instancia e ignora los flags).
- `--no-first-run`, `--hide-crash-restore-bubble`: evitan cartelitos al arrancar o después de un
  corte de luz.

### Acceso directo

1. Clic derecho en el escritorio → Nuevo → Acceso directo.
2. En "ubicación" pegar el comando de arriba. Nombre: "Looper instalación".

### Arrancar al iniciar sesión en Windows

- Opción simple: copiar ese acceso directo en la carpeta de inicio (`Win+R` → `shell:startup`).
- **Opción con demora (recomendada)**: Programador de tareas → Crear tarea → Desencadenador "Al
  iniciar la sesión" con "Retrasar la tarea durante: 30 segundos" → Acción "Iniciar un programa"
  con la ruta de `chrome.exe` y los argumentos de arriba. La demora da tiempo a que el equipo tenga
  red: si Chrome abre el link sin conexión muestra su página de error en vez de Looper.

### Sin link público (instalación local con sesión)

Si el proyecto no puede ser público, o se corre Looper en la misma máquina (backend, Redis y
frontend locales, ver `AGENTS.md`, "Cómo correr"), se puede usar la app con sesión:
`http://localhost:31201/?autostart=1` en el comando de arriba. En ese caso:

- La app abre el último proyecto usado en ese perfil de Chrome.
- Hay que entrar una vez: lanzar el acceso directo, salir del kiosko (Alt+F4) o abrir el perfil
  sin `--kiosk`, hacer LOGIN, y volver a abrir con el acceso directo: tiene que cargar sin pedir
  login y arrancar solo. Sin sesión (LED apagado, "Off") el autostart espera al LOGIN.
- La cookie de sesión dura 30 días y se renueva con cada request; mientras la página está abierta,
  Looper consulta la sesión cada 10 min, así que no vence mientras la instalación funcione.
- Lo que se cambie en el kiosko (tempo, volúmenes) **sí se guarda** en el proyecto.

## Cómo se recupera sola

- **AudioContext suspendido o interrumpido** (otra aplicación tomó el audio, cambió el dispositivo
  de salida, el sistema lo suspendió): con el transporte corriendo, Looper reintenta reanudarlo a
  1 s, 2 s, 4 s... y después cada 30 s, sin rendirse. Mientras está suspendido el transporte queda
  congelado y al reanudar sigue donde estaba. Si a los 3 intentos no pudo, muestra además el cartel
  con el botón RESUME (un clic lo reanuda). Igual en el link público y en la app.
- **Servidor caído o sin red mientras suena**: no afecta lo que ya está sonando (los audios están en
  memoria). Con el link público no hay sesión que perder.
- **Servidor caído al cargar** (link público con `?autostart=1`; la página bajó pero la API respondió
  un error 5xx o 429, o no respondió): la vista muestra el error con "Retrying in N s..." y
  reintenta sola a los 5 s, 10 s, 20 s... y después cada 60 s, sin rendirse; cuando el servidor responde, carga y arranca sola. Un "Project not found" (el proyecto
  lo ocultó el admin o se borró) **no** se reintenta: hay que arreglar el proyecto
  y recargar. Si Chrome ni siquiera pudo bajar la página (sin red al lanzarlo), muestra su página
  de error: ver la opción con demora arriba.
- **Algún audio no carga**: se muestra un aviso con los archivos que fallaron y el resto suena igual.
- **Sesión perdida** (solo en la instalación local con sesión): el LED de la barra superior se pone
  **rojo** con "No session". La reproducción **sigue**; lo único que no funciona es guardar
  cambios. Para volver a tener sesión: STOP, LOGOUT/LOGIN (o recargar la página y entrar). En la
  instalación local, una recarga de página sin backend deja la app sin audios hasta que vuelva.
- **Corte de luz / reinicio del equipo**: si Chrome se lanza al iniciar sesión en Windows (ver
  arriba), Looper vuelve solo.

## Prueba larga (antes de dejarla en una muestra)

1. Lanzar con el acceso directo. Verificar que arranca solo, sin clic y sin login.
2. Abrir el Administrador de tareas de Chrome (`Shift+Esc`; en kiosko, desde otra ventana de Chrome
   del mismo perfil o antes de pasar a kiosko) y anotar la **memoria** de la pestaña de Looper y la
   hora. Anotar también la memoria del proceso de Chrome en el Administrador de tareas de Windows.
3. Dejarla correr **8 a 12 horas** con todas las funciones en uso (configuradas en el proyecto desde
   la app): alguna pista con Rest, alguna one-shot, Rev, Dly y FX de transición en algunas pistas, Tags cambiando.
4. Cada tanto (o al final) anotar memoria de nuevo y escuchar: que no haya clics, cortes, desfasajes
   de tempo ni pistas trabadas, y que los LEDs y LCDs sigan moviéndose al ritmo.
5. Al final comparar: después de estabilizarse (primera media hora) la memoria no debería crecer de
   forma sostenida. Un crecimiento lineal (por ejemplo decenas de MB por hora) indica una fuga:
   anotar los números en `docs/KNOWN_ISSUES.md`.
6. Probar la recuperación: durante la corrida, desconectar/cambiar el dispositivo de audio o
   abrir otra app que tome el audio en exclusivo y ver que vuelve a sonar; desconectar la red un
   rato y ver que el sonido no se corta. El reintento de carga se prueba en desarrollo: abrir
   `http://localhost:31201/p/<id>?autostart=1` con el backend detenido, ver "Retrying in N s...",
   arrancar el backend y ver que carga y arranca sola.
