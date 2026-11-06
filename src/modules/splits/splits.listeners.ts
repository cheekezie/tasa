import { bus } from '../../lib/events';
import { SplitsService } from './splits.service';

/** A bill paid from a split's pot settles the split, whenever VTpass gives its answer. */
export function registerSplits() {
  const settle = ({ transactionId }: { transactionId: string }) =>
    SplitsService.onBillResult(transactionId).catch((err) => console.error(`[splits] bill ${transactionId}`, err));
  bus.on('bill.succeeded', settle);
  bus.on('bill.failed', settle);
}
