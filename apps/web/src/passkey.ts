import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from './api.ts';

export const passkeysSupported = browserSupportsWebAuthn;

/** Отмена системного окна passkey — не ошибка, её не показываем. */
export function isCancel(e: unknown): boolean {
  return e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError');
}

export async function loginWithPasskey(): Promise<void> {
  const optionsJSON = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/auth/login/options', { method: 'POST' });
  const response = await startAuthentication({ optionsJSON });
  await api('/api/auth/login/verify', { body: { response } });
}

export async function registerWithPasskey(token: string, name: string): Promise<void> {
  const optionsJSON = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/auth/register/options', { body: { token, name } });
  const response = await startRegistration({ optionsJSON });
  await api('/api/auth/register/verify', { body: { response } });
}

export async function addPasskey(): Promise<void> {
  const optionsJSON = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/auth/passkeys/options', { method: 'POST' });
  const response = await startRegistration({ optionsJSON });
  await api('/api/auth/passkeys/verify', { body: { response } });
}
