import { useLocalSearchParams } from 'expo-router';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button, Card } from '@/components/ui/Button';
import { describePaid } from '@/components/ui/DuesStatement';
import { GroupNameRow } from '@/components/ui/GroupJoinPreview';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, TasaText } from '@/components/ui/Screen';
import { useCopyToClipboard } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useGroup, useGroupReceipts } from '@/hooks/useGroups';
import { formatDateTime, formatNaira } from '@/lib/format';

// The QR stays dark on white in both themes, so any scanner reads it.
const INK = '#14201C';

/**
 * One dues receipt to show at the department: its QR code opens Tasa's page for it, which says
 * who paid which dues to which group, so nobody has to trust a screenshot.
 */
export default function ReceiptScreen() {
  const { group: groupId, id } = useLocalSearchParams<{ group: string; id: string }>();
  const t = useT();
  const { colors } = useTheme();
  const styles = useStyles();
  const receipts = useGroupReceipts(groupId);
  const group = useGroup(groupId).data;
  const receipt = receipts.data?.find((r) => r.id === id);
  const copy = useCopyToClipboard();

  return (
    <Screen
      footer={
        receipt ? (
          <Button
            label={t('groups.shareReceipt')}
            onPress={() => Share.share({ message: t('groups.receiptShareMessage', { name: group?.name ?? '', url: receipt.url }), url: receipt.url })}
          />
        ) : undefined
      }>
      <QueryState query={receipts} hasData={!!receipts.data} skeleton="detail" />
      {receipts.data && !receipt && <EmptyState message={t('groups.receiptMissing')} />}
      {receipt && (
        <>
          {group && <GroupNameRow name={group.name} logoUrl={group.logoUrl} />}
          <Card style={styles.card}>
            <View style={styles.qr}>
              <QRCode value={receipt.url} size={200} color={INK} backgroundColor="#FFFFFF" />
            </View>
            <TasaText variant="display" color={colors.heading}>
              {formatNaira(receipt.amount)}
            </TasaText>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t('groups.paidOn', { date: formatDateTime(receipt.paidAt) })}
            </TasaText>
            <View style={styles.lines}>
              {describePaid(receipt.dues).map((line) => (
                <TasaText key={line} variant="body" style={styles.centered}>
                  {line}
                </TasaText>
              ))}
            </View>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t('groups.reference')}
            </TasaText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.copy')}
              hitSlop={8}
              onPress={() => copy(receipt.reference, t('common.copied'))}>
              <TasaText variant="bodyMedium" style={styles.centered}>
                {receipt.reference}
              </TasaText>
            </Pressable>
          </Card>
          <TasaText variant="caption" color={colors.inkMuted} style={styles.centered}>
            {t('groups.receiptShow')}
          </TasaText>
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    card: {
      alignItems: 'center',
      gap: 4,
      marginVertical: theme.spacing.md,
      paddingVertical: theme.spacing.lg,
    },
    qr: {
      padding: 12,
      marginBottom: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: '#FFFFFF',
    },
    lines: {
      gap: 2,
      marginVertical: theme.spacing.sm,
    },
    centered: {
      textAlign: 'center',
    },
  }),
);
