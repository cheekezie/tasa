import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, send } from '../../lib/response';
import { requireActor } from '../../plugins/auth';
import { BillQuoteSchema } from '../bills/bills.schema';
import { BillsService } from '../bills/bills.service';
import { CouponQuoteSchema, GiftQuoteSchema } from '../coupons/coupons.schema';
import { CouponsService } from '../coupons/coupons.service';
import { TicketPayoutQuoteSchema, TicketQuoteSchema } from '../tickets/tickets.schema';
import { TicketsService } from '../tickets/tickets.service';
import { GroupDuesQuoteSchema, GroupPayoutQuoteSchema } from '../groups/groups.schema';
import { GroupsService } from '../groups/groups.service';
import { SplitShareQuoteSchema } from '../splits/splits.schema';
import { SplitsService } from '../splits/splits.service';
import { TransferQuoteSchema } from '../transfers/transfers.schema';
import { TransfersService } from '../transfers/transfers.service';
import { PointsService } from '../points/points.service';
import { FundingQuoteSchema } from '../wallet/wallet.schema';
import { WalletService } from '../wallet/wallet.service';
import { ConfigService, billFeature, type FeatureKey } from '../config/config.service';

const QuoteRequestSchema = z.discriminatedUnion('kind', [
  FundingQuoteSchema,
  BillQuoteSchema,
  TransferQuoteSchema,
  CouponQuoteSchema,
  GiftQuoteSchema,
  TicketQuoteSchema,
  TicketPayoutQuoteSchema,
  GroupDuesQuoteSchema,
  GroupPayoutQuoteSchema,
  SplitShareQuoteSchema,
]);

/** What has to be switched on to price each kind. The action endpoints check again. */
const QUOTE_FEATURES: Record<z.infer<typeof QuoteRequestSchema>['kind'], FeatureKey[]> = {
  funding: ['funding'],
  bill: ['bills'],
  transfer: ['transfers'],
  coupon: ['coupons'],
  gift: ['gifts'],
  ticket: ['tickets'],
  ticket_payout: ['ticket_payouts'],
  group_dues: ['groups'],
  group_payout: ['group_payouts'],
  split_share: ['splits'],
};


/**
 * `POST /api/quotes` — the one endpoint the app calls to show "amount + charges = total"
 * before anything is paid. Returns `{ id, amount, charges[], fee, discount, total, expiresAt }`
 * plus kind-specific details (verified customer name, plan, recipient). Confirm by passing
 * `quoteId` to the matching action endpoint.
 */
export async function quotesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  // Bill quotes call SaySwitch to verify meters and smart cards.
  app.post('/', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const input = parse(QuoteRequestSchema, req.body);
    const userId = req.user.sub;
    await ConfigService.assertEnabled(...QUOTE_FEATURES[input.kind]);
    if (input.kind === 'bill') await ConfigService.assertEnabled(billFeature(input.serviceId));
    switch (input.kind) {
      case 'funding':
        return send(reply, await PointsService.withPoints(await WalletService.quote(userId, input.amount)), 201);
      case 'bill':
        return send(reply, await PointsService.withPoints(await BillsService.quoteDto(userId, input)), 201);
      case 'transfer':
        return send(reply, await PointsService.withPoints(await TransfersService.quote(userId, input)), 201);
      case 'coupon':
        return send(reply, await PointsService.withPoints(await CouponsService.quoteCoupon(userId, input)), 201);
      case 'gift':
        return send(reply, await PointsService.withPoints(await CouponsService.quoteGift(userId, input)), 201);
      case 'ticket':
        return send(reply, await TicketsService.quote(userId, input), 201);
      case 'ticket_payout':
        return send(reply, await TicketsService.quotePayout(userId, input), 201);
      case 'group_dues':
        return send(reply, await GroupsService.quoteDues(userId, input), 201);
      case 'group_payout':
        return send(reply, await GroupsService.quotePayout(userId, input), 201);
      case 'split_share':
        return send(reply, await SplitsService.quoteShare(userId, input), 201);
    }
  });
}
