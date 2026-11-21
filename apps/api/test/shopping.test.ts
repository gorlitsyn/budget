import type { ShoppingState } from '@money/shared';
import { describe, expect, it } from 'vitest';
import { Client, makeApp, systemInvite } from './helpers.ts';

const id = () => Math.random().toString(36).slice(2, 12).padEnd(10, 'x');

/** Иван и Аня; Ане открыты Покупки с заданным уровнем. */
async function family(level: 'view' | 'edit' | null = 'edit') {
  const app = await makeApp();
  const me = new Client(app);
  await me.register(systemInvite(app), 'Иван');
  const wife = new Client(app);
  if (level) {
    const inv = (await me.post('/api/sharing/invites', { grants: { shopping: level } })).json();
    await wife.register(inv.url, 'Аня');
  } else {
    await wife.register(systemInvite(app), 'Аня');
  }
  const meId = (await me.get('/api/me')).json().me.id as string;
  const wifeId = (await wife.get('/api/me')).json().me.id as string;
  const base = `/api/spaces/${meId}/shopping`;
  const state = async (c = me) => (await c.get(base)).json() as ShoppingState;
  return { app, me, wife, meId, wifeId, base, state };
}

describe('покупки', () => {
  it('первый заход создаёт список «Продукты»; повторный — не плодит', async () => {
    const { state } = await family();
    const s1 = await state();
    expect(s1.lists.map((l) => l.name)).toEqual(['Продукты']);
    expect((await state()).lists).toHaveLength(1);
  });

  it('жена с правкой добавляет и отмечает — подписи «кто добавил / кто купил»', async () => {
    const { wife, me, base, state, meId, wifeId } = await family();
    const listId = (await state()).lists[0]!.id;
    const itemId = id();
    expect((await wife.put(`${base}/items/${itemId}`, { listId, name: 'Молоко', qty: '2 л' })).statusCode).toBe(200);
    await me.put(`${base}/items/${itemId}`, { listId, name: 'Молоко', qty: '2 л', checked: true });
    const s = await state(wife);
    expect(s.items[0]).toMatchObject({ name: 'Молоко', qty: '2 л', checked: true, addedBy: wifeId, checkedBy: meId });
    expect(s.people).toEqual({ [meId]: 'Иван', [wifeId]: 'Аня' });
  });

  it('повтор того же PUT (офлайн-очередь) не создаёт дубль', async () => {
    const { me, base, state } = await family();
    const listId = (await state()).lists[0]!.id;
    const itemId = id();
    for (let i = 0; i < 3; i++) await me.put(`${base}/items/${itemId}`, { listId, name: 'Хлеб' });
    expect((await state()).items).toHaveLength(1);
  });

  it('удалённое не воскресает от запоздавшего изменения из очереди', async () => {
    const { me, wife, base, state } = await family();
    const listId = (await state()).lists[0]!.id;
    const itemId = id();
    await me.put(`${base}/items/${itemId}`, { listId, name: 'Сыр' });
    await me.del(`${base}/items/${itemId}`);
    const late = await wife.put(`${base}/items/${itemId}`, { listId, name: 'Сыр', checked: true });
    expect(late.json()).toEqual({ status: 'deleted' });
    expect((await state()).items).toHaveLength(0);
  });

  it('просмотр: читать можно, менять нельзя', async () => {
    const { wife, base, state } = await family('view');
    const listId = (await state()).lists[0]!.id;
    expect((await wife.get(base)).statusCode).toBe(200);
    expect((await wife.put(`${base}/items/${id()}`, { listId, name: 'Х' })).statusCode).toBe(403);
    expect((await wife.post(`${base}/lists/${listId}/clear-checked`)).statusCode).toBe(403);
  });

  it('без доступа — 404, и не видно, что пространство существует', async () => {
    const { wife, base } = await family(null);
    expect((await wife.get(base)).statusCode).toBe(404);
    expect((await wife.get(`${base}/events`)).statusCode).toBe(404);
  });

  it('свой список и чужой id: нельзя писать в чужой список через своё пространство', async () => {
    const { wife, me, base, state, wifeId } = await family();
    const myListId = (await state()).lists[0]!.id;
    // Аня пишет в СВОЁ пространство, подставляя id списка Ивана
    const res = await wife.put(`/api/spaces/${wifeId}/shopping/items/${id()}`, { listId: myListId, name: 'Взлом' });
    expect(res.statusCode).toBe(404);
    // И не может переименовать его список через своё пространство
    expect((await wife.put(`/api/spaces/${wifeId}/shopping/lists/${myListId}`, { name: 'x' })).statusCode).toBe(404);
    expect((await state(me)).lists[0]!.name).toBe('Продукты');
  });

  it('несколько списков; последний удалить нельзя; удаление списка убирает его позиции', async () => {
    const { me, base, state } = await family();
    const first = (await state()).lists[0]!.id;
    const pharmacy = id();
    await me.put(`${base}/lists/${pharmacy}`, { name: 'Аптека' });
    await me.put(`${base}/items/${id()}`, { listId: pharmacy, name: 'Пластырь' });
    expect((await me.del(`${base}/lists/${pharmacy}`)).statusCode).toBe(200);
    const s = await state();
    expect(s.lists.map((l) => l.name)).toEqual(['Продукты']);
    expect(s.items).toHaveLength(0);
    expect((await me.del(`${base}/lists/${first}`)).statusCode).toBe(400);
  });

  it('«очистить купленное» убирает только отмеченное', async () => {
    const { me, base, state } = await family();
    const listId = (await state()).lists[0]!.id;
    await me.put(`${base}/items/${id()}`, { listId, name: 'Купил', checked: true });
    await me.put(`${base}/items/${id()}`, { listId, name: 'Ещё нет' });
    expect((await me.post(`${base}/lists/${listId}/clear-checked`)).json()).toEqual({ removed: 1 });
    expect((await state()).items.map((i) => i.name)).toEqual(['Ещё нет']);
  });

  it('подсказки: по началу слова, без учёта регистра и «ё», частые выше', async () => {
    const { me, base, state } = await family();
    const listId = (await state()).lists[0]!.id;
    for (const n of ['Мёд', 'Молоко', 'Молоко', 'Кокосовое молоко', 'Сметана']) await me.put(`${base}/items/${id()}`, { listId, name: n });
    expect((await me.get(`${base}/suggest?list=${listId}&q=мол`)).json()).toEqual(['Молоко', 'Кокосовое молоко']);
    expect((await me.get(`${base}/suggest?list=${listId}&q=мед`)).json()).toEqual(['Мёд']);
    expect((await me.get(`${base}/suggest?list=${listId}&q=%25`)).json()).toEqual([]);
    expect((await me.get(`${base}/suggest?q=мол`)).statusCode).toBe(400);
  });

  it('подсказки у каждого списка свои', async () => {
    const { me, base, state } = await family();
    const food = (await state()).lists[0]!.id;
    const home = id();
    await me.put(`${base}/lists/${home}`, { name: 'Бытовое' });
    await me.put(`${base}/items/${id()}`, { listId: food, name: 'Молоко' });
    await me.put(`${base}/items/${id()}`, { listId: home, name: 'Мыло' });
    expect((await me.get(`${base}/suggest?list=${food}`)).json()).toEqual(['Молоко']);
    expect((await me.get(`${base}/suggest?list=${home}`)).json()).toEqual(['Мыло']);
    expect((await me.get(`${base}/suggest?list=${home}&q=мол`)).json()).toEqual([]);
  });

  it('опечатку в названии исправили — в подсказках новое, старое пропало', async () => {
    const { me, base, state } = await family();
    const listId = (await state()).lists[0]!.id;
    const item = id();
    await me.put(`${base}/items/${item}`, { listId, name: 'Малоко' });
    await me.put(`${base}/items/${item}`, { listId, name: 'Молоко' });
    expect((await me.get(`${base}/suggest?list=${listId}`)).json()).toEqual(['Молоко']);
  });

  it('подсказку можно удалить; только с правом правки', async () => {
    const { me, wife, base, state } = await family('view');
    const listId = (await state()).lists[0]!.id;
    await me.put(`${base}/items/${id()}`, { listId, name: 'Хлеп' });
    const url = `${base}/suggest?list=${listId}&name=${encodeURIComponent('хлеп')}`;
    expect((await wife.del(url)).statusCode).toBe(403);
    expect((await me.del(url)).statusCode).toBe(200);
    expect((await me.get(`${base}/suggest?list=${listId}`)).json()).toEqual([]);
    // позиция в списке осталась
    expect((await state()).items.map((i) => i.name)).toEqual(['Хлеп']);
  });

  it('стоимость: задаётся, сохраняется, если не передана (старые клиенты), убирается null', async () => {
    const { me, base, state } = await family();
    const listId = (await state()).lists[0]!.id;
    const item = id();
    await me.put(`${base}/items/${item}`, { listId, name: 'Сыр', price: 45990 });
    expect((await state()).items[0]!.price).toBe(45990);
    await me.put(`${base}/items/${item}`, { listId, name: 'Сыр', checked: true }); // без price
    expect((await state()).items[0]!.price).toBe(45990);
    await me.put(`${base}/items/${item}`, { listId, name: 'Сыр', checked: true, price: null });
    expect((await state()).items[0]!.price).toBeNull();
    for (const price of [0, -1, 12.5]) {
      expect((await me.put(`${base}/items/${id()}`, { listId, name: 'Х', price })).statusCode).toBe(400);
    }
  });

  it('неверный id или пустое название — 400', async () => {
    const { me, base, state } = await family();
    const listId = (await state()).lists[0]!.id;
    expect((await me.put(`${base}/items/../x`, { listId, name: 'a' })).statusCode).not.toBe(200);
    expect((await me.put(`${base}/items/${id()}`, { listId, name: '   ' })).statusCode).toBe(400);
  });
});

