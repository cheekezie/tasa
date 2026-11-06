import { startWorker } from '../../lib/queue';
import { BILLS_QUEUE, BillsService } from './bills.service';

export function startBillsWorker() {
  startWorker(BILLS_QUEUE, async (job) => {
    if (job.name === 'requery') {
      const { transactionId, attempt } = job.data as { transactionId: string; attempt: number };
      await BillsService.requery(transactionId, attempt);
    }
  });
}
