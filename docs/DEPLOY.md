# Despliegue en el VPS

Cómo se instala Looper en el VPS la primera vez, cómo se despliega cada cambio, cómo se vuelve
atrás y qué hay que mirar después. Las decisiones están en "Infraestructura" y "Estado del
servidor" de `docs/PLAN_PUBLICACION.md`. El detalle técnico de cada pieza está en
`docs/ARCHITECTURE.md`, en "Producción (nginx)", "Producción (pm2)" y "Producción (despliegue)".

**Acá no van datos de conexión.** Al servidor se entra con el alias SSH `jape-pruebas` de
`~/.ssh/config` de la máquina de desarrollo. La IP, el puerto, el usuario y la clave viven solo ahí
(o en `deploy/.env.deploy`, ignorado por git). Este archivo tampoco lleva secretos: donde dice
`<...>` se completa en el momento y no se anota en el repo.

## Piezas y rutas

| Qué | Dónde (en el servidor) |
|---|---|
| Usuario de sistema | `looper`, sin shell (`/usr/sbin/nologin`), home `/var/lib/looper` |
| Clon del repo (público en GitHub) | `/var/lib/looper/looper` (rama `main`) |
| Configuración del backend | `/var/lib/looper/looper/backend/.env` (fuera de git, permisos 600) |
| Datos | `/var/lib/looper/storage/db.sqlite` y `/var/lib/looper/storage/audio/<user_id>/<file_id>.mp3` |
| Respaldos de la base | `/var/lib/looper/backups/` |
| Proceso | pm2 del usuario `looper` (`backend/ecosystem.config.cjs`), servicio systemd `pm2-looper` |
| Logs del backend | `/var/lib/looper/.pm2/logs/` |
| nginx | `/etc/nginx/conf.d/looper.jape.com.ar.conf` (copia de `deploy/nginx/looper.jape.com.ar.conf`) |
| Backend | `127.0.0.1:31200` (solo local; afuera se entra por nginx) |

`storage/` queda **fuera del clon**. Así un `git clean` o un clon nuevo no lo tocan.

El servidor ya aloja otros sitios (`jape.com.ar`, `www`, `carrilion`) y otra app con pm2
(`carrillion`), que comparte Redis. Nada de lo que sigue toca su configuración.

## Preparación inicial (una sola vez)

Es la tarea 6.5 del plan. La hace la sesión principal paso a paso, con confirmación del dueño.
Todo se corre como root (o con `sudo`) salvo que se indique otra cosa. Para correr algo como
`looper`, que no tiene shell, se usa `sudo -u looper -H <comando>`.

### 1. Usuario `looper`

```bash
useradd --system --create-home --home-dir /var/lib/looper --shell /usr/sbin/nologin looper
# nginx (www-data) tiene que poder atravesar el home para llegar a frontend/dist
chmod 711 /var/lib/looper
```

### 2. Clon del repo

```bash
sudo -u looper -H git clone https://github.com/japentaca/looper.git /var/lib/looper/looper
chmod 755 /var/lib/looper/looper
```

El repo es público y no necesita credenciales. Si pasa a privado, usar una *deploy key* de solo
lectura del usuario `looper`.

### 3. Redis: usuario ACL propio

Redis no tiene clave y `carrillion` usa el usuario `default` sin clave. **No tocar `default`**:
ponerle clave rompe `carrillion`. A Looper se le crea un usuario propio, limitado a sus claves
(`looper_s:` de sesiones, `looper_login_fails:`, `looper_register:`, etc.) y a los comandos que usa:

```bash
# clave nueva, solo hexadecimal (sin espacios ni caracteres raros)
openssl rand -hex 32
redis-cli ACL SETUSER looper on '><clave>' resetkeys '~looper*' resetchannels -@all \
  +get +set +del +incr +expire +mget +ping
redis-cli ACL LIST                      # aparece "user looper on ..."; default sigue igual
redis-cli --user looper --pass '<clave>' --no-auth-warning SET looper_test 1   # OK
redis-cli --user looper --pass '<clave>' --no-auth-warning SET otra_clave 1    # NOPERM
redis-cli --user looper --pass '<clave>' --no-auth-warning DEL looper_test
```

Para que el usuario no se pierda al reiniciar Redis:

