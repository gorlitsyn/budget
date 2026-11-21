import type { Dictionaries, Grants, PlanItem, Transaction } from '@money/shared';
import { describe, expect, it } from 'vitest';
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
  } else await wife.register(systemInvite(app), 'Аня');
  const base = `/api/spaces/${meId}`;
  const dict = async (c = me) => (await c.get(`${base}/dictionaries`)).json() as Dictionaries;
  const cat = async (name: string) => (await dict()).categories.find((c) => c.name === name)!.id;
  return { app, me, wife, meId, base, dict, cat };
}

describe('справочники', () => {
  it('первый заход — шаблон категорий и видов поступлений, один раз', async () => {
    const { dict } = await setup();
    const d = await dict();
    expect(d.categories.map((c) => c.name)).toEqual(['Продукты', 'Бытовые', 'Авто', 'Коммуналка', 'Связь/Интернет']);
    expect(d.incomeKinds.map((k) => k.name)).toEqual(['Зарплата', 'Аванс', 'Кэшбек', 'Прочее']);
    expect((await dict()).categories).toHaveLength(5);
  });

  it('удалил все категории — шаблон не возвращается', async () => {
    const { me, base, dict } = await setup();
    for (const c of (await dict()).categories) await me.del(`${base}/categories/${c.id}`);
    const d = await dict();
    expect(d.categories.every((c) => c.archived)).toBe(true);
    expect(d.categories).toHaveLength(5);
  });

  it('подкатегории — один уровень', async () => {
    const { me, base, cat } = await setup();
    const auto = await cat('Авто');
    const fuel = id();
    expect((await me.put(`${base}/categories/${fuel}`, { name: 'Бензин', parentId: auto })).json().status).toBe('saved');
    // подкатегория подкатегории — нет
    expect((await me.put(`${base}/categories/${id()}`, { name: 'АИ-95', parentId: fuel })).statusCode).toBe(400);
    // категорию с подкатегориями нельзя спрятать под другую
    expect((await me.put(`${base}/categories/${auto}`, { name: 'Авто', parentId: await cat('Бытовые') })).statusCode).toBe(400);
  });

  it('удаление категории уносит в архив и подкатегории; новые траты в неё нельзя', async () => {
    const { me, base, cat, dict } = await setup();
    const auto = await cat('Авто');
    const fuel = id();
    await me.put(`${base}/categories/${fuel}`, { name: 'Бензин', parentId: auto });
    await me.del(`${base}/categories/${auto}`);
    const d = await dict();
    expect(d.categories.find((c) => c.id === fuel)!.archived).toBe(true);
    const res = await me.put(`${base}/transactions/${id()}`, { date: '2026-11-19', amount: 100, categoryId: fuel });
    expect(res.statusCode).toBe(400);
  });
});

