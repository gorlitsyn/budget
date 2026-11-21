#!/usr/bin/env bash
# Ссылка регистрации из консоли сервера (без доступа к чьим-либо разделам).
# Первый, кто зарегистрируется на пустой базе, становится администратором.
#   scripts/invite.sh [заметка]
set -euo pipefail
. "$(dirname "$0")/lib.sh"

NOTE=$(printf '%q' "${*:-}")
ssh -t "$HOST" "cd $MONEY_DIR && sudo docker compose -f deploy/docker-compose.yml exec -T api node dist/cli.js invite $NOTE"
