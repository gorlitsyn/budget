import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/index.ts';
import { MIGRATIONS } from '../src/db/migrations.ts';

describe('миграции', () => {
  it('v3 → v4: подсказки покупок разложены по спискам из истории позиций', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const m of MIGRATIONS.slice(0, 3)) db.exec(m as string);
    db.pragma('user_version = 3');
    db.prepare("INSERT INTO users (id, name, created_at) VALUES ('u', 'К', 0)").run();
    const list = db.prepare('INSERT INTO shopping_lists (id, owner_id, name, created_at, deleted_at) VALUES (?, ?, ?, 0, ?)');
    list.run('food', 'u', 'Продукты', null);
    list.run('home', 'u', 'Бытовое', null);
    list.run('gone', 'u', 'Удалённый', 5);
    const item = db.prepare(
      'INSERT INTO shopping_items (id, owner_id, list_id, name, added_by, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    item.run('i1', 'u', 'food', 'Молоко', 'u', 1, 1, null);
    item.run('i2', 'u', 'food', 'молоко', 'u', 2, 2, 3); // купили и убрали — в истории всё равно
    item.run('i3', 'u', 'home', 'Мыло', 'u', 4, 4, null);
    item.run('i4', 'u', 'gone', 'Пластырь', 'u', 5, 5, 5);
    db.prepare("INSERT INTO shopping_history (owner_id, key, name, uses, last_used) VALUES ('u', 'молоко', 'Молоко', 2, 2)").run();

    migrate(db);

    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    const rows = db.prepare('SELECT list_id, key, name, uses, last_used FROM shopping_history ORDER BY list_id, key').all();
    expect(rows).toEqual([
      { list_id: 'food', key: 'молоко', name: 'молоко', uses: 2, last_used: 2 },
      { list_id: 'home', key: 'мыло', name: 'Мыло', uses: 1, last_used: 4 },
    ]);
  });
});
