<script setup lang="ts">
import { useRoute } from 'vue-router';
import TabBar from './components/TabBar.vue';
import { useSession } from './stores/session.ts';

const route = useRoute();
const session = useSession();
</script>

<template>
  <RouterView :key="session.spaceId ?? ''" />
  <TabBar v-if="session.me && !route.meta.noTabs" />
</template>
