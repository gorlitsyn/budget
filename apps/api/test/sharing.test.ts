import { describe, expect, it } from 'vitest';
import { Client, makeApp, systemInvite } from './helpers.ts';

async function family() {
  const app = await makeApp();
  const me = new Client(app);
  await me.register(systemInvite(app), 'Иван');
  return { app, me };
}

describe('инвайты и права по разделам', () => {
  it('жена по инвайту: регистрируется и сразу видит выданные разделы', async () => {
    const { app, me } = await family();
    const grants = { shopping: 'edit', summary: 'view', plan: 'view' };
    const inv = (await me.post('/api/sharing/invites', { note: 'Жена', grants })).json();

    const wifeBrowser = new Client(app);
    const preview = (await wifeBrowser.get(`/api/invites/${inv.url.split('/invite/')[1]}`)).json();
    expect(preview).toEqual({ ownerName: 'Иван', grants, system: false });

    await wifeBrowser.register(inv.url, 'Аня');
    const wife = (await wifeBrowser.get('/api/me')).json();
    expect(wife.me.admin).toBe(false);
    expect(wife.spaces).toEqual([{ ownerId: (await me.get('/api/me')).json().me.id, ownerName: 'Иван', grants }]);

    const members = (await me.get('/api/sharing/members')).json();
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ name: 'Аня', grants });

    const invites = (await me.get('/api/sharing/invites')).json();
    expect(invites[0]).toMatchObject({ note: 'Жена', usedByName: 'Аня' });
  });

  it('пользователи изолированы: без инвайта чужое пространство не видно', async () => {
    const { app, me } = await family();
    const other = new Client(app);
    await other.register(systemInvite(app), 'Сосед');
    expect((await other.get('/api/me')).json().spaces).toEqual([]);
    expect((await me.get('/api/sharing/members')).json()).toEqual([]);
  });

  it('уже зарегистрированный принимает инвайт; повторный инвайт заменяет права целиком', async () => {
    const { app, me } = await family();
    const wife = new Client(app);
    await wife.register(systemInvite(app), 'Аня');

    const first = (await me.post('/api/sharing/invites', { grants: { shopping: 'edit', plan: 'view' } })).json();
    expect((await wife.post(`/api/invites/${first.url.split('/invite/')[1]}/accept`)).statusCode).toBe(200);
    const second = (await me.post('/api/sharing/invites', { grants: { summary: 'view' } })).json();
    await wife.post(`/api/invites/${second.url.split('/invite/')[1]}/accept`);
    expect((await wife.get('/api/me')).json().spaces[0].grants).toEqual({ summary: 'view' });
  });

  it('свой инвайт принять нельзя, системный — тоже, если уже есть аккаунт', async () => {
    const { app, me } = await family();
    const own = (await me.post('/api/sharing/invites', { grants: { shopping: 'edit' } })).json();
    expect((await me.post(`/api/invites/${own.url.split('/invite/')[1]}/accept`)).statusCode).toBe(400);
    expect((await me.post(`/api/invites/${systemInvite(app).split('/invite/')[1]}/accept`)).statusCode).toBe(400);
  });

  it('изменение прав, удаление участника, выход участника из пространства', async () => {
    const { app, me } = await family();
    const inv = (await me.post('/api/sharing/invites', { grants: { shopping: 'edit' } })).json();
    const wife = new Client(app);
    await wife.register(inv.url, 'Аня');
    const wifeId = (await wife.get('/api/me')).json().me.id;
    const meId = (await me.get('/api/me')).json().me.id;

    expect((await me.put(`/api/sharing/members/${wifeId}`, { grants: { shopping: 'view', transactions: 'view' } })).statusCode).toBe(200);
    expect(app.store.grantsIn(meId, wifeId)).toEqual({ shopping: 'view', transactions: 'view' });

    await wife.del(`/api/sharing/spaces/${meId}`);
    expect(app.store.grantsIn(meId, wifeId)).toEqual({});
    expect((await me.get('/api/sharing/members')).json()).toEqual([]);
  });

  it('права выдаются только существующему участнику, не по произвольному id', async () => {
    const { app, me } = await family();
    const other = new Client(app);
    await other.register(systemInvite(app), 'Сосед');
    const otherId = (await other.get('/api/me')).json().me.id;
    expect((await me.put(`/api/sharing/members/${otherId}`, { grants: { shopping: 'edit' } })).statusCode).toBe(404);
  });

  it('пустой инвайт (просто новый аккаунт) — только админу', async () => {
    const { app, me } = await family();
    expect((await me.post('/api/sharing/invites', { grants: {} })).statusCode).toBe(200);
    const inv = (await me.post('/api/sharing/invites', { grants: { shopping: 'edit' } })).json();
    const wife = new Client(app);
    await wife.register(inv.url, 'Аня');
    expect((await wife.post('/api/sharing/invites', { grants: {} })).statusCode).toBe(400);
  });

  it('отозванный инвайт не работает', async () => {
    const { app, me } = await family();
    const inv = (await me.post('/api/sharing/invites', { grants: { shopping: 'edit' } })).json();
    expect((await me.del(`/api/sharing/invites/${inv.id}`)).statusCode).toBe(200);
    await expect(new Client(app).register(inv.url, 'Аня')).rejects.toThrow(/404/);
  });

  it('истёкший инвайт не работает', async () => {
    const { app, me } = await family();
    const inv = (await me.post('/api/sharing/invites', { grants: { shopping: 'edit' } })).json();
    app.store.db.prepare('UPDATE invites SET expires_at = 1 WHERE id = ?').run(inv.id);
    await expect(new Client(app).register(inv.url, 'Аня')).rejects.toThrow(/404/);
  });

  it('неизвестный раздел или уровень в правах — 400', async () => {
    const { me } = await family();
    expect((await me.post('/api/sharing/invites', { grants: { bank: 'edit' } })).statusCode).toBe(400);
    expect((await me.post('/api/sharing/invites', { grants: { shopping: 'admin' } })).statusCode).toBe(400);
  });
});
