import { SECTIONS, createInviteSchema, updateGrantsSchema } from '@money/shared';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../util.ts';

export async function sharingRoutes(app: FastifyInstance): Promise<void> {
  const { store, config } = app;
  const auth = { preHandler: app.requireUser };

  // ---- инвайт по ссылке ---------------------------------------------------------------------

  /** Что увидит получатель до входа: от кого и какие разделы. Без сессии. */
  app.get<{ Params: { token: string } }>('/api/invites/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const inv = store.activeInvite(req.params.token);
    if (!inv) throw new HttpError(404, 'Приглашение не найдено, истекло или уже использовано');
    return store.invitePreview(inv);
  });

  /** Уже зарегистрированный человек принимает приглашение в чужое пространство. */
  app.post<{ Params: { token: string } }>('/api/invites/:token/accept', auth, async (req) => {
    const inv = store.activeInvite(req.params.token);
    if (!inv) throw new HttpError(404, 'Приглашение не найдено, истекло или уже использовано');
    if (inv.owner_id === null) throw new HttpError(400, 'Это приглашение для регистрации, а вы уже зарегистрированы');
    if (inv.owner_id === req.user!.id) throw new HttpError(400, 'Это ваше собственное приглашение — отправьте ссылку тому, кого приглашаете');
    if (!store.redeemInvite(inv.id, req.user!.id)) throw new HttpError(409, 'Приглашение уже использовано');
    return { ok: true, ownerId: inv.owner_id };
  });

  // ---- мои инвайты --------------------------------------------------------------------------

  app.get('/api/sharing/invites', auth, async (req) => store.listInvites(req.user!.id));

  app.post('/api/sharing/invites', auth, async (req) => {
    const body = createInviteSchema.parse(req.body);
    const hasGrants = SECTIONS.some((s) => body.grants[s]);
    // Инвайт без разделов = просто новый аккаунт на сервере. Это решает только администратор.
    if (!hasGrants && !req.user!.admin) throw new HttpError(400, 'Отметьте хотя бы один раздел');
    const { id, token } = store.createInvite(req.user!.id, body.note, body.grants, config.inviteDays);
    // Токен виден только сейчас: в БД лежит его хэш.
    return { id, url: `${config.origin}/invite/${token}` };
  });

  app.delete<{ Params: { id: string } }>('/api/sharing/invites/:id', auth, async (req) => {
    if (!store.revokeInvite(req.user!.id, req.params.id)) throw new HttpError(404, 'Приглашение не найдено или уже использовано');
    return { ok: true };
  });

  // ---- кому я дал доступ --------------------------------------------------------------------

  app.get('/api/sharing/members', auth, async (req) => store.members(req.user!.id));

  app.put<{ Params: { id: string } }>('/api/sharing/members/:id', auth, async (req) => {
    const { grants } = updateGrantsSchema.parse(req.body);
    const me = req.user!.id;
    // Только тем, кто уже участник: права новому человеку выдаются инвайтом, не по id.
    if (!store.members(me).some((m) => m.userId === req.params.id)) throw new HttpError(404, 'Участник не найден');
    store.setGrants(me, req.params.id, grants);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/sharing/members/:id', auth, async (req) => {
    store.setGrants(req.user!.id, req.params.id, {});
    return { ok: true };
  });

  /** Выйти из чужого пространства. */
  app.delete<{ Params: { ownerId: string } }>('/api/sharing/spaces/:ownerId', auth, async (req) => {
    if (req.params.ownerId === req.user!.id) throw new HttpError(400, 'Это ваше пространство');
    store.setGrants(req.params.ownerId, req.user!.id, {});
    return { ok: true };
  });
}
