import type { Dictionaries, Grants, Summary } from '@money/shared';
import { describe, expect, it, vi } from 'vitest';
import { Client, makeApp, systemInvite } from './helpers.ts';

const id = () => Math.random().toString(36).slice(2, 12).padEnd(10, 'x');

async function setup(grants: Grants | null = null) {
  const app = await makeApp();
  const me = new Client(app);
  await me.register(systemInvite(app), 'Иван');
  const meId = (await me.get('/api/me')).json().me.id as string;
  const wife = new Client(app);
  if (grants) {
    const inv = (await me.post('/api/sharing/invites', { grants })).json();
    await wife.register(inv.url, 'Аня');
  }
  const base = `/api/spaces/${meId}`;
  const d = (await me.get(`${base}/dictionaries`)).json() as Dictionaries;
  const cat = (n: string) => d.categories.find((c) => c.name === n)!.id;
  const salary = d.incomeKinds[0]!.id;
  const tx = (date: string, amount: number, categoryId: string) =>
    me.put(`${base}/transactions/${id()}`, { date, amount, categoryId });
  const inc = (date: string, amount: number) => me.put(`${base}/incomes/${id()}`, { date, amount, kindId: salary });
  const summary = async (month: string, c = me) => (await c.get(`${base}/summary?month=${month}`)).json() as Summary;
  return { app, me, wife, base, cat, tx, inc, summary };
}

