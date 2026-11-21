<script setup lang="ts">
// Справочник категорий и подкатегорий. Править можно с правом правки раздела «План».
import type { Category } from '@money/shared';
import { computed, onMounted, ref } from 'vue';
import { api, errorText } from '../api.ts';
import Icon from '../components/Icon.vue';
import PageHead from '../components/PageHead.vue';
import { useDicts } from '../stores/dicts.ts';
import { useSession } from '../stores/session.ts';
import { clientId } from '../storage.ts';

const session = useSession();
const dicts = useDicts();
const owner = computed(() => session.spaceId ?? '');
const canEdit = computed(() => session.can('plan', 'edit'));
const base = computed(() => `/api/spaces/${owner.value}`);
const error = ref('');

async function run(fn: () => Promise<unknown>) {
  error.value = '';
  try {
    await fn();
    await dicts.load(owner.value);
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(() => run(async () => {}));

const add = (parent?: Category) => {
  const name = prompt(parent ? `Подкатегория в «${parent.name}»` : 'Новая категория')?.trim().slice(0, 40);
  if (name) void run(() => api(`${base.value}/categories/${clientId()}`, { method: 'PUT', body: { name, parentId: parent?.id ?? null } }));
};
const rename = (c: Category) => {
  const name = prompt('Название', c.name)?.trim().slice(0, 40);
  if (name && name !== c.name) void run(() => api(`${base.value}/categories/${c.id}`, { method: 'PUT', body: { name, parentId: c.parentId } }));
};
const remove = (c: Category) => {
  const sub = dicts.categories.some((x) => x.parentId === c.id && !x.archived) ? ' вместе с подкатегориями' : '';
  const plan = c.parentId ? '' : ' Статья плана на неё тоже удалится.';
  if (confirm(`Удалить «${c.name}»${sub}? Старые траты сохранят название, новые записать будет нельзя.${plan}`))
    void run(() => api(`${base.value}/categories/${c.id}`, { method: 'DELETE' }));
};
</script>

<template>
  <main class="page">
    <RouterLink to="/more" class="back"><Icon name="chevron" :size="16" class="flip" /> Ещё</RouterLink>
    <PageHead title="Категории" switcher />
    <p v-if="!canEdit" class="viewonly"><span class="pill">Только просмотр</span></p>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="group">
      <template v-for="c in dicts.tree" :key="c.id">
        <div class="row">
          <button class="grow plain-btn" :disabled="!canEdit" @click="rename(c)">{{ c.name }}</button>
          <template v-if="canEdit">
            <button class="icon-btn" :aria-label="`Подкатегория в «${c.name}»`" @click="add(c)"><Icon name="plus" :size="16" /></button>
            <button class="icon-btn" :aria-label="`Удалить «${c.name}»`" @click="remove(c)"><Icon name="trash" :size="16" /></button>
          </template>
        </div>
        <div v-for="s in c.children" :key="s.id" class="row child">
          <button class="grow plain-btn" :disabled="!canEdit" @click="rename(s)">{{ s.name }}</button>
          <button v-if="canEdit" class="icon-btn" :aria-label="`Удалить «${s.name}»`" @click="remove(s)"><Icon name="trash" :size="16" /></button>
        </div>
      </template>
      <button v-if="canEdit" class="row accent" @click="add()"><Icon name="plus" /> Категория</button>
    </div>
    <p v-if="canEdit" class="section-foot">Нажмите на название, чтобы переименовать. «+» у категории — подкатегория.</p>
  </main>
</template>

<style scoped>
.back { display: inline-flex; align-items: center; gap: 2px; margin-left: -6px; }
.flip { transform: rotate(180deg); }
.viewonly { margin: -6px 0 10px; }
.plain-btn { background: none; border: 0; padding: 0; text-align: left; }
.plain-btn:disabled { color: inherit; }
.child { padding-left: 30px; }
.child .plain-btn { color: var(--label-2); }
</style>
