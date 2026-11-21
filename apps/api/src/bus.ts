/**
 * Живые обновления: подписки SSE по пространствам. Один процесс api — шина в памяти.
 * Перед каждой отправкой права перепроверяются: закрытый доступ отрезает поток сразу.
 */
import type { Section } from '@money/shared';
import type { Store } from './store.ts';

interface Sub {
  userId: string;
  send: (data: string) => void;
  close: () => void;
}

export class Bus {
  private subs = new Map<string, Set<Sub>>();
  constructor(private store: Store) {}

  private key = (ownerId: string, section: Section) => `${section}:${ownerId}`;

  subscribe(ownerId: string, section: Section, sub: Sub): () => void {
    const k = this.key(ownerId, section);
    let set = this.subs.get(k);
    if (!set) this.subs.set(k, (set = new Set()));
    set.add(sub);
    return () => {
      set.delete(sub);
      if (set.size === 0) this.subs.delete(k);
    };
  }

  publish(ownerId: string, section: Section, event: unknown): void {
    const set = this.subs.get(this.key(ownerId, section));
    if (!set) return;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const sub of [...set]) {
      if (this.store.grantsIn(ownerId, sub.userId)[section]) sub.send(data);
      else sub.close();
    }
  }

  /** При остановке сервера: иначе app.close() ждёт открытые потоки, и docker stop убивает по таймауту. */
  closeAll(): void {
    for (const set of this.subs.values()) for (const sub of [...set]) sub.close();
  }

  /** Для тестов и диагностики. */
  count(ownerId: string, section: Section): number {
    return this.subs.get(this.key(ownerId, section))?.size ?? 0;
  }
}
