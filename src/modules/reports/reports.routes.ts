import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, send } from '../../lib/response';
import { requireActor, requireRole } from '../../plugins/auth';
import { requireActiveAdmin } from '../admins/admins.guard';
import { lagosDay } from '../../lib/lagos';
import { ReportsService, type Range } from './reports.service';
import { SPENDING_PERIODS, SpendingQuerySchema } from '../transactions/transactions.schema';
import { periodRange } from '../transactions/spending.service';

const OptionalPeriodSchema = z.object({ period: z.enum(SPENDING_PERIODS).optional() }).passthrough();


/**
 * `from`/`to` are Lagos calendar days, both inclusive (`to=2026-12-31` covers all of the 31st).
 * Default: the last 30 days.
 */
const RangeQuery = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  })
  .transform(({ from, to }): Range => {
    const end = to ? new Date(lagosDay(to).getTime() + 86_400_000) : new Date();
    const start = from ? lagosDay(from) : new Date(end.getTime() - 30 * 86_400_000);
    return { from: start, to: end };
  })
  .refine((r) => r.from < r.to, 'from must be before to')
  .refine((r) => r.to.getTime() - r.from.getTime() <= 400 * 86_400_000, 'Ranges are limited to about a year');

/** `/api/admin/reports/*` — profit and loss and campaign costs, computed from the ledger. */
export async function reportsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('admin'));
  app.addHook('preHandler', requireActiveAdmin);

  /** `?period=` (the app's periods, as on the dashboard) or `?from=&to=` Lagos days. */
  app.get('/overview', async (req, reply) => {
    const { period } = parse(OptionalPeriodSchema, req.query);
    if (!period) return send(reply, await ReportsService.overview(parse(RangeQuery, req.query)));
    const { current } = periodRange(period);
    return send(reply, await ReportsService.overview({ from: current.from ?? new Date(0), to: current.to }));
  });

  /** Income over time and by bill category, for the app's periods. Any admin, like the overview. */
  app.get('/income', async (req, reply) => {
    const { period } = parse(SpendingQuerySchema, req.query);
    return send(reply, await ReportsService.income(period));
  });

  app.get('/pnl', { preHandler: requireRole('finance') }, async (req, reply) => {
    const range = parse(RangeQuery, req.query);
    const [report, series] = await Promise.all([ReportsService.pnl(range), ReportsService.pnlSeries(range)]);
    return send(reply, { ...report, series });
  });

  app.get('/giveaways', { preHandler: requireRole('finance') }, async (req, reply) =>
    send(reply, await ReportsService.giveaways(parse(RangeQuery, req.query))),
  );
}
