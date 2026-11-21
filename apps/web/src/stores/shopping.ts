/**
 * Покупки с офлайн-очередью. Каждое изменение сразу применяется на экране, ложится в очередь
 * (localStorage) и отправляется по порядку. Нет сети — очередь ждёт; id записей создаёт клиент,
 * поэтому повтор безопасен. Изменения других людей приходят по SSE.
 */
import { SSE_DEAD_MS, type ShoppingEvent, type ShoppingItem, type ShoppingList, type ShoppingState } from '@money/shared';
import { defineStore } from 'pinia';
import { ApiError, api } from '../api.ts';
import { clientId, load, save } from '../storage.ts';
import { useSession } from './session.ts';

type ItemBody = { listId: string; name: string; qty: string; checked: boolean; price?: number | null };
type Op =
  | { kind: 'item'; id: string; body: ItemBody }
  | { kind: 'del-item'; id: string }
  | { kind: 'list'; id: string; name: string }
  | { kind: 'del-list'; id: string }
  | { kind: 'clear'; listId: string };

const RETRY_MS = 5000;

export const useShopping = defineStore('shopping', {
  state: () => ({
    ownerId: '',
    lists: [] as ShoppingList[],
    items: [] as ShoppingItem[],
    people: {} as Record<string, string>,
    listId: '',
    queue: [] as Op[],
    /** SSE открыт — изменения других приходят сразу (зелёная точка). */
    live: false,
    /**
     * Связь пропала по-настоящему: ошибка запроса или потока. Отдельно от live: пока поток только
     * подключается (доли секунды при каждом открытии раздела), это не «нет связи».
     */
    offline: false,
    loaded: false,
    error: '',
  }),
  getters: {
    list: (s) => s.lists.find((l) => l.id === s.listId) ?? s.lists[0],
    current(s): ShoppingItem[] {
      const id = this.list?.id;
      return s.items.filter((i) => i.listId === id);
    },
    toBuy(): ShoppingItem[] {
      return this.current.filter((i) => !i.checked).sort((a, b) => a.createdAt - b.createdAt);
    },
    bought(): ShoppingItem[] {
      return this.current.filter((i) => i.checked).sort((a, b) => b.updatedAt - a.updatedAt);
    },
  },
  actions: {
    base() {
      return `/api/spaces/${this.ownerId}/shopping`;
    },
    persist() {
      save(`shop:${this.ownerId}`, { lists: this.lists, items: this.items, people: this.people, listId: this.listId });
      save(`shopq:${this.ownerId}`, this.queue);
    },

    /** Открыть пространство: сначала кэш (мгновенно и без сети), потом сервер и живые обновления. */
    async open(ownerId: string) {
      this.close();
      this.$reset();
      this.ownerId = ownerId;
      const cached = load<ShoppingState & { listId: string }>(`shop:${ownerId}`);
      if (cached) {
        Object.assign(this, { lists: cached.lists, items: cached.items, people: cached.people, listId: cached.listId, loaded: true });
      }
      this.queue = load<Op[]>(`shopq:${ownerId}`) ?? [];
      this.connect();
      await this.refresh();
    },

    async refresh() {
      try {
        const s = await api<ShoppingState>(this.base());
        this.lists = s.lists;
        this.items = s.items;
        this.people = s.people;
        // Ещё не отправленное поверх ответа сервера — иначе оно мигнёт и пропадёт.
        for (const op of this.queue) this.apply(op);
        if (!this.lists.some((l) => l.id === this.listId)) this.listId = this.lists[0]?.id ?? '';
        this.loaded = true;
        this.error = '';
        this.offline = false;
        this.persist();
        void this.flush();
      } catch (e) {
        if (e instanceof ApiError) this.error = e.message;
        else this.offline = true;
        this.live = false;
      }
    },

    // ---- живые обновления --------------------------------------------------------------------

    connect() {
      if (typeof EventSource === 'undefined') return;
      stopped.delete(this.$id);
      const es = new EventSource(`${this.base()}/events`);
      es.onopen = () => {
        // Пока соединения не было, могли пропустить события — перечитываем.
        if (!this.live) void this.refresh();
        this.live = true;
        this.offline = false;
      };
      es.onerror = () => {
        this.live = false;
        this.offline = true;
        // На сетевой обрыв EventSource переподключается сам, а на ответ-ошибку (502 от nginx, пока
        // api перезапускается при деплое) закрывается навсегда. Тогда переподключаемся сами.
        if (es.readyState === EventSource.CLOSED && sources.get(this.$id) === es) {
          sources.delete(this.$id);
          setTimeout(() => {
            if (!sources.has(this.$id) && !stopped.has(this.$id)) this.connect();
          }, RETRY_MS);
        }
      };
      es.onmessage = (m) => {
        this.watch(es);
        this.receive(JSON.parse(m.data) as ShoppingEvent);
      };
      sources.set(this.$id, es);
      this.watch(es);
    },
    /**
     * Сторож: сервер шлёт ping каждые 20 с. Тишина дольше 50 с — соединение полуоткрытое (прокси или
     * мобильная сеть держат сокет, а сервера за ним уже нет): переподключаемся и перечитываем.
     */
    watch(es: EventSource) {
      clearTimeout(watchdogs.get(this.$id));
      watchdogs.set(
        this.$id,
        setTimeout(() => {
          if (sources.get(this.$id) !== es) return;
          this.live = false;
          es.close();
          sources.delete(this.$id);
          this.connect();
        }, SSE_DEAD_MS),
      );
    },
    close() {
      clearTimeout(watchdogs.get(this.$id));
      stopped.add(this.$id); // и отложенное переподключение не сработает
      sources.get(this.$id)?.close();
      sources.delete(this.$id);
    },

    receive(ev: ShoppingEvent) {
      const pending = (id: string) => this.queue.some((op) => 'id' in op && op.id === id);
      if (ev.type === 'ping') return;
      if (ev.type === 'item') {
        if (pending(ev.item.id)) return; // своё неотправленное важнее
        const i = this.items.findIndex((x) => x.id === ev.item.id);
        if (i >= 0) this.items[i] = ev.item;
        else this.items.push(ev.item);
      } else if (ev.type === 'item-deleted') {
        this.items = this.items.filter((x) => x.id !== ev.id);
      } else if (ev.type === 'list') {
        const i = this.lists.findIndex((x) => x.id === ev.list.id);
        if (i >= 0) this.lists[i] = ev.list;
        else this.lists.push(ev.list);
      } else if (ev.type === 'list-deleted') {
        this.lists = this.lists.filter((x) => x.id !== ev.id);
        this.items = this.items.filter((x) => x.listId !== ev.id);
        if (this.listId === ev.id) this.listId = this.lists[0]?.id ?? '';
      }
      this.persist();
    },

    // ---- изменения ---------------------------------------------------------------------------

    /** Применить операцию к локальному состоянию (и при вводе, и поверх свежего ответа сервера). */
    apply(op: Op) {
      const me = useSession().me?.id ?? '';
      const now = Date.now();
      if (op.kind === 'item') {
        const cur = this.items.find((i) => i.id === op.id);
        if (cur) {
          if (cur.checked !== op.body.checked) cur.checkedBy = op.body.checked ? me : null;
          Object.assign(cur, op.body, { updatedAt: now });
        } else {
          this.items.push({ id: op.id, ...op.body, price: op.body.price ?? null, addedBy: me, checkedBy: op.body.checked ? me : null, createdAt: now, updatedAt: now });
        }
      } else if (op.kind === 'del-item') {
        this.items = this.items.filter((i) => i.id !== op.id);
      } else if (op.kind === 'list') {
        const cur = this.lists.find((l) => l.id === op.id);
        if (cur) cur.name = op.name;
        else this.lists.push({ id: op.id, name: op.name, createdAt: now });
      } else if (op.kind === 'del-list') {
        this.lists = this.lists.filter((l) => l.id !== op.id);
        this.items = this.items.filter((i) => i.listId !== op.id);
      } else if (op.kind === 'clear') {
        this.items = this.items.filter((i) => !(i.listId === op.listId && i.checked));
      }
    },

    enqueue(op: Op) {
      this.apply(op);
      // Несколько правок одной позиции до отправки — достаточно последней.
      if (op.kind === 'item') this.queue = this.queue.filter((q) => !(q.kind === 'item' && q.id === op.id));
      this.queue.push(op);
      this.persist();
      void this.flush();
    },

    async flush() {
      if (flushing.has(this.$id)) return;
      flushing.add(this.$id);
      try {
        while (this.queue.length) {
          const op = this.queue[0]!;
          try {
            await send(this.base(), op);
          } catch (e) {
            if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
              // Сервер отверг навсегда (нет прав, удалено) — выбрасываем и показываем правду с сервера.
              this.error = e.message;
              this.queue.shift();
              this.persist();
              void this.refresh();
              continue;
            }
            // Нет сети или сервер недоступен — ждём и повторяем.
            this.live = false;
            this.offline = true;
            setTimeout(() => void this.flush(), RETRY_MS);
            return;
          }
          this.queue.shift();
          this.persist();
        }
      } finally {
        flushing.delete(this.$id);
      }
    },

    add(name: string) {
      const n = name.trim();
      if (!n || !this.list) return;
      // Уже есть в «купить» — не дублируем; есть в купленном — возвращаем в список.
      const same = this.current.find((i) => i.name.toLowerCase() === n.toLowerCase());
      if (same && !same.checked) return;
      if (same) return this.update(same, { checked: false });
      this.enqueue({ kind: 'item', id: clientId(), body: { listId: this.list.id, name: n, qty: '', checked: false } });
    },
    update(item: ShoppingItem, patch: Partial<ItemBody>) {
      const body = { listId: item.listId, name: item.name, qty: item.qty, checked: item.checked, price: item.price, ...patch };
      this.enqueue({ kind: 'item', id: item.id, body });
    },
    toggle(item: ShoppingItem) {
      this.update(item, { checked: !item.checked });
    },
    remove(item: ShoppingItem) {
      this.enqueue({ kind: 'del-item', id: item.id });
    },
    clearBought() {
      if (this.list) this.enqueue({ kind: 'clear', listId: this.list.id });
    },
    addList(name: string) {
      const id = clientId();
      this.enqueue({ kind: 'list', id, name: name.trim() });
      this.listId = id;
      this.persist();
    },
    renameList(id: string, name: string) {
      this.enqueue({ kind: 'list', id, name: name.trim() });
    },
    removeList(id: string) {
      this.enqueue({ kind: 'del-list', id });
      this.listId = this.lists[0]?.id ?? '';
      this.persist();
    },
    select(id: string) {
      this.listId = id;
      this.persist();
    },
  },
});

const sources = new Map<string, EventSource>();
const flushing = new Set<string>();
const stopped = new Set<string>();
const watchdogs = new Map<string, ReturnType<typeof setTimeout>>();

async function send(base: string, op: Op): Promise<void> {
  try {
    if (op.kind === 'item') await api(`${base}/items/${op.id}`, { method: 'PUT', body: op.body });
    else if (op.kind === 'del-item') await api(`${base}/items/${op.id}`, { method: 'DELETE' });
    else if (op.kind === 'list') await api(`${base}/lists/${op.id}`, { method: 'PUT', body: { name: op.name } });
    else if (op.kind === 'del-list') await api(`${base}/lists/${op.id}`, { method: 'DELETE' });
    else await api(`${base}/lists/${op.listId}/clear-checked`, { method: 'POST' });
  } catch (e) {
    // Удаление того, чего на сервере уже нет, — цель достигнута.
    if (e instanceof ApiError && e.status === 404 && (op.kind === 'del-item' || op.kind === 'del-list')) return;
    throw e;
  }
}
