# Общее для deploy.sh, backup.sh и invite.sh: читает deploy/.env и собирает команду compose.
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
[ -f "$ROOT/deploy/.env" ] || { echo "Нет deploy/.env — скопируйте deploy/.env.example и заполните" >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. "$ROOT/deploy/.env"
set +a
: "${MONEY_SSH:?укажите MONEY_SSH в deploy/.env}"
: "${MONEY_DIR:?укажите MONEY_DIR в deploy/.env}"
HOST=$MONEY_SSH
