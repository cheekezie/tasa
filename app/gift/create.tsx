import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { AmountInput, Input } from '@/components/ui/Input';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { ServiceIcon } from '@/components/ui/Icon';
import { CheckoutFailureView } from '@/components/ui/CheckoutFailureView';
import { PinSheet } from '@/components/ui/PinSheet';
import { RecipientField, useRecipientLookup } from '@/components/ui/RecipientField';
import { SuccessView, useResultScreen } from '@/components/ui/StatusView';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { ServiceId, utilityServices } from '@/constants/data';
import { theme } from '@/constants/theme';
import { useAccount } from '@/hooks/useAccount';
import { useCheckout } from '@/hooks/useCheckout';
import { errorMessage } from '@/lib/api/errors';
import { offersService } from '@/lib/api/services/offers';
import { formatNaira } from '@/lib/format';
import { kobo } from '@/lib/money';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';

const NOTE_MAX = 140;

export default function GiftBillScreenGated() {
  return (
    <FeatureGate feature="gifts">
      <GiftBillScreen />
    </FeatureGate>
  );
}

function GiftBillScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { walletBalance } = useAccount();
  const [recipient, setRecipient] = useState('');
  const [parsedAmount, setAmount] = useState(kobo(500_000));
  const [serviceId, setServiceId] = useState<ServiceId>('airtime');
  const [note, setNote] = useState('');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const checkout = useCheckout(offersService.sendGift);
  const lookup = useRecipientLookup(recipient);
  const target =
    lookup.status === 'found'
      ? { recipient: lookup.match.recipient, name: lookup.match.name }
      : lookup.status === 'invite'
        ? { recipient: lookup.recipient, name: recipient.trim() }
        : null;

  const send = async () => {
    if (!target) return;
    setQuoteError(null);
    try {
      await checkout.start({
        kind: 'gift',
        recipient: target.recipient,
        recipientName: target.name,
        serviceId,
        amount: parsedAmount,
        message: note.trim() || undefined,
      });
    } catch (error) {
      setQuoteError(errorMessage(error));
    }
  };

  useResultScreen(!!checkout.result || !!checkout.failure);

  if (checkout.result) {
    const to = target?.name ?? '';
    return (
      <SuccessView
        title={t('gift.sentTitle')}
        message={t('gift.sentBody', { amount: formatNaira(parsedAmount), recipient: to })}
        secondaryAction={{
          label: t('gift.sendAnother'),
          onPress: () => {
            setRecipient('');
            setNote('');
            checkout.reset();
          },
        }}>
        <Card style={styles.receipt}>
          <Row label={t('gift.receiptTo')} value={to} />
          <Row label={t('gift.receiptGift')} value={t(`services.${serviceId}.name`)} />
          <Row label={t('common.amount')} value={formatNaira(parsedAmount)} />
          {!!note.trim() && <Row label={t('gift.note')} value={note.trim()} multiline />}
          <Row label={t('gift.receiptBalance')} value={formatNaira(walletBalance)} />
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
          disabled={!target || parsedAmount <= 0}
          label={t('gift.send', { amount: formatNaira(parsedAmount) })}
          loading={checkout.quoting}
          onPress={send}
        />
      }>
      <View style={styles.hero}>
        <TasaText variant="bodyMedium">{t('gift.heroTitle')}</TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('gift.heroBody')}
        </TasaText>
      </View>

      <RecipientField
        allowInvite
        label={t('gift.recipient')}
        value={recipient}
        onChangeText={setRecipient}
        lookup={lookup}
      />

      <SectionHeader title={t('gift.chooseType')} />
      <View style={styles.grid}>
        {utilityServices.map((service) => (
          <Pressable
            key={service.id}
            onPress={() => setServiceId(service.id)}
            style={[styles.tile, serviceId === service.id && styles.tileActive]}>
            <ServiceIcon serviceId={service.id} color={serviceId === service.id ? '#FFFFFF' : undefined} />
            <TasaText
              variant="caption"
              color={serviceId === service.id ? '#FFFFFF' : colors.ink}>
              {t(`services.${service.id}.name`)}
            </TasaText>
          </Pressable>
        ))}
      </View>

      <AmountInput
        label={t('common.amount')}
        error={quoteError}
        style={styles.field}
        value={parsedAmount}
        onChangeValue={setAmount}
      />

      <Input
        label={t('gift.noteLabel')}
        placeholder={t('gift.notePlaceholder')}
        hint={t('gift.noteCount', { count: note.length, max: NOTE_MAX })}
        multiline
        maxLength={NOTE_MAX}
        last
        style={styles.field}
        value={note}
        onChangeText={setNote}
      />

      <PinSheet
        {...checkout.pinSheet}
        title={t('checkout.pinTitle')}
        processingTitle={t('processing.gift')}
        detail={checkout.quote ? t('checkout.total', { amount: formatNaira(checkout.quote.total) }) : undefined}
      />
    </Screen>
  );
}

function Row({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.receiptRow}>
      <TasaText variant="caption" color={colors.inkMuted}>
        {label}
      </TasaText>
      <TasaText variant="bodyMedium" numberOfLines={multiline ? 3 : 1} style={styles.receiptValue}>
        {value}
      </TasaText>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    hero: {
      gap: 2,
      marginBottom: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: colors.giftSoft,
      borderWidth: 1,
      borderColor: colors.giftSoftBorder,
    },
    field: {
      gap: 8,
      marginBottom: theme.spacing.lg,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: theme.spacing.lg,
    },
    tile: {
      width: '31%',
      minHeight: 84,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.surfaceElevated,
    },
    tileActive: {
      backgroundColor: colors.brand,
      borderColor: colors.brand,
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
