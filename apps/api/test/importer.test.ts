import { describe, expect, it } from 'vitest';
import { runShoppingAdd } from '../src/importer.ts';
import { Client, makeApp, systemInvite } from './helpers.ts';

async function setup() {
  const app = await makeApp();
  const me = new Client(app);
  await me.register(systemInvite(app), 'К');
  const id = (await me.get('/api/me')).json().me.id as string;
  return { app, me, id };
}

describe('массовое добавление покупок', () => {
  const items = [
    { name: 'Молоко', qty: '5 шт.' },
    { name: 'Мёд' },
    { name: 'молоко' }, // повтор в файле
    { name: 'Хлеб' }, // уже есть в списке
  ];

  async function ready() {
    const { app, me, id } = await setup();
    const base = `/api/spaces/${id}/shopping`;
    const listId = (await me.get(base)).json().lists[0].id;
    await me.put(`${base}/items/existing01`, { listId, name: 'хлеб' });
    const state = async () => (await me.get(base)).json();
    return { app, me, id, base, listId, state };
  }

  it('пробный прогон ничего не пишет', async () => {
    const { app, id, state } = await ready();
    const r = runShoppingAdd(app.store.db, id, 'Продукты', items, { dryRun: true });
    expect(r).toMatchObject({ added: 2, skipped: ['молоко', 'Хлеб'] });
    expect((await state()).items).toHaveLength(1);
  });

  it('добавляет купленными, в порядке файла; имеющуюся не трогает; есть в подсказках; повтор не задваивает', async () => {
    const { app, me, id, base, listId, state } = await ready();
    runShoppingAdd(app.store.db, id, 'продукты', items, { dryRun: false });
    runShoppingAdd(app.store.db, id, 'Продукты', items, { dryRun: false });
    const s = await state();
    expect(s.items).toHaveLength(3);
    const bought = s.items.filter((i: { checked: boolean }) => i.checked).sort((a: { updatedAt: number }, b: { updatedAt: number }) => b.updatedAt - a.updatedAt);
    expect(bought.map((i: { name: string; qty: string }) => [i.name, i.qty])).toEqual([['Молоко', '5 шт.'], ['Мёд', '']]);
    expect(s.items.find((i: { name: string }) => i.name === 'хлеб').checked).toBe(false);
    expect((await me.get(`${base}/suggest?list=${listId}&q=мед`)).json()).toEqual(['Мёд']);
  });

  it('нет такого списка — ошибка', async () => {
    const { app, id } = await ready();
    expect(() => runShoppingAdd(app.store.db, id, 'Нет такого', items, { dryRun: false })).toThrow(/Нет списка/);
  });
});
