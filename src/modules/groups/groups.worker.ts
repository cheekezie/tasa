import { startWorker } from '../../lib/queue';
import { GROUPS_QUEUE, GroupsService } from './groups.service';

export function startGroupsWorker() {
  startWorker(GROUPS_QUEUE, async (job) => {
    const { changeId } = job.data as { changeId: string };
    if (job.name === 'payout-change.expire') await GroupsService.expirePayoutChange(changeId);
    if (job.name === 'payout-change.apply') await GroupsService.applyPayoutChange(changeId);
  });
}
