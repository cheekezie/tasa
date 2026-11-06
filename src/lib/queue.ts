import { Queue, Worker, type Processor } from 'bullmq';
import { createQueueConnection } from './redis';

/**
 * Thin BullMQ wrappers. Queues are how slow or time-based work (SMS, offer
 * timeouts, retries) leaves the request path. Workers can run in the API
 * process today and move to a dedicated worker process later unchanged.
 */
const connection = createQueueConnection();
const queues = new Map<string, Queue>();
const workers: Worker[] = [];

export function getQueue(name: string) {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection,
      defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    });
    queues.set(name, q);
  }
  return q;
}

export function startWorker(name: string, processor: Processor, concurrency = 5) {
  const worker = new Worker(name, processor, { connection: createQueueConnection(), concurrency });
  worker.on('failed', (job, err) => console.error(`[queue:${name}] job ${job?.name} failed:`, err.message));
  workers.push(worker);
  return worker;
}

export async function closeQueues() {
  await Promise.all([...workers.map((w) => w.close()), ...[...queues.values()].map((q) => q.close())]);
}
