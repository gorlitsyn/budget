import { type Me, nameSchema } from '@money/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  const { store } = app;

  /** Без сессии — 200 с me: null: фронту так проще решить, показывать ли экран входа. */
  app.get('/api/me', async (req) => {
    const u = req.user;
    if (!u) return { me: null, spaces: [], devLogin: app.config.devLogin };
    const me: Me = { id: u.id, name: u.name, admin: u.admin === 1 };
    return { me, spaces: store.sharedSpaces(u.id), devLogin: app.config.devLogin };
  });

  app.patch('/api/me', { preHandler: app.requireUser }, async (req) => {
    const { name } = z.object({ name: nameSchema }).parse(req.body);
    store.renameUser(req.user!.id, name);
    return { ok: true };
  });
}
