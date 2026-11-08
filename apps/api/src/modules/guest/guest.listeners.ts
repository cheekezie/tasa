import { bus } from '../../lib/events';
import { GuestService } from './guest.service';

/** A website order moves on when its transfer is credited, and settles when its bill does. */
export function registerGuest() {
  bus.on('funding.succeeded', ({ transactionId }) => GuestService.onFunded(transactionId).catch((err) => console.error(`[guest] funded ${transactionId}`, err)));
  const settle = ({ transactionId }: { transactionId: string }) =>
    GuestService.onBillResult(transactionId).catch((err) => console.error(`[guest] bill ${transactionId}`, err));
  bus.on('bill.succeeded', settle);
  bus.on('bill.failed', settle);
}
