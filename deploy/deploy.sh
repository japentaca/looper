#!/usr/bin/env bash
# Despliegue de Looper en el VPS, disparado desde la máquina de desarrollo (Git Bash en Windows,
# o cualquier bash con ssh y git). Ver docs/DEPLOY.md y "Infraestructura" en docs/PLAN_PUBLICACION.md.
#
# Uso:  bash deploy/deploy.sh [-y]
#   -y   no preguntar si hay avisos (cambios locales sin commitear o sin pushear)
#
# El servidor hace `git pull` de GitHub: lo que no esté pusheado a origin/main NO se despliega.
# Los datos de conexión salen de deploy/.env.deploy (ignorado por git; copiar de
# deploy/.env.deploy.example) o de ~/.ssh/config. Nunca poner IPs, puertos ni usuarios reales en
# archivos versionados.
#
# En el VPS, como el usuario de la app (looper, sin shell): git pull --ff-only de main, npm ci en
# backend y frontend (compila better-sqlite3/bcrypt para Linux), npm run build_prd, y como root
# `systemctl restart pm2-looper`. Nunca pm2 update/pm2 kill, y nunca pm2 como root.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"

assume_yes=0
while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) assume_yes=1 ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: $1 (ver -h)" >&2; exit 2 ;;
  esac
  shift
done

# --- Configuración -------------------------------------------------------------------------------
env_file="$script_dir/.env.deploy"
if [ -f "$env_file" ]; then
  # tr quita los \r por si el archivo se editó con fin de línea de Windows
  set -a
  # shellcheck disable=SC1090
  . <(tr -d '\r' < "$env_file")
  set +a
fi

DEPLOY_HOST="${DEPLOY_HOST:-}"                 # alias de ~/.ssh/config o nombre del host
DEPLOY_PORT="${DEPLOY_PORT:-}"                 # vacío = el de ~/.ssh/config (o 22)
DEPLOY_USER="${DEPLOY_USER:-}"                 # vacío = el de ~/.ssh/config
DEPLOY_APP_USER="${DEPLOY_APP_USER:-looper}"
DEPLOY_APP_DIR="${DEPLOY_APP_DIR:-/var/lib/looper/looper}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-pm2-looper}"
DEPLOY_HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:31200/api/public/projects}"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -n "$DEPLOY_HOST" ] || die "falta DEPLOY_HOST (copiar deploy/.env.deploy.example a deploy/.env.deploy)"

# Estos valores van dentro del comando remoto: solo se aceptan caracteres seguros.
for var in DEPLOY_APP_USER DEPLOY_APP_DIR DEPLOY_BRANCH DEPLOY_SERVICE DEPLOY_HEALTH_URL; do
  val="${!var}"
  [[ "$val" =~ ^[A-Za-z0-9_./:@?=\&-]+$ ]] || die "$var tiene caracteres no permitidos: '$val'"
