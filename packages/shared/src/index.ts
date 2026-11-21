import { z } from 'zod';

/**
 * Разделы пространства пользователя. Доступ другим выдаётся по каждому отдельно.
 * Порядок — как в таб-баре и в форме инвайта.
 */
export const SECTIONS = ['shopping', 'transactions', 'incomes', 'summary', 'plan'] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_TITLES: Record<Section, string> = {
  shopping: 'Покупки',
  transactions: 'Траты',
  incomes: 'Поступления',
  summary: 'Сводка',
  plan: 'План',
};

/** none не хранится: нет строки в grants = нет доступа. */
export const LEVELS = ['view', 'edit'] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_TITLES: Record<Level, string> = { view: 'Просмотр', edit: 'Редактирование' };

export const sectionSchema = z.enum(SECTIONS);
export const levelSchema = z.enum(LEVELS);

/** Права одного человека в чужом пространстве: раздел → уровень. Отсутствующий раздел = нет доступа. */
export const grantsSchema = z.partialRecord(sectionSchema, levelSchema);
export type Grants = z.infer<typeof grantsSchema>;

export const nameSchema = z.string().trim().min(1).max(40);

export const createInviteSchema = z.object({
  /** Подпись для себя: «Жена», «Мама». Видна только автору инвайта. */
  note: z.string().trim().max(60).default(''),
  grants: grantsSchema,
});
export type CreateInvite = z.infer<typeof createInviteSchema>;

export const updateGrantsSchema = z.object({ grants: grantsSchema });

export interface Me {
  id: string;
  name: string;
  admin: boolean;
}

/** Чужое пространство, к которому у меня есть доступ. */
export interface SharedSpace {
  ownerId: string;
  ownerName: string;
  grants: Grants;
}

/** Человек, которому я дал доступ к своему пространству. */
export interface Member {
  userId: string;
  name: string;
  grants: Grants;
  since: number;
}

export interface InviteInfo {
  id: string;
  note: string;
  grants: Grants;
  createdAt: number;
  expiresAt: number;
  usedBy: string | null;
  usedByName: string | null;
}

/** То, что видит получатель ссылки до входа. */
export interface InvitePreview {
  ownerName: string | null;
  grants: Grants;
  /** Инвайт создан из консоли сервера: только регистрация, без доступа к чужому пространству. */
  system: boolean;
}

export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export function canView(grants: Grants, s: Section): boolean {
  return grants[s] === 'view' || grants[s] === 'edit';
}
export function canEdit(grants: Grants, s: Section): boolean {
  return grants[s] === 'edit';
}

/** Полный доступ — так владелец видит своё пространство. */
export const OWNER_GRANTS: Grants = Object.fromEntries(SECTIONS.map((s) => [s, 'edit'])) as Grants;

// ---- покупки ----------------------------------------------------------------------------------

/** id создаёт клиент: так запись идемпотентна и переживает повтор из офлайн-очереди. */
export const clientIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,32}$/);

export const shoppingListSchema = z.object({ name: z.string().trim().min(1).max(40) });

export const shoppingItemSchema = z.object({
  listId: clientIdSchema,
  name: z.string().trim().min(1).max(120),
  qty: z.string().trim().max(30).default(''),
  checked: z.boolean().default(false),
  /**
   * Стоимость позиции, копейки. null — убрать цену; не передана — оставить как есть: старые сборки
   * и офлайн-очереди телефонов шлют позицию без цены и не должны её стирать.
   */
  price: z.number().int().positive().max(100_000_000_00).nullable().optional(),
});
export type ShoppingItemInput = z.input<typeof shoppingItemSchema>;

export interface ShoppingList {
  id: string;
  name: string;
  createdAt: number;
}

export interface ShoppingItem {
  id: string;
  listId: string;
  name: string;
  qty: string;
  checked: boolean;
  price: number | null;
  addedBy: string;
  checkedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ShoppingState {
  lists: ShoppingList[];
  items: ShoppingItem[];
  /** id → имя для подписей «добавила Аня». Только владелец и его участники. */
  people: Record<string, string>;
}

/** События живых обновлений (SSE). */
export type ShoppingEvent =
  | { type: 'item'; item: ShoppingItem }
  | { type: 'item-deleted'; id: string; listId: string }
  | { type: 'list'; list: ShoppingList }
  | { type: 'list-deleted'; id: string }
  /** Раз в 20 с: клиент по нему понимает, что соединение живое (полуоткрытое молчит). */
  | { type: 'ping' };

export const SSE_PING_MS = 20_000;
/** Тишина дольше этого — соединение считается мёртвым, клиент переподключается. */
export const SSE_DEAD_MS = 50_000;

// ---- траты, поступления, план -----------------------------------------------------------------

/** Деньги — целые копейки: 1 234,50 ₽ = 123450. */
export const amountSchema = z.number().int().positive().max(100_000_000_00);
/** Дата операции по календарю пользователя, без времени. */
export const dateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const commentSchema = z.string().trim().max(200).default('');

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(40),
  /** Один уровень: подкатегория не может иметь своих подкатегорий. */
  parentId: clientIdSchema.nullable().default(null),
});
export const incomeKindSchema = z.object({ name: z.string().trim().min(1).max(40) });

