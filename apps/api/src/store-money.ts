/** SQL трат, поступлений, плана и их справочников. Удаление — надгробие (deleted_at) или архив. */
import {
  type Category,
  DEFAULT_CATEGORIES,
  DEFAULT_INCOME_KINDS,
  type Dictionaries,
  type Income,
  type IncomeKind,
  type PlanItem,
  type PlanPart,
  type Transaction,
} from '@money/shared';
import type { DB } from './db/index.ts';
import { freezePlan } from './plan-history.ts';
import type { Upsert } from './store-shopping.ts';
import { HttpError, nameKey, newId } from './util.ts';

interface CategoryRow {
  id: string;
  owner_id: string;
  name: string;
  parent_id: string | null;
  sort: number;
  archived_at: number | null;
}
interface KindRow {
  id: string;
  owner_id: string;
  name: string;
  archived_at: number | null;
}
interface TxRow {
  id: string;
  owner_id: string;
  date: string;
  amount: number;
  category_id: string;
  comment: string;
  created_by: string;
  updated_at: number;
  deleted_at: number | null;
}
interface IncomeRow extends Omit<TxRow, 'category_id'> {
  kind_id: string;
}
interface PlanRow {
  id: string;
  owner_id: string;
  name: string;
  amount: number;
  deleted_at: number | null;
}

const toCategory = (r: CategoryRow): Category => ({ id: r.id, name: r.name, parentId: r.parent_id, archived: r.archived_at !== null });
const toKind = (r: KindRow): IncomeKind => ({ id: r.id, name: r.name, archived: r.archived_at !== null });
const toTx = (r: TxRow): Transaction => ({
  id: r.id,
  date: r.date,
  amount: r.amount,
  categoryId: r.category_id,
  comment: r.comment,
  createdBy: r.created_by,
  updatedAt: r.updated_at,
});
const toIncome = (r: IncomeRow): Income => ({
  id: r.id,
  date: r.date,
  amount: r.amount,
  kindId: r.kind_id,
  comment: r.comment,
  createdBy: r.created_by,
  updatedAt: r.updated_at,
});

/** Месяц 'YYYY-MM' → границы для сравнения строк дат. */
const monthRange = (month: string) => [`${month}-01`, `${month}-31`] as const;

export class MoneyStore {
  constructor(private db: DB) {}

  // ---- справочники --------------------------------------------------------------------------

  /** Шаблон категорий и видов поступлений — один раз на пространство. */
  private seed(ownerId: string, now: number): void {
    this.db.transaction(() => {
      const done = this.db.prepare('INSERT OR IGNORE INTO space_setup (owner_id, seeded_at) VALUES (?, ?)').run(ownerId, now);
      if (done.changes === 0) return;
      const cat = this.db.prepare('INSERT INTO categories (id, owner_id, name, sort, created_at) VALUES (?, ?, ?, ?, ?)');
      DEFAULT_CATEGORIES.forEach((n, i) => cat.run(newId(), ownerId, n, i, now));
      const kind = this.db.prepare('INSERT INTO income_kinds (id, owner_id, name, sort, created_at) VALUES (?, ?, ?, ?, ?)');
      DEFAULT_INCOME_KINDS.forEach((n, i) => kind.run(newId(), ownerId, n, i, now));
    })();
  }

  dictionaries(ownerId: string, now = Date.now()): Dictionaries {
    this.seed(ownerId, now);
    const categories = this.db
      .prepare('SELECT * FROM categories WHERE owner_id = ? ORDER BY sort, created_at')
      .all(ownerId) as CategoryRow[];
    const kinds = this.db.prepare('SELECT * FROM income_kinds WHERE owner_id = ? ORDER BY sort, created_at').all(ownerId) as KindRow[];
    const people = this.db
      .prepare(
        `SELECT id, name FROM users WHERE id = @owner
           OR id IN (SELECT member_id FROM grants WHERE owner_id = @owner)
           OR id IN (SELECT created_by FROM transactions WHERE owner_id = @owner)
           OR id IN (SELECT created_by FROM incomes WHERE owner_id = @owner)`,
      )
      .all({ owner: ownerId }) as { id: string; name: string }[];
    return {
      categories: categories.map(toCategory),
      incomeKinds: kinds.map(toKind),
      people: Object.fromEntries(people.map((p) => [p.id, p.name])),
    };
  }

