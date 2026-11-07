import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/Button';
import { describePaid } from '@/components/ui/DuesStatement';
import { Icon } from '@/components/ui/Icon';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useGroupReceipts } from '@/hooks/useGroups';
import { formatDateTime, formatNaira } from '@/lib/format';

/** Every dues payment they've made to one group, newest first. Each opens as a receipt with a QR code. */
export default function ReceiptsScreen() {
  const { group } = useLocalSearchParams<{ group: string }>();
  const t = useT();
  const { colors } = useTheme();
  const styles = useStyles();
  const receipts = useGroupReceipts(group);

  return (
    <Screen refreshable>
      <QueryState query={receipts} hasData={!!receipts.data} skeleton="list" />
      {receipts.data?.length === 0 && <EmptyState message={t('groups.noReceipts')} />}
      {receipts.data?.map((receipt) => (
        <Pressable
          key={receipt.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/groups/receipt', params: { group, id: receipt.id } })}>
          <Card style={styles.row}>
            <Icon ios="doc.text.fill" android="receipt_long" color={colors.success} size={22} />
            <View style={styles.flex}>
              <TasaText variant="bodyMedium">{formatNaira(receipt.amount)}</TasaText>
              {describePaid(receipt.dues).map((line) => (
                <TasaText key={line} variant="caption" color={colors.ink} numberOfLines={2}>
                  {line}
                </TasaText>
              ))}
              <TasaText variant="caption" color={colors.inkMuted}>
                {formatDateTime(receipt.paidAt)}
              </TasaText>
            </View>
            <Icon ios="qrcode" android="qr_code_2" color={colors.inkMuted} size={18} />
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: theme.spacing.sm,
    },
    flex: {
      flex: 1,
      gap: 2,
    },
  }),
);
