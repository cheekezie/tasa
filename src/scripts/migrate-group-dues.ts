import { connectDB, describeDB, disconnectDB } from '../lib/db';
import { closeQueues } from '../lib/queue';
import { redis } from '../lib/redis';
import { periodStart } from '../modules/groups/groups.periods';
import { GroupMemberModel, GroupModel, type GroupPeriod } from '../modules/groups/models/group.model';

type OldPlan = { _id: unknown; name: string; period: GroupPeriod; amount: number; active: boolean };
type OldMember = { _id: unknown; plan?: unknown; startsAt: Date; anchorDay: number; periodsPaid?: number; backfills?: { periods: number; by?: unknown; at?: Date; note?: string; due?: unknown }[] };

/**
 * One-off: groups made before dues replaced plans. Each plan becomes a compulsory recurring due
 * (a retired plan, an ended one); each member's paid count becomes the periods it covered, and
 * their backfills move onto their plan's due. Safe to run twice: converted groups are skipped.
 */
async function migrate() {
  await connectDB();
  console.log(`Migrating group plans to dues in ${describeDB()}`);
  const groups = GroupModel.collection;
  const members = GroupMemberModel.collection;
  for await (const g of groups.find({ plans: { $exists: true } })) {
    const plans = (g.plans ?? []) as OldPlan[];
    const now = new Date();
    const dues = plans.map((p) => ({
      _id: p._id,
      name: p.name,
      kind: 'recurring',
      period: p.period,
      amount: p.amount,
      compulsory: true,
      createdAt: g.createdAt ?? now,
      ...(!p.active && { endedAt: now }),
    }));
    for await (const raw of members.find({ group: g._id, plan: { $exists: true } })) {
      const m = raw as unknown as OldMember;
      const plan = plans.find((p) => String(p._id) === String(m.plan));
      if (!plan) continue;
      // The old model moved `startsAt` back by each backfill; the new one keeps the join day and counts arrears per due.
      const back = (m.backfills ?? []).reduce((n, b) => n + b.periods, 0);
      const startsAt = periodStart(m.startsAt, plan.period, m.anchorDay, back);
      const paid = Array.from({ length: m.periodsPaid ?? 0 }, (_, i) => ({ due: plan._id, period: i - back, at: now }));
      await members.updateOne(
        { _id: raw._id },
        {
          $set: { startsAt, paid, backfills: (m.backfills ?? []).map((b) => ({ ...b, due: plan._id })) },
          $unset: { plan: '', periodsPaid: '' },
        },
      );
    }
    await groups.updateOne({ _id: g._id }, { $set: { dues }, $unset: { plans: '' } });
    console.log(`✓ ${g.name as string}: ${dues.length} due(s)`);
  }
}

migrate()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues();
    await disconnectDB();
    redis.disconnect();
    process.exit();
  });
