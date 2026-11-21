import { REVISION_HEADER } from '@money/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** JSON-запрос к своему API. Ошибка сервера приходит как { error } — она и становится message. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    // Ревизия: по её отсутствию сервер узнаёт застрявшую старую сборку (см. app.ts в api).
    headers: hasBody ? { 'content-type': 'application/json', [REVISION_HEADER]: __APP_REVISION__ } : { [REVISION_HEADER]: __APP_REVISION__ },
    // Fastify отвечает 400 на POST с content-type json и пустым телом — шлём {}.
    body: hasBody ? JSON.stringify(opts.body ?? {}) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Ошибка ${res.status}`);
  return data as T;
}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
