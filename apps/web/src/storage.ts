/** localStorage с защитой: в приватном режиме или при переполнении он бросает исключения. */
export function load<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
export function save(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* без кэша приложение работает, просто без офлайна */
  }
}
/** Стереть кэши данных при выходе: на общем устройстве чужие покупки не должны оставаться. */
export function clearDataCaches(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('shop')) localStorage.removeItem(k);
  } catch {
    /* нечего чистить */
  }
}

export function clientId(): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...b)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
