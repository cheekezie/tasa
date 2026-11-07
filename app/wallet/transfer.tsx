import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { AmountInput } from '@/components/ui/Input';
import { CheckoutFailureView } from '@/components/ui/CheckoutFailureView';
import { PinSheet } from '@/components/ui/PinSheet';
import { RecipientField, useRecipientLookup } from '@/components/ui/RecipientField';
import { Screen, TasaText } from '@/components/ui/Screen';
import { SuccessView, useResultScreen } from '@/components/ui/StatusView';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { theme } from '@/constants/theme';
import { useAccount } from '@/hooks/useAccount';
import { useCheckout } from '@/hooks/useCheckout';
import { errorMessage } from '@/lib/api/errors';
import { paymentsService } from '@/lib/api/services/payments';
import { formatNaira } from '@/lib/format';
import { kobo } from '@/lib/money';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';

export default function TransferScreenGated() {
  return (
    <FeatureGate feature="transfers">
      <TransferScreen />
    </FeatureGate>
  );
}

function TransferScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { walletBalance } = useAccount();
  const [recipient, setRecipient] = useState('');
  const [parsedAmount, setAmount] = useState(kobo(0));
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const checkout = useCheckout(paymentsService.sendTransfer);
  const lookup = useRecipientLookup(recipient);

  const send = async () => {
    if (lookup.status !== 'found') return;
    setQuoteError(null);
    try {
      await checkout.start({
        kind: 'transfer',
        recipient: lookup.match.recipient,
        amount: parsedAmount,
      });
    } catch (error) {
      setQuoteError(errorMessage(error));
    }
  };

  useResultScreen(!!checkout.result || !!checkout.failure);

  if (checkout.result) {
    const name = lookup.status === 'found' ? lookup.match.name : '';
    return (
      <SuccessView
        title={t('transfer.sentTitle')}
        message={t('transfer.sentBody', { amount: formatNaira(parsedAmount), name })}
        secondaryAction={{
          label: t('transfer.sendAnother'),
          onPress: () => {
            setRecipient('');
            setAmount(kobo(0));
            checkout.reset();
          },
        }}>
        <Card style={styles.receipt}>
          <Row label={t('transfer.receiptTo')} value={name} />
          <Row label={t('common.amount')} value={formatNaira(checkout.result.amount)} />
          <Row label={t('transfer.receiptBalance')} value={formatNaira(walletBalance)} />
        </Card>
      </SuccessView>
    );
  }

  if (checkout.failure) {
    return (
      <CheckoutFailureView failure={checkout.failure} onRetry={checkout.retry} onEdit={checkout.reset} />
    );
  }

  return (
    <Screen
      footer={
        <Button
          disabled={lookup.status !== 'found' || parsedAmount <= 0}
          label={t('transfer.send')}
          loading={checkout.quoting}
          onPress={send}
        />
      }>
      <TasaText variant="body" color={colors.inkMuted} style={styles.intro}>
        {t('transfer.intro')}
      </TasaText>

      <RecipientField
        label={t('transfer.username')}
        value={recipient}
        onChangeText={setRecipient}
        lookup={lookup}
      />

      <AmountInput
        label={t('common.amount')}
        last
        hint={t('transfer.available', { amount: formatNaira(walletBalance) })}
        error={quoteError}
        value={parsedAmount}
        onChangeValue={setAmount}
      />

      <PinSheet
        {...checkout.pinSheet}
        title={t('checkout.pinTitle')}
        processingTitle={t('processing.transfer')}
        detail={
          checkout.quote
            ? [
                t('checkout.total', { amount: formatNaira(checkout.quote.total) }),
                ...(checkout.quote.pointsToEarn > 0
                  ? [`${t('review.pointsToEarn')}: +${checkout.quote.pointsToEarn}`]
                  : []),
              ].join(' · ')
            : undefined
        }
      />
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.receiptRow}>
      <TasaText variant="caption" color={colors.inkMuted}>
        {label}
      </TasaText>
      <TasaText variant="bodyMedium" numberOfLines={1} style={styles.receiptValue}>
        {value}
      </TasaText>
    </View>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    intro: {
      marginBottom: theme.spacing.lg,
    },
    receipt: {
      gap: 10,
    },
    receiptRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    receiptValue: {
      flexShrink: 1,
      textAlign: 'right',
    },
  }),
);