describe('живые обновления', () => {
  it('изменение Ивана приходит Ане по SSE; после закрытия доступа поток обрывается', async () => {
    const { app, me, wife, base, state, wifeId } = await family();
    const listId = (await state()).lists[0]!.id;
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const ctrl = new AbortController();
      const res = await fetch(`${address}${base}/events`, {
        headers: { cookie: `sid=${wife.cookies.get('sid')}` },
        signal: ctrl.signal,
      });
      expect(res.headers.get('content-type')).toMatch(/event-stream/);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const next = async (re: RegExp) => {
        while (!re.test(buf)) {
          const { value, done } = await reader.read();
          if (done) return false;
          buf += dec.decode(value);
        }
        return true;
      };
      await next(/: ok/);
      expect(app.bus.count(base.split('/')[3]!, 'shopping')).toBe(1);

      await me.put(`${base}/items/${id()}`, { listId, name: 'Яблоки' });
      expect(await next(/"name":"Яблоки"/)).toBe(true);

      // закрываем доступ — следующее событие не уходит, поток закрывается
      await me.del(`/api/sharing/members/${wifeId}`);
      await me.put(`${base}/items/${id()}`, { listId, name: 'Секрет' });
      expect(await next(/$^/)).toBe(false);
      expect(buf).not.toContain('Секрет');
      ctrl.abort();
    } finally {
      await app.close();
    }
  });

  it('остановка сервера закрывает потоки и не ждёт их', async () => {
    const { app, wife, base } = await family();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const res = await fetch(`${address}${base}/events`, { headers: { cookie: `sid=${wife.cookies.get('sid')}` } });
    const reader = res.body!.getReader();
    await reader.read();
    const t = Date.now();
    await app.close();
    expect(Date.now() - t).toBeLessThan(1000);
    expect((await reader.read()).done).toBe(true);
  });
});
