import { getQueue, startWorker } from '../../lib/queue';
import { Catalog } from '../bills/bills.catalog';
import { BillsService } from '../bills/bills.service';
import { biller } from '../bills/providers';
import { gateway } from '../payments/providers';
import { TicketsService } from '../tickets/tickets.service';
import { TransactionModel } from '../transactions/models/transaction.model';
import { CollectionsService } from '../wallet/collections.service';
import { WalletService } from '../wallet/wallet.service';
import { WebhookEventModel, type IWebhookEvent } from './models/webhook-event.model';

export const WEBHOOKS_QUEUE = 'webhooks';

async function enqueue(eventId: string) {
  await getQueue(WEBHOOKS_QUEUE).add('process', { eventId }, { jobId: `wh-${eventId}` });
}

export const WebhooksService = {
  async receiveSaySwitch(rawBody: string, headers: Record<string, string | string[] | undefined>) {
    const valid = gateway.verifyWebhook(rawBody, headers);
    const notice = valid ? gateway.parseWebhook(rawBody) : null;
    const event = await WebhookEventModel.create({
      provider: 'sayswitch',
      rawBody: rawBody.slice(0, 64_000),
      signature: valid ? 'valid' : 'invalid',
      reference: notice?.reference,
      status: valid ? 'received' : 'ignored',
      ...(!valid && { result: 'bad signature' }),
    });
    if (valid) await enqueue(event.id);
    return valid;
  },

  /** VTpass doesn't sign callbacks. We store and requery; the body itself is never acted on. */
  async receiveVtpass(rawBody: string) {
    const notice = biller.parseWebhook(rawBody);
    const event = await WebhookEventModel.create({
      provider: 'vtpass',
      rawBody: rawBody.slice(0, 64_000),
      signature: 'none',
      ...(notice?.kind === 'transaction' && { reference: notice.requestId }),
      status: notice ? 'received' : 'ignored',
      ...(!notice && { result: 'unrecognised payload' }),
    });
    if (notice) await enqueue(event.id);
  },

  /**
   * Every path below re-asks the provider before money moves, so a replayed or forged body
   * can't credit or refund anything.
   */
  async process(eventId: string) {
    const event = await WebhookEventModel.findById(eventId);
    if (!event) return;
    const finish = (status: 'processed' | 'ignored', result: string) =>
      WebhookEventModel.updateOne({ _id: event._id }, { status, result, processedAt: new Date(), $unset: { error: 1 } });
    try {
      const [status, result] = event.provider === 'vtpass' ? await this.processVtpass(event) : await this.processSaySwitch(event);
      await finish(status, result);
    } catch (err) {
      await WebhookEventModel.updateOne({ _id: event._id }, { status: 'failed', error: (err as Error).message });
      throw err; // let BullMQ retry
    }
  },

  async processSaySwitch(event: IWebhookEvent): Promise<['processed' | 'ignored', string]> {
    const notice = gateway.parseWebhook(event.rawBody);
    if (!notice) return ['ignored', 'unrecognised payload'];
    // Never trusted: it only tells us which payout to ask SaySwitch about.
    if (notice.kind === 'payout') {
      const after = await TicketsService.onPayoutUpdate(notice.reference, notice.fee);
      return after ? ['processed', `payout ${after.status}`] : ['ignored', 'no payout with that reference'];
    }
    if (notice.kind !== 'transaction') return ['ignored', `${notice.kind} notices are not used`];
    const tx = await TransactionModel.findOne({ reference: notice.reference }).select('kind reference');
    if (tx?.kind === 'funding') {
      const after = await WalletService.reconcileFunding(tx.reference, { providerFee: notice.fee });
      return ['processed', `funding ${after?.status ?? 'unknown'}`];
    }
    // Not one of our references: a transfer into a permanent (wallet/beneficiary) account.
    if (notice.outcome !== 'successful') return ['ignored', 'failed payment with no matching transaction'];
    const result = await CollectionsService.collect(notice.reference, {
      accountNumber: notice.accountNumber,
      customerCode: notice.customerCode,
      providerFee: notice.fee,
    });
    return result.status === 'credited' || result.status === 'already_credited'
      ? ['processed', `collection ${result.transaction.reference} (${result.status})`]
      : ['ignored', result.status === 'unmatched' ? `no account for customer ${result.customerCode ?? '?'}` : 'not paid per SaySwitch'];
  },

  async processVtpass(event: IWebhookEvent): Promise<['processed' | 'ignored', string]> {
    const notice = biller.parseWebhook(event.rawBody);
    if (!notice) return ['ignored', 'unrecognised payload'];
    if (notice.kind === 'variations') {
      await Catalog.invalidate(notice.serviceID);
      return ['processed', `plans refreshed${notice.serviceID ? ` for ${notice.serviceID}` : ''}`];
    }
    const tx = await BillsService.onProviderUpdate(notice.requestId);
    return tx ? ['processed', `bill ${tx.reference} ${tx.status}`] : ['ignored', 'no matching bill'];
  },

  async replay(eventId: string) {
    await WebhookEventModel.updateOne({ _id: eventId }, { status: 'received' });
    await this.process(eventId);
    return WebhookEventModel.findById(eventId);
  },

  startWorker() {
    startWorker(WEBHOOKS_QUEUE, async (job) => {
      await this.process((job.data as { eventId: string }).eventId);
    });
  },
};
