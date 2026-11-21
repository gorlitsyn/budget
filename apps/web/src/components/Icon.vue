<script setup lang="ts">
import { type IconName, PATHS } from '../icons.ts';

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 24 });
</script>


<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="PATHS[props.name]" />
  </svg>
</template>
