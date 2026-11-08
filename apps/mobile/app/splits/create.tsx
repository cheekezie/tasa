import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { AmountInput, Input } from '@/components/ui/Input';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ProviderPicker } from '@/components/ui/ProviderPicker';
import { useRecipientLookup } from '@/components/ui/RecipientField';
import { SelectField } from '@/components/ui/SelectField';
import { useSnackbar } from '@/components/ui/Snackbar';
import { SplitDeadlineField, useSplitDeadline } from '@/components/ui/SplitDeadlineField';
import { ServiceId, theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useAccount } from '@/hooks/useAccount';
import { useCreateSplit } from '@/hooks/useGroups';
import { useBillServices, usePlans, useVerifiedBillAccount } from '@/hooks/usePayments';
import { errorMessage } from '@/lib/api/errors';
import { formatNaira } from '@/lib/format';
import { kobo } from '@/lib/money';
import { checkAccountNumber } from '@/lib/validation';

type SplitService = Extract<ServiceId, 'electricity' | 'tv' | 'internet'>;
const SERVICES: SplitService[] = ['electricity', 'tv', 'internet'];

/**
 * Starting a split: the bill (checked with the provider, as when paying it), who's in, and how long
 * they have. Shares are equal; the API works them out from the bill and its charge.
 */
export default function CreateSplitScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const create = useCreateSplit();
  const me = useAccount().profile.username;
  const services = useBillServices();
  const [title, setTitle] = useState('');
  const [serviceId, setServiceId] = useState<SplitService>('electricity');
  const [provider, setProvider] = useState<string | null>(null);
  const [account, setAccount] = useState('');
  const [meterType, setMeterType] = useState<'prepaid' | 'postpaid'>('prepaid');
  const [amount, setAmount] = useState(kobo(0));
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [usernames, setUsernames] = useState<string[]>(['']);
  const [includeMe, setIncludeMe] = useState(true);
  // Each typed person as their Tasa username once looked up; null while unknown or not found.
  const [resolved, setResolved] = useState<Record<number, string | null>>({});
  const deadline = useSplitDeadline();
  const plansBased = serviceId !== 'electricity';
  const plans = usePlans(serviceId, provider, plansBased);
  const providers = services.data?.find((s) => s.id === serviceId)?.providers ?? [];
  // Checked with the provider, as when paying a bill, once the number looks right.
  const accountCheck = checkAccountNumber(serviceId, account);
  const verified = useVerifiedBillAccount(serviceId, provider, accountCheck.value, meterType, !!account && !accountCheck.error);
  const showFormatError = account.length >= 6 && !!accountCheck.error;
  const typed = usernames.map((u, i) => ({ text: u.trim(), username: resolved[i] ?? null })).filter((p) => p.text);
  const people = [...(includeMe && me ? [me] : []), ...typed.flatMap((p) => (p.username ? [p.username] : []))];
  const everyoneFound = typed.every((p) => !!p.username);
  const price = plansBased ? (plans.data?.find((p) => p.code === planCode)?.amount ?? 0) : amount;
  const ready =
    title.trim().length >= 2 &&
    !!provider &&
    verified.isSuccess &&
    !verified.isFetching &&
    (plansBased ? !!planCode : amount >= 50_000) &&
    everyoneFound &&
    new Set(people).size >= 2;

  const submit = () =>
    create.mutate(
      {
        title: title.trim(),
        bill: {
          serviceId,
          provider: provider!,
          account: verified.data!.account,
          ...(plansBased ? { planCode: planCode! } : { amount, meterType }),
        },
        shares: [...new Set(people)].map((username) => ({ username })),
        hours: deadline.hours()!,
      },
      {
        onSuccess: (split) => {
          show(t('splits.started'));
          router.replace({ pathname: '/splits/[id]', params: { id: split.id } });
        },
        onError: (error) => show(errorMessage(error), { tone: 'error' }),
      },
    );

  return (
    <Screen footer={<Button disabled={!ready} label={t('splits.start')} loading={create.isPending} onPress={submit} />}>
      <Input label={t('splits.title')} placeholder={t('splits.titlePlaceholder')} maxLength={60} value={title} onChangeText={setTitle} />

      <SectionHeader title={t('splits.theBill')} />
      <SegmentedControl
        options={SERVICES.map((id) => ({ value: id, label: t(`services.${id}.name`) }))}
        value={serviceId}
        onChange={(next) => {
          setServiceId(next);
          setProvider(null);
          setPlanCode(null);
        }}
      />
      <View style={styles.gap} />
      <ProviderPicker
        label={t('splits.provider')}
        providers={providers}
        value={provider}
        onChange={(next) => {
          setProvider(next);
          setPlanCode(null);
        }}
      />
      {serviceId === 'electricity' && (
        <>
          <View style={styles.gap} />
          <SegmentedControl
            options={[
              { value: 'prepaid', label: t('bill.prepaid') },
              { value: 'postpaid', label: t('bill.postpaid') },
            ]}
            value={meterType}
            onChange={setMeterType}
          />
        </>
      )}
      <Input
        label={t(`splits.account.${serviceId}`)}
        keyboardType={serviceId === 'internet' ? 'default' : 'number-pad'}
        autoCapitalize="none"
        error={showFormatError ? accountCheck.error : verified.isError ? errorMessage(verified.error) : null}
        value={account}
        onChangeText={setAccount}
      />
      {verified.isFetching && (
        <View style={styles.verifying}>
          <ActivityIndicator color={colors.brand} />
          <TasaText variant="caption" color={colors.inkMuted}>
            {t(serviceId === 'electricity' ? 'review.verifyingMeter' : 'splits.verifying')}
          </TasaText>
        </View>
      )}
      {verified.data?.customer && !verified.isFetching && (
        <View style={styles.customer}>
          <TasaText variant="bodyMedium" color={colors.success}>
            {verified.data.customer.name}
          </TasaText>
          {!!verified.data.customer.address && (
            <TasaText variant="caption" color={colors.inkMuted} numberOfLines={2}>
              {verified.data.customer.address}
            </TasaText>
          )}
        </View>
      )}
      {plansBased ? (
        <SelectField
          title={t('splits.plan')}
          placeholder={t('splits.choosePlan')}
          value={planCode}
          onChange={setPlanCode}
          options={(plans.data ?? []).map((p) => ({ value: p.code, label: p.name, detail: formatNaira(p.amount) }))}
        />
      ) : (
        <AmountInput label={t('splits.amount')} value={amount} onChangeValue={setAmount} />
      )}

      <SectionHeader title={t('splits.who')} />
      <View style={styles.switchRow}>
        <Switch value={includeMe} onValueChange={setIncludeMe} />
        <TasaText variant="caption" style={styles.flex}>
          {t('splits.includeMe')}
        </TasaText>
      </View>
      {usernames.map((username, index) => (
        <PersonField
          key={index}
          label={t('splits.person', { number: index + 1 })}
          value={username}
          includesMe={includeMe}
          onChangeText={(value) => setUsernames((current) => current.map((u, i) => (i === index ? value : u)))}
          onResolved={(found) => setResolved((current) => (current[index] === found ? current : { ...current, [index]: found }))}
        />
      ))}
      {usernames.length < 19 && (
        <Pressable accessibilityRole="button" onPress={() => setUsernames((current) => [...current, ''])} style={styles.add}>
          <TasaText variant="caption" color={colors.brand}>
            {t('splits.addPerson')}
          </TasaText>
        </Pressable>
      )}
      {price > 0 && people.length >= 2 && (
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('splits.eachAbout', { amount: formatNaira(kobo(Math.ceil(price / new Set(people).size))), count: new Set(people).size })}
        </TasaText>
      )}

      <SectionHeader title={t('splits.deadline')} />
      <SplitDeadlineField deadline={deadline} />
      <TasaText variant="caption" color={colors.inkMuted} style={styles.gap}>
        {t('splits.deadlineHint')}
      </TasaText>
    </Screen>
  );
}

