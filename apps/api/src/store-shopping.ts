/** SQL раздела «Покупки». Записи помечаются удалёнными (deleted_at), а не стираются: см. миграцию 2. */
import type { ShoppingItem, ShoppingList, ShoppingState } from '@money/shared';
import type { DB } from './db/index.ts';
import { HttpError, nameKey, newId } from './util.ts';

interface ListRow {
  id: string;
  owner_id: string;
  name: string;
  created_at: number;
  deleted_at: number | null;
}
interface ItemRow {
  id: string;
  owner_id: string;
  list_id: string;
  name: string;
  qty: string;
  checked: number;
  price: number | null;
  added_by: string;
  checked_by: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export const DEFAULT_LIST = 'Продукты';

const toList = (r: ListRow): ShoppingList => ({ id: r.id, name: r.name, createdAt: r.created_at });
const toItem = (r: ItemRow): ShoppingItem => ({
  id: r.id,
  listId: r.list_id,
  name: r.name,
  qty: r.qty,
  checked: r.checked === 1,
  price: r.price,
  addedBy: r.added_by,
  checkedBy: r.checked_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});


export type Upsert<T> = { status: 'saved'; value: T } | { status: 'deleted' };

export class ShoppingStore {
  constructor(private db: DB) {}

  private list(id: string): ListRow | undefined {
    return this.db.prepare('SELECT * FROM shopping_lists WHERE id = ?').get(id) as ListRow | undefined;
  }
  private item(id: string): ItemRow | undefined {
    return this.db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(id) as ItemRow | undefined;
  }
  private liveLists(ownerId: string): ListRow[] {
    return this.db
      .prepare('SELECT * FROM shopping_lists WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at')
      .all(ownerId) as ListRow[];
  }

  /** Всё пространство. Первый заход — создаётся список «Продукты». */
  state(ownerId: string, now = Date.now()): ShoppingState {
    if (this.liveLists(ownerId).length === 0) {
      this.db.prepare('INSERT INTO shopping_lists (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)').run(newId(), ownerId, DEFAULT_LIST, now);
    }
    const lists = this.liveLists(ownerId);
    const items = this.db
      .prepare(
        `SELECT i.* FROM shopping_items i JOIN shopping_lists l ON l.id = i.list_id
         WHERE i.owner_id = ? AND i.deleted_at IS NULL AND l.deleted_at IS NULL ORDER BY i.created_at`,
      )
      .all(ownerId) as ItemRow[];
    // Подписи: владелец, его участники и все, кто трогал записи (даже если уже без доступа).
    const people = this.db
      .prepare(
        `SELECT id, name FROM users WHERE id = @owner
           OR id IN (SELECT member_id FROM grants WHERE owner_id = @owner)
           OR id IN (SELECT added_by FROM shopping_items WHERE owner_id = @owner AND deleted_at IS NULL)
           OR id IN (SELECT checked_by FROM shopping_items WHERE owner_id = @owner AND deleted_at IS NULL)`,
      )
      .all({ owner: ownerId }) as { id: string; name: string }[];
    return { lists: lists.map(toList), items: items.map(toItem), people: Object.fromEntries(people.map((p) => [p.id, p.name])) };
  }

  /** Создать или переименовать. Чужой id — 404, удалённый — не воскрешаем. */
  upsertList(ownerId: string, id: string, name: string, now = Date.now()): Upsert<ShoppingList> {
    const cur = this.list(id);
    if (cur && cur.owner_id !== ownerId) throw new HttpError(404, 'Список не найден');
    if (cur?.deleted_at) return { status: 'deleted' };
    if (cur) this.db.prepare('UPDATE shopping_lists SET name = ? WHERE id = ?').run(name, id);
    else this.db.prepare('INSERT INTO shopping_lists (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)').run(id, ownerId, name, now);
    return { status: 'saved', value: toList(this.list(id)!) };
  }

  deleteList(ownerId: string, id: string, now = Date.now()): boolean {
    return this.db.transaction(() => {
      const cur = this.list(id);
      if (!cur || cur.owner_id !== ownerId) throw new HttpError(404, 'Список не найден');
      if (cur.deleted_at) return false;
      if (this.liveLists(ownerId).length === 1) throw new HttpError(400, 'Последний список удалить нельзя');
      this.db.prepare('UPDATE shopping_lists SET deleted_at = ? WHERE id = ?').run(now, id);
      this.db.prepare('UPDATE shopping_items SET deleted_at = ?, updated_at = ? WHERE list_id = ? AND deleted_at IS NULL').run(now, now, id);
      return true;
    })();
  }