describe('сводка', () => {
  it('итоги месяца и остаток с переносом без начального остатка', async () => {
    const { tx, inc, cat, summary } = await setup();
    await inc('2026-10-01', 100000);
    await tx('2026-10-15', 30000, cat('Продукты'));
    await inc('2026-11-01', 50000);
    await tx('2026-11-02', 20000, cat('Продукты'));
    await tx('2026-11-30', 5000, cat('Авто'));
    await tx('2026-12-01', 99999, cat('Авто')); // другой месяц
    const s = await summary('2026-11');
    expect(s).toMatchObject({ income: 50000, expense: 25000, carryIn: 70000, opening: null, unplanned: 25000 });
    expect(s.byCategory).toEqual([
      { categoryId: cat('Продукты'), amount: 20000 },
      { categoryId: cat('Авто'), amount: 5000 },
    ]);
  });

  it('без доступа к поступлениям сводка не отдаёт доходы и остатки', async () => {
    const { me, wife, base, tx, inc, cat, summary } = await setup({ summary: 'edit', transactions: 'view' });
    await me.put(`${base}/summary/opening`, { amount: -3000000, month: '2026-11' });
    await inc('2026-11-01', 100000);
    await tx('2026-11-05', 40000, cat('Продукты'));
    const s = await summary('2026-11', wife);
    expect(s).toMatchObject({ income: null, carryIn: null, opening: null, expense: 40000 });
    expect(s.history.every((h) => h.income === null)).toBe(true);
    expect(s.history.at(-1)!.expense).toBe(40000);
    expect(((await wife.get(`${base}/dictionaries`)).json() as Dictionaries).incomeKinds).toEqual([]);
    expect((await wife.get(`${base}/incomes?month=2026-11`)).statusCode).toBe(404);
    expect((await wife.put(`${base}/summary/opening`, { amount: 1, month: '2026-11' })).statusCode).toBe(404);
    expect((await wife.del(`${base}/summary/opening`)).statusCode).toBe(404);
    expect((await summary('2026-11')).carryIn).toBe(-3000000); // у владельца всё на месте
  });

  it('правка плана в новом месяце не меняет план и перерасход прошедшего', async () => {
    const { me, base, tx, cat, summary } = await setup();
    const item = id();
    await me.put(`${base}/plan/${item}`, { categoryId: cat('Продукты'), amount: 100000 });
    await me.put(`${base}/plan/${item}`, { categoryId: cat('Продукты'), amount: 150000 }); // в том же месяце — просто правка
    await tx('2026-11-10', 200000, cat('Продукты'));
    expect((await summary('2026-11')).plan[0]).toMatchObject({ amount: 150000, fact: 200000 });

    vi.setSystemTime(new Date('2026-12-05T12:00:00Z'));
    await me.put(`${base}/plan/${item}`, { categoryId: cat('Продукты'), amount: 300000 });
    await me.put(`${base}/plan/${id()}`, { categoryId: cat('Авто'), amount: 50000 });
    await tx('2026-12-02', 10000, cat('Продукты'));
    const nov = await summary('2026-11');
    expect(nov.plan.map((p) => [p.name, p.amount, p.fact])).toEqual([['Продукты', 150000, 200000]]);
    expect((await summary('2026-12')).plan.map((p) => [p.name, p.amount, p.fact])).toEqual([
      ['Продукты', 300000, 10000],
      ['Авто', 50000, 0],
    ]);

    // Трата, внесённая задним числом, попадает в факт прошлого месяца по его плану.
    await tx('2026-11-20', 5000, cat('Продукты'));
    expect((await summary('2026-11')).plan[0]).toMatchObject({ amount: 150000, fact: 205000 });

    // Удаление статьи в следующем месяце прошлое тоже не трогает.
    vi.setSystemTime(new Date('2027-01-03T12:00:00Z'));
    await me.del(`${base}/plan/${item}`);
    expect((await summary('2026-12')).plan.map((p) => p.amount)).toEqual([300000, 50000]);
    expect((await summary('2026-11')).plan.map((p) => p.amount)).toEqual([150000]);
    expect((await summary('2027-01')).plan.map((p) => p.amount)).toEqual([50000]);
  });

  it('начальный остаток: перенос считается от него; раньше его месяца — неизвестно', async () => {
    const { me, base, tx, inc, cat, summary } = await setup();
    await tx('2026-09-10', 77777, cat('Авто')); // до начального остатка — не учитывается
    await inc('2026-11-01', 100000);
    await tx('2026-11-05', 40000, cat('Продукты'));
    expect((await me.put(`${base}/summary/opening`, { amount: -3000000, month: '2026-11' })).statusCode).toBe(200);
    expect((await summary('2026-11')).carryIn).toBe(-3000000);
    expect((await summary('2026-12')).carryIn).toBe(-3000000 + 100000 - 40000);
    expect((await summary('2026-10')).carryIn).toBeNull();
    await me.del(`${base}/summary/opening`);
    expect((await summary('2026-12')).carryIn).toBe(100000 - 40000 - 77777);
  });

  it('план-факт: категория вместе с подкатегориями; вне плана', async () => {
    const { me, base, tx, cat, summary } = await setup();
    await tx('2026-11-04', 50000, cat('Авто')); // трата прямо в категории — до появления подкатегорий
    const fuel = id();
    await me.put(`${base}/categories/${fuel}`, { name: 'Бензин', parentId: cat('Авто') });
    await me.put(`${base}/plan/${id()}`, { categoryId: cat('Продукты'), amount: 10000000 });
    await me.put(`${base}/plan/${id()}`, { categoryId: cat('Авто'), amount: 2000000 });
    await tx('2026-11-01', 400000, cat('Продукты'));
    await tx('2026-11-03', 700000, fuel);
    await tx('2026-11-05', 120000, cat('Связь/Интернет'));
    const s = await summary('2026-11');
    expect(s.plan.map((p) => [p.name, p.amount, p.fact])).toEqual([
      ['Продукты', 10000000, 400000],
      ['Авто', 2000000, 750000],
    ]);
    expect(s.unplanned).toBe(120000);
    expect(s.expense).toBe(1270000);
  });

  it('динамика: 6 месяцев по выбранный, пустые — нулями', async () => {
    const { tx, inc, cat, summary } = await setup();
    await inc('2026-07-01', 1000);
    await tx('2026-08-03', 300, cat('Продукты'));
    await tx('2026-11-03', 200, cat('Продукты'));
    const s = await summary('2026-12');
    expect(s.history).toEqual([
      { month: '2026-07', income: 1000, expense: 0 },
      { month: '2026-08', income: 0, expense: 300 },
      { month: '2026-09', income: 0, expense: 0 },
      { month: '2026-10', income: 0, expense: 0 },
      { month: '2026-11', income: 0, expense: 200 },
      { month: '2026-12', income: 0, expense: 0 },
    ]);
    // переход через год
    expect((await summary('2027-02')).history.map((h) => h.month)).toEqual(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('удалённые траты в сводку не попадают', async () => {
    const { me, base, cat, summary } = await setup();
    const t = id();
    await me.put(`${base}/transactions/${t}`, { date: '2026-11-01', amount: 5000, categoryId: cat('Продукты') });
    await me.del(`${base}/transactions/${t}`);
    expect((await summary('2026-11')).expense).toBe(0);
  });

  it('права: сводка на просмотр — итоги видны, без доступа к тратам; остаток менять нельзя', async () => {
    const { wife, base, summary, tx, cat } = await setup({ summary: 'view', plan: 'view' });
    await tx('2026-11-01', 5000, cat('Продукты'));
    expect((await summary('2026-11', wife)).expense).toBe(5000);
    expect((await wife.get(`${base}/transactions?month=2026-11`)).statusCode).toBe(404);
    expect((await wife.put(`${base}/summary/opening`, { amount: 1, month: '2026-11' })).statusCode).toBe(403);
  });

  it('без доступа к сводке — 404; неверный месяц и остаток — 400', async () => {
    const { wife, me, base } = await setup({ shopping: 'edit' });
    expect((await wife.get(`${base}/summary?month=2026-11`)).statusCode).toBe(404);
    expect((await me.get(`${base}/summary?month=2026-13`)).statusCode).toBe(400);
    expect((await me.put(`${base}/summary/opening`, { amount: 1.5, month: '2026-11' })).statusCode).toBe(400);
  });
});
