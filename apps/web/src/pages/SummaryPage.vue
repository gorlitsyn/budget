<script setup lang="ts">
import type { Summary } from '@money/shared';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, errorText } from '../api.ts';
import HistoryChart from '../components/HistoryChart.vue';
import Icon from '../components/Icon.vue';
import MonthNav from '../components/MonthNav.vue';
import PageHead from '../components/PageHead.vue';
import Sheet from '../components/Sheet.vue';
import { amountInput, money, monthTitle, parseSignedAmount, thisMonth } from '../money.ts';
import { useDicts } from '../stores/dicts.ts';
import { useSession } from '../stores/session.ts';

const session = useSession();
const dicts = useDicts();
const owner = computed(() => session.spaceId ?? '');
const canEdit = computed(() => session.can('summary', 'edit'));

const month = ref(thisMonth());
const s = ref<Summary | null>(null);
const error = ref('');

async function load() {
  error.value = '';
  try {
    const [, data] = await Promise.all([dicts.load(owner.value), api<Summary>(`/api/spaces/${owner.value}/summary?month=${month.value}`)]);
    s.value = data;
  } catch (e) {
    error.value = errorText(e);
  }
}
watch(month, load);
const onVisible = () => document.visibilityState === 'visible' && void load();
onMounted(() => {
  void load();
  document.addEventListener('visibilitychange', onVisible);
});
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible));

/** Нет доступа к «Поступлениям» — сервер не отдаёт доходы и остатки, показываем только расходы. */
const hasIncome = computed(() => s.value?.income !== null && s.value?.income !== undefined);
const carryOut = computed(() =>
  s.value && s.value.income !== null && s.value.carryIn !== null ? s.value.carryIn + s.value.income - s.value.expense : null,
);
const signed = (v: number | null) => (v === null ? '—' : money(v).replace(/^-/, '−'));

// ---- план-факт: полоса = доля плана; ≥90 % — внимание, >100 % — перерасход (цвет + слово + значок) ----

type Level = 'ok' | 'warn' | 'over' | 'none';
const level = (fact: number, plan: number): Level => (!plan ? 'none' : fact > plan ? 'over' : fact >= plan * 0.9 ? 'warn' : 'ok');
const planTotal = computed(() => s.value?.plan.reduce((a, p) => a + p.amount, 0) ?? 0);
const factTotal = computed(() => s.value?.plan.reduce((a, p) => a + p.fact, 0) ?? 0);

