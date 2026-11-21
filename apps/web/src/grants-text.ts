import { type Grants, LEVEL_TITLES, SECTIONS, SECTION_TITLES } from '@money/shared';

/** «Покупки — правка, Сводка — просмотр». */
export function grantsText(g: Grants): string {
  const parts = SECTIONS.filter((s) => g[s]).map((s) => `${SECTION_TITLES[s]} — ${LEVEL_TITLES[g[s]!].toLowerCase()}`);
  return parts.length ? parts.join(', ') : 'без доступа к разделам';
}

export const dateText = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