  private category(id: string): CategoryRow | undefined {
    return this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
  }

  /** Категория пространства, в которую можно записывать (не чужая, не в архиве). */
  private liveCategory(ownerId: string, id: string): CategoryRow {
    const c = this.category(id);
    if (!c || c.owner_id !== ownerId) throw new HttpError(404, 'Категория не найдена');
    if (c.archived_at) throw new HttpError(400, `Категория «${c.name}» удалена`);
    return c;
  }

  upsertCategory(ownerId: string, id: string, input: { name: string; parentId: string | null }, now = Date.now()): Upsert<Category> {
    return this.db.transaction((): Upsert<Category> => {
      const cur = this.category(id);
      if (cur && cur.owner_id !== ownerId) throw new HttpError(404, 'Категория не найдена');
      if (cur?.archived_at) return { status: 'deleted' };
      if (input.parentId) {
        if (input.parentId === id) throw new HttpError(400, 'Категория не может быть подкатегорией самой себя');
        const parent = this.liveCategory(ownerId, input.parentId);
        if (parent.parent_id) throw new HttpError(400, 'Подкатегории бывают только у категорий верхнего уровня');
        const hasChildren = this.db.prepare('SELECT 1 FROM categories WHERE parent_id = ? AND archived_at IS NULL').get(id);
        if (hasChildren) throw new HttpError(400, 'У категории есть подкатегории — её нельзя сделать подкатегорией');
        if (this.planItemOf(id)) throw new HttpError(400, 'На категорию заведена статья плана — её нельзя сделать подкатегорией');
      }
      if (cur) {
        if (cur.name !== input.name || cur.parent_id !== input.parentId) freezePlan(this.db, ownerId, now);
        this.db.prepare('UPDATE categories SET name = ?, parent_id = ? WHERE id = ?').run(input.name, input.parentId, id);
        // Название статьи плана всегда равно названию её категории.
        this.db
          .prepare('UPDATE plan_items SET name = ? WHERE id IN (SELECT plan_item_id FROM plan_item_categories WHERE category_id = ?)')
          .run(input.name, id);
        if (cur.parent_id !== input.parentId) this.prunePlanParts(ownerId);
      } else {
        const sort = (this.db.prepare('SELECT coalesce(max(sort), -1) + 1 AS s FROM categories WHERE owner_id = ?').get(ownerId) as { s: number }).s;
        this.db
          .prepare('INSERT INTO categories (id, owner_id, name, parent_id, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, ownerId, input.name, input.parentId, sort, now);
      }
      return { status: 'saved', value: toCategory(this.category(id)!) };
    })();
  }

  /** В архив вместе с подкатегориями. Траты с ней остаются и показываются с её названием. */
  archiveCategory(ownerId: string, id: string, now = Date.now()): void {
    const c = this.category(id);
    if (!c || c.owner_id !== ownerId) throw new HttpError(404, 'Категория не найдена');
    this.db.transaction(() => {
      freezePlan(this.db, ownerId, now);
      this.db
        .prepare('UPDATE categories SET archived_at = ? WHERE (id = ? OR parent_id = ?) AND archived_at IS NULL')
        .run(now, id, id);
      // Статья живёт вместе со своей категорией.
      this.db
        .prepare(
          `UPDATE plan_items SET deleted_at = ? WHERE deleted_at IS NULL
           AND id IN (SELECT plan_item_id FROM plan_item_categories WHERE category_id = ?)`,
        )
        .run(now, id);
      this.prunePlanParts(ownerId);
    })();
  }

  private kind(id: string): KindRow | undefined {
    return this.db.prepare('SELECT * FROM income_kinds WHERE id = ?').get(id) as KindRow | undefined;
  }

  upsertIncomeKind(ownerId: string, id: string, name: string, now = Date.now()): Upsert<IncomeKind> {
    const cur = this.kind(id);
    if (cur && cur.owner_id !== ownerId) throw new HttpError(404, 'Вид поступления не найден');
    if (cur?.archived_at) return { status: 'deleted' };
    if (cur) this.db.prepare('UPDATE income_kinds SET name = ? WHERE id = ?').run(name, id);
    else {
      const sort = (this.db.prepare('SELECT coalesce(max(sort), -1) + 1 AS s FROM income_kinds WHERE owner_id = ?').get(ownerId) as { s: number }).s;
      this.db.prepare('INSERT INTO income_kinds (id, owner_id, name, sort, created_at) VALUES (?, ?, ?, ?, ?)').run(id, ownerId, name, sort, now);
    }
    return { status: 'saved', value: toKind(this.kind(id)!) };
  }

  archiveIncomeKind(ownerId: string, id: string, now = Date.now()): void {
    const k = this.kind(id);
    if (!k || k.owner_id !== ownerId) throw new HttpError(404, 'Вид поступления не найден');
    this.db.prepare('UPDATE income_kinds SET archived_at = coalesce(archived_at, ?) WHERE id = ?').run(now, id);
  }

  // ---- траты --------------------------------------------------------------------------------

  transactions(ownerId: string, month: string): Transaction[] {
    const [from, to] = monthRange(month);
    const rows = this.db
      .prepare(
        `SELECT * FROM transactions WHERE owner_id = ? AND date BETWEEN ? AND ? AND deleted_at IS NULL
         ORDER BY date DESC, created_at DESC`,
      )
      .all(ownerId, from, to) as TxRow[];
    return rows.map(toTx);
  }

  private tx(id: string): TxRow | undefined {
    return this.db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as TxRow | undefined;
  }

  upsertTransaction(
    ownerId: string,
    id: string,
    input: { date: string; amount: number; categoryId: string; comment: string },
    userId: string,
    now = Date.now(),
  ): Upsert<Transaction> {
    return this.db.transaction((): Upsert<Transaction> => {
      const cur = this.tx(id);
      if (cur && cur.owner_id !== ownerId) throw new HttpError(404, 'Трата не найдена');
      if (cur?.deleted_at) return { status: 'deleted' };
      // Старую трату с удалённой категорией можно править, не меняя категорию.
      if (!(cur && cur.category_id === input.categoryId)) {
        const c = this.liveCategory(ownerId, input.categoryId);
        if (this.liveChildren(c.id).length) throw new HttpError(400, `Выберите подкатегорию в «${c.name}»`);
      }
      if (cur) {
        this.db
          .prepare('UPDATE transactions SET date = ?, amount = ?, category_id = ?, comment = ?, updated_at = ? WHERE id = ?')
          .run(input.date, input.amount, input.categoryId, input.comment, now, id);
      } else {
        this.db
          .prepare(
            `INSERT INTO transactions (id, owner_id, date, amount, category_id, comment, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, ownerId, input.date, input.amount, input.categoryId, input.comment, userId, now, now);
      }
      return { status: 'saved', value: toTx(this.tx(id)!) };
    })();
  }

  deleteTransaction(ownerId: string, id: string, now = Date.now()): void {
    const cur = this.tx(id);
    if (!cur || cur.owner_id !== ownerId) throw new HttpError(404, 'Трата не найдена');
    this.db.prepare('UPDATE transactions SET deleted_at = coalesce(deleted_at, ?), updated_at = ? WHERE id = ?').run(now, now, id);
  }

  // ---- поступления --------------------------------------------------------------------------

  incomes(ownerId: string, month: string): Income[] {
    const [from, to] = monthRange(month);
    const rows = this.db
      .prepare(
        `SELECT * FROM incomes WHERE owner_id = ? AND date BETWEEN ? AND ? AND deleted_at IS NULL
         ORDER BY date DESC, created_at DESC`,
      )
      .all(ownerId, from, to) as IncomeRow[];
    return rows.map(toIncome);
  }

  private income(id: string): IncomeRow | undefined {
    return this.db.prepare('SELECT * FROM incomes WHERE id = ?').get(id) as IncomeRow | undefined;
  }

  upsertIncome(
    ownerId: string,
    id: string,
    input: { date: string; amount: number; kindId: string; comment: string },
    userId: string,
    now = Date.now(),
  ): Upsert<Income> {
    return this.db.transaction((): Upsert<Income> => {
      const cur = this.income(id);
      if (cur && cur.owner_id !== ownerId) throw new HttpError(404, 'Поступление не найдено');
      if (cur?.deleted_at) return { status: 'deleted' };
      if (!(cur && cur.kind_id === input.kindId)) {
        const k = this.kind(input.kindId);
        if (!k || k.owner_id !== ownerId) throw new HttpError(404, 'Вид поступления не найден');
        if (k.archived_at) throw new HttpError(400, `Вид «${k.name}» удалён`);
      }
      if (cur) {
        this.db
          .prepare('UPDATE incomes SET date = ?, amount = ?, kind_id = ?, comment = ?, updated_at = ? WHERE id = ?')
          .run(input.date, input.amount, input.kindId, input.comment, now, id);
      } else {
        this.db
          .prepare(
            `INSERT INTO incomes (id, owner_id, date, amount, kind_id, comment, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, ownerId, input.date, input.amount, input.kindId, input.comment, userId, now, now);
      }
      return { status: 'saved', value: toIncome(this.income(id)!) };
    })();
  }

  deleteIncome(ownerId: string, id: string, now = Date.now()): void {
    const cur = this.income(id);
    if (!cur || cur.owner_id !== ownerId) throw new HttpError(404, 'Поступление не найдено');
    this.db.prepare('UPDATE incomes SET deleted_at = coalesce(deleted_at, ?), updated_at = ? WHERE id = ?').run(now, now, id);
  }

  // ---- план ---------------------------------------------------------------------------------

  plan(ownerId: string): PlanItem[] {
    const rows = this.db
      .prepare('SELECT * FROM plan_items WHERE owner_id = ? AND deleted_at IS NULL ORDER BY sort, created_at')
      .all(ownerId) as PlanRow[];
    const links = this.db
      .prepare(
        `SELECT pc.plan_item_id, pc.category_id FROM plan_item_categories pc
         JOIN plan_items p ON p.id = pc.plan_item_id WHERE p.owner_id = ? AND p.deleted_at IS NULL`,
      )
      .all(ownerId) as { plan_item_id: string; category_id: string }[];
    const parts = this.db
      .prepare(
        `SELECT pp.plan_item_id, pp.category_id, pp.amount FROM plan_item_parts pp
         JOIN plan_items p ON p.id = pp.plan_item_id WHERE p.owner_id = ? AND p.deleted_at IS NULL`,
      )
      .all(ownerId) as { plan_item_id: string; category_id: string; amount: number }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      amount: r.amount,
      categoryId: links.find((l) => l.plan_item_id === r.id)?.category_id ?? '',
      parts: parts.filter((p) => p.plan_item_id === r.id).map((p) => ({ categoryId: p.category_id, amount: p.amount })),
    }));
  }

  private planRow(id: string): PlanRow | undefined {
    return this.db.prepare('SELECT * FROM plan_items WHERE id = ?').get(id) as PlanRow | undefined;
  }

  private liveChildren(categoryId: string): string[] {
    return (this.db.prepare('SELECT id FROM categories WHERE parent_id = ? AND archived_at IS NULL').all(categoryId) as { id: string }[]).map((c) => c.id);
  }

  /** Живая статья плана на эту категорию. */
  private planItemOf(categoryId: string): string | undefined {
    return (
      this.db
        .prepare(
          `SELECT p.id FROM plan_items p JOIN plan_item_categories pc ON pc.plan_item_id = p.id
           WHERE pc.category_id = ? AND p.deleted_at IS NULL`,
        )
        .get(categoryId) as { id: string } | undefined
    )?.id;
  }

  private itemParts(id: string): PlanPart[] {
    return (
      this.db.prepare('SELECT category_id, amount FROM plan_item_parts WHERE plan_item_id = ?').all(id) as { category_id: string; amount: number }[]
    ).map((p) => ({ categoryId: p.category_id, amount: p.amount }));
  }

  /**
   * Убрать из плана подкатегории, которых у категории статьи больше нет (удалены или перенесены).
   * Сумма статьи пересчитывается; если расписанных сумм не осталось — остаётся последней,
   * чтобы план молча не обнулился.
   */
  private prunePlanParts(ownerId: string): void {
    const items = this.db
      .prepare(
        `SELECT DISTINCT p.id, pc.category_id AS cat FROM plan_items p
         JOIN plan_item_parts pp ON pp.plan_item_id = p.id
         JOIN plan_item_categories pc ON pc.plan_item_id = p.id
         WHERE p.owner_id = ? AND p.deleted_at IS NULL`,
      )
      .all(ownerId) as { id: string; cat: string }[];
    for (const { id, cat } of items) {
      const allowed = new Set(this.liveChildren(cat));
      const parts = this.itemParts(id);
      const kept = parts.filter((p) => allowed.has(p.categoryId));
      if (kept.length === parts.length) continue;
      for (const p of parts) {
        if (!allowed.has(p.categoryId)) this.db.prepare('DELETE FROM plan_item_parts WHERE plan_item_id = ? AND category_id = ?').run(id, p.categoryId);
      }
      const sum = kept.reduce((s, p) => s + p.amount, 0);
      if (sum > 0) this.db.prepare('UPDATE plan_items SET amount = ? WHERE id = ?').run(sum, id);
    }
  }

  /** Создать или изменить статью: одна категория верхнего уровня — одна статья. */
  upsertPlanItem(
    ownerId: string,
    id: string,
    input: { categoryId: string; amount: number; parts?: PlanPart[] },
    now = Date.now(),
  ): Upsert<PlanItem> {
    return this.db.transaction((): Upsert<PlanItem> => {
      const cur = this.planRow(id);
      if (cur && cur.owner_id !== ownerId) throw new HttpError(404, 'Статья плана не найдена');
      if (cur?.deleted_at) return { status: 'deleted' };
      const category = this.liveCategory(ownerId, input.categoryId);
      if (category.parent_id) throw new HttpError(400, 'Статья плана заводится на категорию, а не на подкатегорию');
      const other = this.planItemOf(category.id);
      if (other && other !== id) throw new HttpError(409, `На категорию «${category.name}» статья уже есть`);

      const allowed = new Set(this.liveChildren(category.id));
      let parts: PlanPart[];
      if (input.parts) {
        parts = input.parts;
        if (new Set(parts.map((p) => p.categoryId)).size !== parts.length) throw new HttpError(400, 'Подкатегория указана дважды');
        if (parts.some((p) => !allowed.has(p.categoryId))) throw new HttpError(400, 'Это не подкатегория категории статьи');
      } else {
        parts = cur ? this.itemParts(id).filter((p) => allowed.has(p.categoryId)) : [];
      }
      // Расписано по подкатегориям — итог равен их сумме; иначе действует общая сумма статьи.
      const sum = parts.reduce((s, p) => s + p.amount, 0);
      const amount = sum > 0 ? sum : input.amount;
      freezePlan(this.db, ownerId, now);
      if (cur) {
        this.db.prepare('UPDATE plan_items SET name = ?, amount = ? WHERE id = ?').run(category.name, amount, id);
      } else {
        const sort = (this.db.prepare('SELECT coalesce(max(sort), -1) + 1 AS s FROM plan_items WHERE owner_id = ?').get(ownerId) as { s: number }).s;
        this.db
          .prepare('INSERT INTO plan_items (id, owner_id, name, amount, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, ownerId, category.name, amount, sort, now);
      }
      this.db.prepare('DELETE FROM plan_item_categories WHERE plan_item_id = ?').run(id);
      this.db.prepare('INSERT INTO plan_item_categories (plan_item_id, category_id) VALUES (?, ?)').run(id, category.id);
      this.db.prepare('DELETE FROM plan_item_parts WHERE plan_item_id = ?').run(id);
      const part = this.db.prepare('INSERT INTO plan_item_parts (plan_item_id, category_id, amount) VALUES (?, ?, ?)');
      for (const p of parts) part.run(id, p.categoryId, p.amount);
      return { status: 'saved', value: this.plan(ownerId).find((p) => p.id === id)! };
    })();
  }

  deletePlanItem(ownerId: string, id: string, now = Date.now()): void {
    const cur = this.planRow(id);
    if (!cur || cur.owner_id !== ownerId) throw new HttpError(404, 'Статья плана не найдена');
    this.db.transaction(() => {
      freezePlan(this.db, ownerId, now);
      this.db.prepare('UPDATE plan_items SET deleted_at = coalesce(deleted_at, ?) WHERE id = ?').run(now, id);
    })();
  }
}
