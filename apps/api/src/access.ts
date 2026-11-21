import { type Section, canEdit, canView } from '@money/shared';
import type { FastifyRequest } from 'fastify';
import type { Store } from './store.ts';
import { HttpError } from './util.ts';

/**
 * Проверка доступа к разделу чужого (или своего) пространства. Каждый эндпоинт данных обязан её звать.
 * Нет доступа даже на просмотр — 404: не подтверждаем, что такое пространство существует.
 */
export function requireSection(store: Store, req: FastifyRequest, ownerId: string, section: Section, level: 'view' | 'edit'): string {
  const user = req.user;
  if (!user) throw new HttpError(401, 'Нужно войти');
  const grants = store.grantsIn(ownerId, user.id);
  if (!canView(grants, section)) throw new HttpError(404, 'Раздел недоступен');
  if (level === 'edit' && !canEdit(grants, section)) throw new HttpError(403, 'У вас доступ только на просмотр');
  return user.id;
}

/** Доступ на просмотр хотя бы к одному из разделов (справочники нужны и тратам, и сводке, и плану). */
export function requireAnySection(store: Store, req: FastifyRequest, ownerId: string, sections: Section[]): string {
  const user = req.user;
  if (!user) throw new HttpError(401, 'Нужно войти');
  const grants = store.grantsIn(ownerId, user.id);
  if (!sections.some((s) => canView(grants, s))) throw new HttpError(404, 'Раздел недоступен');
  return user.id;
}
