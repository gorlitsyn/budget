import type Database from 'better-sqlite3';
import { nameKey } from '../util.ts';

/**
 * Миграции по порядку; номер версии = индекс + 1, хранится в PRAGMA user_version.
 * Уже выпущенную миграцию не править — только добавлять новую в конец.
 * Время везде — миллисекунды UTC (Date.now()).
 * Миграция — SQL или функция (когда данные нужно пересчитать в JS). Каждая идёт в своей транзакции.
 */
export const MIGRATIONS: (string | ((db: Database.Database) => void))[] = [
  /* 1: пользователи, passkeys, сессии, инвайты, права */ `
  CREATE TABLE users (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    admin       INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE credentials (
    id            TEXT PRIMARY KEY,             -- credential ID, base64url
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key    BLOB NOT NULL,
    counter       INTEGER NOT NULL DEFAULT 0,
    transports    TEXT NOT NULL DEFAULT '[]',   -- JSON
    device_type   TEXT NOT NULL,
    backed_up     INTEGER NOT NULL,
    name          TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    last_used_at  INTEGER
  );
  CREATE INDEX credentials_user ON credentials(user_id);

  CREATE TABLE sessions (
    token_hash    TEXT PRIMARY KEY,             -- sha256 от токена из cookie
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  -- Незавершённые церемонии WebAuthn. Живут минуты, id лежит в cookie.
  CREATE TABLE challenges (
    id          TEXT PRIMARY KEY,
    challenge   TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('register', 'login', 'add')),
    user_id     TEXT,                           -- будущий id пользователя (register) или текущий (add)
    invite_id   TEXT,
    name        TEXT,
    expires_at  INTEGER NOT NULL
  );

  -- Инвайт: регистрация (если человека ещё нет) + доступ к пространству автора.
  -- owner_id NULL — системный, из консоли сервера: только регистрация.
  CREATE TABLE invites (
    id          TEXT PRIMARY KEY,
    token_hash  TEXT NOT NULL UNIQUE,
    owner_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
    note        TEXT NOT NULL DEFAULT '',
    grants      TEXT NOT NULL DEFAULT '{}',     -- JSON: раздел → уровень
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    used_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
    used_at     INTEGER
  );
  CREATE INDEX invites_owner ON invites(owner_id);

  -- Права участника в пространстве владельца. Нет строки = нет доступа.
  CREATE TABLE grants (
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section     TEXT NOT NULL,
    level       TEXT NOT NULL CHECK (level IN ('view', 'edit')),
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (owner_id, member_id, section),
    CHECK (owner_id <> member_id)
  );
  CREATE INDEX grants_member ON grants(member_id);
  `,
  /* 2: списки покупок */ `
  CREATE TABLE shopping_lists (
    id          TEXT PRIMARY KEY,               -- создаёт клиент (офлайн-очередь)
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    deleted_at  INTEGER                         -- надгробие: повтор из очереди не воскресит
  );
  CREATE INDEX shopping_lists_owner ON shopping_lists(owner_id);

  CREATE TABLE shopping_items (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_id     TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    qty         TEXT NOT NULL DEFAULT '',
    checked     INTEGER NOT NULL DEFAULT 0,
    added_by    TEXT NOT NULL,                  -- без FK: подпись остаётся, даже если человек ушёл
    checked_by  TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
  );
  CREATE INDEX shopping_items_list ON shopping_items(list_id);

  -- Для подсказок при вводе: что и как часто покупали в этом пространстве.
  CREATE TABLE shopping_history (
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,                  -- название в нижнем регистре
    name        TEXT NOT NULL,                  -- как написали в последний раз
    uses        INTEGER NOT NULL DEFAULT 1,
    last_used   INTEGER NOT NULL,
    PRIMARY KEY (owner_id, key)
  );
  `,
  /* 3: категории, виды поступлений, траты, поступления, план */ `
  -- Справочники пространства. Удаление — архив: старые траты сохраняют название категории.
  CREATE TABLE categories (
    id           TEXT PRIMARY KEY,
    owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    parent_id    TEXT REFERENCES categories(id),
    sort         INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    archived_at  INTEGER
  );
  CREATE INDEX categories_owner ON categories(owner_id);

  CREATE TABLE income_kinds (
    id           TEXT PRIMARY KEY,
    owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    sort         INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    archived_at  INTEGER
  );
  CREATE INDEX income_kinds_owner ON income_kinds(owner_id);

  -- Справочники заводятся один раз: удалил всё — шаблон не вернётся.
  CREATE TABLE space_setup (
    owner_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    seeded_at    INTEGER NOT NULL
  );

  -- Суммы — целые копейки. date — 'YYYY-MM-DD' по календарю пользователя.
  CREATE TABLE transactions (
    id           TEXT PRIMARY KEY,
    owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date         TEXT NOT NULL,
    amount       INTEGER NOT NULL CHECK (amount > 0),
    category_id  TEXT NOT NULL REFERENCES categories(id),
    comment      TEXT NOT NULL DEFAULT '',
    created_by   TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER
  );
  CREATE INDEX transactions_owner_date ON transactions(owner_id, date);

  CREATE TABLE incomes (
    id           TEXT PRIMARY KEY,
    owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date         TEXT NOT NULL,
    amount       INTEGER NOT NULL CHECK (amount > 0),
    kind_id      TEXT NOT NULL REFERENCES income_kinds(id),
    comment      TEXT NOT NULL DEFAULT '',
    created_by   TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER
  );
  CREATE INDEX incomes_owner_date ON incomes(owner_id, date);

  -- Ежемесячный план: статья с суммой, покрывает одну или несколько категорий/подкатегорий.
  CREATE TABLE plan_items (
    id           TEXT PRIMARY KEY,
    owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    amount       INTEGER NOT NULL DEFAULT 0,
    sort         INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    deleted_at   INTEGER
  );
  CREATE INDEX plan_items_owner ON plan_items(owner_id);

  CREATE TABLE plan_item_categories (
    plan_item_id TEXT NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
    category_id  TEXT NOT NULL REFERENCES categories(id),
    PRIMARY KEY (plan_item_id, category_id)
  );
  `,
  /* 4: подсказки покупок — свои у каждого списка */ (db) => {
    db.exec(`
      CREATE TABLE shopping_history_v4 (
        owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        list_id     TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
        key         TEXT NOT NULL,
        name        TEXT NOT NULL,
        uses        INTEGER NOT NULL DEFAULT 1,
        last_used   INTEGER NOT NULL,
        PRIMARY KEY (owner_id, list_id, key)
      );
    `);
    // Историю пересобираем из позиций: в каком списке что покупали. Ключ — только в JS (кириллица).
    const rows = db
      .prepare(
        `SELECT i.owner_id, i.list_id, i.name, i.created_at FROM shopping_items i
         JOIN shopping_lists l ON l.id = i.list_id WHERE l.deleted_at IS NULL ORDER BY i.created_at`,
      )
      .all() as { owner_id: string; list_id: string; name: string; created_at: number }[];
    const upsert = db.prepare(
      `INSERT INTO shopping_history_v4 (owner_id, list_id, key, name, uses, last_used) VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT (owner_id, list_id, key) DO UPDATE SET name = excluded.name, uses = uses + 1, last_used = excluded.last_used`,
    );
    for (const r of rows) upsert.run(r.owner_id, r.list_id, nameKey(r.name), r.name.trim(), r.created_at);
    db.exec('DROP TABLE shopping_history; ALTER TABLE shopping_history_v4 RENAME TO shopping_history;');
  },
  /* 5: стоимость позиции в списке покупок */ `
  ALTER TABLE shopping_items ADD COLUMN price INTEGER CHECK (price IS NULL OR price > 0);
  `,
  /* 6: настройки пространства — начальный остаток для сводки */ `
  CREATE TABLE space_settings (
    owner_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    opening_amount  INTEGER,           -- копейки, может быть < 0
    opening_month   TEXT               -- 'YYYY-MM': остаток на начало этого месяца
  );
  `,
  /* 7: плановые суммы по подкатегориям внутри статьи */ `
  CREATE TABLE plan_item_parts (
    plan_item_id TEXT NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
    category_id  TEXT NOT NULL REFERENCES categories(id),
    amount       INTEGER NOT NULL CHECK (amount > 0),
    PRIMARY KEY (plan_item_id, category_id)
  );
  `,
  /* 8: подкатегория может входить в план без своей суммы (в общую сумму статьи) */ `
  CREATE TABLE plan_item_parts_v8 (
    plan_item_id TEXT NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
    category_id  TEXT NOT NULL REFERENCES categories(id),
    amount       INTEGER NOT NULL CHECK (amount >= 0),
    PRIMARY KEY (plan_item_id, category_id)
  );
  INSERT INTO plan_item_parts_v8 SELECT plan_item_id, category_id, amount FROM plan_item_parts;
  DROP TABLE plan_item_parts;
  ALTER TABLE plan_item_parts_v8 RENAME TO plan_item_parts;
  `,
  /* 9: версии плана — прошедшие месяцы считаются по плану, действовавшему тогда */ `
  CREATE TABLE plan_versions (
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    until_month TEXT NOT NULL,
    data        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (owner_id, until_month)
  );
  `,
];
