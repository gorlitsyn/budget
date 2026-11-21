/** Сводка месяца: итоги, остаток с переносом, план-факт, траты по категориям, динамика. */
import type { Opening, Summary } from '@money/shared';
import type { DB } from './db/index.ts';
import { planForMonth, shiftMonth } from './plan-history.ts';

const HISTORY_MONTHS = 6;

/** Сводка для того, кому «Поступления» закрыты: убирает доходы и остатки, из которых они вычисляются. */
export function withoutIncome(s: Summary): Summary {
  return {
    ...s,
    income: null,
    carryIn: null,
    opening: null,
    history: s.history.map((h) => ({ ...h, income: null })),
  };
}

export class SummaryStore {
  constructor(private db: DB) {}

  opening(ownerId: string): Opening | null {
    const r = this.db.prepare('SELECT opening_amount, opening_month FROM space_settings WHERE owner_id = ?').get(ownerId) as
      | { opening_amount: number | null; opening_month: string | null }
      | undefined;
    return r && r.opening_amount !== null && r.opening_month ? { amount: r.opening_amount, month: r.opening_month } : null;
  }

  setOpening(ownerId: string, o: Opening | null): void {
    this.db
      .prepare(
        `INSERT INTO space_settings (owner_id, opening_amount, opening_month) VALUES (?, ?, ?)
         ON CONFLICT (owner_id) DO UPDATE SET opening_amount = excluded.opening_amount, opening_month = excluded.opening_month`,
      )
      .run(ownerId, o?.amount ?? null, o?.month ?? null);
  }

  /** Поступления минус траты за даты [from, to) — строки 'YYYY-MM-DD'; from = null — с начала. */
  private net(ownerId: string, from: string | null, to: string): number {
    const sum = (table: 'incomes' | 'transactions') =>
      (
        this.db
          .prepare(
            `SELECT coalesce(sum(amount), 0) AS s FROM ${table}
             WHERE owner_id = ? AND deleted_at IS NULL AND date >= ? AND date < ?`,
          )
          .get(ownerId, from ?? '0000', to) as { s: number }
      ).s;
    return sum('incomes') - sum('transactions');
  }

  summary(ownerId: string, month: string): Summary {
    const from = `${month}-01`;
    const to = `${shiftMonth(month, 1)}-01`;

    const byCategory = this.db
      .prepare(
        `SELECT category_id AS categoryId, sum(amount) AS amount FROM transactions
         WHERE owner_id = ? AND deleted_at IS NULL AND date >= ? AND date < ?
         GROUP BY category_id ORDER BY amount DESC`,
      )
      .all(ownerId, from, to) as { categoryId: string; amount: number }[];
    const expense = byCategory.reduce((s, c) => s + c.amount, 0);
    const income = (
      this.db
        .prepare('SELECT coalesce(sum(amount), 0) AS s FROM incomes WHERE owner_id = ? AND deleted_at IS NULL AND date >= ? AND date < ?')
        .get(ownerId, from, to) as { s: number }
    ).s;

    // Остаток на начало: от начального остатка (если задан) или от самых первых записей.
    const opening = this.opening(ownerId);
    let carryIn: number | null;
    if (!opening) carryIn = this.net(ownerId, null, from);
    else if (month < opening.month) carryIn = null;
    else carryIn = opening.amount + this.net(ownerId, `${opening.month}-01`, from);

    // План-факт: статья покрывает свои категории; категория верхнего уровня — вместе с подкатегориями.
    const children = new Map<string, string[]>();
    const order = new Map<string, number>();
    (this.db.prepare('SELECT id, parent_id FROM categories WHERE owner_id = ? ORDER BY sort, created_at').all(ownerId) as {
      id: string;
      parent_id: string | null;
    }[]).forEach((r, i) => {
      order.set(r.id, i);
      if (r.parent_id) children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r.id]);
    });
    const spent = new Map(byCategory.map((c) => [c.categoryId, c.amount]));
    const covered = new Set<string>();
    // Прошедший месяц считается по плану, действовавшему тогда.
    const plan = planForMonth(this.db, ownerId, month).map((it) => {
      // Выбраны подкатегории — считаются только они, остальное «вне плана». Не выбраны — вся категория.
      const planned = new Map(it.parts.map((p) => [p.categoryId, p.amount]));
      const cats = new Set<string>(planned.keys());
      if (!planned.size) {
        for (const l of it.links) {
          cats.add(l);
          for (const c of children.get(l) ?? []) cats.add(c);
        }
      }
      let fact = 0;
      for (const c of cats) {
        fact += spent.get(c) ?? 0;
        covered.add(c);
      }
      const parts = [...planned.keys()]
        .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
        .map((categoryId) => ({ categoryId, amount: planned.get(categoryId)!, fact: spent.get(categoryId) ?? 0 }));
      return { id: it.id, name: it.name, amount: it.amount, fact, parts };
    });
    const unplanned = byCategory.filter((c) => !covered.has(c.categoryId)).reduce((s, c) => s + c.amount, 0);

    // Динамика: последние месяцы по выбранный включительно.
    const first = shiftMonth(month, -(HISTORY_MONTHS - 1));
    const perMonth = (table: 'incomes' | 'transactions') =>
      new Map(
        (
          this.db
            .prepare(
              `SELECT substr(date, 1, 7) AS m, sum(amount) AS s FROM ${table}
               WHERE owner_id = ? AND deleted_at IS NULL AND date >= ? AND date < ? GROUP BY m`,
            )
            .all(ownerId, `${first}-01`, to) as { m: string; s: number }[]
        ).map((r) => [r.m, r.s]),
      );
    const inc = perMonth('incomes');
    const exp = perMonth('transactions');
    const history = Array.from({ length: HISTORY_MONTHS }, (_, i) => {
      const m = shiftMonth(first, i);
      return { month: m, income: inc.get(m) ?? 0, expense: exp.get(m) ?? 0 };
    });

    return { month, income, expense, carryIn, opening, byCategory, plan, unplanned, history };
  }
}
