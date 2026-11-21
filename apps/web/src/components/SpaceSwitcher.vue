<script setup lang="ts">
// Чьё пространство открыто: своё или чужое, куда пустили. Без чужих пространств не показывается.
import { useRouter } from 'vue-router';
import { useSession } from '../stores/session.ts';
import { TABS } from '../tabs.ts';

const session = useSession();
const router = useRouter();

function onChange(e: Event) {
  session.switchSpace((e.target as HTMLSelectElement).value);
  // В новом пространстве текущей вкладки может не быть — уходим на первую доступную.
  const cur = TABS.find((t) => router.currentRoute.value.path.startsWith(t.path));
  if (cur && cur.sections.length && !cur.sections.some((s) => session.can(s))) {
    const first = TABS.find((t) => t.sections.length === 0 || t.sections.some((s) => session.can(s)))!;
    router.replace(first.path);
  }
}
</script>

<template>
  <label v-if="session.spaces.length && session.me" class="switcher">
    <span class="dot" :class="{ shared: !session.isOwn }" />
    <select :value="session.spaceId ?? ''" aria-label="Чьё пространство" @change="onChange">
      <option :value="session.me.id">Моё</option>
      <option v-for="s in session.spaces" :key="s.ownerId" :value="s.ownerId">{{ s.ownerName }}</option>
    </select>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9l6 6 6-6" /></svg>
  </label>
</template>

<style scoped>
.switcher {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--fill);
  color: var(--acc);
  font-size: var(--fs-subhead);
  font-weight: 600;
}
select {
  appearance: none;
  border: 0;
  background: none;
  color: inherit;
  font-weight: inherit;
  outline: none;
  padding: 0;
}
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--acc); }
.dot.shared { background: var(--orange); }
</style>
