<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText } from '../api.ts';
import Icon from '../components/Icon.vue';
import { isCancel, loginWithPasskey, passkeysSupported } from '../passkey.ts';
import { useSession } from '../stores/session.ts';

const session = useSession();
const router = useRouter();
const route = useRoute();
const error = ref('');
const busy = ref(false);
const devName = ref('');

async function done() {
  await session.load();
  router.replace(typeof route.query.next === 'string' ? route.query.next : '/');
}

async function login() {
  error.value = '';
  busy.value = true;
  try {
    await loginWithPasskey();
    await done();
  } catch (e) {
    if (!isCancel(e)) error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

async function devLogin() {
  await api('/api/dev/login', { body: { name: devName.value } });
  await done();
}
</script>

<template>
  <main class="page no-tabs login">
    <div class="hero">
      <div class="logo"><Icon name="sparkle" :size="32" /></div>
      <h1 class="large-title">Бюджет</h1>
      <p class="subtitle">Траты, план и общий список покупок</p>
    </div>

    <button class="btn block" :disabled="busy || !passkeysSupported()" @click="login">
      <Icon name="key" :size="18" /> Войти с passkey
    </button>
    <p v-if="!passkeysSupported()" class="error">Этот браузер не поддерживает passkeys</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p class="section-foot">Регистрация — только по приглашению. Попросите ссылку у того, кто уже пользуется.</p>

    <form v-if="session.devLogin" class="dev" @submit.prevent="devLogin">
      <p class="section-title">Разработка: вход без passkey</p>
      <input v-model="devName" class="input" placeholder="Имя" />
      <button class="btn plain block" :disabled="!devName.trim()">Войти по имени</button>
    </form>
  </main>
</template>

<style scoped>
.login { display: flex; flex-direction: column; justify-content: center; min-height: 100dvh; gap: 12px; }
.hero { text-align: center; margin-bottom: 32px; }
.logo {
  display: inline-grid;
  place-items: center;
  width: 68px;
  height: 68px;
  border-radius: 22px;
  background: var(--acc);
  color: var(--on-acc);
  margin-bottom: 16px;
}
.dev { display: grid; gap: 8px; margin-top: 24px; }
.dev .section-title { margin-left: 4px; }
</style>
