import {
  canView,
  categorySchema,
  clientIdSchema,
  incomeKindSchema,
  incomeSchema,
  monthSchema,
  planItemSchema,
  transactionSchema,
} from '@money/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAnySection, requireSection } from '../access.ts';
import { MoneyStore } from '../store-money.ts';

type P = { Params: { owner: string; id: string } };
type M = { Params: { owner: string }; Querystring: { month?: string } };

/**
 * Траты, поступления, план и справочники пространства.
 * Права: траты — раздел transactions, поступления и их виды — incomes, план и категории — plan.
 * Справочники читаются с любым из разделов, где они нужны для подписей.
 */
export async function moneyRoutes(app: FastifyInstance): Promise<void> {
  const { store } = app;
  const money = new MoneyStore(store.db);
  const base = '/api/spaces/:owner';
  const need = (req: FastifyRequest, owner: string, s: 'transactions' | 'incomes' | 'plan', level: 'view' | 'edit') =>
    requireSection(store, req, owner, s, level);

  app.get<P>(`${base}/dictionaries`, async (req) => {
    const userId = requireAnySection(store, req, req.params.owner, ['transactions', 'incomes', 'summary', 'plan']);
    const dicts = money.dictionaries(req.params.owner);
    return canView(store.grantsIn(req.params.owner, userId), 'incomes') ? dicts : { ...dicts, incomeKinds: [] };
  });

  // ---- категории (раздел «План») ------------------------------------------------------------

  app.put<P>(`${base}/categories/:id`, async (req) => {
    need(req, req.params.owner, 'plan', 'edit');
    return money.upsertCategory(req.params.owner, clientIdSchema.parse(req.params.id), categorySchema.parse(req.body));
  });
  app.delete<P>(`${base}/categories/:id`, async (req) => {
    need(req, req.params.owner, 'plan', 'edit');
    money.archiveCategory(req.params.owner, req.params.id);
    return { ok: true };
  });

  // ---- виды поступлений (раздел «Поступления») ----------------------------------------------

  app.put<P>(`${base}/income-kinds/:id`, async (req) => {
    need(req, req.params.owner, 'incomes', 'edit');
    const { name } = incomeKindSchema.parse(req.body);
    return money.upsertIncomeKind(req.params.owner, clientIdSchema.parse(req.params.id), name);
  });
  app.delete<P>(`${base}/income-kinds/:id`, async (req) => {
    need(req, req.params.owner, 'incomes', 'edit');
    money.archiveIncomeKind(req.params.owner, req.params.id);
    return { ok: true };
  });

  // ---- траты --------------------------------------------------------------------------------

  app.get<M>(`${base}/transactions`, async (req) => {
    need(req, req.params.owner, 'transactions', 'view');
    return money.transactions(req.params.owner, monthSchema.parse(req.query.month));
  });
  app.put<P>(`${base}/transactions/:id`, async (req) => {
    const userId = need(req, req.params.owner, 'transactions', 'edit');
    return money.upsertTransaction(req.params.owner, clientIdSchema.parse(req.params.id), transactionSchema.parse(req.body), userId);
  });
  app.delete<P>(`${base}/transactions/:id`, async (req) => {
    need(req, req.params.owner, 'transactions', 'edit');
    money.deleteTransaction(req.params.owner, req.params.id);
    return { ok: true };
  });

  // ---- поступления --------------------------------------------------------------------------

  app.get<M>(`${base}/incomes`, async (req) => {
    need(req, req.params.owner, 'incomes', 'view');
    return money.incomes(req.params.owner, monthSchema.parse(req.query.month));
  });
  app.put<P>(`${base}/incomes/:id`, async (req) => {
    const userId = need(req, req.params.owner, 'incomes', 'edit');
    return money.upsertIncome(req.params.owner, clientIdSchema.parse(req.params.id), incomeSchema.parse(req.body), userId);
  });
  app.delete<P>(`${base}/incomes/:id`, async (req) => {
    need(req, req.params.owner, 'incomes', 'edit');
    money.deleteIncome(req.params.owner, req.params.id);
    return { ok: true };
  });

  // ---- план ---------------------------------------------------------------------------------

  app.get<P>(`${base}/plan`, async (req) => {
    need(req, req.params.owner, 'plan', 'view');
    return money.plan(req.params.owner);
  });
  app.put<P>(`${base}/plan/:id`, async (req) => {
    need(req, req.params.owner, 'plan', 'edit');
    return money.upsertPlanItem(req.params.owner, clientIdSchema.parse(req.params.id), planItemSchema.parse(req.body));
  });
  app.delete<P>(`${base}/plan/:id`, async (req) => {
    need(req, req.params.owner, 'plan', 'edit');
    money.deletePlanItem(req.params.owner, req.params.id);
    return { ok: true };
  });
}