- Si `redis-cli CONFIG GET aclfile` está vacío, correr `redis-cli CONFIG REWRITE`. Eso escribe la
  línea `user looper ...` en `redis.conf`.
- Si hay `aclfile`, correr `redis-cli ACL SAVE`.

No hace falta reiniciar Redis. Sí hay que comprobar que `carrillion` siga respondiendo.

La lista de comandos sale de leer el código (`routes/api.js`, connect-redis 7 e ioredis 5). Si al
probar la app aparece `NOPERM` en el log, falta un comando en la lista.

Al conectarse, ioredis manda `INFO` para saber si Redis está listo. El usuario `looper` no tiene
permiso para `INFO`, así que el log muestra un aviso "Skipping the ready check because INFO command
fails: NOPERM" y sigue normalmente. Es esperado. Las sesiones (connect-redis) usan `get`, `set`,
`del`, `expire` y `mget`. Si en algún momento se agrega un comando de Redis al backend, sumarlo al
ACL (`ACL SETUSER looper +<comando>`, y después `CONFIG REWRITE` o `ACL SAVE`).

### 4. `backend/.env` con secretos nuevos

Se escribe a mano en el servidor. **No se copia el `.env` de desarrollo**: el `session_secret` y la
clave de Redis son nuevos. Plantilla: `backend/.env.example`.

```bash
openssl rand -hex 32     # session_secret nuevo
sudo -u looper -H nano /var/lib/looper/looper/backend/.env   # o crear el archivo y chown después
chmod 600 /var/lib/looper/looper/backend/.env
chown looper:looper /var/lib/looper/looper/backend/.env
```

Valores (sin espacios alrededor del `=`):

```
redis_host=127.0.0.1
redis_port=6379
redis_username=looper
redis_password=<clave del paso 3>
service_port=31200
storage_path=/var/lib/looper/storage/audio/
db_file=/var/lib/looper/storage/db.sqlite
default_max_seconds=1200
disk_min_free_gb=10
session_secret=<nuevo>
cors_origin=https://looper.jape.com.ar
```

- `storage_path` tiene que terminar en `/`.
- `service_port` tiene que coincidir con el `proxy_pass` de nginx y con `DEPLOY_HEALTH_URL`
  de `deploy/.env.deploy`.
- `path_to_ffmpeg`/`path_to_ffprobe` no van: se usan los binarios de `ffmpeg-static`/`ffprobe-static`.
- `cors_origin` en producción no se usa, porque todo sale del mismo origen.
- `jntaca_password` es solo para las pruebas locales y no va al servidor.

### 5. Migración de `storage/` (base + audios)

Se copian la base y los audios de la máquina de desarrollo. Antes de copiar:

- Apagar el backend local, para que la base no cambie a mitad de la copia.
- Confirmar que la clave del admin ya es la nueva (política 2 del plan).

Desde la raíz del repo, en Git Bash:

```bash
tar -czf - -C storage db.sqlite audio | ssh jape-pruebas 'cat > /tmp/looper_storage.tgz'
```

En el servidor:

```bash
install -d -o looper -g looper -m 700 /var/lib/looper/storage /var/lib/looper/backups
tar -xzf /tmp/looper_storage.tgz -C /var/lib/looper/storage
chown -R looper:looper /var/lib/looper/storage
chmod -R u=rwX,go= /var/lib/looper/storage
rm /tmp/looper_storage.tgz
ls /var/lib/looper/storage/audio | wc -l      # una carpeta por usuario con archivos
```

`storage/` tiene permisos 700 porque nginx no lo lee: el audio sale por Node (`GET /api/file/:id`).
Al arrancar, el backend corre las migraciones (`db_migrations.js`, idempotentes) sobre esta base.

### 6. Dependencias y build

```bash
cd /var/lib/looper/looper/backend  && sudo -u looper -H npm ci --omit=dev
cd /var/lib/looper/looper/frontend && sudo -u looper -H npm ci && sudo -u looper -H npm run build_prd
ls /var/lib/looper/looper/frontend/dist/index.html
```

Notas:

- El backend compila o baja `better-sqlite3` y `bcrypt` para Linux con el Node 24 del sistema. Si
  no hay binario precompilado, hacen falta `build-essential` y `python3`. Con `carrillion` ya se
  recompiló `better-sqlite3`, así que deberían estar.
