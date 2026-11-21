#!/usr/bin/env bash
# Деплой на сервер из закоммиченного HEAD. Запускать со своего компьютера: scripts/deploy.sh
# Нужны SSH-доступ к серверу, sudo на нём и заполненные deploy/.env и deploy/money.env.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
: "${MONEY_URL:?укажите MONEY_URL в deploy/.env}"
[ -f "$ROOT/deploy/money.env" ] || { echo "Нет deploy/money.env — скопируйте deploy/money.env.example" >&2; exit 1; }
URL=$MONEY_URL
cd "$ROOT"

# На сервер уходит ровно то, что в коммите: незакоммиченное не задеплоится молча.
if [ -n "$(git status --porcelain)" ]; then
  echo "Есть незакоммиченные изменения — сначала коммит (деплоится HEAD)" >&2
  exit 1
fi
REV=$(git rev-parse --short HEAD)

git archive --format=tar.gz -o /tmp/money-src.tar.gz HEAD
# Настройки сервера в git не лежат и едут отдельным архивом.
COPYFILE_DISABLE=1 tar --no-xattrs -czf /tmp/money-config.tar.gz -C deploy .env money.env
scp -q /tmp/money-src.tar.gz /tmp/money-config.tar.gz scripts/remote-deploy.sh "$HOST:/tmp/"
rm -f /tmp/money-src.tar.gz /tmp/money-config.tar.gz
ssh -t "$HOST" "sudo bash /tmp/remote-deploy.sh $REV $MONEY_DIR"

# Caddy выпускает сертификат для нового хоста при первом обращении — на первом деплое это заняло
# больше минуты, поэтому ждём до ~5 минут. /api/health отвечает, только если web достучался до api:
# проверка всей цепочки.
for _ in $(seq 20); do
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$URL/api/health" || true)
  [ "$code" = 200 ] && break
  sleep 5
done
[ "$code" = 200 ] || { echo "FAIL: $URL/api/health ответил '$code' — см. docker compose logs на сервере" >&2; exit 1; }

# Типы файлов: HTML с не тем типом браузер предлагает скачать, а sw.js не как JavaScript Safari
# отвергает — и установленное приложение перестаёт обновляться.
check_type() {
  local got
  got=$(curl -s -o /dev/null -m 10 -w '%{content_type}' "$URL$1")
  # shellcheck disable=SC2254 — $2 намеренно шаблон
  case "$got" in $2) ;; *) echo "FAIL: $1 отдаётся как '$got', ждали $2" >&2; exit 1 ;; esac
}
check_type / 'text/html*'
check_type /sw.js '*javascript*'
check_type /manifest.webmanifest 'application/manifest+json*'
check_type "/$(curl -s -m 10 "$URL/" | grep -o 'assets/index-[^"]*\.js' | head -1)" '*javascript*'
echo "OK: $URL ($REV)"
exit 0

