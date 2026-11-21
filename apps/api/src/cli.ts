/**
 * Консоль сервера. В контейнере: docker compose exec api node dist/cli.js <команда>
 *   invite [заметка]   — ссылка регистрации без доступа к чужому пространству (первый вход админа)
 *   users              — список пользователей
 *   backup <файл>      — согласованная копия БД на ходу (SQLite online backup), для scripts/backup.sh
 *   recategorize <файл.json> --owner <id> [--dry-run] — пересобрать дерево категорий и план
 *   shopping-add <файл.json> --owner <id> --list <название> [--dry-run] — добавить позиции как купленные
 */
import fs from 'node:fs';
import { runShoppingAdd } from './importer.ts';
import { runRecategorize } from './recategorize.ts';
import { openDb } from './db/index.ts';
import { Store } from './store.ts';

const [cmd, ...args] = process.argv.slice(2);
const origin = (process.env.ORIGIN ?? '').replace(/\/$/, '');
const store = new Store(openDb(process.env.DATA_DIR ?? '/data'));

switch (cmd) {
  case 'invite': {
    if (!origin) throw new Error('Не задан ORIGIN');
    const { token } = store.createInvite(null, args.join(' '), {}, Number(process.env.INVITE_DAYS ?? 7));
    const first = store.userCount() === 0 ? ' (первый зарегистрированный станет администратором)' : '';
    console.log(`${origin}/invite/${token}${first}`);
    break;
  }
  case 'users':
    for (const u of store.db.prepare('SELECT id, name, admin, created_at FROM users ORDER BY created_at').all() as {
      id: string;
      name: string;
      admin: number;
      created_at: number;
    }[]) {
      console.log(`${u.id}\t${u.name}${u.admin ? '\t[admin]' : ''}\t${new Date(u.created_at).toISOString()}`);
    }
    break;
  case 'backup': {
    const out = args[0];
    if (!out) throw new Error('Укажите файл: backup /data/backup.db');
    await store.db.backup(out);
    console.log(out);
    break;
  }
  case 'recategorize': {
    const file = args[0];
    const owner = args.includes('--owner') ? args[args.indexOf('--owner') + 1] : undefined;
    if (!file || !owner) throw new Error('recategorize <файл.json> --owner <id> [--dry-run]');
    if (!store.getUser(owner)) throw new Error(`Нет пользователя ${owner}`);
    const dryRun = args.includes('--dry-run');
    const r = runRecategorize(store.db, owner, JSON.parse(fs.readFileSync(file, 'utf8')), { dryRun });
    const rub = (k: number) => (k / 100).toLocaleString('ru-RU');
    console.log(dryRun ? '=== ПРОБНЫЙ ПРОГОН: ничего не записано ===' : '=== ПЕРЕСБОРКА ЗАПИСАНА ===');
    console.log(`Траты: было ${r.before.count} на ${rub(r.before.sum)} ₽, стало ${r.after.count} на ${rub(r.after.sum)} ₽`);
    console.log(`Категорий: ${r.categories}, подкатегорий: ${r.subcategories}; план: ${r.plan.length} статей на ${rub(r.plan.reduce((s, p) => s + p.amount, 0))} ₽`);
    for (const t of r.totals) {
      console.log(`${t.name}\t${rub(t.amount)}`);
      for (const c of t.children) console.log(`   ${c.name}\t${rub(c.amount)}`);
    }
    for (const p of r.plan) console.log(`План: ${p.name}\t${rub(p.amount)}`);
    break;
  }
  case 'shopping-add': {
    const file = args[0];
    const owner = args.includes('--owner') ? args[args.indexOf('--owner') + 1] : undefined;
    const list = args.includes('--list') ? args[args.indexOf('--list') + 1] : undefined;
    if (!file || !owner || !list) throw new Error('shopping-add <файл.json> --owner <id> --list <название> [--dry-run]');
    if (!store.getUser(owner)) throw new Error(`Нет пользователя ${owner}`);
    const dryRun = args.includes('--dry-run');
    const r = runShoppingAdd(store.db, owner, list, JSON.parse(fs.readFileSync(file, 'utf8')), { dryRun });
    console.log(`${dryRun ? 'ПРОБНЫЙ ПРОГОН' : 'ЗАПИСАНО'}: список «${r.list}», добавлено ${r.added}, пропущено ${r.skipped.length}${r.skipped.length ? ` (${r.skipped.join(', ')})` : ''}`);
    break;
  }
  default:
    console.error('Команды: invite [заметка] | users | backup <файл> | recategorize <файл.json> --owner <id> [--dry-run] | shopping-add <файл.json> --owner <id> --list <название> [--dry-run]');
    process.exit(1);
}