// Статья с суммами по подкатегориям разворачивается в строки план-факт.
const openPlan = ref<Set<string>>(new Set());
function togglePlan(id: string) {
  const next = new Set(openPlan.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  openPlan.value = next;
}
/** «Футбол» или «Школа/Сад · без подкатегории» для трат прямо в категории с подкатегориями. */
function partName(id: string): string {
  const c = dicts.byId.get(id);
  if (!c) return '—';
  if (c.parentId) return c.name;
  return dicts.categories.some((x) => x.parentId === id) ? `${c.name} · без подкатегории` : c.name;
}

// ---- траты по категориям: подкатегории сворачиваются в родителя, но видны под ним ----------------

const categories = computed(() => {
  if (!s.value) return [];
  const top = new Map<string, { id: string; name: string; amount: number; children: { name: string; amount: number }[] }>();
  for (const { categoryId, amount } of s.value.byCategory) {
    const c = dicts.byId.get(categoryId);
    const parentId = c?.parentId ?? categoryId;
    const parent = dicts.byId.get(parentId);
    const row = top.get(parentId) ?? { id: parentId, name: parent?.name ?? '—', amount: 0, children: [] };
    row.amount += amount;
    if (c?.parentId) row.children.push({ name: c.name, amount });
    top.set(parentId, row);
  }
  return [...top.values()].sort((a, b) => b.amount - a.amount);
});
const maxCat = computed(() => Math.max(1, ...categories.value.map((c) => c.amount)));
const share = (v: number) => {
  if (!s.value?.expense) return '0%';
  const p = (v / s.value.expense) * 100;
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
};

// ---- начальный остаток -----------------------------------------------------------------------

const openingOpen = ref(false);
const oAmount = ref('');
const oMonth = ref('');
function editOpening() {
  if (!canEdit.value || !s.value) return;
  oAmount.value = s.value.opening ? amountInput(s.value.opening.amount) : '';
  oMonth.value = s.value.opening?.month ?? month.value;
  openingOpen.value = true;
}
const oValid = computed(() => parseSignedAmount(oAmount.value) !== null && /^\d{4}-\d{2}$/.test(oMonth.value));
async function saveOpening() {
  try {
    await api(`/api/spaces/${owner.value}/summary/opening`, { method: 'PUT', body: { amount: parseSignedAmount(oAmount.value), month: oMonth.value } });
    openingOpen.value = false;
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
async function clearOpening() {
  if (!confirm('Убрать начальный остаток? Остаток будет считаться с самых первых записей.')) return;
  await api(`/api/spaces/${owner.value}/summary/opening`, { method: 'DELETE' });
  openingOpen.value = false;
  await load();
}
</script>

<template>
  <main class="page">
    <PageHead title="Сводка" switcher />
    <MonthNav v-model="month" />
    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="s">
      <!-- итоги месяца -->
      <div class="tiles" :class="{ single: !hasIncome }">
        <template v-if="hasIncome">
          <button class="tile" :class="{ editable: canEdit }" :disabled="!canEdit" @click="editOpening">
            <span class="label">На начало</span>
            <strong>{{ signed(s.carryIn) }}</strong>
          </button>
          <div class="tile">
            <span class="label">Остаток</span>
            <strong :class="{ minus: carryOut !== null && carryOut < 0 }">{{ signed(carryOut) }}</strong>
          </div>
          <div class="tile">
            <span class="label">Поступления</span>
            <strong>{{ money(s.income ?? 0) }}</strong>
          </div>
        </template>
        <div class="tile">
          <span class="label">Расходы</span>
          <strong>{{ money(s.expense) }}</strong>
        </div>
      </div>
      <p v-if="hasIncome && s.carryIn === null" class="section-foot">
        Начальный остаток задан с {{ monthTitle(s.opening!.month).toLowerCase() }} — для более ранних месяцев остаток не считается.
      </p>
      <p v-else-if="hasIncome && !s.opening && canEdit" class="section-foot">
        «На начало» — сумма всех поступлений минус траты до этого месяца. Нажмите, чтобы задать начальный остаток.
      </p>

      <!-- план-факт -->
      <template v-if="s.plan.length">
        <p class="section-title">План и факт</p>
        <div class="group">
          <div v-for="p in s.plan" :key="p.id" class="meter">
            <component
              :is="p.parts.length ? 'button' : 'div'"
              class="meter-head"
              :class="{ tap: p.parts.length }"
              :aria-expanded="p.parts.length ? openPlan.has(p.id) : undefined"
              @click="p.parts.length && togglePlan(p.id)"
            >
              <span class="grow">
                {{ p.name }}
                <Icon v-if="p.parts.length" name="chevron" :size="15" class="chev" :class="{ open: openPlan.has(p.id) }" />
              </span>
              <span class="fig">{{ money(p.fact) }}<span v-if="p.amount" class="of"> из {{ money(p.amount) }}</span></span>
            </component>
            <div v-if="p.amount" class="track" :class="level(p.fact, p.amount)">
              <div class="fill" :style="{ width: `${Math.min(100, (p.fact / p.amount) * 100)}%` }" />
            </div>
            <div v-if="p.amount" class="meter-foot" :class="level(p.fact, p.amount)">
              <template v-if="p.fact > p.amount"><Icon name="alert" :size="12" /> перерасход {{ money(p.fact - p.amount) }}</template>
              <template v-else>осталось {{ money(p.amount - p.fact) }}</template>
            </div>
            <div v-if="openPlan.has(p.id)" class="parts">
              <div v-for="x in p.parts" :key="x.categoryId" class="part">
                <div class="meter-head">
                  <span class="grow">{{ partName(x.categoryId) }}</span>
                  <Icon v-if="x.amount && x.fact > x.amount" name="alert" :size="11" class="over-ic" />
                  <span class="fig">{{ money(x.fact) }}<span class="of">{{ x.amount ? ` из ${money(x.amount)}` : '' }}</span></span>
                </div>
                <div v-if="x.amount" class="track thin" :class="level(x.fact, x.amount)">
                  <div class="fill" :style="{ width: `${Math.min(100, (x.fact / x.amount) * 100)}%` }" />
                </div>
              </div>
            </div>
          </div>
          <div class="row total-row">
            <strong class="grow">Итого по плану</strong>
            <strong class="fig">{{ money(factTotal) }} <span class="of">из {{ money(planTotal) }}</span></strong>
          </div>
          <div class="row">
            <span class="grow">Вне плана</span>
            <span class="fig">{{ money(s.unplanned) }}</span>
          </div>
        </div>
      </template>

      <!-- по категориям -->
      <p class="section-title">Траты по категориям</p>
      <div v-if="categories.length" class="group">
        <div v-for="c in categories" :key="c.id" class="cat">
          <div class="meter-head">
            <span class="grow">{{ c.name }}</span>
            <span class="share">{{ share(c.amount) }}</span>
            <span class="fig">{{ money(c.amount) }}</span>
          </div>
          <div class="bar"><div :style="{ width: `${(c.amount / maxCat) * 100}%` }" /></div>
          <div v-for="ch in c.children" :key="ch.name" class="child">
            <span class="grow">{{ ch.name }}</span>
            <span class="fig">{{ money(ch.amount) }}</span>
          </div>
        </div>
      </div>
      <p v-else class="section-foot">В этом месяце трат нет.</p>

      <!-- динамика -->
      <p class="section-title">Последние полгода</p>
      <div class="group">
        <HistoryChart :history="s.history" :current="month" />
      </div>
    </template>

    <Sheet v-if="openingOpen" title="Начальный остаток" @close="openingOpen = false">
      <template #action>
        <button class="done" :disabled="!oValid" @click="saveOpening">Готово</button>
      </template>
      <div class="group">
        <label class="row">
          <span>Сумма, ₽</span>
          <input v-model="oAmount" class="input grow" inputmode="text" placeholder="−30 000" />
        </label>
        <label class="row">
          <span>На начало месяца</span>
          <input v-model="oMonth" type="month" class="input grow" />
        </label>
      </div>
      <p class="section-foot">
        Сколько денег было (или не хватало — со знаком минус) к началу этого месяца. Дальше остаток переносится
        из месяца в месяц сам: поступления минус траты.
      </p>
      <button v-if="s?.opening" class="btn plain block danger" @click="clearOpening">Убрать начальный остаток</button>
    </Sheet>
  </main>
</template>

<style scoped>
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tiles.single { grid-template-columns: 1fr; }
.tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--surface);
  border: 0;
  border-radius: var(--r-card);
  text-align: left;
  color: inherit;
}
.tile:disabled { opacity: 1; }
.tile.editable .label::after { content: ' ✎'; color: var(--acc); }
.tile .label { color: var(--label-2); font-size: var(--fs-footnote); }
.tile strong { font-size: var(--fs-body); font-variant-numeric: tabular-nums; white-space: nowrap; }
.minus { color: var(--red); }

.meter, .cat { padding: 9px 14px; position: relative; }
.meter + .meter::before, .cat + .cat::before, .group > .row::before {
  content: '';
  position: absolute;
  top: 0;
  left: 14px;
  right: 0;
  border-top: 0.5px solid var(--sep);
}
.meter-head { display: flex; align-items: baseline; gap: 8px; }
.meter-head .grow, .child .grow { flex: 1; min-width: 0; }
button.meter-head { width: 100%; background: none; border: 0; padding: 0; text-align: left; }
.chev { display: inline-block; vertical-align: -3px; margin-left: 1px; color: var(--label-2); transition: transform var(--fast); }
.chev.open { transform: rotate(90deg); }
.parts { margin-top: 8px; padding-left: 10px; border-left: 2px solid var(--fill); display: grid; gap: 7px; font-size: var(--fs-subhead); }
.track.thin { height: 3px; margin-top: 3px; }
.over-ic { color: var(--red); align-self: center; }
.fig { font-variant-numeric: tabular-nums; white-space: nowrap; }
.of { color: var(--label-2); font-size: var(--fs-footnote); font-weight: 400; }
.share { color: var(--label-2); font-size: var(--fs-footnote); font-variant-numeric: tabular-nums; }

/* Метр: заливка несёт состояние, дорожка — светлый шаг того же цвета. */
.track { --fill: #3987e5; height: 6px; border-radius: 3px; margin-top: 6px; background: color-mix(in srgb, var(--fill) 20%, transparent); overflow: hidden; }
.track.warn { --fill: #fab219; }
.track.over { --fill: #d03b3b; }
.fill { height: 100%; border-radius: 3px; background: var(--fill); }
.meter-foot { margin-top: 4px; font-size: var(--fs-footnote); color: var(--label-2); display: flex; align-items: center; gap: 4px; }
.meter-foot.over { color: var(--red); }

/* Категории — величина, один цвет. */
.bar { height: 4px; border-radius: 2px; margin-top: 5px; background: var(--fill); }
.bar > div { height: 100%; border-radius: 2px; background: #3987e5; }
.child { display: flex; gap: 8px; padding: 4px 0 0 12px; font-size: var(--fs-footnote); color: var(--label-2); }

.total-row .fig { font-weight: 600; }
.done { background: none; border: 0; color: var(--acc); font-weight: 600; padding: 0; }
.done:disabled { color: var(--label-3); }
.danger { color: var(--red); }
</style>
