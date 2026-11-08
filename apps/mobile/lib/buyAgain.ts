import { ActivityItem } from '@/constants/data';

/**
 * Opens the summary for a past bill. It quotes afresh, so the account is re-verified and the
 * user sees today's price before paying. Null for anything that can't be bought again.
 */
export function buyAgainRoute({ rebuy, serviceId, status, beneficiaryId }: ActivityItem) {
  if (!rebuy || !serviceId || status === 'pending') return null;
  return {
    pathname: '/bills/review' as const,
    params: {
      service: serviceId,
      provider: rebuy.provider,
      account: rebuy.account,
      amount: rebuy.planCode ? '' : String(rebuy.amount),
      beneficiaryId: beneficiaryId ?? '',
      ...(rebuy.product && { product: rebuy.product }),
      ...(rebuy.meterType && { meterType: rebuy.meterType }),
      planCode: rebuy.planCode ?? '',
    },
  };
}
