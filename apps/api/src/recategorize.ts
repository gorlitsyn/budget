/**
 * Пересборка дерева категорий и плана с нуля (`cli recategorize`). Все траты переезжают в новые категории
 * по таблице соответствий из файла, старые категории и статьи удаляются. Всё в одной транзакции:
 * трата без соответствия, не сошедшееся разбиение или изменившаяся общая сумма откатывают всё.
 */
import { z } from 'zod';
import type { DB } from './db/index.ts';
import { MoneyStore } from './store-money.ts';
import { HttpError, newId } from './util.ts';

const target = z.tuple([z.string().min(1), z.string().min(1).nullable()]);
export const recategorizeSchema = z.object({
  tree: z.array(z.object({ name: z.string().min(1), children: z.array(z.string().min(1)) })).min(1),
  /** Старый путь («Авто › Бензин» или «Продукты») → новый [категория, подкатегория|null]. */
  map: z.record(z.string(), target),
  /** Уточнение по началу комментария: важнее map. */
  rules: z.array(z.object({ from: z.string(), comment: z.string().min(1), to: target })).default([]),
  /** Одна трата → несколько: сумма частей должна совпасть, совпасть должна ровно одна трата. */
  splits: z
    .array(z.object({ from: z.string(), comment: z.string().min(1), parts: z.array(z.object({ to: target, amount: z.number().int().positive() })).min(2) }))
    .default([]),
  /** Куда отнести уже удалённые траты без соответствия: они не видны, но ссылаются на категорию. */
  fallback: target,
  plan: z.array(z.object({ category: z.string().min(1), amount: z.number().int().min(0).default(0), parts: z.record(z.string(), z.number().int().min(0)).default({}) })),
});

export interface RecategorizeReport {
  before: { count: number; sum: number };
  after: { count: number; sum: number };
  categories: number;
  subcategories: number;
  totals: { name: string; amount: number; children: { name: string; amount: number }[] }[];
  plan: { name: string; amount: number }[];
}

interface Tx {
  id: string;
  date: string;
  amount: number;
  category_id: string;
  comment: string;
  created_by: string;
  created_at: number;
  deleted_at: number | null;
}

class DryRun extends Error {}
const starts = (comment: string, prefix: string) => comment.trim().toLowerCase().startsWith(prefix.trim().toLowerCase());

