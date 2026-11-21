/** Настройки вида — только в этом браузере. localStorage может быть недоступен (приватный режим). */
import { ref, watch } from 'vue';

export type Theme = 'system' | 'dark' | 'light';
export const ACCENTS = ['red', 'blue', 'teal', 'indigo', 'green', 'purple', 'pink', 'orange'] as const;
export type Accent = (typeof ACCENTS)[number];

function read<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* без сохранения — не страшно */
  }
}

export const theme = ref<Theme>(read('theme', 'system', ['system', 'dark', 'light']));
export const accent = ref<Accent>(read('accent', 'red', ACCENTS));

export function applyPrefs(): void {
  const root = document.documentElement;
  const apply = () => {
    if (theme.value === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme.value;
    root.dataset.accent = accent.value;
  };
  apply();
  watch(theme, (v) => (write('theme', v), apply()));
  watch(accent, (v) => (write('accent', v), apply()));
}

export function readSpace(): string | null {
  try {
    return localStorage.getItem('space');
  } catch {
    return null;
  }
}
export const writeSpace = (id: string) => write('space', id);
