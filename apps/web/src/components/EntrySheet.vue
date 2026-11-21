<script setup lang="ts">
// Ввод и правка траты или поступления: сумма, категория (или вид), дата, комментарий.
import type { Income, Transaction } from '@money/shared';
import { computed, nextTick, onMounted, ref } from 'vue';
import { api, errorText } from '../api.ts';
import { amountInput, defaultDate, parseAmount } from '../money.ts';
import { useDicts } from '../stores/dicts.ts';
import { useSession } from '../stores/session.ts';
import { clientId } from '../storage.ts';
import Sheet from './Sheet.vue';

const props = defineProps<{
  kind: 'tx' | 'income';
  ownerId: string;
  month: string;
  entry: Transaction | Income | null;
  readonly: boolean;
  /** Новая запись при включённом фильтре — сразу в этой категории. */
  defaultCategoryId?: string | null;
}>();
const emit = defineEmits<{ close: []; saved: [] }>();
const dicts = useDicts();
const session = useSession();
/** Заводить категории можно с правом правки «Плана» — как и на экране «Категории». */
const canCreate = computed(() => !props.readonly && session.can('plan', 'edit'));

const isTx = props.kind === 'tx';
const amount = ref(props.entry ? amountInput(props.entry.amount) : '');
const date = ref(props.entry?.date ?? defaultDate(props.month));
const comment = ref(props.entry?.comment ?? '');
const initialCat = props.entry && 'categoryId' in props.entry ? props.entry.categoryId : '';
const initialKind = props.entry && 'kindId' in props.entry ? props.entry.kindId : '';
// Выбранная категория верхнего уровня и (необязательно) подкатегория.
const startCat = initialCat || (isTx && !props.entry ? (props.defaultCategoryId ?? '') : '');
const parentId = ref(dicts.byId.get(startCat)?.parentId ?? startCat);
const childId = ref(dicts.byId.get(startCat)?.parentId ? startCat : '');
const kindId = ref(initialKind);
const error = ref('');
const busy = ref(false);
const amountEl = ref<HTMLInputElement>();

const title = computed(() => (props.entry ? (isTx ? 'Трата' : 'Поступление') : isTx ? 'Новая трата' : 'Новое поступление'));
const children = computed(() => dicts.tree.find((c) => c.id === parentId.value)?.children ?? []);
const categoryId = computed(() => childId.value || parentId.value);
// Удалённая категория/вид старой записи остаются выбранными, но в списке живых их нет — покажем отдельно.
const archivedCat = computed(() => (initialCat && dicts.byId.get(initialCat)?.archived ? dicts.categoryName(initialCat) : ''));
const kinds = computed(() => dicts.incomeKinds.filter((k) => !k.archived || k.id === initialKind));
// Если у категории есть подкатегории, выбрать одну обязательно. Старую трату, записанную прямо
// в категорию, можно править, не меняя её.
const needChild = computed(() => isTx && children.value.length > 0 && !childId.value && categoryId.value !== initialCat);
const valid = computed(() => parseAmount(amount.value) !== null && (isTx ? !!categoryId.value && !needChild.value : !!kindId.value) && !!date.value);

onMounted(() => {
  if (!props.entry && !props.readonly) void nextTick(() => amountEl.value?.focus());
});

function pickParent(id: string) {
  parentId.value = id;
  childId.value = '';
}

async function createCategory(parent: string | null) {
  const parentName = parent ? dicts.byId.get(parent)?.name : '';
  const name = prompt(parent ? `Новая подкатегория в «${parentName}»` : 'Новая категория')?.trim().slice(0, 40);
  if (!name) return;
  error.value = '';
  try {
    const id = clientId();
    await api(`/api/spaces/${props.ownerId}/categories/${id}`, { method: 'PUT', body: { name, parentId: parent } });
    await dicts.load(props.ownerId);
    if (parent) childId.value = id;
    else pickParent(id);
  } catch (e) {
    error.value = errorText(e);
  }
}

