import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { ActivityIcon, Icon } from '@/components/ui/Icon';
import { QueryState } from '@/components/ui/QueryState';
import { Screen, TasaText } from '@/components/ui/Screen';
import { useCopyToClipboard, useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useTransaction } from '@/hooks/usePayments';
import { buyAgainRoute } from '@/lib/buyAgain';
import { downloadReceipt, formatDateTime, receiptRows, signedAmount } from '@/lib/receipt';

export default function TransactionScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useTransaction(id);
  const { show } = useSnackbar();
  const copy = useCopyToClipboard();
  const [downloading, setDownloading] = useState(false);
  const item = query.data;

  if (!item) {
    return (
      <Screen>
        <QueryState query={query} skeleton="detail" />
      </Screen>
    );
  }

  const download = async () => {
    setDownloading(true);
    try {
      if (!(await downloadReceipt(item))) show(t('transaction.downloadUnavailable'));
    } catch {
      show(t('transaction.downloadFailed'));
    } finally {
      setDownloading(false);
    }
  };

  const credit = item.direction === 'credit';
  const rebuy = buyAgainRoute(item);

  return (
    <Screen
      refreshable
      footer={
        <>
          {rebuy && (
            <Button
              label={t('activity.buyAgain')}
              onPress={() => router.push(rebuy)}
              style={styles.buyAgain}
            />
          )}
          <Button
            label={t('transaction.download')}
            variant={rebuy ? 'secondary' : 'primary'}
            loading={downloading}
            onPress={download}
          />
        </>
      }>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <ActivityIcon item={item} color={colors.brand} size={28} />
        </View>
        <TasaText variant="display" color={credit ? colors.success : colors.heading}>
          {signedAmount(item)}
        </TasaText>
        <TasaText variant="body" color={colors.inkMuted} numberOfLines={2} style={styles.center}>
          {item.title}
        </TasaText>
        <View style={styles.status}>
          {item.status === 'success' ? (
            <Icon ios="checkmark.circle.fill" android="check_circle" color={colors.success} size={16} />
          ) : (
            <Icon ios="clock" android="schedule" color={colors.inkMuted} size={16} />
          )}
          <TasaText variant="caption" color={item.status === 'success' ? colors.success : colors.inkMuted}>
            {t(`transaction.status.${item.status}`)}
          </TasaText>
        </View>
        <TasaText variant="caption" color={colors.inkSubtle}>
          {formatDateTime(item.date)}
        </TasaText>
      </View>

      <Card style={styles.details}>
        {receiptRows(item).map((row, index) => (
          <View key={row.label} style={[styles.row, index > 0 && styles.rowDivider]}>
            <TasaText variant="caption" color={colors.inkMuted} style={styles.label}>
              {row.label}
            </TasaText>
            <View style={styles.valueWrap}>
              <TasaText variant="bodyMedium" style={styles.value}>
                {row.value}
              </TasaText>
              {row.copyable && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('common.copy')} ${row.label}`}
                  hitSlop={10}
                  onPress={() => copy(row.value)}>
                  <Icon ios="doc.on.doc" android="content_copy" color={colors.brand} size={16} />
                </Pressable>
              )}
            </View>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    buyAgain: {
      marginBottom: theme.spacing.sm,
    },
    hero: {
      alignItems: 'center',
      gap: 6,
      paddingTop: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    },
    heroIcon: {
      width: 60,
      height: 60,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing.sm,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
    },
    center: {
      textAlign: 'center',
    },
    status: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginVertical: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: colors.overlay,
    },
    details: {
      paddingVertical: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
      paddingVertical: 12,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    label: {
      paddingTop: 2,
    },
    valueWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
    },
    value: {
      flexShrink: 1,
      textAlign: 'right',
    },
  }),
);
