/** Деньги в копейках, месяцы 'YYYY-MM', даты 'YYYY-MM-DD' — по местному календарю. */

const whole = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 123450 → «1 234,50 ₽», 100000 → «1 000 ₽»: копейки только когда они есть. */
export const money = (kop: number): string => `${(kop % 100 === 0 ? whole : cents).format(kop / 100)} ₽`;

/** «1 234,50», «1234.5», «1 234» → копейки; иначе null. */
export function parseAmount(s: string): number | null {
  const clean = s.replace(/[\s ₽]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const kop = Math.round(Number(clean) * 100);
  return kop > 0 ? kop : null;
}

/** Как parseAmount, но со знаком: «-30 000» → -3000000; ноль допустим. */
export function parseSignedAmount(s: string): number | null {
  const t = s.trim().replace(/^[−–]/, '-');
  const neg = t.startsWith('-');
  const clean = (neg ? t.slice(1) : t).replace(/[\s\u00a0₽]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const kop = Math.round(Number(clean) * 100);
  return neg ? -kop : kop;
}

/** Компактно для осей: 1 250 000 ₽ → «1,3 млн», 300 000 ₽ → «300 тыс». */
export function compactMoney(kop: number): string {
  const rub = kop / 100;
  const f = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
  if (Math.abs(rub) >= 1_000_000) return `${f(rub / 1_000_000)} млн`;
  if (Math.abs(rub) >= 1_000) return `${f(rub / 1_000)} тыс`;
  return f(rub);
}

/** «ноя» — короткое имя месяца для подписей оси. */
export function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
}

/** Копейки → строка для поля ввода: «1234,5». */
export const amountInput = (kop: number): string => (kop / 100).toString().replace('.', ',').replace('-', '−');

const pad = (n: number) => String(n).padStart(2, '0');

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const thisMonth = (): string => today().slice(0, 7);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** «Ноябрь 2026» (год опускается для текущего). */
export function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const name = new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long' });
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  return y === new Date().getFullYear() ? cap : `${cap} ${y}`;
}

/** «Сегодня», «Вчера», «19 ноября, чт». */
export function dayTitle(date: string): string {
  if (date === today()) return 'Сегодня';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (dt.toDateString() === yest.toDateString()) return 'Вчера';
  return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
}

/** Дата по умолчанию для новой записи в выбранном месяце: сегодня или последний день месяца. */
export function defaultDate(month: string): string {
  if (month === thisMonth()) return today();
  const [y, m] = month.split('-').map(Number) as [number, number];
  return month > thisMonth() ? `${month}-01` : `${month}-${pad(new Date(y, m, 0).getDate())}`;
}
