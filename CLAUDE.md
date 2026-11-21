# CLAUDE.md — money

«Бюджет» — self-hosted учёт движения средств и общие списки покупок. Описание для людей — [README.md](README.md).

## Documentation index

- [.claude-docs/index.md](.claude-docs/index.md) — таблица маршрутизации
- [.claude-docs/architecture.md](.claude-docs/architecture.md) — стек, раскладка, модель доступа, путь запроса
- [.claude-docs/roadmap.md](.claude-docs/roadmap.md) — этапы и решения по продукту
- [.claude-docs/runbook.md](.claude-docs/runbook.md) — первый запуск, деплой, бэкап, откат
- [.claude-docs/conventions.md](.claude-docs/conventions.md) — код, миграции, тексты
- [.claude-docs/gotchas.md](.claude-docs/gotchas.md) — неочевидные грабли

## Commands

```bash
pnpm install
pnpm dev:api          # API на :3000, БД в ./data, вход по имени без passkey (DEV_LOGIN=1)
pnpm dev:web          # фронт на :5173, /api проксируется на :3000
pnpm typecheck && pnpm test
pnpm --filter @money/api cli invite   # ссылка регистрации для локальной БД (ORIGIN=http://localhost:5173)
scripts/deploy.sh     # HEAD → сервер, сборка образов там, проверка /api/health (нужен deploy/.env)
scripts/invite.sh     # ссылка регистрации на сервере (первый зарегистрированный — админ)
scripts/backup.sh     # копия БД с сервера в MONEY_BACKUP_DIR
```

## Boundaries

### MUST

- Новая таблица/колонка — только новой миграцией в конец `apps/api/src/db/migrations.ts`.
- Каждый эндпоинт данных раздела проверяет права через `store.grantsIn(ownerId, userId)`:
  пользователи изолированы, чужое видно только по выданным разделам.
- Правка плана и категорий сначала зовёт `freezePlan`: прошедшие месяцы считаются по своей версии плана.
- Перед деплоем, меняющим схему БД, — `scripts/backup.sh`.

### MUST NOT

- Не менять `RP_ID`/`ORIGIN` в `deploy/money.env` после первой регистрации — все passkeys станут недействительны.
- Не публиковать порты `web`/`api` на внешний интерфейс: Docker-порты обходят фаервол. Снаружи — только через HTTPS-прокси.
- Не коммитить `data/`, `*.db`, `import/`, архивы бэкапов, `deploy/.env`, `deploy/money.env`.
- Не добавлять в репозиторий адреса, домены, пути и имена конкретной установки: они живут в `deploy/.env`.
- Не копировать код и CSS openGym (AGPL-3.0) — стиль воспроизводится своими токенами.

## Workflow

- Default branch: `master`. Деплоится закоммиченный HEAD.
