<script setup lang="ts">
/**
 * План: статья = одна категория. В списке — название и итог; по нажатию разворачиваются подкатегории
 * с суммами (итог = их сумма). У категории без подкатегорий — одна сумма.
 */
import type { PlanItem, PlanPart } from '@money/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorText } from '../api.ts';
import Icon from '../components/Icon.vue';
import PageHead from '../components/PageHead.vue';
import Sheet from '../components/Sheet.vue';
import { amountInput, money, parseAmount } from '../money.ts';
import { useDicts } from '../stores/dicts.ts';
import { useSession } from '../stores/session.ts';
import { clientId } from '../storage.ts';

const session = useSession();
const dicts = useDicts();
const owner = computed(() => session.spaceId ?? '');
const canEdit = computed(() => session.can('plan', 'edit'));
const base = computed(() => `/api/spaces/${owner.value}`);

const plan = ref<PlanItem[]>([]);
const loaded = ref(false);
const error = ref('');

async function load() {
  try {
    const [, p] = await Promise.all([dicts.load(owner.value), api<PlanItem[]>(`${base.value}/plan`)]);
    plan.value = p;
    for (const it of p) if (expanded.value.has(it.id)) resetDrafts(it);
    loaded.value = true;
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(load);

const subsOf = (categoryId: string) => dicts.tree.find((t) => t.id === categoryId)?.children ?? [];
const total = computed(() => plan.value.reduce((s, p) => s + amountOf(p), 0));

// ---- развёрнутая статья ------------------------------------------------------------------------
// В плане только известные траты: подкатегории добавляются в статью явно, остальные — «вне плана».

const expanded = ref<Set<string>>(new Set());
/** Подкатегории статьи в плане: статья → подкатегория → введённая сумма. */
const drafts = reactive<Record<string, Record<string, string>>>({});
/** Общая сумма статьи — пока по подкатегориям ничего не расписано (или подкатегорий нет). */
const totals = reactive<Record<string, string>>({});
const badField = ref('');

function resetDrafts(p: PlanItem) {
  const d: Record<string, string> = {};
  for (const x of p.parts) d[x.categoryId] = x.amount ? amountInput(x.amount) : '';
  drafts[p.id] = d;
  totals[p.id] = p.amount ? amountInput(p.amount) : '';
}
function toggle(p: PlanItem) {
  const next = new Set(expanded.value);
  if (next.has(p.id)) next.delete(p.id);
  else {
    next.add(p.id);
    resetDrafts(p);
  }
  expanded.value = next;
}

const inPlan = (p: PlanItem) => subsOf(p.categoryId).filter((k) => drafts[p.id] && k.id in drafts[p.id]!);
const notInPlan = (p: PlanItem) => subsOf(p.categoryId).filter((k) => !drafts[p.id] || !(k.id in drafts[p.id]!));

/** Разбор строк подкатегорий; null — где-то не число. Пустая строка — без своей суммы. */
function parsedParts(p: PlanItem): PlanPart[] | null {
  const parts: PlanPart[] = [];
  for (const k of inPlan(p)) {
    const text = drafts[p.id]![k.id]!.trim();
    const amount = text ? parseAmount(text) : 0;
    if (amount === null) return null;
    parts.push({ categoryId: k.id, amount });
  }
  return parts;
}
const partsSum = (p: PlanItem) => (parsedParts(p) ?? []).reduce((s, x) => s + x.amount, 0);
/** Поле общей суммы нужно, пока по подкатегориям ничего не расписано. */
const showTotal = (p: PlanItem) => partsSum(p) === 0;

/** Итог на экране — сразу при вводе, ещё до сохранения. */
function amountOf(p: PlanItem): number {
  if (!expanded.value.has(p.id) || !drafts[p.id]) return p.amount;
  const sum = partsSum(p);
  if (sum > 0) return sum;
  const text = totals[p.id]?.trim() ?? '';
  return text ? (parseAmount(text) ?? p.amount) : 0;
}

// Сохранения идут по очереди: быстрый переход между полями не должен записать старое поверх нового.
let saving: Promise<unknown> = Promise.resolve();
function save(p: PlanItem, fieldId: string) {
  const parts = parsedParts(p);
  const text = totals[p.id]?.trim() ?? '';
  const total = text ? parseAmount(text) : 0;
  if (!parts || total === null) {
    badField.value = `${p.id}:${fieldId}`;
    return;
  }
  badField.value = '';
  const key = (xs: PlanPart[]) => JSON.stringify([...xs].sort((a, b) => a.categoryId.localeCompare(b.categoryId)));
  saving = saving.then(async () => {
    const cur = plan.value.find((x) => x.id === p.id);
    if (!cur) return;
    const sum = parts.reduce((s, x) => s + x.amount, 0);
    if (key(cur.parts) === key(parts) && (sum > 0 || cur.amount === total)) return;
    try {
      const r = await api<{ status: string; value?: PlanItem }>(`${base.value}/plan/${cur.id}`, {
        method: 'PUT',
        body: { categoryId: cur.categoryId, amount: sum > 0 ? cur.amount : total, parts },
      });
      if (r.value) {
        plan.value = plan.value.map((x) => (x.id === cur.id ? r.value! : x));
        if (sum > 0) totals[cur.id] = amountInput(r.value.amount);
      }
      error.value = '';
    } catch (e) {
      error.value = errorText(e);
    }
  });
}
function addSub(p: PlanItem, id: string) {
  drafts[p.id]![id] = '';
  save(p, id);
}
function removeSub(p: PlanItem, id: string) {
  delete drafts[p.id]![id];
  save(p, id);
}

async function removeItem(p: PlanItem) {
  if (!confirm(`Удалить статью «${p.name}»? Категория и траты останутся.`)) return;
  try {
    await api(`${base.value}/plan/${p.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}

// ---- новая статья: выбор категории из списка -----------------------------------------------------

const adding = ref(false);
const newCat = ref('');
const newDrafts = ref<Record<string, string>>({});
const free = computed(() => dicts.tree.filter((c) => !plan.value.some((p) => p.categoryId === c.id)));
const newSubs = computed(() => subsOf(newCat.value));

function openNew() {
  adding.value = true;
  newCat.value = '';
  newDrafts.value = {};
  error.value = '';
}
// В новую статью попадают подкатегории с суммой; остальные можно добавить позже.
const newValid = computed(() => !!newCat.value && Object.values(newDrafts.value).every((t) => !t.trim() || parseAmount(t) !== null));

async function createIn(parent: string | null) {
  const parentName = parent ? dicts.byId.get(parent)?.name : '';
  const name = prompt(parent ? `Новая подкатегория в «${parentName}»` : 'Новая категория')?.trim().slice(0, 40);
  if (!name) return;
  try {
    const id = clientId();
    await api(`${base.value}/categories/${id}`, { method: 'PUT', body: { name, parentId: parent } });
    await dicts.load(owner.value);
    if (!parent) {
      newCat.value = id;
      newDrafts.value = {};
    }
  } catch (e) {
    error.value = errorText(e);
  }
}

async function saveNew() {
  if (!newValid.value) return;
  const subs = newSubs.value;
  const parts = subs.flatMap((k) => {
    const t = newDrafts.value[k.id]?.trim();
    return t ? [{ categoryId: k.id, amount: parseAmount(t)! }] : [];
  });
  const own = newDrafts.value[newCat.value]?.trim();
  const body = { categoryId: newCat.value, amount: !parts.length && own ? parseAmount(own)! : 0, parts };
  try {
    await api(`${base.value}/plan/${clientId()}`, { method: 'PUT', body });
    adding.value = false;
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>

<template>
  <main class="page">
    <PageHead title="План" subtitle="Ежемесячные траты" switcher />
    <p v-if="!canEdit" class="viewonly"><span class="pill">Только просмотр</span></p>
    <p v-if="error && !adding" class="error">{{ error }}</p>

    <div v-if="plan.length" class="group">
      <div v-for="p in plan" :key="p.id" class="plan-item">
        <button class="row" :aria-expanded="expanded.has(p.id)" @click="toggle(p)">
          <span class="grow">
            {{ p.name }}
            <Icon name="chevron" :size="15" class="chev" :class="{ open: expanded.has(p.id) }" />
          </span>
          <span class="amount">{{ amountOf(p) ? money(amountOf(p)) : '—' }}</span>
        </button>
        <div v-if="expanded.has(p.id) && drafts[p.id]" class="parts">
          <div v-for="k in inPlan(p)" :key="k.id" class="part">
            <label class="grow" :for="`part-${k.id}`">{{ k.name }}</label>
            <input
              :id="`part-${k.id}`"
              v-model="drafts[p.id]![k.id]"
              class="part-input"
              :class="{ bad: badField === `${p.id}:${k.id}` }"
              inputmode="decimal"
              :placeholder="canEdit ? '0' : '—'"
              :readonly="!canEdit"
              :aria-label="`План: ${k.name}, рублей`"
              @blur="canEdit && save(p, k.id)"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            />
            <button v-if="canEdit" class="part-x" :aria-label="`Убрать «${k.name}» из плана`" @click="removeSub(p, k.id)">
              <Icon name="close" :size="12" />
            </button>
          </div>
          <label v-if="showTotal(p)" class="part">
            <span class="grow">{{ subsOf(p.categoryId).length ? 'Общая сумма, ₽' : 'В месяц, ₽' }}</span>
            <input
              v-model="totals[p.id]"
              class="part-input"
              :class="{ bad: badField === `${p.id}:total` }"
              inputmode="decimal"
              :placeholder="canEdit ? '0' : '—'"
              :readonly="!canEdit"
              :aria-label="`План: ${p.name}, рублей`"
              @blur="canEdit && save(p, 'total')"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            />
            <span v-if="canEdit && inPlan(p).length" class="part-x-gap" />
          </label>
          <div v-if="canEdit && notInPlan(p).length" class="off-plan">
            <span class="off-label">Добавить в план:</span>
            <button v-for="k in notInPlan(p)" :key="k.id" class="off-chip" @click="addSub(p, k.id)">+ {{ k.name }}</button>
          </div>
          <p v-if="subsOf(p.categoryId).length && !inPlan(p).length" class="part-foot">
            Подкатегории не выбраны — в статью идут все траты категории.
          </p>
          <button v-if="canEdit" class="part-del" @click="removeItem(p)">Удалить статью</button>
        </div>
      </div>
      <div class="row total">
        <strong class="grow">Итого в месяц</strong>
        <strong class="amount">{{ money(total) }}</strong>
      </div>
    </div>
    <div v-else-if="loaded" class="empty">
      <div class="icon"><Icon name="target" :size="44" /></div>
      <h2>Плана пока нет</h2>
      <p v-if="canEdit">Добавьте статьи: выберите категорию и укажите сумму в месяц.</p>
    </div>
    <div v-if="canEdit" class="group add">
      <button class="row accent" @click="openNew"><Icon name="plus" /> Статья плана</button>
    </div>

    <Sheet v-if="adding" title="Новая статья" @close="adding = false">
      <template #action>
        <button class="done" :disabled="!newValid" @click="saveNew">Готово</button>
      </template>
      <div class="group">
        <label class="row">
          <span>Категория</span>
          <select v-model="newCat" class="input grow select" aria-label="Категория" @change="newDrafts = {}">
            <option value="" disabled>Выберите</option>
            <option v-for="c in free" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <Icon name="down" :size="14" class="select-ic" />
        </label>
        <template v-if="newCat">
          <label v-for="k in newSubs" :key="k.id" class="row sub-row">
            <span class="grow">{{ k.name }}</span>
            <input v-model="newDrafts[k.id]" class="part-input" inputmode="decimal" placeholder="0" :aria-label="`План: ${k.name}, рублей`" />
          </label>
          <label v-if="!newSubs.length || !newSubs.some((k) => newDrafts[k.id]?.trim())" class="row">
            <span class="grow">{{ newSubs.length ? 'Общая сумма, ₽' : 'В месяц, ₽' }}</span>
            <input v-model="newDrafts[newCat]" class="part-input" inputmode="decimal" placeholder="0" aria-label="Сумма в месяц, рублей" />
          </label>
        </template>
      </div>
      <div class="new-actions">
        <button class="chip" @click="createIn(null)">+ Создать категорию</button>
        <button v-if="newCat" class="chip" @click="createIn(newCat)">+ Подкатегория</button>
      </div>
      <p v-if="newSubs.length" class="section-foot">В план попадут подкатегории с суммой. Без сумм — статья на всю категорию.</p>
      <p v-if="!free.length" class="section-foot">На все категории статьи уже есть.</p>
      <p v-if="error" class="error">{{ error }}</p>
    </Sheet>
  </main>
</template>

<style scoped>
.viewonly { margin: -8px 0 12px; }
.amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
.total .amount, .total strong { font-weight: 600; }
.add { margin-top: 12px; }
.plan-item { position: relative; }
.plan-item + .plan-item::before, .plan-item + .row::before {
  content: '';
  position: absolute;
  top: 0;
  left: 14px;
  right: 0;
  border-top: 0.5px solid var(--sep);
  z-index: 1;
}
.chev { display: inline-block; vertical-align: -3px; margin-left: 1px; color: var(--label-2); transition: transform var(--fast); }
.chev.open { transform: rotate(90deg); }
.parts { padding: 0 14px 8px 24px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }
.part { display: flex; align-items: center; gap: 10px; min-height: 32px; font-size: var(--fs-subhead); color: var(--label-2); }
.part .grow { flex: 1; min-width: 0; }
.part-input {
  width: 104px;
  flex: none;
  padding: 3px 8px;
  border: 0;
  border-radius: var(--r-sm);
  background: var(--fill);
  outline: none;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.part-input[readonly] { background: none; }
.part-input.bad { box-shadow: inset 0 0 0 1.5px var(--red); }
.part-x { flex: none; display: grid; place-items: center; width: 24px; height: 24px; margin-right: -4px; border: 0; border-radius: 50%; background: none; color: var(--label-3); }
.part-x-gap { flex: none; width: 20px; }
.off-plan { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 4px; }
.off-label { font-size: var(--fs-footnote); color: var(--label-3); }
.off-chip { min-height: 26px; padding: 0 9px; border: 0; border-radius: 999px; background: var(--fill); color: var(--acc); font-size: var(--fs-footnote); }
.part-foot { margin: 4px 0 0; font-size: var(--fs-footnote); color: var(--label-2); line-height: 1.35; }
.part-del { justify-self: start; margin-top: 2px; padding: 4px 0; border: 0; background: none; color: var(--red); font-size: var(--fs-subhead); }
.select { text-align: right; text-align-last: right; appearance: none; background: none; padding: 0; min-height: 0; }
.select-ic { flex: none; margin-left: -6px; color: var(--label-2); }
.sub-row { color: var(--label-2); padding-left: 26px; }
.new-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { min-height: 30px; padding: 0 12px; border-radius: 999px; border: 0; background: none; color: var(--acc); box-shadow: inset 0 0 0 1px var(--acc-soft); font-size: var(--fs-subhead); }
.done { background: none; border: 0; color: var(--acc); font-weight: 600; padding: 0; }
.done:disabled { color: var(--label-3); }
</style>
