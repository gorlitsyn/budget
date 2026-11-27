<script setup lang="ts">
import type { Income, IncomeKind, Transaction } from '@money/shared';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, errorText } from '../api.ts';
import EntrySheet from '../components/EntrySheet.vue';
import Icon from '../components/Icon.vue';
import MonthNav from '../components/MonthNav.vue';
import PageHead from '../components/PageHead.vue';
import Sheet from '../components/Sheet.vue';
import { dayTitle, money, thisMonth } from '../money.ts';
import { useDicts } from '../stores/dicts.ts';
import { useSession } from '../stores/session.ts';
import { clientId } from '../storage.ts';

type Mode = 'tx' | 'income';
const session = useSession();
const dicts = useDicts();
const owner = computed(() => session.spaceId ?? '');
const canTx = computed(() => session.can('transactions'));
const canIncome = computed(() => session.can('incomes'));
const editTx = computed(() => session.can('transactions', 'edit'));
const editIncome = computed(() => session.can('incomes', 'edit'));

const month = ref(thisMonth());
const mode = ref<Mode>(canTx.value ? 'tx' : 'income');
const txs = ref<Transaction[]>([]);
const incomes = ref<Income[]>([]);
const loaded = ref(false);
const error = ref('');
const sheet = ref<{ kind: Mode; entry: Transaction | Income | null } | null>(null);
const kindsOpen = ref(false);
const filterOpen = ref(false);
/** Выбранная категория; категория верхнего уровня включает свои подкатегории. Не сбрасывается при смене месяца. */
const filterId = ref<string | null>(null);

