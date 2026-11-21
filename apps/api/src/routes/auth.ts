import { nameSchema } from '@money/shared';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE } from '../app.ts';
import { HttpError, newId } from '../util.ts';

const CHALLENGE_COOKIE = 'wa';
/** Лимит на церемонии входа/регистрации с одного адреса. */
const AUTH_LIMIT = { rateLimit: { max: 20, timeWindow: '1 minute' } };

/** SimpleWebAuthn бросает исключение на любой неверный ответ — это ошибка клиента, не сервера. */
async function verified<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new HttpError(400, `Passkey не подтверждён: ${(e as Error).message}`);
  }
}

const responseSchema = z.object({ response: z.looseObject({ id: z.string(), type: z.literal('public-key') }) });

/** Имя passkey по умолчанию — по устройству, чтобы в списке было понятно, что удалять. */
export function deviceName(ua: string | undefined): string {
  const s = ua ?? '';
  if (/iPhone/.test(s)) return 'iPhone';
  if (/iPad/.test(s)) return 'iPad';
  if (/Android/.test(s)) return 'Android';
  if (/Macintosh|Mac OS X/.test(s)) return 'Mac';
  if (/Windows/.test(s)) return 'Windows';
  return 'Passkey';
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { store, config } = app;
  const secure = config.origin.startsWith('https://');

  const rememberChallenge = (reply: FastifyReply, id: string) =>
    reply.setCookie(CHALLENGE_COOKIE, id, { path: '/api/auth', httpOnly: true, secure, sameSite: 'strict', maxAge: 300 });

  const takeChallenge = (req: FastifyRequest, reply: FastifyReply, kind: 'register' | 'login' | 'add') => {
    const id = req.cookies[CHALLENGE_COOKIE];
    reply.clearCookie(CHALLENGE_COOKIE, { path: '/api/auth' });
    const ch = id ? store.takeChallenge(id, kind) : undefined;
    if (!ch) throw new HttpError(400, 'Время подтверждения истекло, попробуйте ещё раз');
    return ch;
  };

  // UV не требуем: часть ключей без PIN не умеет. Passkeys iPhone/Mac всё равно спрашивают Face ID.
  const verifyCommon = { expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: false };

  // ---- регистрация по инвайту ---------------------------------------------------------------

  app.post('/api/auth/register/options', { config: AUTH_LIMIT }, async (req, reply) => {
    const body = z.object({ token: z.string().min(10).max(100), name: nameSchema }).parse(req.body);
    const invite = store.activeInvite(body.token);
    if (!invite) throw new HttpError(404, 'Приглашение не найдено или уже использовано');
    const userId = newId(12);
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userID: Buffer.from(userId, 'base64url'),
      userName: body.name,
      userDisplayName: body.name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    rememberChallenge(reply, store.saveChallenge({ challenge: options.challenge, kind: 'register', userId, inviteId: invite.id, name: body.name }));
    return options;
  });

  app.post('/api/auth/register/verify', { config: AUTH_LIMIT }, async (req, reply) => {
    const { response } = responseSchema.parse(req.body);
    const ch = takeChallenge(req, reply, 'register');
    const result = await verified(() =>
      verifyRegistrationResponse({
      ...verifyCommon,
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge: ch.challenge,
    }),
    );
    if (!result.verified) throw new HttpError(400, 'Passkey не подтверждён');
    const info = result.registrationInfo;
    const userId = ch.user_id!;
    store.db.transaction(() => {
      const first = store.userCount() === 0;
      store.createUser(userId, ch.name!, first);
      store.addCredential(userId, {
        id: info.credential.id,
        publicKey: info.credential.publicKey,
        counter: info.credential.counter,
        transports: info.credential.transports ?? [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        name: deviceName(req.headers['user-agent']),
      });
      if (!store.redeemInvite(ch.invite_id!, userId)) throw new HttpError(409, 'Приглашение уже использовано');
    })();
    app.setSession(reply, userId);
    return { ok: true };
  });

  // ---- вход ---------------------------------------------------------------------------------

  app.post('/api/auth/login/options', { config: AUTH_LIMIT }, async (_req, reply) => {
    // allowCredentials пустой: браузер сам предложит passkeys этого сайта (discoverable).
    const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: 'preferred' });
    rememberChallenge(reply, store.saveChallenge({ challenge: options.challenge, kind: 'login' }));
    return options;
  });

  app.post('/api/auth/login/verify', { config: AUTH_LIMIT }, async (req, reply) => {
    const { response } = responseSchema.parse(req.body);
    const ch = takeChallenge(req, reply, 'login');
    const cred = store.getCredential(response.id);
    if (!cred) throw new HttpError(400, 'Этот passkey здесь не зарегистрирован');
    const result = await verified(() =>
      verifyAuthenticationResponse({
      ...verifyCommon,
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge: ch.challenge,
      credential: { id: cred.id, publicKey: new Uint8Array(cred.public_key), counter: cred.counter, transports: JSON.parse(cred.transports) },
    }),
    );
    if (!result.verified) throw new HttpError(400, 'Passkey не подтверждён');
    store.touchCredential(cred.id, result.authenticationInfo.newCounter);
    app.setSession(reply, cred.user_id);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) store.deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/logout-all', { preHandler: app.requireUser }, async (req, reply) => {
    store.deleteUserSessions(req.user!.id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---- свои passkeys ------------------------------------------------------------------------

  app.get('/api/auth/passkeys', { preHandler: app.requireUser }, async (req) => store.listPasskeys(req.user!.id));

  app.post('/api/auth/passkeys/options', { preHandler: app.requireUser, config: AUTH_LIMIT }, async (req, reply) => {
    const user = req.user!;
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userID: Buffer.from(user.id, 'base64url'),
      userName: user.name,
      userDisplayName: user.name,
      attestationType: 'none',
      excludeCredentials: store.userCredentials(user.id).map((c) => ({ id: c.id, transports: JSON.parse(c.transports) })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    rememberChallenge(reply, store.saveChallenge({ challenge: options.challenge, kind: 'add', userId: user.id }));
    return options;
  });

  app.post('/api/auth/passkeys/verify', { preHandler: app.requireUser, config: AUTH_LIMIT }, async (req, reply) => {
    const { response } = responseSchema.parse(req.body);
    const ch = takeChallenge(req, reply, 'add');
    if (ch.user_id !== req.user!.id) throw new HttpError(400, 'Подтверждение начато в другом аккаунте');
    const result = await verified(() =>
      verifyRegistrationResponse({
      ...verifyCommon,
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge: ch.challenge,
    }),
    );
    if (!result.verified) throw new HttpError(400, 'Passkey не подтверждён');
    const info = result.registrationInfo;
    if (store.getCredential(info.credential.id)) throw new HttpError(409, 'Этот passkey уже добавлен');
    store.addCredential(req.user!.id, {
      id: info.credential.id,
      publicKey: info.credential.publicKey,
      counter: info.credential.counter,
      transports: info.credential.transports ?? [],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      name: deviceName(req.headers['user-agent']),
    });
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>('/api/auth/passkeys/:id', { preHandler: app.requireUser }, async (req) => {
    const { name } = z.object({ name: nameSchema }).parse(req.body);
    if (!store.renameCredential(req.user!.id, req.params.id, name)) throw new HttpError(404, 'Passkey не найден');
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/auth/passkeys/:id', { preHandler: app.requireUser }, async (req) => {
    const r = store.deleteCredential(req.user!.id, req.params.id);
    if (r === 'not_found') throw new HttpError(404, 'Passkey не найден');
    if (r === 'last') throw new HttpError(400, 'Это последний passkey — без него в аккаунт не войти');
    return { ok: true };
  });

  // ---- вход без passkey: только локальная разработка ---------------------------------------

  if (config.devLogin) {
    app.post('/api/dev/login', async (req, reply) => {
      const { name } = z.object({ name: nameSchema }).parse(req.body);
      const found = store.db.prepare('SELECT id FROM users WHERE name = ?').get(name) as { id: string } | undefined;
      const id = found?.id ?? store.createUser(newId(12), name, store.userCount() === 0).id;
      app.setSession(reply, id);
      return { ok: true };
    });
  }
}