- `ffmpeg-static` baja su binario al instalarse, así que necesita salida a internet.
- `npm run build_prd` usa `frontend/.env.prd` (`VITE_APP_BACKEND = 'https://looper.jape.com.ar'`).

### 7. pm2 y el servicio `pm2-looper`

Se sigue el patrón de `carrillion`; para comparar, `systemctl cat pm2-carrillion`. Primero se crea
el servicio y después se carga la app en el daemon que maneja systemd:

```bash
# como root: genera y habilita /etc/systemd/system/pm2-looper.service
pm2 startup systemd -u looper --hp /var/lib/looper
systemctl start pm2-looper            # si pm2 startup no lo dejó activo
# como looper: carga la app en ese daemon y guarda la lista para el resurrect
cd /var/lib/looper && sudo -u looper -H pm2 start /var/lib/looper/looper/backend/ecosystem.config.cjs
sudo -u looper -H pm2 save
# prueba de que el servicio la levanta solo
systemctl restart pm2-looper
sudo -u looper -H pm2 ls              # looper "online"
curl -fsS http://127.0.0.1:31200/api/public/projects
```

- `pm2 startup` como root solo genera la unidad; el daemon queda a nombre de `looper`. Después
  confirmar que no quedó un daemon de root (`ls /root/.pm2`, `pgrep -fa "PM2 v"`). Si aparece uno,
  está vacío y se puede cerrar con `pm2 kill` como root. Eso **no** afecta a `pm2-looper` ni a
  `pm2-carrillion`.
- Revisar el log del primer arranque: tiene que decir "Redis connected", correr las migraciones y
  terminar en "Listening on 31200". Se ve con `sudo -u looper -H pm2 logs looper --lines 50`.
- Si no arranca, el error suele ser de `.env` (rutas, `session_secret`) o de la ACL de Redis
  (`NOPERM`, `WRONGPASS`).

### 8. nginx

```bash
cp /var/lib/looper/looper/deploy/nginx/looper.jape.com.ar.conf /etc/nginx/conf.d/
# la plantilla ya trae el certificado de los otros sitios (/opt/cert/public.pem + private.pem) y el
# bloque del puerto 80 que redirige a https, como ellos
nginx -t && systemctl reload nginx      # si nginx -t falla: borrar el archivo y no recargar
```

**Siempre `nginx -t` antes de `reload`.** Un error de sintaxis en `conf.d/` tira todos los sitios
del servidor, no solo Looper. No tocar los archivos de los otros sitios, ni
`00-default.conf` ni `cloudflare-realip.conf`.

Para confirmar que www-data llega al build:
`sudo -u www-data test -r /var/lib/looper/looper/frontend/dist/index.html && echo ok`.

### 9. Datos de despliegue en la máquina de desarrollo

```bash
cp deploy/.env.deploy.example deploy/.env.deploy   # DEPLOY_HOST=jape-pruebas; lo demás, por defecto
```

El primer `bash deploy/deploy.sh` después de la puesta en marcha sirve de prueba del script. Sin
commits nuevos reinstala, recompila y reinicia igual.

Al terminar, hacer la verificación de abajo.

## Despliegue habitual

1. Commitear y pushear a `main` en GitHub. El servidor hace `git pull` de GitHub: lo que no está
   pusheado no se despliega.
2. Si el cambio toca `backend/db_migrations.js`, **respaldar la base antes** (ver abajo). Para ver
   si lo toca:

   ```bash
   desplegado=$(ssh jape-pruebas 'sudo -u looper git -C /var/lib/looper/looper rev-parse HEAD')
   git diff --stat "$desplegado"..origin/main -- backend/db_migrations.js
   ```

3. `bash deploy/deploy.sh`. Con `-y` no pregunta si hay avisos locales. El script hace `git pull
   --ff-only`, `npm ci`, `build_prd` (a un directorio aparte, que recién al final reemplaza a
   `dist`), `systemctl restart pm2-looper` y un chequeo de `/api/public/projects`. Detalle en
   "Producción (despliegue)" de `docs/ARCHITECTURE.md`.
4. Verificar (ver abajo).

