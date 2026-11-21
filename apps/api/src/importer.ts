/** Массовое добавление покупок (`cli shopping-add`): через те же store и проверки, что и приложение. */
import crypto from 'node:crypto';
import { shoppingItemSchema } from '@money/shared';
import { z } from 'zod';
import type { DB } from './db/index.ts';
import { ShoppingStore } from './store-shopping.ts';
import { nameKey } from './util.ts';

const detId = (...parts: (string | number | null)[]) =>
  'i' + crypto.createHash('sha256').update(JSON.stringify(parts)).digest('base64url').slice(0, 20);

class DryRun extends Error {}

const shoppingFileSchema = z.array(z.object({ name: shoppingItemSchema.shape.name, qty: z.string().trim().max(30).default('') })).min(1).max(1000);

export interface ShoppingAddReport {
  list: string;
  added: number;
  /** Уже есть в списке (без учёта регистра и «ё») — не тронуты. */
  skipped: string[];
}

/**
 * Массовое добавление позиций как купленных: они не мешают списку «купить», но появляются в подсказках
 * и возвращаются в список одним нажатием. Те же проверки, что в приложении; повторный запуск не задваивает.
 */
export function runShoppingAdd(db: DB, ownerId: string, listName: string, raw: unknown, opts: { dryRun: boolean; now?: number }): ShoppingAddReport {
  const items = shoppingFileSchema.parse(raw);
  const shop = new ShoppingStore(db);
  const base = opts.now ?? Date.now();
  let report: ShoppingAddReport | undefined;
  try {
    db.transaction(() => {
      const state = shop.state(ownerId);
      const list = state.lists.find((l) => nameKey(l.name) === nameKey(listName));
      if (!list) throw new Error(`Нет списка «${listName}»`);
      const have = new Set(state.items.filter((i) => i.listId === list.id).map((i) => nameKey(i.name)));
      const r: ShoppingAddReport = { list: list.name, added: 0, skipped: [] };
      items.forEach((it, i) => {
        const key = nameKey(it.name);
        if (have.has(key)) {
          r.skipped.push(it.name);
          return;
        }
        have.add(key);
        // Время по убыванию: «Куплено» сортируется от новых, так порядок остаётся как в исходном списке.
        const saved = shop.upsertItem(ownerId, detId('shop', ownerId, list.id, key), { listId: list.id, name: it.name, qty: it.qty, checked: true }, ownerId, base - i);
        if (saved.status === 'saved') r.added++;
        else r.skipped.push(it.name); // такую позицию уже добавляли и удалили — не воскрешаем
      });
      report = r;
      if (opts.dryRun) throw new DryRun('откат пробного прогона');
    })();
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return report!;
}
