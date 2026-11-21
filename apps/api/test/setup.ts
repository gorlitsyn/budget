import { afterEach, beforeEach, vi } from 'vitest';

// Тесты пишут траты в фиксированные месяцы, а версии плана зависят от текущей даты.
beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});
