import { startWorker } from '../../lib/queue';
import { r2 } from '../../lib/r2';
import { STORAGE_QUEUE } from './avatars.service';

export function startStorageWorker() {
  startWorker(STORAGE_QUEUE, async (job) => {
    await r2.deleteFile((job.data as { key: string }).key);
  });
}
