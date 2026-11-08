import { ActivityItem, SpendingPoint } from '@/constants/data';
import { sumKobo } from '@/lib/money';

const MONTHS_TO_SHOW = 6;

/** Monthly spend for one beneficiary. Services use `GET /insights`, which has no beneficiary view. */
export function beneficiarySpendingSeries(activity: ActivityItem[], beneficiaryId: string): SpendingPoint[] {
  const relevant = activity.filter(
    (item) =>
      item.direction === 'debit' && item.status === 'success' && item.beneficiaryId === beneficiaryId,
  );
  if (relevant.length === 0) return [];

  const now = new Date();
  const points: SpendingPoint[] = [];
  for (let i = MONTHS_TO_SHOW - 1; i >= 0; i -= 1) {
    const cursor = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const total = sumKobo(
      relevant
        .filter((item) => {
          const date = new Date(item.date);
          return date.getFullYear() === cursor.getFullYear() && date.getMonth() === cursor.getMonth();
        })
        .map((item) => item.amount),
    );
    points.push({ month: cursor.toLocaleString('en-US', { month: 'short' }), amount: total });
  }
  return points;
}