Si el script falla después del `git pull`, el clon queda en el commit nuevo con el proceso viejo
corriendo. Se corrige y se vuelve a correr: el script es repetible.

### Respaldo de la base

Las migraciones corren solas al reiniciar y no tienen vuelta atrás. Antes de desplegar un cambio de
esquema, se hace una copia consistente con la API de backup de `better-sqlite3`, que funciona con el
backend andando:

```bash
ssh jape-pruebas
cd /var/lib/looper && sudo -u looper -H node -e "
  const Db = require('/var/lib/looper/looper/backend/node_modules/better-sqlite3')
  const dest = '/var/lib/looper/backups/db-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite'
  new Db('/var/lib/looper/storage/db.sqlite', { readonly: true }).backup(dest).then(() => console.log(dest))"
```

No reemplaza a un backup de verdad: queda en el mismo disco, y los backups siguen fuera del plan.
Borrar los respaldos viejos a mano.

### Normalizar los audios ya subidos (una vez)

Desde la normalización de loudness en `/upload` (-18 LUFS / -1 dBTP, ganancia fija), los archivos
anteriores se normalizan una vez con `backend/normalize_existing.js`, después de desplegar ese
cambio. Antes, respaldar la base (ver arriba): el script actualiza `files.size` y recalcula
`users.bytes_used = sum(files.size)`. Primero `--dry-run`, que solo informa:

```bash
ssh jape-pruebas
cd /var/lib/looper/looper/backend
sudo -u looper -H nice node normalize_existing.js --dry-run
sudo -u looper -H nice node normalize_existing.js
```

- Recodifica (de a uno) los que necesitan más de ±0,5 dB; no toca `duration` ni los volúmenes de
  `project_files`. Cada original se copia antes a `/var/lib/looper/backups/audio_pre_normalize_<fecha>/<user_id>/<id>.mp3`
  (`<storage_path>/../../backups/...`; otro con `--backup-dir=<dir>`), y el nuevo se escribe a un
  temporal y se renombra encima. Ese respaldo ocupa lo mismo que los audios: verificar el disco
  libre antes (`df -h /var/lib/looper`) y borrarlo a mano cuando ya no haga falta.
- Es repetible: saltea los que ya tienen respaldo en algún `audio_pre_normalize_*` de ese directorio
  y los que no pasan el umbral. Puede correr con el backend andando (cada reemplazo es atómico).
- Para volver atrás un archivo: copiar su respaldo encima del mp3 (el `size` de la base queda con el
  del normalizado; es informativo).
- `GET /file/:id` sirve con caché `immutable` de un año: un navegador que ya tenía un archivo en caché
  sigue usando la versión vieja. Por eso el front pide `/api/file/<id>?v=<AUDIO_VERSION>`
  (`frontend/src/helpers/api.js`). **Orden:** primero correr el script y recién después desplegar el
  front con `AUDIO_VERSION` subido; al revés, un navegador que cargue en el medio guarda por un año
  el audio viejo bajo la versión nueva. Para esta normalización (`AUDIO_VERSION = 2`): desplegar
  hasta el commit del script (`git` en el servidor a ese commit, o un despliegue antes de traer el
  cambio de versión), correr el script y después el despliegue normal. Para un reproceso futuro,
  subir el número de nuevo con el mismo orden.

## Rollback

**Volver a un commit anterior** (el problema está en el código):

```bash
ssh jape-pruebas
cd /var/lib/looper/looper
sudo -u looper -H git log --oneline -10            # elegir <commit>
sudo -u looper -H git checkout <commit>
cd backend  && sudo -u looper -H npm ci --omit=dev
cd ../frontend && sudo -u looper -H npm ci && sudo -u looper -H npm run build_prd
systemctl restart pm2-looper
```

- Mientras el clon está en un commit suelto (*detached HEAD*), `deploy.sh` se niega a correr porque
  pide estar en `main`. Para volver al flujo normal: arreglar en `main` (o `git revert` del commit
  malo), pushear, y en el servidor `sudo -u looper -H git checkout main`. Después, `deploy.sh`.
- La alternativa sin entrar al servidor es `git revert` en la máquina de desarrollo, push y
  `deploy.sh`.