  /**
   * Создать или изменить позицию. Повтор того же запроса из офлайн-очереди безопасен.
   * Последняя запись выигрывает — для списка покупок этого достаточно.
   */
  upsertItem(
    ownerId: string,
    id: string,
    input: { listId: string; name: string; qty: string; checked: boolean; price?: number | null },
    userId: string,
    now = Date.now(),
  ): Upsert<ShoppingItem> {
    return this.db.transaction((): Upsert<ShoppingItem> => {
      const list = this.list(input.listId);
      if (!list || list.owner_id !== ownerId) throw new HttpError(404, 'Список не найден');
      const cur = this.item(id);
      if (cur && cur.owner_id !== ownerId) throw new HttpError(404, 'Позиция не найдена');
      if (cur?.deleted_at || list.deleted_at) return { status: 'deleted' };
      const checked = input.checked ? 1 : 0;
      const price = input.price === undefined ? (cur?.price ?? null) : input.price;
      if (cur) {
        // Исправили название (опечатку) — подсказка переезжает на новое, старое не копится.
        if (nameKey(cur.name) !== nameKey(input.name) || cur.list_id !== input.listId) {
          this.unremember(ownerId, cur.list_id, cur.name);
          this.remember(ownerId, input.listId, input.name, now);
        }
        const checkedBy = checked === cur.checked ? cur.checked_by : checked ? userId : null;
        this.db
          .prepare('UPDATE shopping_items SET list_id = ?, name = ?, qty = ?, checked = ?, price = ?, checked_by = ?, updated_at = ? WHERE id = ?')
          .run(input.listId, input.name, input.qty, checked, price, checkedBy, now, id);
      } else {
        this.db
          .prepare(
            `INSERT INTO shopping_items (id, owner_id, list_id, name, qty, checked, price, added_by, checked_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, ownerId, input.listId, input.name, input.qty, checked, price, userId, checked ? userId : null, now, now);
        this.remember(ownerId, input.listId, input.name, now);
      }
      return { status: 'saved', value: toItem(this.item(id)!) };
    })();
  }

  deleteItem(ownerId: string, id: string, now = Date.now()): ItemRow | undefined {
    const cur = this.item(id);
    if (!cur || cur.owner_id !== ownerId) throw new HttpError(404, 'Позиция не найдена');
    if (cur.deleted_at) return undefined;
    this.db.prepare('UPDATE shopping_items SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
    return cur;
  }

  /** Убрать купленное из списка. Возвращает id убранных. */
  clearChecked(ownerId: string, listId: string, now = Date.now()): string[] {
    const list = this.list(listId);
    if (!list || list.owner_id !== ownerId || list.deleted_at) throw new HttpError(404, 'Список не найден');
    const rows = this.db
      .prepare('UPDATE shopping_items SET deleted_at = ?, updated_at = ? WHERE list_id = ? AND checked = 1 AND deleted_at IS NULL RETURNING id')
      .all(now, now, listId) as { id: string }[];
    return rows.map((r) => r.id);
  }

  private remember(ownerId: string, listId: string, name: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO shopping_history (owner_id, list_id, key, name, uses, last_used) VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT (owner_id, list_id, key) DO UPDATE SET name = excluded.name, uses = uses + 1, last_used = excluded.last_used`,
      )
      .run(ownerId, listId, nameKey(name), name.trim(), now);
  }

  private unremember(ownerId: string, listId: string, name: string): void {
    const key = nameKey(name);
    this.db.prepare('UPDATE shopping_history SET uses = uses - 1 WHERE owner_id = ? AND list_id = ? AND key = ?').run(ownerId, listId, key);
    this.db.prepare('DELETE FROM shopping_history WHERE owner_id = ? AND list_id = ? AND key = ? AND uses <= 0').run(ownerId, listId, key);
  }

  /** Убрать подсказку насовсем (опечатка, больше не покупаем). Позиции в списке не трогает. */
  forget(ownerId: string, listId: string, name: string): boolean {
    return (
      this.db.prepare('DELETE FROM shopping_history WHERE owner_id = ? AND list_id = ? AND key = ?').run(ownerId, listId, nameKey(name)).changes > 0
    );
  }

  /** Подсказки списка: сначала совпадения с начала слова, потом частые и недавние. */
  suggest(ownerId: string, listId: string, q: string, limit = 8): string[] {
    const key = nameKey(q);
    if (!key) {
      return (
        this.db
          .prepare('SELECT name FROM shopping_history WHERE owner_id = ? AND list_id = ? ORDER BY uses DESC, last_used DESC LIMIT ?')
          .all(ownerId, listId, limit) as { name: string }[]
      ).map((r) => r.name);
    }
    const esc = key.replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = this.db
      .prepare(
        `SELECT name, (key LIKE @start ESCAPE '\\' OR key LIKE @word ESCAPE '\\') AS starts FROM shopping_history
         WHERE owner_id = @owner AND list_id = @list AND key LIKE @any ESCAPE '\\'
         ORDER BY starts DESC, uses DESC, last_used DESC LIMIT @limit`,
      )
      .all({ owner: ownerId, list: listId, start: `${esc}%`, word: `% ${esc}%`, any: `%${esc}%`, limit }) as { name: string }[];
    return rows.map((r) => r.name);
  }
}
