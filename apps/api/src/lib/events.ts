import { EventEmitter } from 'node:events';

/**
 * In-process domain event bus. Services emit facts ("bill delivered"); listeners in
 * other modules react (notify, schedule a requery). Modules stay decoupled — the bills
 * service never imports notifications.
 *
 * Listeners must be fast and never throw; slow or retryable work (SMS, push) is handed
 * to a BullMQ queue from inside the listener.
 */
export type DomainEvents = {
  'funding.succeeded': { transactionId: string };
  /** A website order settled: its PIN or token was delivered, or it didn't go through. */
  'guest.order': { orderId: string; stage: 'delivered' | 'failed' };
  'bill.succeeded': { transactionId: string };
  /** Refunded to the wallet. */
  'bill.failed': { transactionId: string };
  /** The provider did not give a final answer; a requery is due. */
  'bill.pending': { transactionId: string; attempt: number };
  'transfer.completed': { debitId: string; creditId: string };
  'gift.created': { couponId: string };
  'recurring.skipped': { recurringId: string; reason: string };
  'pin.reset': { userId: string };
  'bvn.reviewed': { userId: string; status: 'verified' | 'rejected'; reason?: string | undefined };
  /** Compliance's decision on an organiser's photo and ID. */
  'seller.reviewed': { userId: string; status: 'approved' | 'rejected'; reason?: string | undefined };
  'seller.suspension': { userId: string; suspended: boolean; reason?: string | undefined };
  /** A student profile was verified (school email or ID card), or its ID card turned down. */
  'student.verified': { userId: string; status: 'verified' | 'rejected'; reason?: string | undefined };
  /** Tasa's decision on a group's proof that it's who it says. */
  /** Someone joined a group, asked to, or was let in or turned away. */
  'group.member': { memberId: string; stage: 'joined' | 'requested' | 'approved' | 'rejected' };
  /** An executive added a due: the members it applies to are told. */
  'group.due': { groupId: string; dueId: string };
  /** A split bill was made, paid, or ended without paying (everyone refunded). */
  'split.update': { splitId: string; stage: 'created' | 'rescheduled' | 'paid' | 'failed' | 'expired' | 'cancelled' };
  /** Tasa suspended a group, or lifted it. */
  'group.suspension': { groupId: string; suspended: boolean; reason?: string | undefined };
  /** A payout account change moved on: co-signers to ask, everyone to tell. */
  'group.payoutChange': { changeId: string; stage: 'proposed' | 'cooling_off' | 'applied' | 'rejected' | 'expired' };
  /** They were at an event and haven't rated it yet: ask them to. */
  'event.rateReminder': { userId: string; eventId: string; title: string; organiser: string };
  /** Money landed in a beneficiary's virtual account. */
  'beneficiary.collection': { transactionId: string; beneficiaryId: string };
};

class TypedBus {
  private emitter = new EventEmitter({ captureRejections: true });

  emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]) {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof DomainEvents>(event: K, handler: (payload: DomainEvents[K]) => void | Promise<void>) {
    this.emitter.on(event, async (payload: DomainEvents[K]) => {
      try {
        await handler(payload);
      } catch (err) {
        console.error(`[events] ${event} listener failed`, err);
      }
    });
  }
}

export const bus = new TypedBus();
