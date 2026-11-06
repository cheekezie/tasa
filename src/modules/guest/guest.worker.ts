import { startWorker } from '../../lib/queue';
import { GUEST_QUEUE, GuestService } from './guest.service';

export function startGuestWorker() {
  startWorker(GUEST_QUEUE, async (job) => {
    // A failure here isn't lost: the sweep retries funded orders that haven't bought their bill.
    if (job.name === 'guest.pay') await GuestService.payBill((job.data as { orderId: string }).orderId);
  });
}
