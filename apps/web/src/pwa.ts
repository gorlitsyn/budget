/**
 * Обновление установленного приложения. iOS держит PWA в памяти и почти не перезагружает её —
 * без этого новая версия ставилась в фоне, а на экране неделями оставалась старая.
 * Проверяем обновление при каждом возврате на экран и раз в 30 минут; новая версия взяла
 * управление — перезагружаемся, но не посреди ввода (очередь изменений в localStorage переживёт).
 */
import { registerSW } from 'virtual:pwa-register';

const CHECK_MS = 30 * 60 * 1000;

const typing = () => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
};

export function setupPwa(): void {
  if (!('serviceWorker' in navigator)) return;
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine) void reg.update().catch(() => {});
      };
      setInterval(check, CHECK_MS);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
    },
    onNeedReload() {
      if (document.visibilityState === 'hidden' || !typing()) location.reload();
      else document.addEventListener('visibilitychange', () => location.reload(), { once: true });
    },
  });
}

/**
 * Принудительное обновление: снять service worker, стереть его кэш и перезагрузиться из сети.
 * Данные (очередь покупок, настройки) в localStorage не трогаются, сессия — тоже.
 */
export async function forceUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    }
    if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
  } finally {
    location.reload();
  }
}

/** Ревизия, которая сейчас на сервере (null — сервер недоступен). */
export async function serverRevision(): Promise<string | null> {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    return ((await r.json()) as { revision?: string }).revision ?? null;
  } catch {
    return null;
  }
}
