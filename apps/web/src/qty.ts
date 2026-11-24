/**
 * Количество позиции — свободный текст («3», «3 шт.», «1,5 кг», «3 × 1 л»). Если в начале стоит число,
 * цену можно ввести за единицу: сумма = число × цена. Хранится только сумма.
 */
export interface QtyCount {
  n: number;
  /** Единица для подписи «за 1 …»: «шт.», «кг», «л»; пусто, если по тексту не понять. */
  unit: string;
}

export function parseQty(qty: string): QtyCount | null {
  const m = qty.trim().match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  if (!(n > 0)) return null;
  const rest = m[2]!.trim();
  // «3 × 1 л» — три штуки по литру.
  const unit = /^[×xх*]/i.test(rest) ? 'шт.' : /^[a-zа-яё.]{1,6}$/i.test(rest) ? rest : '';
  return { n, unit };
}

export const totalFor = (n: number, unitKop: number): number => Math.round(n * unitKop);
export const unitFor = (n: number, totalKop: number): number => Math.round(totalKop / n);

/** Целое число штук от 2 до 99 — тогда под суммой есть смысл показать «по 73 ₽». «500 г» — не штуки. */
export function pieces(qty: string): number | null {
  const c = parseQty(qty);
  return c && Number.isInteger(c.n) && c.n >= 2 && c.n <= 99 ? c.n : null;
}

/** Ключ для поиска: регистр и «ё» не важны. */
export const searchKey = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').trim();
