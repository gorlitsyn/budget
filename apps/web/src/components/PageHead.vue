<script setup lang="ts">
import SpaceSwitcher from './SpaceSwitcher.vue';

defineProps<{ title: string; subtitle?: string; switcher?: boolean }>();
</script>

<template>
  <header class="page-head">
    <div>
      <h1 class="large-title">{{ title }}</h1>
      <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
    </div>
    <div class="actions">
      <SpaceSwitcher v-if="switcher" />
      <slot />
    </div>
  </header>
</template>

<style scoped>
.actions { display: flex; align-items: center; gap: 8px; padding-bottom: 4px; }
</style>