async function save() {
  if (!valid.value || busy.value) return;
  busy.value = true;
  error.value = '';
  const id = props.entry?.id ?? clientId();
  const body = isTx
    ? { date: date.value, amount: parseAmount(amount.value), categoryId: categoryId.value, comment: comment.value }
    : { date: date.value, amount: parseAmount(amount.value), kindId: kindId.value, comment: comment.value };
  try {
    await api(`/api/spaces/${props.ownerId}/${isTx ? 'transactions' : 'incomes'}/${id}`, { method: 'PUT', body });
    emit('saved');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!props.entry || !confirm(isTx ? 'Удалить трату?' : 'Удалить поступление?')) return;
  try {
    await api(`/api/spaces/${props.ownerId}/${isTx ? 'transactions' : 'incomes'}/${props.entry.id}`, { method: 'DELETE' });
    emit('saved');
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>

<template>
  <Sheet :title="title" @close="emit('close')">
    <template v-if="!readonly" #action>
      <button class="done" :disabled="!valid || busy" @click="save">Готово</button>
    </template>

    <label class="amount">
      <input
        ref="amountEl"
        v-model="amount"
        inputmode="decimal"
        placeholder="0"
        :readonly="readonly"
        aria-label="Сумма"
        @keydown.enter="save"
      />
      <span>₽</span>
    </label>

    <template v-if="isTx">
      <p class="label">Категория</p>
      <p v-if="archivedCat && categoryId === initialCat" class="archived">{{ archivedCat }} (удалена)</p>
      <div class="chips">
        <button
          v-for="c in dicts.tree"
          :key="c.id"
          type="button"
          class="chip"
          :class="{ on: parentId === c.id }"
          :disabled="readonly"
          @click="pickParent(c.id)"
        >
          {{ c.name }}
        </button>
        <button v-if="canCreate" type="button" class="chip create" @click="createCategory(null)">+ Создать категорию</button>
      </div>
      <div v-if="parentId && (children.length || canCreate)" class="chips sub">
        <button v-for="c in children" :key="c.id" type="button" class="chip" :class="{ on: childId === c.id }" :disabled="readonly" @click="childId = c.id">
          {{ c.name }}
        </button>
        <button v-if="canCreate" type="button" class="chip create" @click="createCategory(parentId)">+ Подкатегория</button>
      </div>
      <p v-if="needChild" class="hint">Выберите подкатегорию</p>
      <p v-if="!dicts.tree.length && !canCreate" class="muted">Категорий пока нет.</p>
    </template>

    <template v-else>
      <p class="label">Вид</p>
      <div class="chips">
        <button v-for="k in kinds" :key="k.id" type="button" class="chip" :class="{ on: kindId === k.id }" :disabled="readonly" @click="kindId = k.id">
          {{ k.name }}<template v-if="k.archived"> (удалён)</template>
        </button>
      </div>
    </template>

    <div class="group">
      <label class="row">
        <span>Дата</span>
        <input v-model="date" type="date" class="input grow" :readonly="readonly" />
      </label>
      <label class="row">
        <span>Комментарий</span>
        <input v-model="comment" class="input grow" maxlength="200" placeholder="необязательно" :readonly="readonly" />
      </label>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <button v-if="entry && !readonly" class="btn plain block danger" @click="remove">Удалить</button>
  </Sheet>
</template>

<style scoped>
.done { background: none; border: 0; color: var(--acc); font-weight: 600; padding: 0; }
.done:disabled { color: var(--label-3); }
.amount { display: flex; align-items: baseline; justify-content: center; gap: 6px; padding: 6px 0 2px; }
.amount input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: none;
  outline: none;
  text-align: right;
  font-size: 2.125rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.amount span { font-size: 1.5rem; color: var(--label-2); flex: none; width: 40%; }
.label { margin: 4px 4px -4px; color: var(--label-2); font-size: var(--fs-footnote); text-transform: uppercase; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips.sub { padding-left: 12px; border-left: 2px solid var(--fill); }
.chip {
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 0;
  background: var(--surface);
  font-size: var(--fs-subhead);
}
.chip.on { background: var(--acc); color: var(--on-acc); }
.chip.create { background: none; color: var(--acc); box-shadow: inset 0 0 0 1px var(--acc-soft); }
.hint { margin: -2px 4px 0; color: var(--orange); font-size: var(--fs-footnote); }
.chip:disabled:not(.on) { opacity: 0.6; }
.archived { margin: 0 4px; color: var(--orange); font-size: var(--fs-footnote); }
.danger { color: var(--red); }
</style>
