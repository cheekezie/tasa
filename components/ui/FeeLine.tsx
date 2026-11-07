import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { TasaText } from '@/components/ui/Screen';
import { useT } from '@/context/SettingsContext';
import { useTheme } from '@/context/ThemeContext';
import { sellerService } from '@/lib/api/services/tickets';
import { formatNaira } from '@/lib/format';
import { Kobo, kobo } from '@/lib/money';
import { queryKeys } from '@/lib/queryClient';

/** ₦100. Anything less can't carry the selling fee. */
export const MIN_TICKET_PRICE = kobo(10_000);

/** What this price means for each side, from the live charge rules, never worked out here. */
export function FeeLine({ price }: { price: Kobo }) {
  const { colors } = useTheme();
  const t = useT();
  const [settled, setSettled] = useState(price);

  // Only ask once they've stopped typing.
  useEffect(() => {
    const timer = setTimeout(() => setSettled(price), 400);
    return () => clearTimeout(timer);
  }, [price]);

  const fees = useQuery({
    queryKey: queryKeys.ticketFees(settled),
    queryFn: () => sellerService.getFees(settled),
    enabled: settled >= MIN_TICKET_PRICE,
  });

  if (price < MIN_TICKET_PRICE) return null;
  if (fees.isError) {
    return (
      <TasaText variant="caption" color={colors.inkMuted}>
        {t('tickets.feesUnavailable')}
      </TasaText>
    );
  }
  if (!fees.data || settled !== price) return null;
  return (
    // Only the organiser's side: the buyer's service charge changes often and isn't theirs to plan around.
    <View>
      <TasaText variant="caption" color={colors.success}>
        {t('tickets.youReceive', {
          amount: formatNaira(fees.data.youReceive),
          fee: formatNaira(fees.data.sellingFee),
        })}
      </TasaText>
    </View>
  );
}
