<script setup lang="ts">
/**
 * Правка позиции — и в «купить», и в «куплено». Если количество начинается с числа, есть поле цены за единицу:
 * «3» и «73» за штуку дают сумму 219. Хранится только сумма.
 */
import type { ShoppingItem } from '@money/shared';
import { computed, onMounted, ref } from 'vue';
import { amountInput, parseAmount } from '../money.ts';
import { parseQty, totalFor, unitFor } from '../qty.ts';
import { useShopping } from '../stores/shopping.ts';
import Icon from './Icon.vue';

const props = defineProps<{ item: ShoppingItem }>();
const emit = defineEmits<{ done: [] }>();
const shop = useShopping();

const name = ref(props.item.name);
const qty = ref(props.item.qty);
const initialTotal = props.item.price ? amountInput(props.item.price) : '';
const total = ref(initialTotal);
const count = computed(() => parseQty(qty.value));
const startCount = parseQty(props.item.qty);
const unit = ref(startCount && props.item.price ? amountInput(unitFor(startCount.n, props.item.price)) : '');
const bad = ref<'unit' | 'total' | null>(null);
const nameInput = ref<HTMLInputElement>();
onMounted(() => nameInput.value?.focus());

const unitLabel = computed(() => `Цена за 1${count.value?.unit ? ` ${count.value.unit}` : ''}`);

function recalcTotal() {
  const u = parseAmount(unit.value);
  if (count.value && u !== null) total.value = amountInput(totalFor(count.value.n, u));
}
function onQty() {
  if (unit.value.trim()) recalcTotal();
}
function onUnit() {
  bad.value = null;
  if (!unit.value.trim()) return;
  recalcTotal();
}
function onTotal() {
  bad.value = null;
  const t = parseAmount(total.value);
  if (count.value && t !== null) unit.value = amountInput(unitFor(count.value.n, t));
  else if (!total.value.trim()) unit.value = '';
}

function save() {
  const n = name.value.trim();
  if (unit.value.trim() && count.value && parseAmount(unit.value) === null) {
    bad.value = 'unit';
    return;
  }
  const text = total.value.trim();
  // Сумму не трогали — оставляем как была (пересчёт через цену за штуку мог округлить копейки).
  const price = text === initialTotal ? props.item.price : text ? parseAmount(text) : null;
  if (text && price === null) {
    bad.value = 'total'; // «12,3,4» и т.п. — не сохраняем молча
    return;
  }
  const q = qty.value.trim();
  const it = props.item;
  if (n && (n !== it.name || q !== it.qty || price !== it.price)) shop.update(it, { name: n, qty: q, price });
  emit('done');
}
function remove() {
  shop.remove(props.item);
  emit('done');
}
</script>

<template>
  <div class="edit grow">
    <div class="edit-line">
      <input ref="nameInput" v-model="name" class="field" maxlength="120" aria-label="Название" @keydown.enter="save" />
      <button class="icon-btn danger" aria-label="Удалить" @click="remove"><Icon name="trash" :size="16" /></button>
      <button class="icon-btn" aria-label="Готово" @click="save"><Icon name="check" :size="16" /></button>
    </div>
    <div class="edit-line">
      <label class="f">
        <span>Кол-во</span>
        <input v-model="qty" class="field" placeholder="3 шт." maxlength="30" @input="onQty" @keydown.enter="save" />
      </label>
      <label v-if="count" class="f">
        <span>{{ unitLabel }}</span>
        <input
          v-model="unit"
          class="field"
          :class="{ bad: bad === 'unit' }"
          placeholder="₽"
          inputmode="decimal"
          @input="onUnit"
          @keydown.enter="save"
        />
      </label>
      <label class="f">
        <span>Сумма, ₽</span>
        <input
          v-model="total"
          class="field"
          :class="{ bad: bad === 'total' }"
          placeholder="₽"
          inputmode="decimal"
          @input="onTotal"
          @keydown.enter="save"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
/* minmax(0, 1fr) и min-width: 0 — иначе поля берут свою стандартную ширину (~20 символов), строка вылезает
   за край, а фокус прокручивает её так, что кружок уезжает влево. */
.edit { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
.edit-line { display: flex; gap: 6px; align-items: flex-end; min-width: 0; }
.field { width: 100%; border: 0; background: var(--fill); border-radius: var(--r-sm); padding: 4px 8px; outline: none; min-width: 0; }
.field.bad { box-shadow: inset 0 0 0 1.5px var(--red); }
.f { flex: 1 1 0; min-width: 0; display: grid; gap: 2px; }
.f > span { color: var(--label-2); font-size: var(--fs-caption); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn { width: 30px; height: 30px; flex: none; }
.icon-btn.danger { color: var(--red); }
</style>
