# Looper como instalación: arranque solo y recuperación

Cómo dejar Looper corriendo horas sin nadie al lado (fase 6 de `docs/PLAN_instalacion.md`).
Detalle técnico en `docs/ARCHITECTURE.md`, sección "Autostart y recuperación".

## Requisitos

- Backend y Redis corriendo (ver `AGENTS.md`, "Cómo correr"). Para una instalación conviene servir
  el build de producción del frontend (`npm run build_prd`) o, como mínimo, dejar `npm run dev`
  corriendo en el puerto 31201.
- Un usuario con sus archivos, Tracks y Tags ya configurados (volumen, Rest, modo, Rev,
  Drift se guardan por pista y se recuperan al cargar).
- El equipo sin suspensión ni hibernación (Windows: Configuración → Sistema → Inicio/apagado y
  suspensión → "Nunca"). Apagar la pantalla no corta el audio.

## Autostart: `?autostart=1`

Con `?autostart=1` en la URL, apenas terminan de cargar los audios (la barra de carga de la parte
superior llega al final y el LED pasa a verde "Ready") se hace START solo. Ejemplo:

```
http://localhost:31201/?autostart=1
```

Es una vez por carga de página: si después se hace STOP, no vuelve a arrancar solo hasta recargar.

El navegador **no deja sonar audio sin un gesto del usuario**. Si el AudioContext no arranca, en vez
de hacer START se muestra un cartel "Click to start" que cubre la ventana: un clic en cualquier
parte arranca. Para que no haga falta ese clic hay que lanzar Chrome
con `--autoplay-policy=no-user-gesture-required`.

## Lanzar Chrome en modo kiosko (Windows)

Comando (una sola línea):

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required --user-data-dir=C:\looper-chrome --no-first-run --hide-crash-restore-bubble "http://localhost:31201/?autostart=1"
```

- `--kiosk`: pantalla completa sin barras (se sale con Alt+F4).
- `--autoplay-policy=no-user-gesture-required`: permite que el audio arranque sin clic.
- `--user-data-dir=...`: un perfil de Chrome **solo para Looper**. Hace falta para que los flags se
  apliquen aunque haya otro Chrome abierto (si Chrome ya está corriendo con el perfil normal, el
  comando abre una pestaña en esa instancia e ignora los flags) y deja la sesión de Looper aparte.
- `--no-first-run`, `--hide-crash-restore-bubble`: evitan cartelitos al arrancar o después de un
  corte de luz.

### Acceso directo

1. Clic derecho en el escritorio → Nuevo → Acceso directo.
2. En "ubicación" pegar el comando de arriba. Nombre: "Looper instalación".

### Arrancar al iniciar sesión en Windows

- Opción simple: copiar ese acceso directo en la carpeta de inicio (`Win+R` → `shell:startup`).
- Opción con demora (útil si el backend tarda en levantar): Programador de tareas → Crear tarea →
  Desencadenador "Al iniciar la sesión" con "Retrasar la tarea durante: 30 segundos" → Acción
  "Iniciar un programa" con la ruta de `chrome.exe` y los argumentos de arriba.
- El backend (y Redis) tienen que arrancar antes: como servicio, o con otra tarea al iniciar.

### La sesión de Looper

La cookie de sesión no tiene vencimiento propio (dura lo que el navegador) y en Redis vence a las
24 h sin requests (TTL por defecto de connect-redis). Mientras la página está abierta, Looper
consulta la sesión cada 10 min, lo que la mantiene viva. Pero **al cerrar Chrome la cookie se
pierde** salvo que en ese perfil se configure "Al iniciar: Continuar donde lo dejaste"
(`chrome://settings/onStartup`). Hacer una vez:

1. Lanzar el acceso directo, salir del kiosko (Alt+F4) o abrir el perfil sin `--kiosk`.
2. En ese perfil configurar "Continuar donde lo dejaste" y entrar con LOGIN.
3. Cerrar y volver a abrir con el acceso directo: tiene que cargar sin pedir login y arrancar solo.

Si igual aparece sin sesión (LED apagado, "Off"), hay que hacer LOGIN; después de cargar arranca solo
(el autostart espera a que termine la carga).

## Cómo se recupera sola

- **AudioContext suspendido o interrumpido** (otra aplicación tomó el audio, cambió el dispositivo
  de salida, el sistema lo suspendió): con el transporte corriendo, Looper reintenta reanudarlo a
  1 s, 2 s, 4 s... y después cada 30 s, sin rendirse. Mientras está suspendido el transporte queda
  congelado y al reanudar sigue donde estaba. Si a los 3 intentos no pudo, muestra además el cartel
  con el botón RESUME (un clic lo reanuda).
- **Sesión perdida** (Redis reiniciado sin persistencia, sesión vencida en Redis):
  el LED de la barra superior se pone **rojo** con "No session". La reproducción **sigue**: los
  audios ya están en memoria. Lo único que no funciona es guardar cambios. Para volver a tener
  sesión: STOP, LOGOUT/LOGIN (o recargar la página y entrar).
- **Backend caído**: no afecta lo que ya está sonando. Una recarga de página sin backend deja la app
  sin audios hasta que vuelva.
- **Corte de luz / reinicio del equipo**: si el backend arranca solo y Chrome se lanza al iniciar
  sesión (y la sesión persiste, ver arriba), Looper vuelve solo.

## Prueba larga (antes de dejarla en una muestra)

1. Lanzar con el acceso directo. Verificar que arranca solo, sin clic.
2. Abrir el Administrador de tareas de Chrome (`Shift+Esc`; en kiosko, desde otra ventana de Chrome
   del mismo perfil o antes de pasar a kiosko) y anotar la **memoria** de la pestaña de Looper y la
   hora. Anotar también la memoria del proceso de Chrome en el Administrador de tareas de Windows.
3. Dejarla correr **8 a 12 horas** con todas las funciones en uso: alguna pista con Rest, alguna
   one-shot, Rev y Drift en algunas pistas, Tags cambiando.
4. Cada tanto (o al final) anotar memoria de nuevo y escuchar: que no haya clics, cortes, desfasajes
   de tempo ni pistas trabadas, y que los LEDs y LCDs sigan moviéndose al ritmo.
5. Al final comparar: después de estabilizarse (primera media hora) la memoria no debería crecer de
   forma sostenida. Un crecimiento lineal (por ejemplo decenas de MB por hora) indica una fuga:
   anotar los números en `docs/KNOWN_ISSUES.md`.
6. Probar la recuperación: durante la corrida, desconectar/cambiar el dispositivo de audio o
   abrir otra app que tome el audio en exclusivo y ver que vuelve a sonar; reiniciar Redis y ver que
   el LED pasa a rojo en 10 min como mucho, sin que se corte el sonido.
