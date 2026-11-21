<script setup lang="ts">
// Переключатель месяца: стрелки, нажатие на название — к текущему месяцу.
import { addMonths, monthTitle, thisMonth } from '../money.ts';
import Icon from './Icon.vue';

const month = defineModel<string>({ required: true });
</script>

<template>
  <nav class="month">
    <button class="icon-btn" aria-label="Предыдущий месяц" @click="month = addMonths(month, -1)"><Icon name="chevron" :size="16" class="flip" /></button>
    <button class="title" :aria-label="`${monthTitle(month)}, вернуться к текущему месяцу`" @click="month = thisMonth()">{{ monthTitle(month) }}</button>
    <button class="icon-btn" aria-label="Следующий месяц" @click="month = addMonths(month, 1)"><Icon name="chevron" :size="16" /></button>
  </nav>
</template>

<style scoped>
.month { display: flex; align-items: center; justify-content: space-between; margin: -4px 0 10px; }
.title { background: none; border: 0; font-size: var(--fs-title); font-weight: 600; }
.flip { transform: rotate(180deg); }
</style>
