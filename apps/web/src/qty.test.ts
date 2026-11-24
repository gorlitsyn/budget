import { describe, expect, it } from 'vitest';
import { parseQty, pieces, searchKey, totalFor, unitFor } from './qty.ts';

describe('количество и цена за единицу', () => {
  it('число в начале и единица', () => {
    expect(parseQty('3')).toEqual({ n: 3, unit: '' });
    expect(parseQty('3 шт.')).toEqual({ n: 3, unit: 'шт.' });
    expect(parseQty('1,5 кг')).toEqual({ n: 1.5, unit: 'кг' });
    expect(parseQty('3 × 1 л')).toEqual({ n: 3, unit: 'шт.' });
    expect(parseQty('3х1л')).toEqual({ n: 3, unit: 'шт.' });
    expect(parseQty('3 бутылки')).toEqual({ n: 3, unit: '' });
    expect(parseQty('пачка')).toBeNull();
    expect(parseQty('0')).toBeNull();
    expect(parseQty('')).toBeNull();
  });

  it('сумма и цена за единицу в копейках', () => {
    expect(totalFor(3, 7300)).toBe(21900);
    expect(totalFor(1.5, 19990)).toBe(29985);
    expect(unitFor(3, 21900)).toBe(7300);
    expect(unitFor(3, 10000)).toBe(3333);
  });

  it('штуки для подсказки «по … ₽»', () => {
    expect(pieces('3')).toBe(3);
    expect(pieces('3 × 1 л')).toBe(3);
    expect(pieces('1')).toBeNull();
    expect(pieces('1,5 кг')).toBeNull();
    expect(pieces('500 г')).toBeNull();
  });

  it('поиск без учёта регистра и ё', () => {
    expect(searchKey(' Мёд ')).toBe('мед');
  });
});
