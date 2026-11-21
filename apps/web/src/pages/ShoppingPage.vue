<script setup lang="ts">
import type { ShoppingItem } from '@money/shared';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api.ts';
import { amountInput, money, parseAmount } from '../money.ts';
import Icon from '../components/Icon.vue';
import PageHead from '../components/PageHead.vue';
import SwipeRow from '../components/SwipeRow.vue';
import { useSession } from '../stores/session.ts';
import { useShopping } from '../stores/shopping.ts';

const session = useSession();
const shop = useShopping();
const canEdit = computed(() => session.can('shopping', 'edit'));
const me = computed(() => session.me?.id);

const draft = ref('');
const input = ref<HTMLInputElement>();
const focused = ref(false);
const suggestions = ref<string[]>([]);
const editing = ref<string | null>(null);
const editName = ref('');
const editQty = ref('');
const editPrice = ref('');
const priceBad = ref(false);
const showBought = ref(true);

// ---- жизненный цикл: пространство, сеть, возврат в приложение ------------------------------

const onVisible = () => {
  if (document.visibilityState !== 'visible') return;
  // iOS усыпляет PWA в фоне и рвёт SSE — по возвращении переподключаемся и перечитываем.
  shop.close();
  shop.connect();
  void shop.refresh();
};
const onOnline = () => void shop.flush();

onMounted(() => {
  if (session.spaceId) void shop.open(session.spaceId);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
});
onBeforeUnmount(() => {
  shop.close();
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('online', onOnline);
});

// ---- добавление и подсказки ------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | undefined;
const suggestUrl = () => `/api/spaces/${shop.ownerId}/shopping/suggest?list=${encodeURIComponent(shop.list?.id ?? '')}`;
// Подсказки — свои у каждого списка: в «Бытовом» не предлагается молоко.
watch([draft, focused, () => shop.list?.id], () => {
  clearTimeout(timer);
  if (!focused.value || !shop.list) return;
  timer = setTimeout(async () => {
    try {
      const all = await api<string[]>(`${suggestUrl()}&q=${encodeURIComponent(draft.value.trim())}`);
      const have = new Set(shop.toBuy.map((i) => i.name.toLowerCase()));
      suggestions.value = all.filter((n) => !have.has(n.toLowerCase())).slice(0, 6);
    } catch {
      suggestions.value = []; // без сети подсказок нет — не страшно
    }
  }, 150);
});

