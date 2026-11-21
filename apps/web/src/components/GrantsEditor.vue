<script setup lang="ts">
// Матрица прав: раздел × (нет / просмотр / правка). Цвет выбранного уровня виден сразу по всему списку.
import { type Grants, type Level, SECTIONS, SECTION_TITLES, type Section } from '@money/shared';

const model = defineModel<Grants>({ required: true });
const OPTIONS: { value: Level | null; title: string; tone: string }[] = [
  { value: null, title: 'Нет', tone: 'none' },
  { value: 'view', title: 'Смотреть', tone: 'view' },
  { value: 'edit', title: 'Править', tone: 'edit' },
];

function set(s: Section, v: Level | null) {
  const next = { ...model.value };
  if (v) next[s] = v;
  else delete next[s];
  model.value = next;
}
</script>

<template>
  <div class="group grants">
    <div v-for="s in SECTIONS" :key="s" class="row" :class="{ off: !model[s] }">
      <span class="grow">{{ SECTION_TITLES[s] }}</span>
      <div class="segmented" role="radiogroup" :aria-label="SECTION_TITLES[s]">
        <button
          v-for="o in OPTIONS"
          :key="o.title"
          type="button"
          role="radio"
          :aria-checked="(model[s] ?? null) === o.value"
          :class="[o.tone, { on: (model[s] ?? null) === o.value }]"
          @click="set(s, o.value)"
        >
          {{ o.title }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.segmented { width: 210px; flex: none; }
@media (max-width: 380px) { .segmented { width: 186px; } }
.off .grow { color: var(--label-2); }
.grants .segmented button.on.view { background: var(--blue); color: #fff; font-weight: 600; }
.grants .segmented button.on.edit { background: var(--green); color: #000; font-weight: 600; }
.grants .segmented button.on.none { color: var(--label-2); }
</style>
