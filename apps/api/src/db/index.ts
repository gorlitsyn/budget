import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations.ts';

export type DB = Database.Database;

/** ':memory:' — для тестов. */
export function openDb(dataDir: string | ':memory:'): DB {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    file = path.join(dataDir, 'money.db');
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/** Догнать схему до текущей. Экспорт — для теста миграций. */
export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > MIGRATIONS.length) {
    throw new Error(`БД новее приложения: версия схемы ${current}, приложение знает ${MIGRATIONS.length}`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      const m = MIGRATIONS[v]!;
      if (typeof m === 'string') db.exec(m);
      else m(db);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