async function load() {
  error.value = '';
  try {
    const [, t, i] = await Promise.all([
      dicts.load(owner.value),
      canTx.value ? api<Transaction[]>(`/api/spaces/${owner.value}/transactions?month=${month.value}`) : [],
      canIncome.value ? api<Income[]>(`/api/spaces/${owner.value}/incomes?month=${month.value}`) : [],
    ]);
    txs.value = t;
    incomes.value = i;
    loaded.value = true;
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

const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
const spent = computed(() => sum(txs.value));

// ---- фильтр по категории -----------------------------------------------------------------------

const inFilter = (t: Transaction, id: string) => t.categoryId === id || dicts.byId.get(t.categoryId)?.parentId === id;
const shownTx = computed(() => (filterId.value ? txs.value.filter((t) => inFilter(t, filterId.value!)) : txs.value));
const filterName = computed(() => (filterId.value ? dicts.categoryName(filterId.value) : ''));
const filterSum = computed(() => sum(shownTx.value));
const filterShare = computed(() => {
  if (!spent.value) return '0%';
  const p = (filterSum.value / spent.value) * 100;
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
});
/** Новая трата при фильтре — в этой категории, если в неё ещё можно записывать. */
const presetCategory = computed(() => {
  const c = filterId.value ? dicts.byId.get(filterId.value) : undefined;
  return c && !c.archived ? c.id : null;
});

/** Выбор: категории по убыванию трат месяца, удалённые — только если в них есть траты. */
const filterOptions = computed(() => {
  const spentIn = new Map<string, number>();
  for (const t of txs.value) spentIn.set(t.categoryId, (spentIn.get(t.categoryId) ?? 0) + t.amount);
  return dicts.categories
    .filter((c) => !c.parentId)
    .map((c) => {
      const children = dicts.categories
        .filter((x) => x.parentId === c.id)
        .map((x) => ({ id: x.id, name: x.name, archived: x.archived, amount: spentIn.get(x.id) ?? 0 }))
        .filter((x) => !x.archived || x.amount > 0);
      return { id: c.id, name: c.name, archived: c.archived, amount: (spentIn.get(c.id) ?? 0) + children.reduce((s, x) => s + x.amount, 0), children };
    })
    .filter((c) => !c.archived || c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
});
function pickFilter(id: string | null) {
  filterId.value = id;
  filterOpen.value = false;
}

/** Записи текущего режима по дням, с суммой за день. */
const days = computed(() => {
  const list: (Transaction | Income)[] = mode.value === 'tx' ? shownTx.value : incomes.value;
  const groups = new Map<string, (Transaction | Income)[]>();
  for (const x of list) {
    const g = groups.get(x.date);
    if (g) g.push(x);
    else groups.set(x.date, [x]);
  }
  return [...groups].map(([date, items]) => ({ date, items, total: sum(items) }));
});

const label = (x: Transaction | Income) => ('categoryId' in x ? dicts.categoryName(x.categoryId) : (dicts.kindById.get(x.kindId)?.name ?? '—'));
const author = (x: Transaction | Income) => (x.createdBy !== session.me?.id ? (dicts.people[x.createdBy] ?? '') : '');
const canAdd = computed(() => (mode.value === 'tx' ? editTx.value : editIncome.value));

function saved() {
  sheet.value = null;
  void load();
}

// ---- виды поступлений --------------------------------------------------------------------------

async function kindOp(fn: () => Promise<unknown>) {
  try {
    await fn();
    await dicts.load(owner.value);
  } catch (e) {
    error.value = errorText(e);
  }
}
const addKind = () => {
  const name = prompt('Новый вид поступления', 'Премия')?.trim();
  if (name) void kindOp(() => api(`/api/spaces/${owner.value}/income-kinds/${clientId()}`, { method: 'PUT', body: { name } }));
};
const renameKind = (k: IncomeKind) => {
  const name = prompt('Название', k.name)?.trim();
  if (name && name !== k.name) void kindOp(() => api(`/api/spaces/${owner.value}/income-kinds/${k.id}`, { method: 'PUT', body: { name } }));
};
const removeKind = (k: IncomeKind) => {
  if (confirm(`Удалить «${k.name}»? Старые поступления сохранят название.`))
    void kindOp(() => api(`/api/spaces/${owner.value}/income-kinds/${k.id}`, { method: 'DELETE' }));
};
</script>

<template>
  <main class="page">
    <PageHead title="Операции" switcher />

    <MonthNav v-model="month" />

    <div v-if="canTx && canIncome" class="segmented mode" role="tablist" aria-label="Что показать">
      <button role="tab" :aria-selected="mode === 'tx'" :class="{ on: mode === 'tx' }" @click="mode = 'tx'">Расходы</button>
      <button role="tab" :aria-selected="mode === 'income'" :class="{ on: mode === 'income' }" @click="mode = 'income'">Поступления</button>
    </div>

    <div v-if="mode === 'tx' && canTx" class="filter-bar">
      <button class="filter" :class="{ on: filterId }" @click="filterOpen = true">
        <Icon name="filter" :size="14" />
        <span class="filter-name">{{ filterId ? filterName : 'Все категории' }}</span>
      </button>
      <template v-if="filterId">
        <span class="filter-sum">{{ money(filterSum) }} · {{ filterShare }}</span>
        <button class="filter-x" aria-label="Сбросить фильтр" @click="filterId = null"><Icon name="close" :size="13" /></button>
      </template>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <template v-for="d in days" :key="d.date">
      <p class="day section-title">
        <span>{{ dayTitle(d.date) }}</span>
        <span>{{ money(d.total) }}</span>
      </p>
      <div class="group">
        <button v-for="x in d.items" :key="x.id" class="row" @click="sheet = { kind: mode, entry: x }">
          <div class="grow">
            <div>{{ label(x) }}</div>
            <div v-if="x.comment || author(x)" class="sub">
              {{ x.comment }}<template v-if="x.comment && author(x)"> · </template>{{ author(x) }}
            </div>
          </div>
          <span class="amount" :class="{ plus: mode === 'income' }">{{ mode === 'income' ? '+' : '' }}{{ money(x.amount) }}</span>
        </button>
      </div>
    </template>

    <div v-if="loaded && !days.length" class="empty">
      <div class="icon"><Icon name="receipt" :size="44" /></div>
      <h2>{{ mode === 'tx' ? (filterId ? 'В этой категории расходов нет' : 'Расходов нет') : 'Поступлений нет' }}</h2>
      <p v-if="canAdd">Нажмите «+», чтобы добавить.</p>
    </div>

    <div v-if="mode === 'income' && editIncome" class="group kinds-link">
      <button class="row" @click="kindsOpen = true">
        <span class="grow">Виды поступлений</span>
        <Icon name="chevron" :size="16" class="muted" />
      </button>
    </div>

    <button v-if="canAdd" class="fab" :aria-label="mode === 'tx' ? 'Добавить трату' : 'Добавить поступление'" @click="sheet = { kind: mode, entry: null }">
      <Icon name="plus" :size="24" />
    </button>

    <EntrySheet
      v-if="sheet"
      :kind="sheet.kind"
      :owner-id="owner"
      :month="month"
      :entry="sheet.entry"
      :readonly="sheet.kind === 'tx' ? !editTx : !editIncome"
      :default-category-id="presetCategory"
      @close="sheet = null"
      @saved="saved"
    />

    <Sheet v-if="filterOpen" title="Категория" @close="filterOpen = false">
      <div class="group">
        <button class="row" @click="pickFilter(null)">
          <span class="grow">Все категории</span>
          <span class="amount meta">{{ money(spent) }}</span>
          <Icon name="check" :size="15" class="tick" :class="{ on: !filterId }" />
        </button>
        <template v-for="c in filterOptions" :key="c.id">
          <button class="row" :class="{ zero: !c.amount }" @click="pickFilter(c.id)">
            <span class="grow">{{ c.name }}<template v-if="c.archived"> (удалена)</template></span>
            <span class="amount meta">{{ c.amount ? money(c.amount) : '—' }}</span>
            <Icon name="check" :size="15" class="tick" :class="{ on: filterId === c.id }" />
          </button>
          <button v-for="x in c.children" :key="x.id" class="row child" :class="{ zero: !x.amount }" @click="pickFilter(x.id)">
            <span class="grow">{{ x.name }}<template v-if="x.archived"> (удалена)</template></span>
            <span class="amount meta">{{ x.amount ? money(x.amount) : '—' }}</span>
            <Icon name="check" :size="15" class="tick" :class="{ on: filterId === x.id }" />
          </button>
        </template>
      </div>
    </Sheet>

    <Sheet v-if="kindsOpen" title="Виды поступлений" @close="kindsOpen = false">
      <div class="group">
        <div v-for="k in dicts.incomeKinds.filter((x) => !x.archived)" :key="k.id" class="row">
          <button class="grow plain-btn" @click="renameKind(k)">{{ k.name }}</button>
          <button class="icon-btn" aria-label="Удалить" @click="removeKind(k)"><Icon name="trash" :size="16" /></button>
        </div>
        <button class="row accent" @click="addKind"><Icon name="plus" /> Добавить</button>
      </div>
    </Sheet>
  </main>
</template>

<style scoped>
.mode { margin-top: 8px; }
.mode button { min-height: 30px; font-size: var(--fs-subhead); }
.plus { color: var(--green); }
.filter-bar { display: flex; align-items: center; gap: 8px; margin-top: 8px; min-width: 0; }
.filter {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  min-height: 28px;
  padding: 0 11px;
  border: 0;
  border-radius: 999px;
  background: var(--fill);
  font-size: var(--fs-subhead);
  font-weight: 500;
}
.filter.on { background: var(--acc); color: var(--on-acc); }
.filter-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.filter-sum { margin-left: auto; flex: none; color: var(--label-2); font-size: var(--fs-subhead); font-variant-numeric: tabular-nums; white-space: nowrap; }
.filter-x { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 50%; background: var(--fill); color: var(--label-2); }
.child { padding-left: 30px; }
.child .grow { color: var(--label-2); }
.zero .grow { color: var(--label-3); }
.tick { flex: none; color: var(--acc); visibility: hidden; }
.tick.on { visibility: visible; }
.day { display: flex; justify-content: space-between; text-transform: none; letter-spacing: 0; }
.amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
.kinds-link { margin-top: 24px; }
.plain-btn { background: none; border: 0; padding: 0; text-align: left; }
.fab {
  position: fixed;
  right: max(var(--pad), calc((100vw - 640px) / 2 + var(--pad)));
  bottom: calc(var(--tabbar-h) + 16px);
  width: 50px;
  height: 50px;
  border-radius: 50%;
  border: 0;
  background: var(--acc);
  color: var(--on-acc);
  display: grid;
  place-items: center;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
  z-index: 5;
}
.fab:active { transform: scale(0.94); }
</style>
