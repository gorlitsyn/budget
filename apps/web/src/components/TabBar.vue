<script setup lang="ts">
import { computed } from 'vue';
import { useSession } from '../stores/session.ts';
import { TABS } from '../tabs.ts';
import Icon from './Icon.vue';

const session = useSession();
const tabs = computed(() => TABS.filter((t) => t.sections.length === 0 || t.sections.some((s) => session.can(s))));
</script>

<template>
  <nav class="tabbar">
    <RouterLink v-for="t in tabs" :key="t.path" :to="t.path" class="tab" active-class="on">
      <Icon :name="t.icon" :size="22" />
      <span>{{ t.title }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  inset: auto 0 0 0;
  height: var(--tabbar-h);
  padding-bottom: var(--sab);
  display: flex;
  justify-content: space-around;
  background: var(--bar);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: 0.5px solid var(--sep);
  z-index: 10;
}
.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--label-3);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.01em;
}
.tab.on { color: var(--acc); }
</style>
