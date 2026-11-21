import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  /** Домен passkeys. После первой регистрации НЕ менять — все passkeys станут недействительны. */
  rpId: string;
  rpName: string;
  /** Полный origin фронта (https://budget.example.com). По нему же проверяется Origin запросов. */
  origin: string;
  sessionDays: number;
  inviteDays: number;
  /** Вход по имени без passkey. Только для локальной разработки, в production игнорируется. */
  devLogin: boolean;
  production: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

export function loadConfig(env = process.env): Config {
  const production = env.NODE_ENV === 'production';
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR ?? '/data'),
    rpId: required('RP_ID'),
    rpName: env.RP_NAME ?? 'Бюджет',
    origin: required('ORIGIN').replace(/\/$/, ''),
    sessionDays: Number(env.SESSION_DAYS ?? 90),
    inviteDays: Number(env.INVITE_DAYS ?? 7),
    devLogin: !production && env.DEV_LOGIN === '1',
    production,
  };
}
