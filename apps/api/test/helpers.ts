import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { openDb } from '../src/db/index.ts';
import { SoftAuthenticator } from './authenticator.ts';

export const ORIGIN = 'https://money.test';
export const config: Config = {
  port: 0,
  host: '127.0.0.1',
  dataDir: ':memory:',
  rpId: 'money.test',
  rpName: 'Бюджет',
  origin: ORIGIN,
  sessionDays: 90,
  inviteDays: 7,
  devLogin: false,
  production: true,
};

export async function makeApp(over: Partial<Config> = {}) {
  return buildApp({ ...config, ...over }, openDb(':memory:'));
}

/** Клиент с банкой cookie — как один браузер. */
export class Client {
  cookies = new Map<string, string>();
  constructor(readonly app: FastifyInstance) {}

  async req(method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method,
      url,
      payload: payload as InjectOptions['payload'],
      headers: {
        origin: ORIGIN,
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...headers,
      },
    });
    for (const c of res.cookies) {
      if (c.value === '' || c.maxAge === 0) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return res;
  }

  get = (url: string) => this.req('GET', url);
  post = (url: string, body: unknown = {}) => this.req('POST', url, body);
  put = (url: string, body: unknown = {}) => this.req('PUT', url, body);
  del = (url: string) => this.req('DELETE', url);
  patch = (url: string, body: unknown = {}) => this.req('PATCH', url, body);

  /** Регистрация по ссылке инвайта с новым программным passkey. */
  async register(inviteUrl: string, name: string): Promise<SoftAuthenticator> {
    const token = inviteUrl.split('/invite/')[1]!;
    const opts = await this.post('/api/auth/register/options', { token, name });
    if (opts.statusCode !== 200) throw new Error(`register/options ${opts.statusCode}: ${opts.body}`);
    const authr = new SoftAuthenticator(config.rpId, ORIGIN);
    const verify = await this.post('/api/auth/register/verify', { response: authr.create(opts.json()) });
    if (verify.statusCode !== 200) throw new Error(`register/verify ${verify.statusCode}: ${verify.body}`);
    return authr;
  }

  async login(authr: SoftAuthenticator): Promise<LightMyRequestResponse> {
    const opts = await this.post('/api/auth/login/options');
    return this.post('/api/auth/login/verify', { response: authr.get(opts.json()) });
  }
}

/** Системный инвайт, как из консоли сервера. */
export function systemInvite(app: FastifyInstance): string {
  const { token } = app.store.createInvite(null, '', {}, 7);
  return `${ORIGIN}/invite/${token}`;
}