/**
 * One person to split with: their @username, phone or email, looked up as they type (exactly,
 * like a transfer), with their name shown so it's clear who'll be asked to pay.
 */
function PersonField({
  label,
  value,
  includesMe,
  onChangeText,
  onResolved,
}: {
  label: string;
  value: string;
  includesMe: boolean;
  onChangeText: (text: string) => void;
  onResolved: (username: string | null) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const lookup = useRecipientLookup(value);
  const username = lookup.status === 'found' ? lookup.match.username : null;
  useEffect(() => {
    onResolved(username);
  }, [username, onResolved]);

  const error =
    lookup.status === 'notFound' || lookup.status === 'invite'
      ? t('splits.personNotFound')
      : lookup.status === 'self'
        ? t(includesMe ? 'splits.alreadyYou' : 'splits.useSwitchForYou')
        : lookup.status === 'failed'
          ? lookup.message
          : lookup.status === 'found' && !lookup.match.username
            ? t('splits.noUsername')
            : null;

  return (
    <View style={styles.person}>
      <Input
        label={label}
        placeholder={t('recipient.placeholder')}
        autoCapitalize="none"
        autoCorrect={false}
        value={value}
        error={error}
        onChangeText={onChangeText}
      />
      {lookup.status === 'checking' && (
        <View style={styles.verifying}>
          <ActivityIndicator size="small" color={colors.inkSubtle} />
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('recipient.checking')}
          </TasaText>
        </View>
      )}
      {lookup.status === 'found' && !!lookup.match.username && (
        <View style={styles.match}>
          <Avatar uri={null} name={lookup.match.name} size={28} />
          <View style={styles.flex}>
            <TasaText variant="bodyMedium" numberOfLines={1}>
              {lookup.match.name}
            </TasaText>
            <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
              @{lookup.match.username}
            </TasaText>
          </View>
          <Icon color={colors.success} ios="checkmark.seal.fill" android="verified" size={18} />
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    gap: {
      marginTop: theme.spacing.sm,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: theme.spacing.sm,
    },
    add: {
      alignSelf: 'flex-start',
      paddingVertical: theme.spacing.sm,
    },
    person: {
      marginBottom: theme.spacing.sm,
    },
    match: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: -theme.spacing.sm,
      marginBottom: theme.spacing.sm,
    },
    verifying: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
    },
    customer: {
      gap: 2,
      marginBottom: theme.spacing.md,
    },
    flex: {
      flex: 1,
    },
  }),
);