- Este rollback compila en el lugar: mientras dura el build, `dist` puede quedar a medias unos
  segundos. `deploy.sh` no tiene ese problema.

**Restaurar la base** (una migración rompió datos). Se pierde todo lo que pasó desde el respaldo:
usuarios, subidas y cambios de proyectos.

```bash
systemctl stop pm2-looper
cp /var/lib/looper/storage/db.sqlite /var/lib/looper/backups/db-roto.sqlite
cp /var/lib/looper/backups/<respaldo>.sqlite /var/lib/looper/storage/db.sqlite
chown looper:looper /var/lib/looper/storage/db.sqlite && chmod 600 /var/lib/looper/storage/db.sqlite
# volver antes el código al commit previo a la migración (ver arriba), si no la vuelve a correr
systemctl start pm2-looper
```

Los audios no se tocan en un rollback. Ojo: si después del respaldo se subieron o borraron
archivos, la base restaurada y `audio/` dejan de coincidir. Un archivo de la base que no tiene mp3
da 404 al reproducirlo, y un mp3 que no está en la base ocupa disco.

Las migraciones son aditivas (agregan tablas y columnas), así que en general el código anterior
funciona sobre la base nueva y no hace falta restaurarla. Restaurar solo si se rompieron datos.

## Verificación después de desplegar

Desde la máquina de desarrollo:

```bash
for u in https://looper.jape.com.ar/ https://looper.jape.com.ar/gallery \
         https://looper.jape.com.ar/api/public/projects \
         https://jape.com.ar/ https://carrilion.jape.com.ar/; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$u")" "$u"
done
curl -sI https://looper.jape.com.ar/ | grep -iE 'strict-transport|content-security|nosniff|referrer|cache-control'
```

- Todo tiene que dar **200**, incluidos **`jape.com.ar` y `carrilion.jape.com.ar`**, que no tienen
  que verse afectados.
- Tienen que estar los cuatro headers de seguridad y `Cache-Control: no-cache` en `/`.

En el navegador, en `https://looper.jape.com.ar/`:

- Entrar con la cuenta de admin. La cookie `looper_sid` tiene que salir con `Secure`.
- Abrir el proyecto. Los loops cargan y **suenan** con START.
- Abrir un link `/p/<id>` directo y recargarlo: no tiene que dar 404.
- Subir un archivo corto: se convierte y aparece en Files.
- `sudo -u looper -H pm2 logs looper --lines 50` sin errores nuevos.

## Lecciones (no repetir)

- **Reiniciar siempre con `systemctl restart pm2-looper`** (lo mismo para `pm2-carrillion`).
  **Nunca `pm2 update` ni `pm2 kill` a mano** sobre el daemon de una app. systemd ve morir el daemon
  y su `ExecStop` mata al nuevo, y la app queda caída.
- **No correr `pm2` como root** para manejar las apps. Levanta un daemon vacío en `/root/.pm2` que no
  ve las apps, y da la impresión de que no hay nada corriendo. Los comandos de pm2 van con
  `sudo -u looper -H pm2 ...`. La excepción es `pm2 startup ... -u looper`, que solo genera la
  unidad de systemd.
- **SSL de Cloudflare:** la zona está en *Full* (no *strict*) y aplica a todos los subdominios.
  **No cambiarlo sin revisar los otros sitios**: con *Full (strict)*, un sitio sin certificado
  válido en el origen deja de andar. Para pasar a *strict*, todos tienen que usar el certificado de
  origen de `/opt/cert/` y ese certificado tiene que cubrir `*.jape.com.ar`.
- **Nada de caché de Cloudflare, Workers ni R2**: el audio y el frontend salen siempre del VPS. La
  caché del navegador la manejan nginx (`index.html` sin caché, `/assets/` un año) y Express
  (`/api/file/:id`, `immutable`).
- **`nginx -t` antes de cada `reload`**: la configuración es una sola para todos los sitios.
- **Redis es compartido**: no ponerle clave al usuario `default`, no correr `FLUSHALL`/`FLUSHDB`, y
  para borrar claves de Looper usar siempre el prefijo `looper`.
- **Node es el del sistema** y lo comparten las dos apps. Si se cambia de versión, hay que recompilar
  los módulos nativos de las dos: en Looper, un `deploy.sh`, que hace `npm ci`.