export const transactionSchema = z.object({
  date: dateSchema,
  amount: amountSchema,
  categoryId: clientIdSchema,
  comment: commentSchema,
});
export const incomeSchema = z.object({
  date: dateSchema,
  amount: amountSchema,
  kindId: clientIdSchema,
  comment: commentSchema,
});
/** Подкатегория в плане. Сумма 0 — входит в общую сумму статьи, отдельно не расписана. */
export const planPartSchema = z.object({
  categoryId: clientIdSchema,
  amount: z.number().int().min(0).max(100_000_000_00),
});
export type PlanPart = z.infer<typeof planPartSchema>;

/** Статья плана — ровно одна категория верхнего уровня; название берётся из неё. */
export const planItemSchema = z.object({
  categoryId: clientIdSchema,
  /** В месяц, копейки. Для категории с заполненными подкатегориями игнорируется. */
  amount: z.number().int().min(0).max(100_000_000_00),
  /**
   * Подкатегории, которые входят в план; остальные считаются «вне плана». Если хоть у одной есть сумма,
   * сумма статьи = их сумма. [] — статья на всю категорию; не передано — оставить как есть.
   */
  parts: z.array(planPartSchema).max(100).optional(),
});

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  /** Удалённая категория остаётся для старых трат, но не предлагается при вводе. */
  archived: boolean;
}
export interface IncomeKind {
  id: string;
  name: string;
  archived: boolean;
}
export interface Transaction {
  id: string;
  date: string;
  amount: number;
  categoryId: string;
  comment: string;
  createdBy: string;
  updatedAt: number;
}
export interface Income {
  id: string;
  date: string;
  amount: number;
  kindId: string;
  comment: string;
  createdBy: string;
  updatedAt: number;
}
export interface PlanItem {
  id: string;
  name: string;
  amount: number;
  categoryId: string;
  parts: PlanPart[];
}

export interface Dictionaries {
  categories: Category[];
  incomeKinds: IncomeKind[];
  people: Record<string, string>;
}

export const DEFAULT_CATEGORIES = ['Продукты', 'Бытовые', 'Авто', 'Коммуналка', 'Связь/Интернет'];
export const DEFAULT_INCOME_KINDS = ['Зарплата', 'Аванс', 'Кэшбек', 'Прочее'];

// ---- версия приложения ------------------------------------------------------------------------

/** Заголовок, которым фронт сообщает свою ревизию. Нет его в /api/me — клиент из старой сборки. */
export const REVISION_HEADER = 'x-app-revision';

// ---- сводка -----------------------------------------------------------------------------------

/** Начальный остаток: деньги на начало месяца month, до учёта в приложении. Может быть отрицательным. */
export const openingSchema = z.object({
  amount: z.number().int().min(-100_000_000_00).max(100_000_000_00),
  month: monthSchema,
});
export type Opening = z.infer<typeof openingSchema>;

export interface PlanFact {
  id: string;
  name: string;
  /** План в месяц, копейки. */
  amount: number;
  /** Траты месяца по статье: выбранные подкатегории, а если они не выбраны — вся категория. */
  fact: number;
  /**
   * Подкатегории статьи, если в план входят не все: сумма fact по строкам = fact статьи.
   * amount: 0 — подкатегория входит в общую сумму статьи.
   */
  parts: { categoryId: string; amount: number; fact: number }[];
}

/**
 * Сводка месяца — только итоги, без отдельных трат: её видит и тот, кому «Траты» не открыты.
 */
export interface Summary {
  month: string;
  /** null — у смотрящего нет доступа к «Поступлениям»: тогда скрыты и всё, из чего их можно вычислить. */
  income: number | null;
  expense: number;
  /** Остаток на начало месяца; null — месяц раньше начального остатка или нет доступа к «Поступлениям». */
  carryIn: number | null;
  opening: Opening | null;
  /** Траты месяца по категориям (как записаны: категория или подкатегория). */
  byCategory: { categoryId: string; amount: number }[];
  plan: PlanFact[];
  /** Траты, которые не входят ни в одну статью плана. */
  unplanned: number;
  /** Последние 6 месяцев по выбранный включительно, от старого к новому. */
  history: { month: string; income: number | null; expense: number }[];
}
