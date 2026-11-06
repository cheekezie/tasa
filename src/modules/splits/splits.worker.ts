import { startWorker } from '../../lib/queue';
import { SPLITS_QUEUE, SplitsService } from './splits.service';

export function startSplitsWorker() {
  startWorker(SPLITS_QUEUE, async (job) => {
    const { splitId } = job.data as { splitId: string };
    if (job.name === 'split.deadline') await SplitsService.onDeadline(splitId);
    // A failure here isn't lost: the sweep retries splits stuck in 'paying'.
    if (job.name === 'split.pay') await SplitsService.payBill(splitId);
  });
}
