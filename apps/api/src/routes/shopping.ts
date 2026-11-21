import { SSE_PING_MS, type ShoppingEvent, clientIdSchema, shoppingItemSchema, shoppingListSchema } from '@money/shared';
import type { FastifyInstance } from 'fastify';
import { requireSection } from '../access.ts';
import { ShoppingStore } from '../store-shopping.ts';

type P = { Params: { owner: string; id: string } };

export async function shoppingRoutes(app: FastifyInstance): Promise<void> {
  const { store, bus } = app;
  const shop = new ShoppingStore(store.db);
  const base = '/api/spaces/:owner/shopping';
  const publish = (owner: string, ev: ShoppingEvent) => bus.publish(owner, 'shopping', ev);
  const view = (req: Parameters<typeof requireSection>[1], owner: string) => requireSection(store, req, owner, 'shopping', 'view');
  const edit = (req: Parameters<typeof requireSection>[1], owner: string) => requireSection(store, req, owner, 'shopping', 'edit');

  app.get<P>(base, async (req) => {
    view(req, req.params.owner);
    return shop.state(req.params.owner);
  });

  app.get<P & { Querystring: { list?: string; q?: string } }>(`${base}/suggest`, async (req) => {
    view(req, req.params.owner);
    const list = clientIdSchema.parse(req.query.list);
    return shop.suggest(req.params.owner, list, String(req.query.q ?? '').slice(0, 60));
  });

  app.delete<P & { Querystring: { list?: string; name?: string } }>(`${base}/suggest`, async (req) => {
    edit(req, req.params.owner);
    const list = clientIdSchema.parse(req.query.list);
    const name = shoppingItemSchema.shape.name.parse(req.query.name);
    shop.forget(req.params.owner, list, name);
    return { ok: true };
  });

  // ---- списки -------------------------------------------------------------------------------

  app.put<P>(`${base}/lists/:id`, async (req) => {
    edit(req, req.params.owner);
    const id = clientIdSchema.parse(req.params.id);
    const { name } = shoppingListSchema.parse(req.body);
    const r = shop.upsertList(req.params.owner, id, name);
    if (r.status === 'saved') publish(req.params.owner, { type: 'list', list: r.value });
    return r;
  });

  app.delete<P>(`${base}/lists/:id`, async (req) => {
    edit(req, req.params.owner);
    if (shop.deleteList(req.params.owner, req.params.id)) publish(req.params.owner, { type: 'list-deleted', id: req.params.id });
    return { ok: true };
  });

  app.post<P>(`${base}/lists/:id/clear-checked`, async (req) => {
    edit(req, req.params.owner);
    const ids = shop.clearChecked(req.params.owner, req.params.id);
    for (const id of ids) publish(req.params.owner, { type: 'item-deleted', id, listId: req.params.id });
    return { removed: ids.length };
  });

  // ---- позиции ------------------------------------------------------------------------------

  app.put<P>(`${base}/items/:id`, async (req) => {
    const userId = edit(req, req.params.owner);
    const id = clientIdSchema.parse(req.params.id);
    const input = shoppingItemSchema.parse(req.body);
    const r = shop.upsertItem(req.params.owner, id, input, userId);
    if (r.status === 'saved') publish(req.params.owner, { type: 'item', item: r.value });
    return r;
  });

  app.delete<P>(`${base}/items/:id`, async (req) => {
    edit(req, req.params.owner);
    const row = shop.deleteItem(req.params.owner, req.params.id);
    if (row) publish(req.params.owner, { type: 'item-deleted', id: row.id, listId: row.list_id });
    return { ok: true };
  });

  // ---- живые обновления ---------------------------------------------------------------------

  app.get<P>(`${base}/events`, async (req, reply) => {
    const userId = view(req, req.params.owner);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      // nginx и так не буферизует /api (proxy_buffering off), заголовок — на случай другого прокси.
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n: ok\n\n');
    // Пинг — событием, а не комментарием: комментарии EventSource клиенту не показывает.
    const ping = setInterval(() => res.write(`data: ${JSON.stringify({ type: 'ping' } satisfies ShoppingEvent)}\n\n`), SSE_PING_MS);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      unsubscribe();
      res.end();
    };
    const unsubscribe = bus.subscribe(req.params.owner, 'shopping', { userId, send: (d) => res.write(d), close });
    req.raw.on('close', close);
  });
}