/** Убрать подсказку (опечатка, больше не покупаем). Позиции в списке это не трогает. */
async function forget(name: string) {
  suggestions.value = suggestions.value.filter((s) => s !== name);
  try {
    await api(`${suggestUrl()}&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
  } catch {
    /* без сети — подсказка вернётся при следующем вводе, ничего страшного */
  }
}

function add(name = draft.value) {
  shop.add(name);
  draft.value = '';
  input.value?.focus(); // вводим подряд, клавиатура не прячется
}

// ---- правка позиции ----------------------------------------------------------------------------

function startEdit(item: ShoppingItem) {
  if (!canEdit.value) return;
  editing.value = item.id;
  editName.value = item.name;
  editQty.value = item.qty;
  editPrice.value = item.price ? amountInput(item.price) : '';
  priceBad.value = false;
  void nextTick(() => document.querySelector<HTMLInputElement>('.edit-name')?.focus());
}
function saveEdit(item: ShoppingItem) {
  const name = editName.value.trim();
  const priceText = editPrice.value.trim();
  const price = priceText ? parseAmount(priceText) : null;
  if (priceText && price === null) {
    priceBad.value = true; // «12,3,4» и т.п. — не сохраняем молча
    return;
  }
  const qty = editQty.value.trim();
  if (name && (name !== item.name || qty !== item.qty || price !== item.price)) shop.update(item, { name, qty, price });
  editing.value = null;
}

const sumPrices = (items: ShoppingItem[]) => items.reduce((s, i) => s + (i.price ?? 0), 0);
const toBuyTotal = computed(() => sumPrices(shop.toBuy));
const toBuyUnpriced = computed(() => shop.toBuy.filter((i) => !i.price).length);
const boughtTotal = computed(() => sumPrices(shop.bought));
function removeEdit(item: ShoppingItem) {
  shop.remove(item);
  editing.value = null;
}

// ---- списки ------------------------------------------------------------------------------------

function newList() {
  const name = prompt('Название списка', 'Аптека')?.trim();
  if (name) shop.addList(name.slice(0, 40));
}
function listMenu() {
  const l = shop.list;
  if (!l) return;
  const name = prompt(`Переименовать «${l.name}» (очистите поле, чтобы удалить список)`, l.name);
  if (name === null) return;
  if (name.trim()) shop.renameList(l.id, name.trim().slice(0, 40));
  else if (shop.lists.length > 1 && confirm(`Удалить список «${l.name}» со всеми позициями?`)) shop.removeList(l.id);
}

const who = (id: string | null) => (id && id !== me.value ? (shop.people[id] ?? '') : '');

// «Нет связи» — только если связь пропала и не вернулась за 2,5 с: короткие обрывы (переключение
// вкладок, возврат приложения из фона) не мигают оранжевой надписью.
const showOffline = ref(false);
let offlineTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => shop.offline,
  (off) => {
    clearTimeout(offlineTimer);
    if (off) offlineTimer = setTimeout(() => (showOffline.value = true), 2500);
    else showOffline.value = false;
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(offlineTimer));

const status = computed(() => {
  if (!showOffline.value) return '';
  if (shop.queue.length) return `Нет связи · изменений в очереди: ${shop.queue.length}`;
  return shop.loaded ? 'Нет связи · показан сохранённый список' : 'Нет связи';
});
</script>

<template>
  <main class="page">
    <PageHead title="Покупки" switcher>
      <span class="live" :class="{ on: shop.live }" :title="shop.live ? 'Обновляется у всех сразу' : 'Нет связи'" />
    </PageHead>

    <!-- списки -->
    <nav v-if="shop.lists.length > 1 || canEdit" class="chips">
      <button v-for="l in shop.lists" :key="l.id" class="chip" :class="{ on: l.id === shop.list?.id }" @click="shop.select(l.id)">
        {{ l.name }}
      </button>
      <button v-if="canEdit" class="chip add" aria-label="Новый список" @click="newList"><Icon name="plus" :size="14" /></button>
      <button v-if="canEdit" class="chip add" aria-label="Изменить список" @click="listMenu"><Icon name="more" :size="14" /></button>
    </nav>

    <p v-if="!canEdit" class="viewonly"><span class="pill">Только просмотр</span></p>
    <p v-if="status" class="status">{{ status }}</p>
    <p v-if="shop.error" class="error">{{ shop.error }}</p>

    <!-- добавить -->
    <form v-if="canEdit" class="add" @submit.prevent="add()">
      <input
        ref="input"
        v-model="draft"
        class="input"
        :placeholder="`Добавить в «${shop.list?.name ?? 'список'}»`"
        enterkeyhint="done"
        autocomplete="off"
        maxlength="120"
        @focus="focused = true"
        @blur="focused = false"
      />
      <button class="icon-btn" :disabled="!draft.trim()" aria-label="Добавить"><Icon name="plus" :size="18" /></button>
    </form>
    <div v-if="canEdit && focused && suggestions.length" class="suggest">
      <!-- mousedown, а не click: иначе blur поля прячет подсказки раньше нажатия -->
      <span v-for="s in suggestions" :key="s" class="chip sug">
        <button class="sug-name" @mousedown.prevent="add(s)">{{ s }}</button>
        <button class="sug-x" :aria-label="`Убрать подсказку «${s}»`" @mousedown.prevent="forget(s)">
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 2l6 6M8 2l-6 6" /></svg>
        </button>
      </span>
    </div>

    <!-- купить -->
    <div v-if="shop.toBuy.length" class="group items">
      <SwipeRow v-for="item in shop.toBuy" :key="item.id" :disabled="!canEdit || editing === item.id" @delete="shop.remove(item)">
        <div class="row item">
          <button class="check" :disabled="!canEdit" :aria-label="`Куплено: ${item.name}`" @click="shop.toggle(item)" />
          <div v-if="editing === item.id" class="edit grow">
            <input v-model="editName" class="edit-name" maxlength="120" aria-label="Название" @keydown.enter="saveEdit(item)" />
            <div class="edit-line">
              <input v-model="editQty" class="edit-qty" placeholder="Кол-во" maxlength="30" aria-label="Количество" @keydown.enter="saveEdit(item)" />
              <input
                v-model="editPrice"
                class="edit-price"
                :class="{ bad: priceBad }"
                placeholder="Цена, ₽"
                inputmode="decimal"
                aria-label="Цена"
                @input="priceBad = false"
                @keydown.enter="saveEdit(item)"
              />
              <button class="icon-btn danger" aria-label="Удалить" @click="removeEdit(item)"><Icon name="trash" :size="16" /></button>
              <button class="icon-btn" aria-label="Готово" @click="saveEdit(item)"><Icon name="check" :size="16" /></button>
            </div>
          </div>
          <template v-else>
            <button class="grow text" @click="startEdit(item)">
              <span>{{ item.name }}</span>
              <span v-if="item.qty" class="qty">{{ item.qty }}</span>
              <span v-if="who(item.addedBy)" class="sub">{{ who(item.addedBy) }}</span>
            </button>
            <span v-if="item.price" class="price">{{ money(item.price) }}</span>
          </template>
        </div>
      </SwipeRow>
    </div>
    <p v-if="shop.toBuy.length && toBuyTotal" class="section-foot total">
      Итого {{ money(toBuyTotal) }}<template v-if="toBuyUnpriced"> · без цены: {{ toBuyUnpriced }}</template>
    </p>
    <div v-else-if="!shop.toBuy.length && shop.loaded" class="empty">
      <div class="icon"><Icon name="cart" :size="44" /></div>
      <h2>Всё куплено</h2>
      <p v-if="canEdit">Добавьте, что нужно купить — у всех, с кем общий список, появится сразу.</p>
    </div>

    <!-- куплено -->
    <template v-if="shop.bought.length">
      <button class="section-title toggle" @click="showBought = !showBought">
        Куплено · {{ shop.bought.length }}<template v-if="boughtTotal"> · {{ money(boughtTotal) }}</template>
        <Icon name="chevron" :size="12" :class="{ open: showBought }" />
      </button>
      <div v-if="showBought" class="group">
        <SwipeRow v-for="item in shop.bought" :key="item.id" :disabled="!canEdit" @delete="shop.remove(item)">
          <div class="row item done">
            <button class="check on" :disabled="!canEdit" :aria-label="`Вернуть: ${item.name}`" @click="shop.toggle(item)">
              <Icon name="check" :size="14" />
            </button>
            <div class="grow text">
              <span>{{ item.name }}</span>
              <span v-if="item.qty" class="qty">{{ item.qty }}</span>
              <span v-if="who(item.checkedBy)" class="sub">купил(а) {{ who(item.checkedBy) }}</span>
            </div>
            <span v-if="item.price" class="price">{{ money(item.price) }}</span>
          </div>
        </SwipeRow>
      </div>
      <p v-if="canEdit && showBought" class="section-foot">Смахните влево, чтобы удалить.</p>
    </template>
  </main>
</template>

<style scoped>
.live { width: 7px; height: 7px; border-radius: 50%; background: var(--label-3); }
.live.on { background: var(--green); }
.chips { display: flex; gap: 6px; overflow-x: auto; margin: -6px calc(-1 * var(--pad)) 10px; padding: 0 var(--pad); scrollbar-width: none; }
.chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 0;
  background: var(--fill);
  color: var(--label);
  font-size: var(--fs-subhead);
  font-weight: 500;
}
.chip.on { background: var(--acc); color: var(--on-acc); }
.chip.add { padding: 0 9px; color: var(--acc); }
.viewonly { margin: -6px 0 10px; }
.status { color: var(--orange); font-size: var(--fs-footnote); margin: 0 4px 8px; }
.add { display: flex; gap: 6px; align-items: center; position: sticky; top: calc(var(--sat) + 4px); z-index: 3; }
.add .icon-btn { width: 40px; height: 40px; border-radius: var(--r); background: var(--acc); color: var(--on-acc); flex: none; }
.add .icon-btn:disabled { opacity: 0.35; }
.suggest { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; }
.sug { padding: 0; gap: 0; }
.sug-name { background: none; border: 0; padding: 0 4px 0 12px; min-height: 28px; font: inherit; }
.sug-x { background: none; border: 0; color: var(--label-3); width: 26px; min-height: 28px; display: grid; place-items: center; padding: 0 4px 0 0; }
.items { margin-top: 12px; }
.item { gap: 10px; min-height: 40px; padding-top: 6px; padding-bottom: 6px; }
.check {
  flex: none;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  border: 1.5px solid var(--label-3);
  background: none;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--on-acc);
}
.check.on { background: var(--acc); border-color: var(--acc); }
.text { background: none; border: 0; padding: 0; text-align: left; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 6px; }
.text .sub { width: 100%; margin: 0; }
.qty { color: var(--label-2); font-size: var(--fs-footnote); }
.done .text > span:first-child { color: var(--label-2); text-decoration: line-through; }
/* minmax(0, 1fr) и width: 100% — иначе поля берут свою стандартную ширину (~20 символов), строка вылезает
   за край, а фокус прокручивает её так, что кружок уезжает влево. */
.edit { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
.edit-line { display: flex; gap: 6px; align-items: center; min-width: 0; }
.edit-name, .edit-qty, .edit-price { width: 100%; border: 0; background: var(--fill); border-radius: var(--r-sm); padding: 4px 8px; outline: none; min-width: 0; }
.edit-qty, .edit-price { flex: 1 1 0; }
.edit-price.bad { box-shadow: inset 0 0 0 1.5px var(--red); }
.price { flex: none; color: var(--label-2); font-size: var(--fs-subhead); font-variant-numeric: tabular-nums; white-space: nowrap; }
.done .price { color: var(--label-3); }
.total { text-align: right; font-variant-numeric: tabular-nums; }
.item .icon-btn { width: 30px; height: 30px; }
.icon-btn.danger { color: var(--red); }
.toggle { background: none; border: 0; display: inline-flex; align-items: center; gap: 4px; padding: 0; }
.toggle :deep(svg) { transition: transform var(--fast); }
.open { transform: rotate(90deg); }
</style>
