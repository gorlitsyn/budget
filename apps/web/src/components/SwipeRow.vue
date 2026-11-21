<script setup lang="ts">
/**
 * Строка со свайпом влево: открывает красную кнопку «Удалить», длинный свайп удаляет сразу (как в iOS).
 * Вертикальная прокрутка не мешает: направление фиксируется по первым 8 px движения, touch-action: pan-y.
 */
import { onBeforeUnmount, ref } from 'vue';

const props = withDefaults(defineProps<{ disabled?: boolean; label?: string }>(), { disabled: false, label: 'Удалить' });
const emit = defineEmits<{ delete: [] }>();

const ACTION_W = 84;
const root = ref<HTMLElement>();
const x = ref(0);
const animate = ref(true);

let sx = 0;
let sy = 0;
let base = 0;
let mode: 'h' | 'v' | null = null;
let pointer = -1;
let dragging = false;
let moved = false;

const close = () => {
  animate.value = true;
  x.value = 0;
};
onBeforeUnmount(() => {
  if (openRow === close) openRow = null;
});

function down(e: PointerEvent) {
  if (props.disabled || e.button > 0) return;
  sx = e.clientX;
  sy = e.clientY;
  base = x.value;
  mode = null;
  moved = false;
  pointer = e.pointerId;
  dragging = true;
}

function move(e: PointerEvent) {
  if (!dragging || e.pointerId !== pointer) return;
  const dx = e.clientX - sx;
  const dy = e.clientY - sy;
  if (!mode) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    mode = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    if (mode === 'h') {
      (e.currentTarget as Element).setPointerCapture(pointer);
      if (openRow && openRow !== close) openRow();
      openRow = close;
    }
  }
  if (mode !== 'h') return;
  moved = true;
  animate.value = false;
  const width = root.value?.offsetWidth ?? 320;
  x.value = Math.min(0, Math.max(-width, base + dx));
}

function up() {
  if (!dragging) return;
  dragging = false;
  if (mode !== 'h') return;
  animate.value = true;
  const width = root.value?.offsetWidth ?? 320;
  if (-x.value > width * 0.55) {
    x.value = -width;
    setTimeout(() => emit('delete'), 160);
  } else {
    x.value = -x.value > ACTION_W / 2 ? -ACTION_W : 0;
  }
}

/** Нажатие после свайпа или по открытой строке — закрыть её, а не открывать позицию. */
function clickCapture(e: MouseEvent) {
  if (moved || x.value !== 0) {
    e.stopPropagation();
    e.preventDefault();
    if (!moved) close();
    moved = false;
  }
}
</script>

<script lang="ts">
/** Открыта может быть только одна строка. */
let openRow: (() => void) | null = null;
</script>

<template>
  <div ref="root" class="swipe">
    <!-- Показываем только при сдвиге: иначе на стыке строк красное просвечивает тонкой полосой. -->
    <button v-if="!disabled && x < 0" class="action" tabindex="-1" @click="emit('delete')">{{ label }}</button>
    <div
      class="content"
      :class="{ animate }"
      :style="{ transform: `translateX(${x}px)` }"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
      @click.capture="clickCapture"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.swipe { position: relative; overflow: hidden; touch-action: pan-y; }
.swipe + .swipe::before {
  content: '';
  position: absolute;
  top: 0;
  left: 14px;
  right: 0;
  border-top: 0.5px solid var(--sep);
  z-index: 2;
}
.action {
  position: absolute;
  inset: 0 0 0 auto;
  width: 100%;
  border: 0;
  background: var(--red);
  color: #fff;
  font-weight: 600;
  font-size: var(--fs-subhead);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 18px;
}
.content { position: relative; background: var(--surface); }
.content.animate { transition: transform 200ms var(--ease); }
</style>