done
[[ "$DEPLOY_APP_DIR" == /* ]] || die "DEPLOY_APP_DIR tiene que ser una ruta absoluta"
[ -z "$DEPLOY_PORT" ] || [[ "$DEPLOY_PORT" =~ ^[0-9]+$ ]] || die "DEPLOY_PORT tiene que ser un número"

ssh_args=()
[ -z "$DEPLOY_PORT" ] || ssh_args+=(-p "$DEPLOY_PORT")
ssh_target="$DEPLOY_HOST"
[ -z "$DEPLOY_USER" ] || ssh_target="$DEPLOY_USER@$DEPLOY_HOST"

# --- Chequeos locales ----------------------------------------------------------------------------
cd "$repo_dir"
warnings=()

local_branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$local_branch" = "$DEPLOY_BRANCH" ] || warnings+=("la rama local es '$local_branch', pero se despliega '$DEPLOY_BRANCH' de GitHub")

if [ -n "$(git status --porcelain)" ]; then
  warnings+=("hay cambios locales sin commitear (no se despliegan)")
fi

echo "Consultando origin/$DEPLOY_BRANCH..."
git fetch --quiet origin "$DEPLOY_BRANCH" || die "no se pudo hacer git fetch de origin/$DEPLOY_BRANCH"
remote_ref="origin/$DEPLOY_BRANCH"
if git rev-parse --verify --quiet "$DEPLOY_BRANCH" > /dev/null; then
  ahead="$(git rev-list --count "$remote_ref..$DEPLOY_BRANCH")"
  behind="$(git rev-list --count "$DEPLOY_BRANCH..$remote_ref")"
  [ "$ahead" = 0 ] || warnings+=("$DEPLOY_BRANCH local tiene $ahead commit(s) sin pushear (no se despliegan)")
  [ "$behind" = 0 ] || warnings+=("$DEPLOY_BRANCH local está $behind commit(s) detrás de $remote_ref (se despliega lo de GitHub)")
fi

target_rev="$(git rev-parse --short "$remote_ref")"
echo "Se va a desplegar $remote_ref = $(git log -1 --format='%h %s' "$remote_ref")"
echo "Servidor: $ssh_target${DEPLOY_PORT:+ (puerto $DEPLOY_PORT)}, en $DEPLOY_APP_DIR como $DEPLOY_APP_USER"

if [ ${#warnings[@]} -gt 0 ]; then
  echo
  for w in "${warnings[@]}"; do echo "AVISO: $w"; done
  if [ "$assume_yes" -ne 1 ]; then
    [ -t 0 ] || die "hay avisos y no hay terminal para confirmar (usar -y para seguir igual)"
    read -r -p "¿Seguir igual? [s/N] " answer
    case "$answer" in s|S|si|SI|sí|Sí) ;; *) echo "Cancelado."; exit 1 ;; esac
  fi
fi

# --- Script remoto -------------------------------------------------------------------------------
# Corre con bash en el servidor como el usuario de SSH. Lo que toca el clon lo hace como
# $DEPLOY_APP_USER (sudo -u, o runuser si se entró como root); el restart, como root.
# Se manda codificado en base64 (para no pelear con las comillas) como argumento de bash -c, no por
# stdin: así la terminal (ssh -t) queda libre para que sudo pida la clave si hace falta.
remote_script='
set -euo pipefail
app_user="$1"; app_dir="$2"; branch="$3"; service="$4"; health_url="$5"

step() { printf "\n==> %s\n" "$*"; }

app_home="$(getent passwd "$app_user" | cut -d: -f6)"
[ -n "$app_home" ] || { echo "ERROR: no existe el usuario $app_user" >&2; exit 1; }
# as_app DIR CMD...: corre CMD como el usuario de la app, con DIR como directorio de trabajo
# (el usuario de SSH puede no tener permiso para entrar al clon).
if [ "$(id -u)" -eq 0 ]; then
  as_app() { local d="$1"; shift; runuser -u "$app_user" -- env -C "$d" HOME="$app_home" "$@"; }
  as_root() { "$@"; }
else
  as_app() { local d="$1"; shift; sudo -u "$app_user" -H -- env -C "$d" "$@"; }
  as_root() { sudo -- "$@"; }
fi

as_app "$app_home" test -d "$app_dir/.git" || { echo "ERROR: $app_dir no es un clon de git" >&2; exit 1; }

step "git ($app_dir)"
current="$(as_app "$app_dir" git rev-parse --abbrev-ref HEAD)"
[ "$current" = "$branch" ] || { echo "ERROR: el clon está en la rama $current, no en $branch" >&2; exit 1; }
if [ -n "$(as_app "$app_dir" git status --porcelain --untracked-files=no)" ]; then
  echo "ERROR: el clon del servidor tiene cambios en archivos versionados; revisar a mano:" >&2
  as_app "$app_dir" git status --short --untracked-files=no >&2
  exit 1
fi
before="$(as_app "$app_dir" git rev-parse HEAD)"
as_app "$app_dir" git pull --ff-only origin "$branch"
after="$(as_app "$app_dir" git rev-parse HEAD)"
if [ "$before" = "$after" ]; then
  echo "Sin commits nuevos (HEAD $(as_app "$app_dir" git rev-parse --short HEAD)); se reinstala y reinicia igual."
else
  as_app "$app_dir" git log --oneline "$before..$after"
fi

step "backend: npm ci --omit=dev"
as_app "$app_dir/backend" npm ci --omit=dev --no-audit --no-fund

step "frontend: npm ci + npm run build_prd"
# Se compila a un directorio aparte y se cambia por dist al final: si el build falla, el dist
# anterior sigue sirviéndose entero.
build_dir="$(as_app "$app_home" mktemp -d "$app_home/.looper_build.XXXXXX")"
trap "as_app \"$app_home\" rm -rf \"$build_dir\"" EXIT
as_app "$app_dir/frontend" npm ci --no-audit --no-fund
as_app "$app_dir/frontend" npm run build_prd -- --outDir "$build_dir/dist" --emptyOutDir
as_app "$app_home" test -f "$build_dir/dist/index.html" || { echo "ERROR: el build no generó index.html" >&2; exit 1; }
if as_app "$app_dir" test -d frontend/dist; then as_app "$app_dir" mv frontend/dist "$build_dir/dist_old"; fi
as_app "$app_dir" mv "$build_dir/dist" frontend/dist

step "systemctl restart $service"
as_root systemctl restart "$service"
as_root systemctl is-active --quiet "$service" || { echo "ERROR: $service no quedó activo" >&2; as_root systemctl status --no-pager "$service" >&2 || true; exit 1; }

if command -v curl > /dev/null; then
  step "chequeo: $health_url"
  ok=0
  for _ in $(seq 1 20); do
    if curl -fsS -o /dev/null --max-time 5 "$health_url"; then ok=1; break; fi
    sleep 2
  done
  if [ "$ok" -ne 1 ]; then
    echo "ERROR: el backend no responde en $health_url; ver logs con: sudo -u $app_user pm2 logs looper --lines 50" >&2
    exit 1
  fi
  echo "OK"
else
  echo "(curl no está instalado: se omite el chequeo de $health_url)"
fi

printf "\nDesplegado %s\n" "$(as_app "$app_dir" git log -1 --format="%h %s")"
'

encoded="$(printf '%s' "$remote_script" | base64 | tr -d '\n')"
remote_cmd="bash -c \"\$(printf '%s' '$encoded' | base64 -d)\" looper_deploy '$DEPLOY_APP_USER' '$DEPLOY_APP_DIR' '$DEPLOY_BRANCH' '$DEPLOY_SERVICE' '$DEPLOY_HEALTH_URL'"

echo
echo "Conectando a $ssh_target..."
ssh_tty=()
[ -t 0 ] && ssh_tty=(-t)
ssh "${ssh_tty[@]}" "${ssh_args[@]}" "$ssh_target" "$remote_cmd"

echo
echo "Listo: $target_rev desplegado en $DEPLOY_HOST."
