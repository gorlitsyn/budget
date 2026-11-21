import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { REVISION_HEADER } from '@money/shared';
import type { Config } from './config.ts';
import type { DB } from './db/index.ts';
import { Bus } from './bus.ts';
import { authRoutes } from './routes/auth.ts';
import { meRoutes } from './routes/me.ts';
import { moneyRoutes } from './routes/money.ts';
import { sharingRoutes } from './routes/sharing.ts';
import { shoppingRoutes } from './routes/shopping.ts';
import { summaryRoutes } from './routes/summary.ts';
import { Store, type UserRow } from './store.ts';
import { HttpError } from './util.ts';

declare module 'fastify' {
  interface FastifyInstance {
    store: Store;
    bus: Bus;
    config: Config;
    /** preHandler: пускает только с действующей сессией. */
    requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    setSession: (reply: FastifyReply, userId: string) => void;
  }
  interface FastifyRequest {
    user: UserRow | null;
  }
}

export const SESSION_COOKIE = 'sid';
declare const __REVISION__: string | undefined;
/** Ревизия сборки: в образе её подставляет esbuild (build.mjs), локально — 'dev'. */
export const REVISION = typeof __REVISION__ === 'string' ? __REVISION__ : 'dev';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(config: Config, db: DB, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  // api доступен только из сети Docker за nginx и Caddy; Caddy подменяет X-Forwarded-For адресом
  // клиента, поэтому левый адрес в цепочке — настоящий (нужно для лимитов частоты).
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 256 * 1024 });
  const store = new Store(db);
  const secure = config.origin.startsWith('https://');

  app.decorate('store', store);
  app.decorate('bus', new Bus(store));
  app.addHook('preClose', async () => app.bus.closeAll());
  app.decorate('config', config);
  app.decorateRequest('user', null);

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorate('setSession', (reply: FastifyReply, userId: string) => {
    const token = store.createSession(userId, config.sessionDays);
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: config.sessionDays * 24 * 60 * 60,
    });
  });

  app.decorate('requireUser', async (req: FastifyRequest) => {
    if (!req.user) throw new HttpError(401, 'Нужно войти');
  });

  // CSRF: cookie SameSite=Lax + изменяющие запросы только с нашего Origin.
  app.addHook('onRequest', async (req) => {
    if (!SAFE_METHODS.has(req.method) && req.headers.origin !== config.origin) {
      throw new HttpError(403, 'Запрос не с того сайта');
    }
    const token = req.cookies[SESSION_COOKIE];
    req.user = token ? (store.sessionUser(token, config.sessionDays) ?? null) : null;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'Неверные данные', issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ error: 'Слишком много попыток, подождите минуту' });
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Внутренняя ошибка' });
  });

  app.get('/api/health', async () => ({ ok: true, revision: REVISION }));

  // Выталкивание застрявших сборок. Старое приложение на iPhone могло не ставить новый service worker
  // (Safari запрашивал /sw.js и дальше ничего), а своей логики обновления у него нет. Новые сборки шлют
  // свою ревизию в заголовке; /api/me без него — старый клиент: браузер стирает кэш и service worker
  // сайта (Safari 17+). Cookie не трогаем — сессия остаётся. Следующий запуск грузит свежую сборку.
  app.addHook('onSend', async (req, reply) => {
    if (req.method === 'GET' && req.url === '/api/me' && !req.headers[REVISION_HEADER]) {
      reply.header('Clear-Site-Data', '"cache", "storage"');
    }
  });

  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(sharingRoutes);
  await app.register(shoppingRoutes);
  await app.register(moneyRoutes);
  await app.register(summaryRoutes);

  return app;
}
