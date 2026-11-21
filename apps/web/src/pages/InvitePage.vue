<script setup lang="ts">
import type { InvitePreview } from '@money/shared';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorText } from '../api.ts';
import Icon from '../components/Icon.vue';
import { grantsText } from '../grants-text.ts';
import { isCancel, passkeysSupported, registerWithPasskey } from '../passkey.ts';
import { useSession } from '../stores/session.ts';

const props = defineProps<{ token: string }>();
const session = useSession();
const router = useRouter();

const preview = ref<InvitePreview | null>(null);
const loadError = ref('');
const error = ref('');
const busy = ref(false);
const name = ref('');

onMounted(async () => {
  try {
    preview.value = await api<InvitePreview>(`/api/invites/${props.token}`);
  } catch (e) {
    loadError.value = errorText(e);
  }
});

const title = computed(() =>
  preview.value?.ownerName ? `${preview.value.ownerName} приглашает вас` : 'Приглашение в «Бюджет»',
);

async function finish(ownerId: string | null) {
  await session.load();
  if (ownerId) session.switchSpace(ownerId);
  router.replace('/');
}

async function register() {
  error.value = '';
  busy.value = true;
  try {
    await registerWithPasskey(props.token, name.value.trim());
    await session.load();
    // Владелец инвайта теперь в spaces; если он есть — открываем его пространство.
    await finish(session.spaces[0]?.ownerId ?? null);
  } catch (e) {
    if (!isCancel(e)) error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

async function accept() {
  error.value = '';
  busy.value = true;
  try {
    const r = await api<{ ownerId: string }>(`/api/invites/${props.token}/accept`, { method: 'POST' });
    await finish(r.ownerId);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="page no-tabs invite">
    <div v-if="loadError" class="empty">
      <div class="icon"><Icon name="link" :size="40" /></div>
      <h2>Ссылка не работает</h2>
      <p>{{ loadError }}</p>
      <RouterLink to="/">На главную</RouterLink>
    </div>

    <template v-else-if="preview">
      <h1 class="large-title">{{ title }}</h1>
      <p v-if="!preview.system" class="subtitle">Доступ: {{ grantsText(preview.grants) }}</p>
      <p v-else class="subtitle">Ссылка для регистрации</p>

      <!-- Уже вошёл: принять доступ к чужому пространству -->
      <template v-if="session.me">
        <p v-if="preview.system" class="section-foot">Вы уже зарегистрированы как {{ session.me.name }}.</p>
        <button v-else class="btn block start" :disabled="busy" @click="accept">Принять как {{ session.me.name }}</button>
      </template>

      <!-- Новый человек: имя + passkey -->
      <form v-else class="start" @submit.prevent="register">
        <p class="section-title">Как вас называть</p>
        <input v-model="name" class="input" placeholder="Имя" maxlength="40" autocomplete="given-name" />
        <p class="section-foot">Видно тем, с кем вы делитесь. Вход — по Face ID / Touch ID через passkey, без пароля.</p>
        <button class="btn block" :disabled="busy || !name.trim() || !passkeysSupported()">
          <Icon name="key" :size="18" /> Создать passkey
        </button>
        <RouterLink class="have" :to="{ path: '/login', query: { next: `/invite/${token}` } }">У меня уже есть аккаунт</RouterLink>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </template>
  </main>
</template>

<style scoped>
.invite { min-height: 100dvh; display: flex; flex-direction: column; justify-content: center; }
.start { margin-top: 32px; display: grid; gap: 10px; }
.start .section-title { margin: 0 4px; }
.start .section-foot { margin: 0 4px 12px; }
.have { text-align: center; margin-top: 8px; font-size: var(--fs-subhead); }
</style>
