# Бюджет

Self-hosted приложение для учёта денег и общих списков покупок. Ставится на свой сервер, открывается в браузере и
добавляется на экран телефона как приложение (PWA). Интерфейс на русском.

## Возможности

- **Покупки.** Несколько списков, изменения сразу видны всем участникам, работа без связи, подсказки по прошлым
  покупкам, цена позиции.
- **Траты и поступления** по месяцам, категории с подкатегориями, фильтр по категории.
- **План** известных ежемесячных трат. Изменение плана не переписывает прошедшие месяцы.
- **Сводка:** остаток с переносом, план и факт, траты по категориям, динамика за полгода.
- **Совместный доступ.** Данные каждого пользователя изолированы. Владелец приглашает человека и для каждого раздела
  выбирает: нет доступа, смотреть или править.
- **Вход по passkey**, без паролей. Регистрация только по приглашению.

## Стек

Node.js, TypeScript, Fastify, SQLite, Vue 3, Vite, Pinia. Монорепозиторий на pnpm, запуск на сервере через Docker Compose.

## Установка на сервер

Нужны Docker с Compose, домен и HTTPS: passkeys без него не работают.

```bash
git clone <адрес репозитория> money
cd money
cp deploy/.env.example deploy/.env
cp deploy/money.env.example deploy/money.env
```

В `deploy/money.env` укажите свой домен в `RP_ID` и `ORIGIN` и часовой пояс в `TZ`. После первой регистрации домен
менять нельзя: созданные passkeys перестанут работать.

Подготовьте каталог для базы и запустите приложение:

```bash
mkdir -p data && sudo chown 1000:1000 data
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.port.yml up -d --build
```

Приложение слушает `127.0.0.1:8080`. Направьте на этот адрес свой HTTPS-прокси, например Caddy:

```
budget.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Если у вас уже работает caddy-docker-proxy, заполните `MONEY_DOMAIN` и `MONEY_PROXY_NETWORK` в `deploy/.env` и
используйте `deploy/docker-compose.caddy-proxy.yml` вместо `docker-compose.port.yml`.

Создайте первую ссылку регистрации. Первый зарегистрированный пользователь становится администратором:

```bash
docker compose -f deploy/docker-compose.yml exec api node dist/cli.js invite
```

## Резервные копии

Все данные лежат в одном файле SQLite. Согласованная копия без остановки приложения:

```bash
docker compose -f deploy/docker-compose.yml exec api node dist/cli.js backup /data/backup.db
```

В копии есть passkeys, сессии и все траты, храните её как личные данные.

## Разработка

Нужны Node.js из `.nvmrc` и pnpm.

```bash
pnpm install
pnpm dev:api    # API на :3000, база в ./data, вход по имени без passkey
pnpm dev:web    # интерфейс на http://localhost:5173
pnpm typecheck && pnpm test
```

Устройство проекта описано в [.claude-docs/architecture.md](.claude-docs/architecture.md).

## Лицензия

[GNU AGPL-3.0](LICENSE). Приложение можно свободно ставить, менять и распространять. Если вы изменили его и даёте
пользоваться другим людям через сеть, вы обязаны открыть им исходный код своей версии. Ссылка на код показывается
в разделе «Ещё», её адрес задан в `apps/web/src/about.ts`.
