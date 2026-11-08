import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, Card } from '@/components/ui/Button';
import { CheckoutFailureView } from '@/components/ui/CheckoutFailureView';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { PinSheet } from '@/components/ui/PinSheet';
import { QueryState } from '@/components/ui/QueryState';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { useCopyToClipboard, useSnackbar } from '@/components/ui/Snackbar';
import { SplitDeadlineField, useSplitDeadline } from '@/components/ui/SplitDeadlineField';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useCheckout } from '@/hooks/useCheckout';
import { useCancelSplit, useSplit, useSplitAgain, useUpdateSplit } from '@/hooks/useGroups';
import { errorMessage } from '@/lib/api/errors';
import { splitsService } from '@/lib/api/services/groups';
import { SplitDto, SplitRoundDto } from '@/lib/api/types';
import { formatDate, formatDateTime, formatNaira } from '@/lib/format';
import { queryClient, queryKeys } from '@/lib/queryClient';

/** One split: how full the pot is, who's paid, paying your own share, and the bill's receipt once paid. */
export default function SplitScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useSplit(id);
  const split = query.data;
  const cancel = useCancelSplit(id);
  const again = useSplitAgain(id);
  const [askingAgain, setAskingAgain] = useState(false);
  const [editing, setEditing] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const confirm = useCallback(
    async (quoteId: string, pin: string) => {
      const result = await splitsService.payShare(id, quoteId, pin);
      await queryClient.invalidateQueries({ queryKey: queryKeys.split(id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.splits });
      return result;
    },
    [id],
  );
  const checkout = useCheckout(confirm);
  const { result, reset } = checkout;
  // The split was refetched before `result` arrived: 'paying' means this was the last share.
  const lastIn = split?.status === 'paying';
  useEffect(() => {
    if (!result) return;
    show(t(lastIn ? 'splits.lastShareIn' : 'splits.sharePaid'));
    reset();
  }, [result, reset, show, t, lastIn]);

  if (checkout.failure) return <CheckoutFailureView failure={checkout.failure} onRetry={checkout.retry} onEdit={checkout.reset} />;

  const owe = !!split?.myShare && !split.myShare.paid && split.status === 'open';
  const canCancel = !!split?.isStarter && split.status === 'open';
  // Over (paid or not): the same bill and people can go again without setting it all up.
  const canAgain = !!split && split.status !== 'open' && split.status !== 'paying';
  return (
    <Screen
      refreshable
      footer={
        owe || canCancel || canAgain ? (
          <View style={styles.footer}>
            {canCancel && (
              <Button
                label={t('splits.cancel')}
                variant="destructive"
                loading={cancel.isPending}
                style={styles.flex}
                onPress={() =>
                  cancel.mutate(undefined, {
                    onSuccess: () => show(t('splits.cancelled')),
                    onError: (error) => show(errorMessage(error), { tone: 'error' }),
                  })
                }
              />
            )}
            {canAgain && <Button label={t('splits.again')} style={styles.flex} onPress={() => setAskingAgain(true)} />}
            {owe && (
              <Button
                label={t('splits.payAmount', { amount: formatNaira(split!.myShare!.amount) })}
                loading={checkout.quoting}
                style={styles.flex}
                onPress={() => {
                  setQuoteError(null);
                  checkout.start({ kind: 'split_share', splitId: id }).catch((error) => setQuoteError(errorMessage(error)));
                }}
              />
            )}
          </View>
        ) : undefined
      }>
      <QueryState query={query} hasData={!!split} skeleton="detail" />
      {split && (
        <>
          <View style={styles.titleRow}>
            <TasaText variant="title" color={colors.heading} style={styles.flex}>
              {split.title}
            </TasaText>
            {split.isStarter && split.status === 'open' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('splits.edit')}
                hitSlop={8}
                onPress={() => setEditing(true)}
                style={styles.editLink}>
                <Icon ios="pencil" android="edit" color={colors.brand} size={16} />
                <TasaText variant="caption" color={colors.brand}>
                  {t('splits.edit')}
                </TasaText>
              </Pressable>
            )}
          </View>
          <TasaText variant="caption" color={colors.inkMuted}>
            {[t(`services.${split.bill.serviceId}.name`), split.bill.provider, split.bill.planName, split.bill.customerName ?? split.bill.account]
              .filter(Boolean)
              .join(' · ')}
          </TasaText>

          <Card style={styles.pot}>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t(`splits.headline.${split.status}`)}
            </TasaText>
            <TasaText variant="display" color={colors.heading}>
              {formatNaira(split.collected)}
            </TasaText>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t('splits.ofTotal', { total: formatNaira(split.total), fee: formatNaira(split.fee) })}
            </TasaText>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, (split.collected / split.total) * 100)}%` }]} />
            </View>
            <TasaText variant="caption" color={colors.inkMuted}>
              {split.status === 'open' ? t('splits.closesAt', { date: formatDateTime(split.deadline) }) : (split.closedReason ?? '')}
            </TasaText>
          </Card>
          {split.status === 'paying' && (
            <Card style={styles.paying}>
              <ActivityIndicator color={colors.brand} />
              <View style={styles.flex}>
                <TasaText variant="bodyMedium">{t('splits.payingTitle')}</TasaText>
                <TasaText variant="caption" color={colors.inkMuted}>
                  {t('splits.payingBody')}
                </TasaText>
              </View>
            </Card>
          )}
          {split.result && <Receipt split={split} />}
          {!!quoteError && (
            <TasaText variant="caption" color={colors.danger}>
              {quoteError}
            </TasaText>
          )}

          <SectionHeader title={t('splits.shares')} />
          {split.shares.map((share) => (
            <View key={share.id} style={styles.share}>
              <Icon
                ios={share.paid ? 'checkmark.circle.fill' : 'circle'}
                android={share.paid ? 'check_circle' : 'radio_button_unchecked'}
                color={share.refunded ? colors.inkMuted : share.paid ? colors.success : colors.inkSubtle}
                size={20}
              />
              <TasaText variant="bodyMedium" style={styles.flex} numberOfLines={1}>
                {share.name}
                {share.id === split.starter.id ? ` · ${t('splits.starter')}` : ''}
              </TasaText>
              <TasaText variant="caption" color={colors.inkMuted}>
                {formatNaira(share.amount)}
                {share.refunded ? ` · ${t('splits.refunded')}` : ''}
              </TasaText>
            </View>
          ))}

          {!!split.history?.length && <History rounds={split.history} serviceId={split.bill.serviceId} />}

          <AgainSheet
            visible={askingAgain}
            onClose={() => setAskingAgain(false)}
            loading={again.isPending}
            onStart={(hours) =>
              again.mutate(hours, {
                onSuccess: (next) => {
                  setAskingAgain(false);
                  show(t('splits.againStarted'));
                  router.replace({ pathname: '/splits/[id]', params: { id: next.id } });
                },
                onError: (error) => show(errorMessage(error), { tone: 'error' }),
              })
            }
          />
          {editing && <EditSheet split={split} onClose={() => setEditing(false)} />}
          <PinSheet
            {...checkout.pinSheet}
            title={t('checkout.pinTitle')}
            processingTitle={t('splits.paying')}
            detail={checkout.quote ? t('splits.payDetail', { amount: formatNaira(checkout.quote.total), title: split.title }) : undefined}
          />
        </>
      )}
    </Screen>
  );
}

/**
 * Every other time this bill was split (with Split again), newest first: what it came to, what
 * you put in, how it ended, and the token it bought, so last month's is never far away.
 */
function History({ rounds, serviceId }: { rounds: SplitRoundDto[]; serviceId: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const copy = useCopyToClipboard();
  return (
    <>
      <SectionHeader title={t('splits.history')} />
      <Card>
        {rounds.map((round, index) => {
          const token = round.result?.token?.replace(/^Token\s*:\s*/i, '');
          const tone =
            round.status === 'paid' ? colors.success : round.status === 'open' || round.status === 'paying' ? colors.accentHot : colors.inkMuted;
          return (
            <Pressable
              key={round.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/splits/[id]', params: { id: round.id } })}
              style={[styles.round, index > 0 && styles.divider]}>
              <View style={styles.roundHead}>
                <TasaText variant="bodyMedium" style={styles.flex}>
                  {formatDate(round.createdAt)}
                </TasaText>
                <TasaText variant="caption" color={tone}>
                  {t(`splits.headline.${round.status}`)}
                </TasaText>
                <Icon ios="chevron.right" android="chevron_right" color={colors.inkSubtle} size={14} />
              </View>
              <TasaText variant="caption" color={colors.inkMuted}>
                {t('splits.roundLine', { total: formatNaira(round.total) })}
                {round.myShare
                  ? ` · ${t(round.myShare.refunded ? 'splits.youGotBack' : round.myShare.paid ? 'splits.youPaid' : 'splits.youDidntPay', { amount: formatNaira(round.myShare.amount) })}`
                  : ''}
                {round.result?.units ? ` · ${round.result.units}` : ''}
              </TasaText>
              {!!token && serviceId === 'electricity' && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('splits.copyToken')}
                  hitSlop={6}
                  onPress={() => copy(token, t('splits.tokenCopied'))}
                  style={styles.roundToken}>
                  <TasaText variant="caption" color={colors.heading} style={styles.flex} numberOfLines={1}>
                    {token}
                  </TasaText>
                  <Icon ios="doc.on.doc" android="content_copy" color={colors.brand} size={14} />
                </Pressable>
              )}
            </Pressable>
          );
        })}
      </Card>
    </>
  );
}

/** Splitting it again: the same bill and people, and how long they have this time. */
function AgainSheet({
  visible,
  onClose,
  loading,
  onStart,
}: {
  visible: boolean;
  onClose: () => void;
  loading: boolean;
  onStart: (hours: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const deadline = useSplitDeadline();
  return (
    <BottomSheet visible={visible} title={t('splits.again')} onClose={onClose}>
      <TasaText variant="caption" color={colors.inkMuted} style={styles.hint}>
        {t('splits.againHint')}
      </TasaText>
      <SplitDeadlineField deadline={deadline} />
      <Button label={t('splits.startAgain')} loading={loading} style={styles.sheetButton} onPress={() => onStart(deadline.hours()!)} />
    </BottomSheet>
  );
}

/** The starter, while it's collecting: a new name, or a new deadline from now. */
function EditSheet({ split, onClose }: { split: SplitDto; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const update = useUpdateSplit(split.id);
  const [title, setTitle] = useState(split.title);
  const deadline = useSplitDeadline({ keepable: true });
  const renamed = title.trim() !== split.title;
  return (
    <BottomSheet visible title={t('splits.edit')} onClose={onClose}>
      <Input label={t('splits.title')} maxLength={60} value={title} onChangeText={setTitle} />
      <TasaText variant="caption" color={colors.inkMuted} style={styles.hint}>
        {t('splits.deadlineNow', { date: formatDateTime(split.deadline) })}
      </TasaText>
      <SplitDeadlineField deadline={deadline} />
      <Button
        label={t('common.save')}
        disabled={title.trim().length < 2 || (!renamed && deadline.choice === 'keep')}
        loading={update.isPending}
        style={styles.sheetButton}
        onPress={() => {
          const hours = deadline.hours();
          update.mutate(
            { ...(renamed && { title: title.trim() }), ...(hours && { hours }) },
            {
              onSuccess: () => {
                show(t(hours ? 'splits.deadlineMoved' : 'splits.renamed'));
                onClose();
              },
              onError: (error) => show(errorMessage(error), { tone: 'error' }),
            },
          );
        }}
      />
    </BottomSheet>
  );
}

/** What the pot bought, for everyone who paid in: the reference, and the token or PINs to use. */
function Receipt({ split }: { split: SplitDto }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const copy = useCopyToClipboard();
  const r = split.result!;
  const ok = r.status === 'success';
  const line = (label: string, value: string) => (
    <View style={styles.line}>
      <TasaText variant="caption" color={colors.inkMuted}>
        {label}
      </TasaText>
      <TasaText variant="caption" style={styles.lineValue} numberOfLines={2}>
        {value}
      </TasaText>
    </View>
  );
  return (
    <>
      <SectionHeader title={t('splits.receipt')} />
      <Card style={styles.receipt}>
        <View style={styles.receiptHead}>
          <Icon
            ios={ok ? 'checkmark.circle.fill' : 'clock.fill'}
            android={ok ? 'check_circle' : 'schedule'}
            color={ok ? colors.success : colors.accentHot}
            size={20}
          />
          <TasaText variant="bodyMedium" color={ok ? colors.success : colors.heading}>
            {t(`transaction.status.${r.status}`)}
          </TasaText>
        </View>
        {!!r.token && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('splits.copyToken')}
            onPress={() => copy(r.token!, t('splits.tokenCopied'))}
            style={styles.token}>
            <View style={styles.flex}>
              <TasaText variant="caption" color={colors.inkMuted}>
                {t('transaction.token')}
              </TasaText>
              <TasaText variant="subtitle" color={colors.heading}>
                {r.token.replace(/^Token\s*:\s*/i, '')}
              </TasaText>
            </View>
            <Icon ios="doc.on.doc" android="content_copy" color={colors.brand} size={18} />
          </Pressable>
        )}
        {r.pins.map((p, index) => (
          <Pressable key={`${p.pin}-${index}`} accessibilityRole="button" onPress={() => copy(p.pin)} style={styles.token}>
            <View style={styles.flex}>
              <TasaText variant="caption" color={colors.inkMuted}>
                {t('transaction.pin')}
                {p.serial ? ` · ${p.serial}` : ''}
              </TasaText>
              <TasaText variant="subtitle" color={colors.heading}>
                {p.pin}
              </TasaText>
            </View>
            <Icon ios="doc.on.doc" android="content_copy" color={colors.brand} size={18} />
          </Pressable>
        ))}
        {!!r.units && line(t('transaction.units'), r.units)}
        {line(t(`services.${split.bill.serviceId}.account`), split.bill.account)}
        {!!r.customerName && line(t('splits.customer'), r.customerName)}
        {line(t('splits.reference'), r.reference)}
        {line(t('splits.paidAt'), formatDateTime(r.paidAt))}
      </Card>
    </>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    pot: {
      gap: 4,
      marginTop: theme.spacing.md,
    },
    track: {
      height: 8,
      borderRadius: 4,
      overflow: 'hidden',
      marginVertical: theme.spacing.sm,
      backgroundColor: colors.track,
    },
    fill: {
      height: '100%',
      borderRadius: 4,
      backgroundColor: colors.brand,
    },
    share: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: theme.spacing.sm,
    },
    round: {
      gap: 4,
      paddingVertical: theme.spacing.sm,
    },
    roundHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    roundToken: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginTop: 2,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      borderRadius: theme.radius.sm,
      backgroundColor: colors.track,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    editLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    hint: {
      marginBottom: theme.spacing.sm,
    },
    sheetButton: {
      marginTop: theme.spacing.md,
    },
    paying: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      marginTop: theme.spacing.md,
      borderColor: `${colors.brand}55`,
      backgroundColor: `${colors.brand}0D`,
    },
    receipt: {
      gap: theme.spacing.sm,
    },
    receiptHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    token: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: colors.track,
    },
    line: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    lineValue: {
      flexShrink: 1,
      textAlign: 'right',
    },
    footer: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    flex: {
      flex: 1,
    },
  }),
);
