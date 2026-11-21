/** Справочники пространства: категории, виды поступлений, имена людей. */
import type { Category, Dictionaries } from '@money/shared';
import { defineStore } from 'pinia';
import { api } from '../api.ts';

export const useDicts = defineStore('dicts', {
  state: () => ({ ownerId: '', categories: [] as Category[], incomeKinds: [] as Dictionaries['incomeKinds'], people: {} as Record<string, string> }),
  getters: {
    byId: (s) => new Map(s.categories.map((c) => [c.id, c])),
    kindById: (s) => new Map(s.incomeKinds.map((k) => [k.id, k])),
    /** Живые категории верхнего уровня с их живыми подкатегориями — для выбора при вводе. */
    tree: (s) =>
      s.categories
        .filter((c) => !c.parentId && !c.archived)
        .map((c) => ({ ...c, children: s.categories.filter((x) => x.parentId === c.id && !x.archived) })),
  },
  actions: {
    async load(ownerId: string) {
      const d = await api<Dictionaries>(`/api/spaces/${ownerId}/dictionaries`);
      this.ownerId = ownerId;
      this.categories = d.categories;
      this.incomeKinds = d.incomeKinds;
      this.people = d.people;
    },
    /** «Авто · Бензин». */
    categoryName(id: string): string {
      const c = this.byId.get(id);
      if (!c) return '—';
      const parent = c.parentId ? this.byId.get(c.parentId) : undefined;
      return parent ? `${parent.name} · ${c.name}` : c.name;
    },
  },
});
