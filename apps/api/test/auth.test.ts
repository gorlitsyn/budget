import { describe, expect, it } from 'vitest';
import { SoftAuthenticator } from './authenticator.ts';
import { Client, ORIGIN, config, makeApp, systemInvite } from './helpers.ts';

describe('регистрация и вход по passkey', () => {
  it('первый по системному инвайту — админ, сессия выдаётся сразу', async () => {
    const app = await makeApp();
    const c = new Client(app);
    await c.register(systemInvite(app), 'Иван');
    const me = (await c.get('/api/me')).json();
    expect(me.me).toMatchObject({ name: 'Иван', admin: true });
    expect((await c.get('/api/auth/passkeys')).json()).toHaveLength(1);
  });

  it('без инвайта не зарегистрироваться', async () => {
    const app = await makeApp();
    const res = await new Client(app).post('/api/auth/register/options', { token: 'x'.repeat(32), name: 'Чужой' });
    expect(res.statusCode).toBe(404);
  });

  it('инвайт одноразовый', async () => {
    const app = await makeApp();
    const url = systemInvite(app);
    await new Client(app).register(url, 'Первый');
    await expect(new Client(app).register(url, 'Второй')).rejects.toThrow(/404/);
  });

  it('гонка: два браузера начали регистрацию по одному инвайту — второй получает отказ, аккаунт не создаётся', async () => {
    const app = await makeApp();
    const token = systemInvite(app).split('/invite/')[1]!;
    const a = new Client(app);
    const b = new Client(app);
    const oa = (await a.post('/api/auth/register/options', { token, name: 'A' })).json();
    const ob = (await b.post('/api/auth/register/options', { token, name: 'B' })).json();
    const ra = await a.post('/api/auth/register/verify', { response: new SoftAuthenticator(config.rpId, ORIGIN).create(oa) });
    const rb = await b.post('/api/auth/register/verify', { response: new SoftAuthenticator(config.rpId, ORIGIN).create(ob) });
    expect(ra.statusCode).toBe(200);
    expect(rb.statusCode).toBe(409);
    expect(app.store.userCount()).toBe(1);
  });

  it('вход после выхода тем же passkey; счётчик растёт', async () => {
    const app = await makeApp();
    const c = new Client(app);
    const key = await c.register(systemInvite(app), 'К');
    await c.post('/api/auth/logout');
    expect((await c.get('/api/me')).json().me).toBeNull();
    expect((await c.login(key)).statusCode).toBe(200);
    expect((await c.get('/api/me')).json().me.name).toBe('К');
    const [pk] = (await c.get('/api/auth/passkeys')).json();
    expect(pk.lastUsedAt).toBeTypeOf('number');
  });

  it('чужой passkey не пускает', async () => {
    const app = await makeApp();
    const c = new Client(app);
    await c.register(systemInvite(app), 'К');
    await c.post('/api/auth/logout');
    const res = await c.login(new SoftAuthenticator(config.rpId, ORIGIN));
    expect(res.statusCode).toBe(400);
  });

  it('ответ с другого origin отклоняется', async () => {
    const app = await makeApp();
    const c = new Client(app);
    const key = await c.register(systemInvite(app), 'К');
    await c.post('/api/auth/logout');
    const opts = (await c.post('/api/auth/login/options')).json();
    const res = await c.post('/api/auth/login/verify', { response: key.get(opts, 'https://evil.test') });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/origin/i);
  });

  it('challenge одноразовый: повтор того же ответа не проходит', async () => {
    const app = await makeApp();
    const c = new Client(app);
    const key = await c.register(systemInvite(app), 'К');
    await c.post('/api/auth/logout');
    const opts = (await c.post('/api/auth/login/options')).json();
    const response = key.get(opts);
    const wa = c.cookies.get('wa')!;
    expect((await c.post('/api/auth/login/verify', { response })).statusCode).toBe(200);
    c.cookies.set('wa', wa);
    expect((await c.post('/api/auth/login/verify', { response })).statusCode).toBe(400);
  });

  it('изменяющий запрос без нашего Origin — 403', async () => {
    const app = await makeApp();
    const c = new Client(app);
    const res = await c.req('POST', '/api/auth/login/options', {}, { origin: 'https://evil.test' });
    expect(res.statusCode).toBe(403);
  });

  it('второй passkey, удаление; последний не удалить', async () => {
    const app = await makeApp();
    const c = new Client(app);
    await c.register(systemInvite(app), 'К');
    const opts = (await c.post('/api/auth/passkeys/options')).json();
    const second = new SoftAuthenticator(config.rpId, ORIGIN);
    expect((await c.post('/api/auth/passkeys/verify', { response: second.create(opts) })).statusCode).toBe(200);
    const list = (await c.get('/api/auth/passkeys')).json();
    expect(list).toHaveLength(2);
    expect((await c.del(`/api/auth/passkeys/${list[0].id}`)).statusCode).toBe(200);
    expect((await c.del(`/api/auth/passkeys/${list[1].id}`)).statusCode).toBe(400);
    // второй ключ рабочий
    await c.post('/api/auth/logout');
    expect((await c.login(second)).statusCode).toBe(200);
  });

  it('выход везде гасит все сессии', async () => {
    const app = await makeApp();
    const phone = new Client(app);
    const key = await phone.register(systemInvite(app), 'К');
    const mac = new Client(app);
    await mac.login(key);
    await mac.post('/api/auth/logout-all');
    expect((await phone.get('/api/me')).json().me).toBeNull();
  });

  it('вход по имени без passkey выключен в production', async () => {
    const app = await makeApp({ devLogin: false });
    expect((await new Client(app).post('/api/dev/login', { name: 'x' })).statusCode).toBe(404);
  });

  it('старой сборке без заголовка ревизии /api/me велит стереть кэш и service worker, новой — нет', async () => {
    const app = await makeApp();
    const old = await app.inject({ method: 'GET', url: '/api/me' });
    expect(old.headers['clear-site-data']).toBe('"cache", "storage"');
    const fresh = await app.inject({ method: 'GET', url: '/api/me', headers: { 'x-app-revision': 'abc1234' } });
    expect(fresh.headers['clear-site-data']).toBeUndefined();
    const other = await app.inject({ method: 'GET', url: '/api/health' });
    expect(other.headers['clear-site-data']).toBeUndefined();
    expect(other.json()).toEqual({ ok: true, revision: 'dev' });
  });
});
