<script setup lang="ts">
import type { PasskeyInfo } from '@money/shared';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { SOURCE_URL } from '../about.ts';
import { api, errorText } from '../api.ts';
import Icon from '../components/Icon.vue';
import PageHead from '../components/PageHead.vue';
import { dateText } from '../grants-text.ts';
import { addPasskey, isCancel } from '../passkey.ts';
import { ACCENTS, accent, theme } from '../prefs.ts';
import { forceUpdate, serverRevision } from '../pwa.ts';
import { useSession } from '../stores/session.ts';

const session = useSession();
const revision = __APP_REVISION__;
const router = useRouter();
const passkeys = ref<PasskeyInfo[]>([]);
const name = ref(session.me?.name ?? '');
const error = ref('');

const loadPasskeys = async () => (passkeys.value = await api<PasskeyInfo[]>('/api/auth/passkeys'));
const server = ref<string | null>(null);
const updating = ref(false);
onMounted(async () => {
  void loadPasskeys();
  server.value = await serverRevision();
});
const outdated = computed(() => !!server.value && server.value !== 'dev' && server.value !== revision);
async function update() {
  updating.value = true;
  await forceUpdate();
}

async function run(fn: () => Promise<unknown>) {
  error.value = '';
  try {
    await fn();
  } catch (e) {
    if (!isCancel(e)) error.value = errorText(e);
  }
}

const saveName = () =>
  run(async () => {
    const v = name.value.trim();
    if (!v || v === session.me?.name) return;
    await api('/api/me', { method: 'PATCH', body: { name: v } });
    await session.load();
  });

const add = () => run(async () => (await addPasskey(), await loadPasskeys()));
const rename = (p: PasskeyInfo) =>
  run(async () => {
    const v = prompt('Название passkey', p.name)?.trim();
    if (!v) return;
    await api(`/api/auth/passkeys/${p.id}`, { method: 'PATCH', body: { name: v } });
    await loadPasskeys();
  });
const remove = (p: PasskeyInfo) =>
  run(async () => {
    if (!confirm(`Удалить passkey «${p.name}»? С этого устройства войти будет нельзя.`)) return;
    await api(`/api/auth/passkeys/${p.id}`, { method: 'DELETE' });
    await loadPasskeys();
  });

const logout = (everywhere: boolean) =>
  run(async () => {
    if (everywhere && !confirm('Выйти на всех устройствах? Войти снова можно будет по passkey.')) return;
    await session.logout(everywhere);
    router.replace('/login');
  });

const THEMES = [
  { v: 'system', t: 'Авто' },
  { v: 'dark', t: 'Тёмная' },
  { v: 'light', t: 'Светлая' },
] as const;
</script>

<template>
  <main class="page">
    <PageHead title="Ещё" />

    <p class="section-title">Профиль</p>
    <div class="group">
      <label class="row">
        <span>Имя</span>
        <input v-model="name" class="input grow" maxlength="40" @blur="saveName" @keydown.enter="($event.target as HTMLInputElement).blur()" />
      </label>
    </div>

    <template v-if="session.can('plan') || session.can('transactions')">
      <p class="section-title">Данные</p>
      <div class="group">
        <RouterLink to="/more/categories" class="row">
          <Icon name="tag" />
          <span class="grow">Категории</span>
          <Icon name="chevron" :size="16" class="muted" />
        </RouterLink>
      </div>
    </template>

    <p class="section-title">Совместное использование</p>
    <div class="group">
      <RouterLink to="/more/sharing" class="row">
        <Icon name="people" />
        <span class="grow">Доступ и приглашения</span>
        <Icon name="chevron" :size="16" class="muted" />
      </RouterLink>
    </div>
    <p class="section-foot">Кому открыты ваши разделы и чьи разделы открыты вам.</p>

    <p class="section-title">Passkeys</p>
    <div class="group">
      <div v-for="p in passkeys" :key="p.id" class="row">
        <Icon name="key" />
        <button class="grow plain-btn" @click="rename(p)">
          <div>{{ p.name }}</div>
          <div class="sub">
            Добавлен {{ dateText(p.createdAt) }}<template v-if="p.lastUsedAt"> · вход {{ dateText(p.lastUsedAt) }}</template>
          </div>
        </button>
        <button v-if="passkeys.length > 1" class="icon-btn" aria-label="Удалить" @click="remove(p)"><Icon name="trash" :size="16" /></button>
      </div>
      <button class="row accent" @click="add"><Icon name="plus" /> Добавить passkey</button>
    </div>
    <p class="section-foot">Passkey из iCloud работает на всех ваших устройствах Apple. Отдельный нужен для устройства с другим аккаунтом.</p>

    <p class="section-title">Оформление</p>
    <div class="group">
      <div class="row">
        <span class="grow">Тема</span>
        <div class="segmented theme">
          <button v-for="o in THEMES" :key="o.v" :class="{ on: theme === o.v }" @click="theme = o.v">{{ o.t }}</button>
        </div>
      </div>
      <div class="row">
        <span class="grow">Акцент</span>
        <div class="swatches">
          <button
            v-for="a in ACCENTS"
            :key="a"
            class="swatch"
            :class="{ on: accent === a }"
            :style="{ background: `var(--${a})` }"
            :aria-label="a"
            @click="accent = a"
          />
        </div>
      </div>
    </div>

    <p class="section-title">Приложение</p>
    <div class="group">
      <div class="row">
        <span class="grow">Версия</span>
        <span class="meta">{{ revision }}</span>
      </div>
      <div class="row">
        <span class="grow">На сервере</span>
        <span class="meta" :class="{ warn: outdated }">{{ server ?? 'нет связи' }}</span>
      </div>
      <a class="row source" :href="SOURCE_URL" target="_blank" rel="noopener">
        <span class="grow">Исходный код</span>
        <span class="meta">AGPL-3.0</span>
      </a>
      <button class="row accent" :disabled="updating" @click="update">
        {{ updating ? 'Обновляю…' : outdated ? 'Обновить до новой версии' : 'Обновить принудительно' }}
      </button>
    </div>
    <p class="section-foot">Перезагружает приложение с сервера, минуя кэш. Вход и несохранённые покупки не теряются.</p>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="group exit">
      <button class="row danger" @click="logout(false)"><Icon name="logout" /> Выйти</button>
      <button class="row danger" @click="logout(true)">Выйти на всех устройствах</button>
    </div>
  </main>
</template>

<style scoped>
.plain-btn { background: none; border: 0; padding: 0; text-align: left; }
.source { color: var(--label); }
.theme { width: 200px; }
.swatches { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.swatch { width: 22px; height: 22px; border-radius: 50%; border: 0; padding: 0; }
.swatch.on { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--label-2); }
.exit { margin-top: 32px; }
.warn { color: var(--orange); }
a.row { color: inherit; }
</style>
