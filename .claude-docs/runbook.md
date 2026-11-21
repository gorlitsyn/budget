---
tags: [memory/repo, runbook]
---

# Runbook

Скрипты запускаются с вашего компьютера. Нужны SSH-доступ к серверу, sudo на нём и два файла вне git:
`deploy/.env` и `deploy/money.env` (образцы — `*.example`).

## Первый запуск

1. DNS: домен приложения указывает на сервер. Passkeys работают только по HTTPS.
2. Заполнить `deploy/.env` и `deploy/money.env`. `RP_ID` и `ORIGIN` после первой регистрации не менять.
3. Закоммитить, `scripts/deploy.sh`. На слабом сервере сборка идёт несколько минут (pnpm install, node-gyp,
   vite). Скрипт ждёт `/api/health` через прокси — первый ответ после выпуска сертификата.
4. `scripts/invite.sh` → открыть ссылку на телефоне, ввести имя, создать passkey. Первый — админ.
5. В приложении: Ещё → Доступ и приглашения → Пригласить.

## Деплой

`scripts/deploy.sh` — только закоммиченный HEAD (`git archive`) плюс настройки из `deploy/.env` и
`deploy/money.env` отдельным архивом. На сервере `MONEY_DIR` заменяется целиком (прошлая версия — `<MONEY_DIR>.old`),
`docker compose build`, `up -d`. Ревизия — в `<MONEY_DIR>/REVISION`.

Команда compose на сервере зависит от способа доступа:

```bash
# caddy-docker-proxy (задан MONEY_PROXY_NETWORK)
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.caddy-proxy.yml up -d --build
# свой HTTPS-прокси на 127.0.0.1:MONEY_PORT
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.port.yml up -d --build
```

`up` только с базовым файлом отключит приложение от прокси. Для `ps`, `logs` и `exec` базового файла достаточно.

Откат: на сервере переименовать `<MONEY_DIR>` в `.bad`, `<MONEY_DIR>.old` — обратно, затем `up -d --build` командой
выше. Если новая версия успела применить миграцию, старая откажется стартовать («БД новее приложения»):
восстанавливать БД из бэкапа.

## Бэкап и восстановление

> Если фаервол ограничивает частоту SSH, бэкап и деплой подряд могут получить `Connection refused`: бэкап
> открывает три подключения. Между ними — пауза ~30 с.

`scripts/backup.sh` → `<MONEY_BACKUP_DIR>/money-<дата>.db` (600).
Восстановление: остановить api, положить файл как `<MONEY_DATA>/money.db` (владелец 1000:1000),
удалить рядом `money.db-wal` и `money.db-shm`, поднять api.

## Полезное на сервере

```bash
cd <MONEY_DIR>
sudo docker compose -f deploy/docker-compose.yml ps
sudo docker compose -f deploy/docker-compose.yml logs -f api
sudo docker compose -f deploy/docker-compose.yml exec api node dist/cli.js users
```

## Пересборка категорий (`cli recategorize`)

Файл `import/<имя>.json` (личные данные, в git не попадает): новое дерево, соответствие старых категорий новым,
правила по комментарию, разбиения трат, план. Всё в одной транзакции: трата без соответствия, несошедшееся
разбиение или изменившаяся общая сумма откатывают всё. Повторный запуск откажет: старых путей уже нет.

1. Пробный прогон: `... exec -T api node dist/cli.js recategorize /data/recategorize.json --owner <id> --dry-run`.
2. `scripts/backup.sh`, тот же запуск без `--dry-run`.
3. Удалить файл из `<MONEY_DATA>`.

## Массовое добавление покупок

Файл `import/<имя>.json`: `[{ "name": "Молоко", "qty": "5 шт." }, ...]`. Позиции добавляются купленными (попадают в
подсказки, в «купить» возвращаются одним нажатием), уже имеющиеся в списке пропускаются, повтор безопасен.
Открытые приложения увидят их при следующем возврате на экран: CLI — отдельный процесс, SSE-событий не шлёт.

```bash
scp import/<имя>.json <MONEY_SSH>:<MONEY_DATA>/shopping.json
cd <MONEY_DIR> && docker compose -f deploy/docker-compose.yml exec -T api node dist/cli.js shopping-add /data/shopping.json --owner <id> --list Продукты --dry-run
```
Затем тот же запуск без `--dry-run` и удалить `<MONEY_DATA>/shopping.json`.
