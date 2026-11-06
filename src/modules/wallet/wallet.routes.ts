import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, send } from '../../lib/response';
import { requireActor } from '../../plugins/auth';
import { StartFundingSchema } from './wallet.schema';
import { CollectionsService, toAccountDto } from './collections.service';
import { WalletService } from './wallet.service';
import { requireFeature } from '../config/config.routes';

/** `/api/wallet/*`. Get a funding quote first via POST /api/quotes { kind: 'funding' }. */
export async function walletRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  /** Balance, plus the user's permanent account number once they have one. */
  app.get('/', async (req, reply) => {
    const [wallet, account] = await Promise.all([WalletService.balance(req.user.sub), CollectionsService.walletAccount(req.user.sub)]);
    return send(reply, { ...wallet, account: account ? toAccountDto(account) : null });
  });

  /** A permanent account number for this wallet: transfer in from any bank app, any time. */
  app.post('/account', { preHandler: requireFeature('funding'), config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const account = await CollectionsService.issue({ userId: req.user.sub, purpose: 'wallet' });
    return send(reply, toAccountDto(account), 201);
  });

  /**
   * After "I've sent it" on the permanent-account screen, poll this with the time the user
   * tapped. There is no reference to poll: the money arrives without one.
   */
  app.get('/account/credits', async (req, reply) => {
    const { since } = parse(z.object({ since: z.coerce.date() }), req.query);
    return send(reply, await CollectionsService.credits(req.user.sub, since));
  });

  app.post('/fundings', { preHandler: requireFeature('funding'), config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { quoteId } = parse(StartFundingSchema, req.body);
    return send(reply, await WalletService.startFunding(req.user.sub, quoteId), 201);
  });

  /** Poll while the user is on the "transfer to this account" screen. */
  app.get('/fundings/:reference', async (req, reply) => {
    const { reference } = parse(z.object({ reference: z.string().min(6).max(40) }), req.params);
    return send(reply, await WalletService.getFunding(req.user.sub, reference));
  });
}
