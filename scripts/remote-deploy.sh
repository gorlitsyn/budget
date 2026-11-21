#!/usr/bin/env bash
# Серверная половина scripts/deploy.sh: выполняется от root, архивы уже в /tmp.
set -euo pipefail

REV=$1
DIR=$2

# Исходники заменяются целиком: удалённый в репо файл не должен остаться на сервере.
rm -rf "$DIR.new"
mkdir -p "$DIR.new"
tar xzf /tmp/money-src.tar.gz -C "$DIR.new"
tar xzf /tmp/money-config.tar.gz -C "$DIR.new/deploy"
echo "$REV" > "$DIR.new/REVISION"

set -a
# shellcheck disable=SC1091
. "$DIR.new/deploy/.env"
set +a
: "${MONEY_DATA:?укажите MONEY_DATA в deploy/.env}"

COMPOSE=(docker compose -f deploy/docker-compose.yml)
if [ -n "${MONEY_PROXY_NETWORK:-}" ]; then
  docker network inspect "$MONEY_PROXY_NETWORK" >/dev/null 2>&1 \
    || { echo "Нет сети $MONEY_PROXY_NETWORK — прокси не поднят" >&2; exit 1; }
  COMPOSE+=(-f deploy/docker-compose.caddy-proxy.yml)
else
  COMPOSE+=(-f deploy/docker-compose.port.yml)
fi

# api работает от uid 1000 (node) и пишет БД сюда.
mkdir -p "$MONEY_DATA"
chown 1000:1000 "$MONEY_DATA"
chmod 700 "$MONEY_DATA"

rm -rf "$DIR.old"
[ -d "$DIR" ] && mv "$DIR" "$DIR.old"
mv "$DIR.new" "$DIR"
rm -f /tmp/money-src.tar.gz /tmp/money-config.tar.gz /tmp/remote-deploy.sh

cd "$DIR"
"${COMPOSE[@]}" config -q
"${COMPOSE[@]}" build
"${COMPOSE[@]}" up -d --remove-orphans
docker image prune -f >/dev/null
"${COMPOSE[@]}" ps
