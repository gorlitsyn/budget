import { canView, monthSchema, openingSchema } from '@money/shared';
import type { FastifyInstance } from 'fastify';
import { requireSection } from '../access.ts';
import { SummaryStore, withoutIncome } from '../store-summary.ts';

type M = { Params: { owner: string }; Querystring: { month?: string } };

/** Сводка — раздел summary: только итоги, без отдельных трат. Доходы и остатки — ещё и по праву incomes. */
export async function summaryRoutes(app: FastifyInstance): Promise<void> {
  const { store } = app;
  const summary = new SummaryStore(store.db);
  const base = '/api/spaces/:owner/summary';

  app.get<M>(base, async (req) => {
    const userId = requireSection(store, req, req.params.owner, 'summary', 'view');
    const data = summary.summary(req.params.owner, monthSchema.parse(req.query.month));
    return canView(store.grantsIn(req.params.owner, userId), 'incomes') ? data : withoutIncome(data);
  });

  app.put<M>(`${base}/opening`, async (req) => {
    requireSection(store, req, req.params.owner, 'summary', 'edit');
    requireSection(store, req, req.params.owner, 'incomes', 'view');
    summary.setOpening(req.params.owner, openingSchema.parse(req.body));
    return { ok: true };
  });

  app.delete<M>(`${base}/opening`, async (req) => {
    requireSection(store, req, req.params.owner, 'summary', 'edit');
    requireSection(store, req, req.params.owner, 'incomes', 'view');
    summary.setOpening(req.params.owner, null);
    return { ok: true };
  });
}
