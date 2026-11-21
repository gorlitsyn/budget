import type { Section } from '@money/shared';
import type { IconName } from './icons.ts';

export interface Tab {
  path: string;
  title: string;
  icon: IconName;
  /** Видна, если в текущем пространстве есть доступ хотя бы к одному из разделов. Пусто — всегда. */
  sections: Section[];
}

export const TABS: Tab[] = [
  { path: '/shopping', title: 'Покупки', icon: 'cart', sections: ['shopping'] },
  { path: '/transactions', title: 'Траты', icon: 'receipt', sections: ['transactions', 'incomes'] },
  { path: '/summary', title: 'Сводка', icon: 'chart', sections: ['summary'] },
  { path: '/plan', title: 'План', icon: 'target', sections: ['plan'] },
  { path: '/more', title: 'Ещё', icon: 'more', sections: [] },
];