describe('траты и поступления', () => {
  it('по месяцам; суммы в копейках; новые сверху', async () => {
    const { me, base, cat } = await setup();
    const food = await cat('Продукты');
    await me.put(`${base}/transactions/${id()}`, { date: '2026-10-31', amount: 50000, categoryId: food });
    await me.put(`${base}/transactions/${id()}`, { date: '2026-11-01', amount: 123450, categoryId: food, comment: 'Ашан' });
    await me.put(`${base}/transactions/${id()}`, { date: '2026-11-19', amount: 99, categoryId: food });
    const nov = (await me.get(`${base}/transactions?month=2026-11`)).json() as Transaction[];
    expect(nov.map((t) => [t.date, t.amount])).toEqual([
      ['2026-11-19', 99],
      ['2026-11-01', 123450],
    ]);
    expect((await me.get(`${base}/transactions?month=2026-10`)).json()).toHaveLength(1);
    expect((await me.get(`${base}/transactions?month=2026-13`)).statusCode).toBe(400);
    expect((await me.get(`${base}/transactions`)).statusCode).toBe(400);
  });

  it('правка, удаление, повтор PUT идемпотентен, удалённое не воскресает', async () => {
    const { me, base, cat } = await setup();
    const food = await cat('Продукты');
    const t = id();
    for (let i = 0; i < 2; i++) await me.put(`${base}/transactions/${t}`, { date: '2026-11-19', amount: 100, categoryId: food });
    await me.put(`${base}/transactions/${t}`, { date: '2026-11-19', amount: 250, categoryId: food });
    let list = (await me.get(`${base}/transactions?month=2026-11`)).json() as Transaction[];
    expect(list.map((x) => x.amount)).toEqual([250]);
    await me.del(`${base}/transactions/${t}`);
    expect((await me.put(`${base}/transactions/${t}`, { date: '2026-11-19', amount: 1, categoryId: food })).json()).toEqual({ status: 'deleted' });
    list = (await me.get(`${base}/transactions?month=2026-11`)).json();
    expect(list).toEqual([]);
  });

  it('старую трату с удалённой категорией можно править, не меняя категорию', async () => {
    const { me, base, cat } = await setup();
    const auto = await cat('Авто');
    const t = id();
    await me.put(`${base}/transactions/${t}`, { date: '2026-11-03', amount: 500000, categoryId: auto });
    await me.del(`${base}/categories/${auto}`);
    const res = await me.put(`${base}/transactions/${t}`, { date: '2026-11-03', amount: 500000, categoryId: auto, comment: 'Шиномонтаж' });
    expect(res.json().status).toBe('saved');
  });

  it('неверные суммы и даты — 400', async () => {
    const { me, base, cat } = await setup();
    const food = await cat('Продукты');
    for (const body of [
      { date: '2026-11-19', amount: 0, categoryId: food },
      { date: '2026-11-19', amount: 12.5, categoryId: food },
      { date: '2026-11-19', amount: -5, categoryId: food },
      { date: '19.11.2026', amount: 100, categoryId: food },
    ]) {
      expect((await me.put(`${base}/transactions/${id()}`, body)).statusCode).toBe(400);
    }
  });

  it('поступления: свои виды, новый вид, удалённый вид недоступен', async () => {
    const { me, base, dict } = await setup();
    const salary = (await dict()).incomeKinds.find((k) => k.name === 'Зарплата')!.id;
    await me.put(`${base}/incomes/${id()}`, { date: '2026-11-01', amount: 29192000, kindId: salary });
    const bonus = id();
    await me.put(`${base}/income-kinds/${bonus}`, { name: 'Премия' });
    await me.put(`${base}/incomes/${id()}`, { date: '2026-11-15', amount: 1000000, kindId: bonus });
    expect((await me.get(`${base}/incomes?month=2026-11`)).json()).toHaveLength(2);
    await me.del(`${base}/income-kinds/${bonus}`);
    expect((await me.put(`${base}/incomes/${id()}`, { date: '2026-11-16', amount: 1, kindId: bonus })).statusCode).toBe(400);
  });
});

describe('план', () => {
  it('статья = одна категория: название из неё, вторая статья и подкатегория — отказ', async () => {
    const { me, base, cat } = await setup();
    const auto = await cat('Авто');
    const fuel = id();
    await me.put(`${base}/categories/${fuel}`, { name: 'Бензин', parentId: auto });
    const item = id();
    expect((await me.put(`${base}/plan/${item}`, { categoryId: auto, amount: 1500000 })).statusCode).toBe(200);
    expect((await me.put(`${base}/plan/${id()}`, { categoryId: auto, amount: 1 })).statusCode).toBe(409);
    expect((await me.put(`${base}/plan/${id()}`, { categoryId: fuel, amount: 1 })).statusCode).toBe(400);
    expect((await me.get(`${base}/plan`)).json()).toEqual([{ id: item, name: 'Авто', amount: 1500000, categoryId: auto, parts: [] }]);
  });

  it('переименовали категорию — название статьи следует за ней', async () => {
    const { me, base, cat } = await setup();
    const c = await cat('Продукты');
    await me.put(`${base}/plan/${id()}`, { categoryId: c, amount: 100 });
    await me.put(`${base}/categories/${c}`, { name: 'Еда', parentId: null });
    expect(((await me.get(`${base}/plan`)).json() as PlanItem[])[0]!.name).toBe('Еда');
  });

  it('удалили статью — категория осталась, статью можно завести снова; удалили категорию — статья ушла', async () => {
    const { me, base, cat, dict } = await setup();
    const c = await cat('Продукты');
    const p = id();
    await me.put(`${base}/plan/${p}`, { categoryId: c, amount: 100 });
    await me.del(`${base}/plan/${p}`);
    expect((await dict()).categories.find((x) => x.id === c)!.archived).toBe(false);
    expect((await me.put(`${base}/plan/${id()}`, { categoryId: c, amount: 200 })).statusCode).toBe(200);
    await me.del(`${base}/categories/${c}`);
    expect((await me.get(`${base}/plan`)).json()).toEqual([]);
  });

  it('категорию со статьёй нельзя сделать подкатегорией', async () => {
    const { me, base, cat } = await setup();
    const c = await cat('Продукты');
    await me.put(`${base}/plan/${id()}`, { categoryId: c, amount: 100 });
    expect((await me.put(`${base}/categories/${c}`, { name: 'Продукты', parentId: await cat('Бытовые') })).statusCode).toBe(400);
  });
});

