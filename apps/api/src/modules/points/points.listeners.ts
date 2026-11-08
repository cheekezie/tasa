import { bus } from '../../lib/events';
import { PointsService } from './points.service';

export function registerPoints() {
  bus.on('bill.succeeded', ({ transactionId }) => PointsService.earn(transactionId));
  // The sender earns; the receiver's side of the transfer doesn't.
  bus.on('transfer.completed', ({ debitId }) => PointsService.earn(debitId));
}
