import type { Dictionaries, PlanItem, Transaction } from '@money/shared';
import { describe, expect, it } from 'vitest';
import { runRecategorize } from '../src/recategorize.ts';
import { Client, makeApp, systemInvite } from './helpers.ts';

const id = () => Math.random().toString(36).slice(2, 12).padEnd(10, 'x');

const spec = {
  tree: [
    { name: 'Общие траты', children: ['Продукты', 'Бытовые'] },
    { name: 'Авто', children: ['Бензин', 'Мойка'] },
    { name: 'Кредит', children: ['Основной платёж', 'Досрочное погашение'] },
    { name: 'Накопления', children: ['ИИС'] },
    { name: 'Разное', children: ['Прочее'] },
  ],
  map: {
    Продукты: ['Общие траты', 'Продукты'],
    Бытовые: ['Общие траты', 'Бытовые'],
    Авто: ['Авто', null],
    'Авто › Бензин': ['Авто', 'Бензин'],
  },
  rules: [{ from: 'Коммуналка', comment: 'ИИС', to: ['Накопления', 'ИИС'] }],
  splits: [
    {
      from: 'Связь/Интернет',
      comment: 'Кредит 150',
      parts: [
        { to: ['Кредит', 'Основной платёж'], amount: 11200000 },
        { to: ['Кредит', 'Досрочное погашение'], amount: 3800000 },
      ],
    },
  ],
  fallback: ['Разное', 'Прочее'],
  plan: [
    { category: 'Общие траты', amount: 10000000 },
    { category: 'Кредит', parts: { 'Основной платёж': 15000000, 'Досрочное погашение': 10000000 } },
  ],
};

async function setup() {
  const app = await makeApp();
  const me = new Client(app);
  await me.register(systemInvite(app), 'К');
  const owner = (await me.get('/api/me')).json().me.id as string;
  const base = `/api/spaces/${owner}`;
  const d = (await me.get(`${base}/dictionaries`)).json() as Dictionaries;
  const cat = (n: string) => d.categories.find((c) => c.name === n)!.id;
  const tx = async (amount: number, categoryId: string, comment = '') => {
    const t = id();
    await me.put(`${base}/transactions/${t}`, { date: '2026-11-05', amount, categoryId, comment });
    return t;
  };
  await tx(100000, cat('Продукты'), 'Глобус');
  await tx(20000, cat('Бытовые'));
  await tx(38300, cat('Авто'), 'Платная дорога');
  const fuel = id();
  await me.put(`${base}/categories/${fuel}`, { name: 'Бензин', parentId: cat('Авто') });
  await tx(700000, fuel);
  await tx(5000000, cat('Коммуналка'), 'ИИС пополнение');
  await tx(15000000, cat('Связь/Интернет'), 'Кредит 150');
  const gone = await tx(999, cat('Связь/Интернет'), 'удалённая');
  await me.del(`${base}/transactions/${gone}`);
  await me.put(`${base}/plan/${id()}`, { categoryId: cat('Продукты'), amount: 777 });
  const list = async () => (await me.get(`${base}/transactions?month=2026-11`)).json() as Transaction[];
  return { app, me, owner, base, list, cat };
}

describe('пересборка категорий', () => {
  it('пробный прогон ничего не меняет, но показывает итог', async () => {
    const { app, me, owner, base, list } = await setup();
    const before = await list();
    const r = runRecategorize(app.store.db, owner, spec, { dryRun: true });
    expect(r.after).toEqual({ count: 7, sum: r.before.sum });
    expect(await list()).toEqual(before);
    const d = (await me.get(`${base}/dictionaries`)).json() as Dictionaries;
    expect(d.categories.some((c) => c.name === 'Общие траты')).toBe(false);
  });

  it('траты переехали, разбиение и правила сработали, старое удалено, план собран, сумма та же', async () => {
    const { app, me, owner, base, list } = await setup();
    const sum = (await list()).reduce((s, t) => s + t.amount, 0);
    runRecategorize(app.store.db, owner, spec, { dryRun: false });
    const d = (await me.get(`${base}/dictionaries`)).json() as Dictionaries;
    const name = (cid: string) => {
      const c = d.categories.find((x) => x.id === cid)!;
      const p = d.categories.find((x) => x.id === c.parentId);
      return p ? `${p.name} › ${c.name}` : c.name;
    };
    const after = await list();
    expect(after.reduce((s, t) => s + t.amount, 0)).toBe(sum);
    expect(after.map((t) => [name(t.categoryId), t.amount]).sort()).toEqual(
      [
        ['Общие траты › Продукты', 100000],
        ['Общие траты › Бытовые', 20000],
        ['Авто', 38300],
        ['Авто › Бензин', 700000],
        ['Накопления › ИИС', 5000000],
        ['Кредит › Основной платёж', 11200000],
        ['Кредит › Досрочное погашение', 3800000],
      ].sort(),
    );
    expect(d.categories.map((c) => c.name)).not.toContain('Коммуналка');
    expect(d.categories).toHaveLength(13);
    expect(d.categories.every((c) => !c.archived)).toBe(true);
    const plan = (await me.get(`${base}/plan`)).json() as PlanItem[];
    expect(plan.map((p) => [p.name, p.amount])).toEqual([['Общие траты', 10000000], ['Кредит', 25000000]]);
    // повторный запуск: старых путей больше нет — отказ, данные целы
    expect(() => runRecategorize(app.store.db, owner, spec, { dryRun: false })).toThrow();
    expect((await list()).length).toBe(7);
  });

  it('трата без соответствия — отказ и полный откат', async () => {
    const { app, me, owner, base, list, cat } = await setup();
    await me.put(`${base}/transactions/${id()}`, { date: '2026-11-06', amount: 1, categoryId: cat('Связь/Интернет'), comment: 'новая' });
    const before = await list();
    expect(() => runRecategorize(app.store.db, owner, spec, { dryRun: false })).toThrow(/Нет соответствия/);
    expect(await list()).toEqual(before);
    const d = (await me.get(`${base}/dictionaries`)).json() as Dictionaries;
    expect(d.categories.some((c) => c.name === 'Общие траты')).toBe(false);
  });

  it('части разбиения не сходятся с суммой — отказ', async () => {
    const { app, owner } = await setup();
    const bad = structuredClone(spec);
    bad.splits[0]!.parts[1]!.amount = 1;
    expect(() => runRecategorize(app.store.db, owner, bad, { dryRun: false })).toThrow(/сумма частей/);
  });
});