describe('план: суммы по подкатегориям', () => {
  async function withSubs() {
    const ctx = await setup();
    const { me, base, cat } = ctx;
    const school = await cat('Бытовые');
    const football = id();
    const english = id();
    await me.put(`${base}/categories/${football}`, { name: 'Футбол', parentId: school });
    await me.put(`${base}/categories/${english}`, { name: 'Английский', parentId: school });
    const item = id();
    await me.put(`${base}/plan/${item}`, { categoryId: school, amount: 3165000 });
    const getPlan = async () => ((await me.get(`${base}/plan`)).json() as PlanItem[]).find((p) => p.id === item)!;
    const put = (body: object) => me.put(`${base}/plan/${item}`, { categoryId: school, amount: 3165000, ...body });
    return { ...ctx, school, football, english, item, getPlan, put };
  }

  it('сумма статьи = сумма по подкатегориям; amount из запроса игнорируется', async () => {
    const { put, getPlan, football, english } = await withSubs();
    const r = await put({ parts: [{ categoryId: football, amount: 765000 }, { categoryId: english, amount: 640000 }] });
    expect(r.statusCode).toBe(200);
    expect((await getPlan()).amount).toBe(1405000);
  });

  it('без parts разбивка не стирается; [] убирает и возвращает ручную сумму', async () => {
    const { put, getPlan, football } = await withSubs();
    await put({ parts: [{ categoryId: football, amount: 765000 }] });
    await put({});
    expect(await getPlan()).toMatchObject({ amount: 765000, parts: [{ categoryId: football, amount: 765000 }] });
    await put({ parts: [], amount: 100 });
    expect(await getPlan()).toMatchObject({ amount: 100, parts: [] });
  });

  it('в разбивке только подкатегории этой категории, без повторов', async () => {
    const { me, base, put, football, school, cat } = await withSubs();
    const fuel = id();
    await me.put(`${base}/categories/${fuel}`, { name: 'Бензин', parentId: await cat('Авто') });
    expect((await put({ parts: [{ categoryId: fuel, amount: 100 }] })).statusCode).toBe(400);
    expect((await put({ parts: [{ categoryId: school, amount: 100 }] })).statusCode).toBe(400);
    expect((await put({ parts: [{ categoryId: football, amount: 100 }, { categoryId: football, amount: 200 }] })).statusCode).toBe(400);
    expect((await put({ parts: [{ categoryId: football, amount: -1 }] })).statusCode).toBe(400);
  });

  it('удалили подкатегорию — её сумма уходит из статьи; последняя строка сумму не обнуляет', async () => {
    const { me, base, put, getPlan, football, english } = await withSubs();
    await put({ parts: [{ categoryId: football, amount: 765000 }, { categoryId: english, amount: 640000 }] });
    await me.del(`${base}/categories/${football}`);
    expect(await getPlan()).toMatchObject({ amount: 640000, parts: [{ categoryId: english, amount: 640000 }] });
    await me.del(`${base}/categories/${english}`);
    expect(await getPlan()).toMatchObject({ amount: 640000, parts: [] });
  });

  it('подкатегории без своей суммы входят в общую сумму статьи', async () => {
    const { put, getPlan, football, english } = await withSubs();
    await put({ amount: 10000000, parts: [{ categoryId: football, amount: 0 }, { categoryId: english, amount: 0 }] });
    expect(await getPlan()).toMatchObject({ amount: 10000000 });
    expect((await getPlan()).parts).toHaveLength(2);
    await put({ parts: [{ categoryId: football, amount: 500 }, { categoryId: english, amount: 0 }] });
    expect((await getPlan()).amount).toBe(500);
  });

  it('сводка: в факте статьи только выбранные подкатегории, остальное — вне плана', async () => {
    const ctx = await setup();
    const { me, base, cat } = ctx;
    const school = await cat('Бытовые');
    await me.put(`${base}/transactions/${id()}`, { date: '2026-11-05', amount: 5000, categoryId: school }); // прямо в категории
    const football = id();
    const english = id();
    const pets = id();
    await me.put(`${base}/categories/${football}`, { name: 'Футбол', parentId: school });
    await me.put(`${base}/categories/${english}`, { name: 'Английский', parentId: school });
    await me.put(`${base}/categories/${pets}`, { name: 'Питомцы', parentId: school });
    await me.put(`${base}/plan/${id()}`, { categoryId: school, amount: 1, parts: [{ categoryId: football, amount: 765000 }, { categoryId: english, amount: 640000 }] });
    await me.put(`${base}/transactions/${id()}`, { date: '2026-11-05', amount: 800000, categoryId: football });
    await me.put(`${base}/transactions/${id()}`, { date: '2026-11-06', amount: 7000, categoryId: pets });
    const s = (await me.get(`${base}/summary?month=2026-11`)).json();
    const p = s.plan[0];
    expect(p).toMatchObject({ amount: 1405000, fact: 800000 });
    expect(p.parts).toEqual([
      { categoryId: football, amount: 765000, fact: 800000 },
      { categoryId: english, amount: 640000, fact: 0 },
    ]);
    expect(s.unplanned).toBe(12000);
  });
});

