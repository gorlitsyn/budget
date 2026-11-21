#!/usr/bin/env bash
# Копия БД с сервера на этот компьютер (каталог MONEY_BACKUP_DIR из deploy/.env).
# В копии passkeys, сессии и все траты — не коммитить и никуда не выкладывать.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
: "${MONEY_DATA:?укажите MONEY_DATA в deploy/.env}"

OUT=${MONEY_BACKUP_DIR:-$HOME/money-backups}
NAME=money-$(date +%F-%H%M).db

mkdir -p "$OUT"
chmod 700 "$OUT"
# Online backup SQLite изнутри api: согласованная копия без остановки (простое копирование
# файла при WAL может дать битую БД). Одно ssh на подготовку — фаервол может ограничивать частоту SSH.
ssh -t "$HOST" "cd $MONEY_DIR && sudo docker compose -f deploy/docker-compose.yml exec -T api node dist/cli.js backup /data/$NAME >/dev/null \
  && sudo mv $MONEY_DATA/$NAME /tmp/$NAME && sudo chown \$(id -un) /tmp/$NAME"
scp -q "$HOST:/tmp/$NAME" "$OUT/$NAME"
ssh "$HOST" "rm -f /tmp/$NAME"
chmod 600 "$OUT/$NAME"
echo "$OUT/$NAME"
