<script setup lang="ts">
// Нижняя шторка поверх экрана (как sheet в iOS). Закрывается по фону и по Esc.
import { onBeforeUnmount, onMounted } from 'vue';

defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();

const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close');
onMounted(() => {
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @click.self="emit('close')">
      <section class="sheet" role="dialog" :aria-label="title">
        <header>
          <button class="link" @click="emit('close')">Отмена</button>
          <h2>{{ title }}</h2>
          <span class="right"><slot name="action" /></span>
        </header>
        <div class="body"><slot /></div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  animation: fade var(--fast) var(--ease);
}
.sheet {
  width: 100%;
  max-width: 640px;
  max-height: 92dvh;
  overflow-y: auto;
  background: var(--bg-el);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  padding: 0 var(--pad) calc(var(--sab) + 24px);
  animation: up 260ms var(--ease);
}
header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  padding: 12px 0 8px;
  background: var(--bg-el);
}
h2 { margin: 0; font-size: var(--fs-body); font-weight: 600; }
.right { justify-self: end; }
.link { justify-self: start; background: none; border: 0; color: var(--acc); padding: 0; }
.body { display: grid; gap: 10px; }
@keyframes up { from { transform: translateY(100%); } }
@keyframes fade { from { opacity: 0; } }
</style>
