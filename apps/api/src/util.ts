import crypto from 'node:crypto';

export const newId = (bytes = 12): string => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('base64url');
export const DAY = 24 * 60 * 60 * 1000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Ключ для сравнения названий: регистр и «ё» не важны. Только в JS: lower() в SQLite не знает кириллицу. */
export const nameKey = (name: string) => name.trim().toLowerCase().replaceAll('ё', 'е');
