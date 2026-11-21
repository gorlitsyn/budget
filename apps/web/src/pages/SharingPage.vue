<script setup lang="ts">
import type { Grants, InviteInfo, Member } from '@money/shared';
import { computed, onMounted, ref } from 'vue';
import { api, errorText } from '../api.ts';
import GrantsEditor from '../components/GrantsEditor.vue';
import Icon from '../components/Icon.vue';
import { dateText, grantsText } from '../grants-text.ts';
import { useSession } from '../stores/session.ts';

const session = useSession();
const members = ref<Member[]>([]);
const invites = ref<InviteInfo[]>([]);
const error = ref('');

// Новый инвайт
const creating = ref(false);
const note = ref('');
const grants = ref<Grants>({ shopping: 'edit' });
const link = ref('');
const copied = ref(false);

// Правка участника
const editing = ref<string | null>(null);
const editGrants = ref<Grants>({});

const pending = computed(() => invites.value.filter((i) => !i.usedBy));
const used = computed(() => invites.value.filter((i) => i.usedBy));
const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

async function load() {
  [members.value, invites.value] = await Promise.all([
    api<Member[]>('/api/sharing/members'),
    api<InviteInfo[]>('/api/sharing/invites'),
  ]);
}
onMounted(() => run(load));

async function run(fn: () => Promise<unknown>) {
  error.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = errorText(e);
  }
}

const createInvite = () =>
  run(async () => {
    const r = await api<{ url: string }>('/api/sharing/invites', { body: { note: note.value, grants: grants.value } });
    link.value = r.url;
    await load();
  });

function resetInvite() {
  creating.value = false;
  link.value = '';
  note.value = '';
  grants.value = { shopping: 'edit' };
  copied.value = false;
}

async function copy() {
  await navigator.clipboard.writeText(link.value);
  copied.value = true;
}
const share = () => run(() => navigator.share({ title: 'Приглашение в «Бюджет»', url: link.value }));

const revoke = (i: InviteInfo) =>
  run(async () => {
    await api(`/api/sharing/invites/${i.id}`, { method: 'DELETE' });
    await load();
  });

function startEdit(m: Member) {
  editing.value = m.userId;
  editGrants.value = { ...m.grants };
}
const saveEdit = (m: Member) =>
  run(async () => {
    await api(`/api/sharing/members/${m.userId}`, { method: 'PUT', body: { grants: editGrants.value } });
    editing.value = null;
    await load();
  });
const removeMember = (m: Member) =>
  run(async () => {
    if (!confirm(`Закрыть ${m.name} доступ ко всем разделам?`)) return;
    await api(`/api/sharing/members/${m.userId}`, { method: 'DELETE' });
    editing.value = null;
    await load();
  });

const leave = (ownerId: string, name: string) =>
  run(async () => {
    if (!confirm(`Отказаться от доступа к разделам ${name}? Вернуть можно только новым приглашением.`)) return;
    await api(`/api/sharing/spaces/${ownerId}`, { method: 'DELETE' });
    await session.load();
  });
</script>