export function runRecategorize(db: DB, ownerId: string, raw: unknown, opts: { dryRun: boolean }): RecategorizeReport {
  const spec = recategorizeSchema.parse(raw);
  const money = new MoneyStore(db);
  let report: RecategorizeReport | undefined;

  const stats = () =>
    db.prepare('SELECT count(*) AS count, coalesce(sum(amount), 0) AS sum FROM transactions WHERE owner_id = ? AND deleted_at IS NULL').get(ownerId) as {
      count: number;
      sum: number;
    };

  try {
    db.transaction(() => {
      const before = stats();
      const oldCats = db.prepare('SELECT id, name, parent_id FROM categories WHERE owner_id = ?').all(ownerId) as {
        id: string;
        name: string;
        parent_id: string | null;
      }[];
      const oldById = new Map(oldCats.map((c) => [c.id, c]));
      const oldPath = (id: string) => {
        const c = oldById.get(id)!;
        return c.parent_id ? `${oldById.get(c.parent_id)!.name} › ${c.name}` : c.name;
      };
      const txs = db.prepare('SELECT * FROM transactions WHERE owner_id = ?').all(ownerId) as Tx[];

      // ---- новое дерево рядом со старым ----
      const newIds = new Map<string, string>();
      const key = ([p, c]: readonly [string, string | null]) => (c ? `${p} › ${c}` : p);
      for (const t of spec.tree) {
        const id = newId();
        money.upsertCategory(ownerId, id, { name: t.name, parentId: null });
        newIds.set(t.name, id);
        for (const ch of t.children) {
          const cid = newId();
          money.upsertCategory(ownerId, cid, { name: ch, parentId: id });
          newIds.set(`${t.name} › ${ch}`, cid);
        }
      }
      const idOf = (t: readonly [string, string | null]) => {
        const id = newIds.get(key(t));
        if (!id) throw new HttpError(400, `В дереве нет «${key(t)}»`);
        return id;
      };

      // ---- разбиения ----
      const splitDone = new Set<string>();
      const insert = db.prepare(
        `INSERT INTO transactions (id, owner_id, date, amount, category_id, comment, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const update = db.prepare('UPDATE transactions SET amount = ?, category_id = ?, updated_at = ? WHERE id = ?');
      const now = Date.now();
      for (const sp of spec.splits) {
        const hit = txs.filter((t) => !t.deleted_at && oldPath(t.category_id) === sp.from && starts(t.comment, sp.comment));
        if (hit.length !== 1) throw new HttpError(400, `Разбиение «${sp.from} / ${sp.comment}»: найдено трат ${hit.length}, нужна одна`);
        const t = hit[0]!;
        if (sp.parts.reduce((s, p) => s + p.amount, 0) !== t.amount) throw new HttpError(400, `Разбиение «${sp.comment}»: сумма частей не равна ${t.amount}`);
        const [first, ...rest] = sp.parts;
        update.run(first!.amount, idOf(first!.to), now, t.id);
        for (const p of rest) insert.run(newId(), ownerId, t.date, p.amount, idOf(p.to), t.comment, t.created_by, t.created_at, now);
        splitDone.add(t.id);
      }

      // ---- остальные траты ----
      const unmapped: string[] = [];
      const move = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');
      for (const t of txs) {
        if (splitDone.has(t.id)) continue;
        const from = oldPath(t.category_id);
        const to = spec.rules.find((r) => r.from === from && starts(t.comment, r.comment))?.to ?? spec.map[from];
        if (!to && !t.deleted_at) {
          unmapped.push(`${t.date} ${from}: ${t.amount / 100} ₽ ${t.comment}`);
          continue;
        }
        move.run(idOf(to ?? spec.fallback), t.id);
      }
      if (unmapped.length) throw new HttpError(400, `Нет соответствия для трат:\n${unmapped.join('\n')}`);

      // ---- старое убрать, план собрать заново ----
      db.prepare('DELETE FROM plan_items WHERE owner_id = ?').run(ownerId); // части и привязки — каскадом
      const clear = db.prepare('UPDATE categories SET parent_id = NULL WHERE id = ?');
      const del = db.prepare('DELETE FROM categories WHERE id = ?');
      for (const c of oldCats) clear.run(c.id);
      for (const c of oldCats) del.run(c.id);

      for (const p of spec.plan) {
        const parts = Object.entries(p.parts).map(([sub, amount]) => ({ categoryId: idOf([p.category, sub]), amount }));
        money.upsertPlanItem(ownerId, newId(), { categoryId: idOf([p.category, null]), amount: p.amount, parts });
      }

      // ---- контроль: деньги не должны измениться ----
      const after = stats();
      if (after.sum !== before.sum) throw new Error(`Сумма трат изменилась: ${before.sum} → ${after.sum}`);
      const extra = spec.splits.reduce((s, x) => s + x.parts.length - 1, 0);
      if (after.count !== before.count + extra) throw new Error(`Число трат: ожидалось ${before.count + extra}, стало ${after.count}`);

      const spent = new Map(
        (
          db.prepare('SELECT category_id AS c, sum(amount) AS s FROM transactions WHERE owner_id = ? AND deleted_at IS NULL GROUP BY category_id').all(ownerId) as {
            c: string;
            s: number;
          }[]
        ).map((r) => [r.c, r.s]),
      );
      const totals = spec.tree.map((t) => {
        const own = spent.get(newIds.get(t.name)!) ?? 0;
        const children = t.children.map((ch) => ({ name: ch, amount: spent.get(newIds.get(`${t.name} › ${ch}`)!) ?? 0 }));
        if (own && children.length) children.push({ name: '(без подкатегории)', amount: own });
        return { name: t.name, amount: own + (t.children.length ? children.filter((c) => c.name !== '(без подкатегории)').reduce((s, c) => s + c.amount, 0) : 0), children };
      });
      report = {
        before,
        after,
        categories: spec.tree.length,
        subcategories: spec.tree.reduce((s, t) => s + t.children.length, 0),
        totals,
        plan: money.plan(ownerId).map((p) => ({ name: p.name, amount: p.amount })),
      };
      if (opts.dryRun) throw new DryRun('откат');
    })();
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return report!;
}
