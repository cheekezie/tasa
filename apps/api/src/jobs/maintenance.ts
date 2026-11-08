import { getQueue, startWorker } from '../lib/queue';
import { BillsService } from '../modules/bills/bills.service';
import { CouponsService } from '../modules/coupons/coupons.service';
import { GroupsService } from '../modules/groups/groups.service';
import { SplitsService } from '../modules/splits/splits.service';
import { GuestService } from '../modules/guest/guest.service';
import { RecurringService } from '../modules/recurring/recurring.service';
import { TicketsService } from '../modules/tickets/tickets.service';
import { WalletService } from '../modules/wallet/wallet.service';

const QUEUE = 'maintenance';

/** Repeatable jobs. BullMQ dedupes them by key, so every instance can call this on boot. */
const SCHEDULE: { name: string; every?: number; pattern?: string }[] = [
  { name: 'fundings.sweep', every: 5 * 60_000 },
  { name: 'bills.sweep', every: 5 * 60_000 },
  { name: 'coupons.sweep', every: 10 * 60_000 },
  { name: 'payouts.sweep', every: 10 * 60_000 },
  { name: 'groups.sweep', every: 10 * 60_000 },
  { name: 'splits.sweep', every: 10 * 60_000 },
  { name: 'guest.sweep', every: 5 * 60_000 },
  { name: 'recurring.run', every: 15 * 60_000 },
  { name: 'recurring.reminders', pattern: '0 8 * * *' }, // 08:00 Lagos
];

export async function startMaintenance() {
  const queue = getQueue(QUEUE);
  for (const job of SCHEDULE) {
    await queue.upsertJobScheduler(job.name, job.pattern ? { pattern: job.pattern, tz: 'Africa/Lagos' } : { every: job.every! }, {
      name: job.name,
      opts: { attempts: 1 },
    });
  }
  startWorker(
    QUEUE,
    async (job) => {
      switch (job.name) {
        case 'fundings.sweep':
          return WalletService.sweepFundings();
        case 'bills.sweep':
          return BillsService.sweepStuck();
        case 'coupons.sweep':
          return CouponsService.sweep();
        case 'payouts.sweep':
          return TicketsService.sweepPayouts();
        case 'groups.sweep':
          return GroupsService.sweepPayoutChanges();
        case 'splits.sweep':
          return SplitsService.sweep();
        case 'guest.sweep':
          return GuestService.sweep();
        case 'recurring.run':
          return RecurringService.runDue();
        case 'recurring.reminders':
          return RecurringService.remindShortfalls();
      }
    },
    1,
  );
}