<template>
  <main class="page">
    <RouterLink to="/more" class="back"><Icon name="chevron" :size="16" class="flip" /> Ещё</RouterLink>
    <header class="page-head"><h1 class="large-title">Доступ</h1></header>

    <!-- Новое приглашение -->
    <div v-if="!creating" class="group">
      <button class="row accent" @click="creating = true"><Icon name="plus" /> Пригласить</button>
    </div>
    <template v-else>
      <p class="section-title">Новое приглашение</p>
      <template v-if="!link">
        <input v-model="note" class="input" placeholder="Для кого, например «Жена»" maxlength="60" />
        <p class="section-title">Что открыть</p>
        <GrantsEditor v-model="grants" />
        <p class="section-foot">
          Человек видит только отмеченные разделы. «Сводка» без «Трат» — итоги по категориям без отдельных покупок.
          Ссылка одноразовая, действует 7 дней. Если у человека ещё нет аккаунта, по ней он и зарегистрируется.
        </p>
        <div class="actions">
          <button class="btn plain" @click="resetInvite">Отмена</button>
          <button class="btn" @click="createInvite">Создать ссылку</button>
        </div>
      </template>
      <template v-else>
        <div class="group">
          <div class="row"><code class="grow link">{{ link }}</code></div>
        </div>
        <p class="section-foot">Ссылка показывается один раз. Отправьте её сейчас — потом можно будет только создать новую.</p>
        <div class="actions">
          <button class="btn plain" @click="copy"><Icon name="copy" :size="18" /> {{ copied ? 'Скопировано' : 'Копировать' }}</button>
          <button v-if="canShare" class="btn" @click="share"><Icon name="share" :size="18" /> Отправить</button>
          <button class="btn plain" @click="resetInvite">Готово</button>
        </div>
      </template>
    </template>

    <p v-if="error" class="error">{{ error }}</p>

    <!-- Кому открыт доступ -->
    <p class="section-title">Мои разделы открыты</p>
    <div v-if="members.length" class="group">
      <template v-for="m in members" :key="m.userId">
        <button class="row" @click="editing === m.userId ? (editing = null) : startEdit(m)">
          <div class="grow">
            <div>{{ m.name }}</div>
            <div class="sub">{{ grantsText(m.grants) }}</div>
          </div>
          <Icon name="chevron" :size="16" class="muted" :class="{ open: editing === m.userId }" />
        </button>
        <div v-if="editing === m.userId" class="edit">
          <GrantsEditor v-model="editGrants" />
          <div class="actions">
            <button class="btn plain small danger-text" @click="removeMember(m)">Закрыть всё</button>
            <button class="btn small" @click="saveEdit(m)">Сохранить</button>
          </div>
        </div>
      </template>
    </div>
    <p v-else class="section-foot">Пока никому. Создайте приглашение выше.</p>

    <!-- Приглашения -->
    <template v-if="pending.length">
      <p class="section-title">Ждут ответа</p>
      <div class="group">
        <div v-for="i in pending" :key="i.id" class="row">
          <div class="grow">
            <div>{{ i.note || 'Без подписи' }}</div>
            <div class="sub">{{ grantsText(i.grants) }} · до {{ dateText(i.expiresAt) }}</div>
          </div>
          <button class="btn plain small" @click="revoke(i)">Отозвать</button>
        </div>
      </div>
    </template>
    <template v-if="used.length">
      <p class="section-title">Приняты</p>
      <div class="group">
        <div v-for="i in used" :key="i.id" class="row">
          <div class="grow">
            <div>{{ i.note || 'Без подписи' }} → {{ i.usedByName ?? 'аккаунт удалён' }}</div>
            <div class="sub">{{ grantsText(i.grants) }}</div>
          </div>
          <Icon name="check" class="ok" />
        </div>
      </div>
    </template>

    <!-- Мне открыли -->
    <p class="section-title">Мне открыли</p>
    <div v-if="session.spaces.length" class="group">
      <div v-for="s in session.spaces" :key="s.ownerId" class="row">
        <div class="grow">
          <div>{{ s.ownerName }}</div>
          <div class="sub">{{ grantsText(s.grants) }}</div>
        </div>
        <button class="btn plain small" @click="leave(s.ownerId, s.ownerName)">Отказаться</button>
      </div>
    </div>
    <p v-else class="section-foot">Чужих разделов нет. Они появятся, когда вы примете чьё-то приглашение.</p>
  </main>
</template>

<style scoped>
.back { display: inline-flex; align-items: center; gap: 2px; font-size: var(--fs-body); margin-left: -6px; }
.flip { transform: rotate(180deg); }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; flex-wrap: wrap; }
.link { font-size: var(--fs-footnote); word-break: break-all; color: var(--label); }
.edit { padding: 0 12px 12px; }
.edit .group { background: var(--surface-2); }
.open { transform: rotate(90deg); }
.danger-text { color: var(--red); }
.ok { color: var(--green); }
.page-head { margin-top: 4px; }
</style>
