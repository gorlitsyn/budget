/**
 * История плана. План один и правится в текущем месяце, но прошедшие месяцы считаются по тому плану,
 * что действовал тогда: перед первой правкой в новом месяце текущий план записывается как версия,
 * действующая по прошлый месяц включительно. Одна строка покрывает все месяцы без правок.
 */
import type { DB } from './db/index.ts';

export interface PlanVersionItem {
  id: string;
  name: string;
  amount: number;
  /** Категории статьи; без частей статья покрывает их вместе с подкатегориями. */
  links: string[];
  parts: { categoryId: string; amount: number }[];
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Месяц момента времени в часовом поясе сервера (переменная TZ). */
export function monthOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function livePlan(db: DB, ownerId: string): PlanVersionItem[] {
  const items = db
    .prepare('SELECT id, name, amount FROM plan_items WHERE owner_id = ? AND deleted_at IS NULL ORDER BY sort, created_at')
    .all(ownerId) as { id: string; name: string; amount: number }[];
  const links = db
    .prepare(
      `SELECT pc.plan_item_id AS item, pc.category_id AS cat FROM plan_item_categories pc
       JOIN plan_items p ON p.id = pc.plan_item_id WHERE p.owner_id = ? AND p.deleted_at IS NULL`,
    )
    .all(ownerId) as { item: string; cat: string }[];
  const parts = db
    .prepare(
      `SELECT pp.plan_item_id AS item, pp.category_id AS cat, pp.amount FROM plan_item_parts pp
       JOIN plan_items p ON p.id = pp.plan_item_id WHERE p.owner_id = ? AND p.deleted_at IS NULL`,
    )
    .all(ownerId) as { item: string; cat: string; amount: number }[];
  return items.map((it) => ({
    ...it,
    links: links.filter((l) => l.item === it.id).map((l) => l.cat),
    parts: parts.filter((p) => p.item === it.id).map((p) => ({ categoryId: p.cat, amount: p.amount })),
  }));
}

/** План, действовавший в месяце: ближайшая версия не раньше него, иначе текущий. */
export function planForMonth(db: DB, ownerId: string, month: string): PlanVersionItem[] {
  const row = db
    .prepare('SELECT data FROM plan_versions WHERE owner_id = ? AND until_month >= ? ORDER BY until_month LIMIT 1')
    .get(ownerId, month) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as PlanVersionItem[]) : livePlan(db, ownerId);
}

/** Звать внутри транзакции ДО изменения плана. В одном месяце срабатывает один раз. */
export function freezePlan(db: DB, ownerId: string, now: number): void {
  const until = shiftMonth(monthOf(now), -1);
  const last = db.prepare('SELECT max(until_month) AS m FROM plan_versions WHERE owner_id = ?').get(ownerId) as { m: string | null };
  if (last.m && last.m >= until) return;
  db.prepare('INSERT INTO plan_versions (owner_id, until_month, data, created_at) VALUES (?, ?, ?, ?)').run(
    ownerId,
    until,
    JSON.stringify(livePlan(db, ownerId)),
    now,
  );
}