describe('траты: подкатегория обязательна', () => {
  it('в категорию с подкатегориями записать нельзя; старую трату в ней править можно', async () => {
    const { me, base, cat } = await setup();
    const auto = await cat('Авто');
    const t = id();
    await me.put(`${base}/transactions/${t}`, { date: '2026-11-01', amount: 500000, categoryId: auto });
    await me.put(`${base}/categories/${id()}`, { name: 'Бензин', parentId: auto });
    const denied = await me.put(`${base}/transactions/${id()}`, { date: '2026-11-02', amount: 100, categoryId: auto });
    expect(denied.statusCode).toBe(400);
    expect(denied.json().error).toMatch(/подкатегорию/);
    expect((await me.put(`${base}/transactions/${t}`, { date: '2026-11-01', amount: 500000, categoryId: auto, comment: 'Шиномонтаж' })).statusCode).toBe(200);
  });
});

describe('права', () => {
  it('участнику План и Сводка на просмотр: план и справочники видит, траты — нет, менять ничего нельзя', async () => {
    const { wife, base, cat } = await setup({ shopping: 'edit', summary: 'view', plan: 'view' });
    expect((await wife.get(`${base}/plan`)).statusCode).toBe(200);
    expect((await wife.get(`${base}/dictionaries`)).statusCode).toBe(200);
    expect((await wife.get(`${base}/transactions?month=2026-11`)).statusCode).toBe(404);
    expect((await wife.get(`${base}/incomes?month=2026-11`)).statusCode).toBe(404);
    expect((await wife.put(`${base}/plan/${id()}`, { categoryId: id(), amount: 1 })).statusCode).toBe(403);
    expect((await wife.put(`${base}/categories/${id()}`, { name: 'x' })).statusCode).toBe(403);
    expect((await wife.put(`${base}/transactions/${id()}`, { date: '2026-11-19', amount: 1, categoryId: await cat('Продукты') })).statusCode).toBe(404);
  });

  it('траты на правку: пишет траты, но не категории; подпись автора', async () => {
    const { wife, me, base, cat, dict } = await setup({ transactions: 'edit' });
    const t = id();
    expect((await wife.put(`${base}/transactions/${t}`, { date: '2026-11-19', amount: 300, categoryId: await cat('Продукты') })).statusCode).toBe(200);
    // к «Плану» доступа нет вовсе — 404, как будто раздела нет
    expect((await wife.put(`${base}/categories/${id()}`, { name: 'Моя' })).statusCode).toBe(404);
    const list = (await me.get(`${base}/transactions?month=2026-11`)).json() as Transaction[];
    const d = await dict();
    expect(d.people[list[0]!.createdBy]).toBe('Аня');
  });

  it('без доступа — справочники и траты 404', async () => {
    const { wife, base } = await setup(null);
    expect((await wife.get(`${base}/dictionaries`)).statusCode).toBe(404);
    expect((await wife.get(`${base}/plan`)).statusCode).toBe(404);
  });

  it('чужая категория в своём пространстве не принимается', async () => {
    const { wife, cat } = await setup({ shopping: 'edit' });
    const wifeId = (await wife.get('/api/me')).json().me.id;
    await wife.get(`/api/spaces/${wifeId}/dictionaries`);
    const res = await wife.put(`/api/spaces/${wifeId}/transactions/${id()}`, { date: '2026-11-19', amount: 1, categoryId: await cat('Продукты') });
    expect(res.statusCode).toBe(404);
    const plan = await wife.put(`/api/spaces/${wifeId}/plan/${id()}`, { categoryId: await cat('Продукты'), amount: 1 });
    expect(plan.statusCode).toBe(404);
  });
});
