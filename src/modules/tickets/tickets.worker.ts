import { startWorker } from '../../lib/queue';
import { TICKETS_QUEUE, TicketsService } from './tickets.service';

export function startTicketsWorker() {
  startWorker(TICKETS_QUEUE, async (job) => {
    if (job.name === 'payout.requery') {
      const { transactionId, attempt } = job.data as { transactionId: string; attempt: number };
      await TicketsService.requeryPayout(transactionId, attempt);
    }
    if (job.name === 'rating.reminder') {
      const { eventId, userId } = job.data as { eventId: string; userId: string };
      await TicketsService.remindToRate(eventId, userId);
    }
  });
}
