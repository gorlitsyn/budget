<script setup lang="ts">
/**
 * Поступления и расходы по месяцам — сгруппированные столбики на одной оси.
 * Цвета — категориальные слоты 1–2 (синий, оранжевый), проверены валидатором dataviz в обеих темах.
 * Легенда при двух сериях, значения — в подсказке по нажатию и в таблице под графиком.
 * Без доступа к поступлениям (income = null) остаётся одна серия — расходы.
 */
import { computed, ref } from 'vue';
import { compactMoney, money, monthShort, monthTitle } from '../money.ts';

const props = defineProps<{ history: { month: string; income: number | null; expense: number }[]; current: string }>();
const withIncome = computed(() => props.history.some((h) => h.income !== null));

const W = 340;
const H = 140;
const PAD_L = 44; // место под подписи оси
const PAD_B = 18;
const PAD_T = 6;
const BAR = 9;
const GAP = 2; // зазор цвета фона между соседними столбиками

const max = computed(() => {
  const m = Math.max(1, ...props.history.flatMap((h) => [h.income ?? 0, h.expense]));
  // Круглый верх шкалы (×10^n), достаточно частый, чтобы график не был наполовину пустым.
  const p = 10 ** Math.floor(Math.log10(m));
  return ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((k) => k * p >= m) ?? 10) * p;
});
const plotW = W - PAD_L;
const plotH = H - PAD_B - PAD_T;
const slot = computed(() => plotW / props.history.length);
const y = (v: number) => PAD_T + plotH - (v / max.value) * plotH;
const ticks = computed(() => [0, max.value / 2, max.value]);

/** Столбик со скруглённым на 4 px верхом и прямым низом на базовой линии. */
function bar(x: number, v: number): string {
  if (v <= 0) return '';
  const top = y(v);
  const base = PAD_T + plotH;
  const r = Math.min(4, (base - top) / 2, BAR / 2);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + BAR - r}Q${x + BAR},${top} ${x + BAR},${top + r}V${base}Z`;
}

// Без «повторное нажатие — скрыть»: перед click всегда приходит mouseenter (и на iPhone тоже),
// и переключатель тут же гасил подсказку.
const active = ref<number | null>(null);
const tip = computed(() => (active.value === null ? null : props.history[active.value]!));
</script>

<template>
  <div class="viz">
    <div v-if="withIncome" class="legend" aria-hidden="true">
      <span><i class="sw income" />Поступления</span>
      <span><i class="sw expense" />Расходы</span>
    </div>
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      :aria-label="withIncome ? 'Поступления и расходы по месяцам' : 'Расходы по месяцам'"
      @mouseleave="active = null"
    >
      <g class="grid">
        <template v-for="t in ticks" :key="t">
          <line :x1="PAD_L" :x2="W" :y1="y(t)" :y2="y(t)" />
          <text :x="PAD_L - 6" :y="y(t) + 3" text-anchor="end">{{ t ? compactMoney(t) : '0' }}</text>
        </template>
      </g>
      <g v-for="(h, i) in history" :key="h.month">
        <path v-if="withIncome" class="income" :d="bar(PAD_L + i * slot + slot / 2 - BAR - GAP / 2, h.income ?? 0)" :opacity="active === null || active === i ? 1 : 0.35" />
        <path class="expense" :d="bar(PAD_L + i * slot + slot / 2 + (withIncome ? GAP / 2 : -BAR / 2), h.expense)" :opacity="active === null || active === i ? 1 : 0.35" />
        <text class="m" :class="{ cur: h.month === current }" :x="PAD_L + i * slot + slot / 2" :y="H - 4" text-anchor="middle">
          {{ monthShort(h.month) }}
        </text>
        <!-- область нажатия — вся колонка месяца, больше самих столбиков -->
        <rect
          class="hit"
          :x="PAD_L + i * slot"
          :y="0"
          :width="slot"
          :height="H"
          @mouseenter="active = i"
          @click="active = i"
        />
      </g>
    </svg>
    <p v-if="tip" class="tip">
      <strong>{{ monthTitle(tip.month) }}</strong>
      <span v-if="withIncome"><i class="sw income" />{{ money(tip.income ?? 0) }}</span>
      <span><i class="sw expense" />{{ money(tip.expense) }}</span>
    </p>
    <details class="table">
      <summary>Таблица</summary>
      <table>
        <thead>
          <tr><th>Месяц</th><th v-if="withIncome">Поступления</th><th>Расходы</th></tr>
        </thead>
        <tbody>
          <tr v-for="h in history" :key="h.month">
            <td>{{ monthTitle(h.month) }}</td>
            <td v-if="withIncome">{{ money(h.income ?? 0) }}</td>
            <td>{{ money(h.expense) }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </div>
</template>

<style scoped>
/* Тёмная тема — по умолчанию приложения; светлая — по системе или вручную. */
.viz { --series-income: #3987e5; --series-expense: #d95926; padding: 10px 12px 8px; }
@media (prefers-color-scheme: light) {
  :root:where(:not([data-theme='dark'])) .viz { --series-income: #2a78d6; --series-expense: #eb6834; }
}
:root[data-theme='light'] .viz { --series-income: #2a78d6; --series-expense: #eb6834; }

svg { display: block; width: 100%; height: auto; overflow: visible; }
.income { fill: var(--series-income); }
.expense { fill: var(--series-expense); }
.grid line { stroke: var(--sep); stroke-width: 0.5; }
.grid text, .m { fill: var(--label-2); font-size: 9px; }
.m.cur { fill: var(--label); font-weight: 600; }
.hit { fill: transparent; cursor: pointer; }
.legend { display: flex; gap: 14px; font-size: var(--fs-footnote); color: var(--label-2); margin-bottom: 6px; }
.legend span, .tip span { display: inline-flex; align-items: center; gap: 5px; }
.sw { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
.sw.income { background: var(--series-income); }
.sw.expense { background: var(--series-expense); }
.tip { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 6px 0 0; font-size: var(--fs-footnote); font-variant-numeric: tabular-nums; }
.table { margin-top: 6px; font-size: var(--fs-footnote); color: var(--label-2); }
.table summary { cursor: pointer; }
table { width: 100%; border-collapse: collapse; margin-top: 4px; font-variant-numeric: tabular-nums; color: var(--label); }
th { text-align: right; font-weight: 500; color: var(--label-2); padding: 2px 0; }
td { text-align: right; padding: 2px 0; }
th:first-child, td:first-child { text-align: left; }
</style>
