import * as ImagePicker from 'expo-image-picker';
import { router, useNavigation } from 'expo-router';
import { useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, Card } from '@/components/ui/Button';
import { ApprovalStatus, EventCard } from '@/components/ui/EventCard';
import { FeeLine, MIN_TICKET_PRICE } from '@/components/ui/FeeLine';
import { Icon } from '@/components/ui/Icon';
import { LOGO_OPTIONS, OrganisationLogo } from '@/components/ui/OrganisationLogo';
import { AmountInput, Input } from '@/components/ui/Input';
import { PinSheet } from '@/components/ui/PinSheet';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SelectField } from '@/components/ui/SelectField';
import { useSnackbar } from '@/components/ui/Snackbar';
import { VerificationDraft, VerificationForm, draftReady, emptyDraft } from '@/components/ui/SellerVerification';
import { SELLER_TERMS } from '@/constants/sellerTerms';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import {
  useBanks,
  useBecomeSeller,
  useMyEvents,
  useSaveBankAccount,
  useSeller,
  useSubmitVerification,
  useTicketPayout,
  useUpdateSeller,
  useVerifiedBankAccount,
  useWithdrawTicketSales,
} from '@/hooks/useTickets';
import { errorMessage } from '@/lib/api/errors';
import { Seller } from '@/lib/api/mappers';
import { formatDate, formatDateTime, formatNaira } from '@/lib/format';
import { kobo } from '@/lib/money';
import { FeaturePaused } from '@/components/ui/FeatureGate';
import { useFeature } from '@/hooks/useAppConfig';

const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export default function SellingScreen() {
  const seller = useSeller();
  // Setting up renders its own screen so its steps can stay pinned above the form.
  if (seller.data && !seller.data.optedIn) return <OptIn seller={seller.data} />;
  return (
    <Screen refreshable>
      <QueryState query={seller} hasData={!!seller.data} skeleton="detail" />
      {seller.data && <Dashboard seller={seller.data} />}
    </Screen>
  );
}

const OPT_IN_STEPS = ['tickets.optStepOrganisation', 'tickets.optStepVerify', 'tickets.optStepBank', 'tickets.optStepTerms'] as const;
const VERIFY_STEP = 1;
const BANK_STEP = 2;
const TERMS_STEP = 3;
/** What the fee example starts at (₦5,000). They can change it to their own price. */
const SAMPLE_PRICE = kobo(500_000);

/** Everything a seller needs, in order: who buyers see, ID and where to pay them, then the fees and terms. */
function OptIn({ seller }: { seller: Seller }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const become = useBecomeSeller();
  const selling = useFeature('ticket_selling');
  const banks = useBanks();
  const { show } = useSnackbar();
  const [step, setStep] = useState(0);
  const [organisation, setOrganisation] = useState('');
  const [about, setAbout] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [type, setType] = useState<'bvn' | 'nin'>('bvn');
  const [value, setValue] = useState('');
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [skipBank, setSkipBank] = useState(false);
  const [samplePrice, setSamplePrice] = useState(SAMPLE_PRICE);
  const [accepted, setAccepted] = useState(false);
  const verified = useVerifiedBankAccount(skipBank ? null : bankCode, accountNumber);
  const bank = !skipBank && verified.data && !verified.isFetching ? verified.data : null;
  const lastStep = step === OPT_IN_STEPS.length - 1;
  const idReady = seller.hasId || value.length === 11;

  const [verification, setVerification] = useState<VerificationDraft>(emptyDraft);
  const stepReady =
    selling.enabled && [organisation.trim().length >= 2, draftReady(verification), idReady && (skipBank || !!bank), accepted][step];

  const pickLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync(LOGO_OPTIONS);
    if (!result.canceled && result.assets[0]) setLogo(result.assets[0].uri);
  };

  // No PIN: setting up a seller profile moves no money. Withdrawals ask for it.
  const submit = async () => {
    if (!draftReady(verification)) return;
    const { logoFailed, verificationFailed } = await become.mutateAsync({
      id: seller.hasId ? null : { type, value },
      input: {
        organisation: organisation.trim(),
        ...(about.trim() && { about: about.trim() }),
        acceptTerms: SELLER_TERMS.version,
        ...(bank && { bankCode: bank.bankCode, accountNumber: bank.accountNumber }),
      },
      logo,
      verification,
    });
    if (verificationFailed) show(t('tickets.verifyFailed'), { tone: 'error' });
    else if (logoFailed) show(t('tickets.logoFailed'), { tone: 'error' });
    else show(t('tickets.optedInReview'));
  };

  return (
    <Screen
      pinned={
        <>
          <View style={styles.progress}>
            {OPT_IN_STEPS.map((key, index) => (
              <View key={key} style={[styles.progressBar, index <= step && styles.progressBarDone]} />
            ))}
          </View>
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('tickets.stepOf', { current: step + 1, total: OPT_IN_STEPS.length })}
          </TasaText>
          <TasaText variant="title" color={colors.heading}>
            {step === 0 ? t('tickets.optInTitle') : t(OPT_IN_STEPS[step])}
          </TasaText>
        </>
      }>
      {!selling.enabled && <FeaturePaused message={selling.message} />}

      {step === 0 && (
        <>
          <TasaText variant="body" color={colors.inkMuted} style={styles.intro}>
            {t('tickets.optInBody')}
          </TasaText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(logo ? 'tickets.changeLogo' : 'tickets.addLogo')}
            onPress={pickLogo}
            style={styles.logoPicker}>
            <OrganisationLogo uri={logo} size={72} />
            <View style={styles.logoCopy}>
              <TasaText variant="bodyMedium">{t(logo ? 'tickets.changeLogo' : 'tickets.addLogo')}</TasaText>
              <TasaText variant="caption" color={colors.inkMuted}>
                {t('tickets.logoHint')}
              </TasaText>
            </View>
          </Pressable>
          <Input
            label={t('tickets.organisation')}
            hint={t('tickets.organisationHint')}
            autoCapitalize="words"
            maxLength={60}
            value={organisation}
            onChangeText={setOrganisation}
          />
          <Input
            label={t('tickets.about')}
            hint={t('tickets.aboutHint')}
            multiline
            maxLength={600}
            last
            value={about}
            onChangeText={setAbout}
          />
        </>
      )}

      {step === VERIFY_STEP && (
        <>
          <TasaText variant="body" color={colors.inkMuted} style={styles.intro}>
            {t('tickets.verifyBody')}
          </TasaText>
          <VerificationForm draft={verification} onChange={setVerification} />
        </>
      )}

      {step === BANK_STEP && (
        <>
          <TasaText variant="body" color={colors.inkMuted} style={styles.intro}>
            {t('tickets.optBankBody')}
          </TasaText>
          {!seller.hasId && (
            <>
              <View style={styles.switcher}>
                <SegmentedControl
                  options={[
                    { value: 'bvn', label: 'BVN' },
                    { value: 'nin', label: 'NIN' },
                  ]}
                  value={type}
                  onChange={(next) => {
                    setType(next);
                    setValue('');
                  }}
                />
              </View>
              <Input
                label={type === 'bvn' ? 'BVN' : 'NIN'}
                keyboardType="number-pad"
                maxLength={11}
                value={value}
                onChangeText={(text) => setValue(text.replace(/\D/g, ''))}
              />
            </>
          )}
          <SelectField
            title={t('tickets.bankName')}
            placeholder={t('tickets.chooseBank')}
            value={bankCode}
            onChange={setBankCode}
            options={(banks.data ?? []).map((bank) => ({ value: bank.code, label: bank.name }))}
          />
          <Input
            label={t('tickets.accountNumber')}
            keyboardType="number-pad"
            maxLength={10}
            last
            error={verified.isError ? errorMessage(verified.error) : null}
            value={accountNumber}
            onChangeText={(text) => setAccountNumber(text.replace(/\D/g, ''))}
          />
          {verified.isFetching && <ActivityIndicator color={colors.brand} style={styles.verifying} />}
          {verified.data && !verified.isFetching && (
            <TasaText variant="bodyMedium" color={colors.success} style={styles.verifying}>
              {verified.data.accountName}
            </TasaText>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={!idReady}
            hitSlop={8}
            onPress={() => {
              setSkipBank(true);
              setStep((current) => current + 1);
            }}
            style={styles.skip}>
            <TasaText variant="bodyMedium" color={idReady ? colors.brand : colors.inkSubtle}>
              {t('tickets.skipBank')}
            </TasaText>
            <TasaText variant="caption" color={colors.inkMuted} style={styles.skipHint}>
              {t('tickets.skipBankHint')}
            </TasaText>
          </Pressable>
        </>
      )}

      {step === TERMS_STEP && (
        <>
          <SectionHeader title={t('tickets.feesTitle')} />
          <Card style={styles.fees}>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t('tickets.feesBody')}
            </TasaText>
            <AmountInput label={t('tickets.samplePrice')} value={samplePrice} onChangeValue={setSamplePrice} />
            {samplePrice < MIN_TICKET_PRICE ? (
              <TasaText variant="caption" color={colors.inkMuted}>
                {t('tickets.minPrice', { amount: formatNaira(MIN_TICKET_PRICE) })}
              </TasaText>
            ) : (
              <FeeLine price={samplePrice} />
            )}
          </Card>

          <SectionHeader title={t('tickets.termsTitle')} />
          <Card style={styles.terms}>
            {SELLER_TERMS.sections.map((section) => (
              <View key={section.title} style={styles.termsSection}>
                <TasaText variant="bodyMedium" color={colors.heading}>
                  {section.title}
                </TasaText>
                <TasaText variant="caption" color={colors.inkMuted}>
                  {section.body}
                </TasaText>
              </View>
            ))}
          </Card>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: accepted }}
            onPress={() => setAccepted((current) => !current)}
            style={styles.accept}>
            <Icon
              color={accepted ? colors.brand : colors.inkSubtle}
              ios={accepted ? 'checkmark.square.fill' : 'square'}
              android={accepted ? 'check_box' : 'check_box_outline_blank'}
              size={24}
            />
            <TasaText variant="body" style={styles.acceptCopy}>
              {t('tickets.acceptTerms')}
            </TasaText>
          </Pressable>
        </>
      )}

      <View style={styles.stepActions}>
        {step > 0 && (
          <Button
            label={t('tickets.back')}
            variant="secondary"
            style={styles.stepBack}
            onPress={() => {
              if (step === TERMS_STEP) setSkipBank(false);
              setStep((current) => current - 1);
            }}
          />
        )}
        <Button
          disabled={!stepReady}
          label={lastStep ? t('tickets.optIn') : t('common.continue')}
          loading={become.isPending}
          style={styles.stepNext}
          onPress={() =>
            lastStep
              ? submit().catch((error) => show(errorMessage(error), { tone: 'error' }))
              : setStep((current) => current + 1)
          }
        />
      </View>

    </Screen>
  );
}

function Dashboard({ seller }: { seller: Seller }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const events = useMyEvents();
  const selling = useFeature('ticket_selling');
  const wallet = seller.wallet!;
  const navigation = useNavigation();
  const [withdrawing, setWithdrawing] = useState(false);
  // Why it can't be pressed is said above it (status, terms, paused selling).
  const canCreate =
    !!seller.organisation && !!seller.termsAccepted && selling.enabled && seller.verification.status === 'approved' && !seller.suspension.active;

  // Their full organiser page, as buyers see it, one tap from the dashboard.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tickets.myProfile')}
          hitSlop={8}
          onPress={() => router.push({ pathname: '/organisers/[id]', params: { id: seller.organiserId } })}
          style={styles.headerAction}>
          <OrganisationLogo uri={seller.logoUrl} size={24} />
          <TasaText variant="caption" color={colors.brand}>
            {t('tickets.myProfile')}
          </TasaText>
        </Pressable>
      ),
    });
    return () => navigation.setOptions({ headerRight: undefined });
  }, [navigation, t, colors.brand, styles.headerAction, seller.organiserId, seller.logoUrl]);

  // Theirs first: the money, anything blocking them, their events. Someone else's events they
  // scan for are a short list of shortcuts after; organisation and bank are settings, so last.
  return (
    <>
      <Card style={styles.wallet}>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('tickets.available')}
        </TasaText>
        <TasaText variant="display" color={colors.heading}>
          {formatNaira(wallet.available)}
        </TasaText>
        {wallet.held > 0 && (
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('tickets.onHold', { amount: formatNaira(wallet.held) })}
          </TasaText>
        )}
        <Button
          disabled={wallet.available <= 0 || seller.suspension.active}
          label={t('tickets.withdraw')}
          style={styles.walletAction}
          onPress={() => setWithdrawing(true)}
        />
      </Card>
      <WithdrawSheet seller={seller} visible={withdrawing} onClose={() => setWithdrawing(false)} />

      <SellerStatus seller={seller} />
      {!seller.termsAccepted && <TermsUpdate />}

      <SectionHeader
        title={t('tickets.yourEvents')}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canCreate }}
            disabled={!canCreate}
            hitSlop={8}
            onPress={() => router.push('/events/create')}
            style={styles.createEvent}>
            <Icon ios="plus.circle.fill" android="add_circle" color={canCreate ? colors.brand : colors.inkSubtle} size={18} />
            <TasaText variant="caption" color={canCreate ? colors.brand : colors.inkSubtle}>
              {t('tickets.createEvent')}
            </TasaText>
          </Pressable>
        }
      />
      {!selling.enabled && <FeaturePaused message={selling.message} />}
      <QueryState query={events} hasData={!!events.data} quiet />
      {events.data?.owned.length === 0 && <EmptyState message={t('tickets.noOwnEvents')} />}
      {events.data?.owned.map((event) => (
        <EventCard key={event.id} event={event} href={{ pathname: '/events/manage/[id]', params: { id: event.id } }} />
      ))}

      {!!events.data?.staffed.length && (
        <>
          <SectionHeader title={t('tickets.doorDuty')} />
          <Card style={styles.doorDuty}>
            {events.data.staffed.map((event, index) => (
              <Pressable
                key={event.id}
                accessibilityRole="button"
                accessibilityLabel={`${event.title}. ${t('tickets.scanAction')}`}
                onPress={() => router.push({ pathname: '/events/scan/[id]', params: { id: event.id } })}
                style={[styles.doorRow, index > 0 && styles.doorRowDivider]}>
                <Icon ios="qrcode.viewfinder" android="qr_code_scanner" color={colors.brand} size={18} />
                <View style={styles.doorCopy}>
                  <TasaText variant="bodyMedium" numberOfLines={1}>
                    {event.title}
                  </TasaText>
                  <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
                    {formatDateTime(event.startsAt)}
                  </TasaText>
                </View>
                <TasaText variant="caption" color={colors.brand}>
                  {t('tickets.scanAction')}
                </TasaText>
              </Pressable>
            ))}
          </Card>
        </>
      )}

      <SectionHeader title={t('tickets.organisation')} />
      <Organisation seller={seller} />

      {/* Without one, it's asked for where it's needed: withdrawing to a bank. */}
      {!!seller.bankAccount && (
        <>
          <SectionHeader title={t('tickets.bankTitle')} />
          <BankAccount seller={seller} />
        </>
      )}
    </>
  );
}

/**
 * Where they stand with Tasa: suspended, waiting for review, or asked to send their photo and ID
 * (again). Nothing shows once they're approved and in good standing.
 */
function SellerStatus({ seller }: { seller: Seller }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const submit = useSubmitVerification();
  const [draft, setDraft] = useState<VerificationDraft>(emptyDraft);
  const { verification, suspension } = seller;

  if (suspension.active) {
    return (
      <Card style={{ ...styles.status, ...styles.statusDanger }}>
        <TasaText variant="bodyMedium" color={colors.danger}>
          {t('tickets.suspendedTitle')}
        </TasaText>
        {!!suspension.reason && <TasaText variant="body">{suspension.reason}</TasaText>}
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('tickets.suspendedBody')}
        </TasaText>
      </Card>
    );
  }
  if (verification.status === 'approved') return null;
  if (verification.status === 'pending') {
    return (
      <Card style={styles.status}>
        <TasaText variant="bodyMedium" color={colors.heading}>
          {t('tickets.reviewPendingTitle')}
        </TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('tickets.reviewPendingBody')}
        </TasaText>
      </Card>
    );
  }
  const rejected = verification.status === 'rejected';
  return (
    <Card style={{ ...styles.status, ...(rejected ? styles.statusDanger : {}) }}>
      <TasaText variant="bodyMedium" color={rejected ? colors.danger : colors.heading}>
        {t(rejected ? 'tickets.reviewRejectedTitle' : 'tickets.verifyNeededTitle')}
      </TasaText>
      {rejected && !!verification.reason && <TasaText variant="body">{verification.reason}</TasaText>}
      <VerificationForm draft={draft} onChange={setDraft} />
      <Button
        disabled={!draftReady(draft)}
        label={t('tickets.verifySend')}
        loading={submit.isPending}
        onPress={() => {
          if (!draftReady(draft)) return;
          submit.mutate(draft, {
            onSuccess: () => {
              setDraft(emptyDraft);
              show(t('tickets.verifySent'));
            },
            onError: (error) => show(errorMessage(error), { tone: 'error' }),
          });
        }}
      />
    </Card>
  );
}

/**
 * Ticket sales leave two ways: to their bank (priced first, with the fee shown), or to the bill
 * payment wallet, which is one way. Wallet money can't reach a bank, so it isn't a way to cash out.
 */
function WithdrawSheet({ seller, visible, onClose }: { seller: Seller; visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const payout = useTicketPayout();
  const payouts = useFeature('ticket_payouts');
  const move = useWithdrawTicketSales();
  const wallet = seller.wallet!;
  const [to, setTo] = useState<'bank' | 'wallet'>('bank');
  const [amount, setAmount] = useState(kobo(0));
  const [pinOpen, setPinOpen] = useState(false);
  const key = useRef(newKey());
  const tooMuch = amount > wallet.available;
  const quote = payout.quote.data;
  const bank = seller.bankAccount;

  const reset = () => {
    setAmount(kobo(0));
    setPinOpen(false);
    payout.quote.reset();
  };

  const close = () => {
    reset();
    onClose();
  };

  const confirm = async (pin: string) => {
    if (to === 'bank') {
      await payout.pay.mutateAsync({ quoteId: quote!.id, pin });
      show(t('tickets.payoutSent', { amount: formatNaira(quote!.amount) }));
    } else {
      await move.mutateAsync({ amount, pin, key: key.current });
      key.current = newKey();
      show(t('tickets.moved', { amount: formatNaira(amount) }));
    }
    close();
  };

  return (
    <BottomSheet visible={visible} title={t('tickets.withdrawTitle')} onClose={close}>
      <TasaText variant="bodyMedium" color={colors.heading}>
        {t('tickets.availableNow', { amount: formatNaira(wallet.available) })}
      </TasaText>
      {wallet.holds.map((hold) => (
        <TasaText key={hold.until} variant="caption" color={colors.inkMuted}>
          {t('tickets.holdLine', { amount: formatNaira(hold.amount), date: formatDate(hold.until) })}
        </TasaText>
      ))}
      {wallet.held > 0 && (
        <TasaText variant="caption" color={colors.inkSubtle}>
          {t('tickets.holdHint')}
        </TasaText>
      )}
      <View style={styles.switcher}>
        <SegmentedControl
          options={[
            { value: 'bank', label: t('tickets.toBank') },
            { value: 'wallet', label: t('tickets.toWallet') },
          ]}
          value={to}
          onChange={(next) => {
            setTo(next);
            payout.quote.reset();
          }}
        />
      </View>

      {to === 'bank' && !payouts.enabled ? (
        <FeaturePaused message={payouts.message} />
      ) : to === 'bank' && !bank ? (
        <>
          <TasaText variant="body" color={colors.inkMuted} style={styles.intro}>
            {t('tickets.bankNeeded')}
          </TasaText>
          <BankAccount seller={seller} />
        </>
      ) : (
        <>
          <AmountInput
            label={t('tickets.withdrawAmount')}
            error={tooMuch ? t('tickets.tooMuch', { amount: formatNaira(wallet.available) }) : null}
            value={amount}
            onChangeValue={(next) => {
              setAmount(next);
              payout.quote.reset();
            }}
          />

          {to === 'bank' ? (
            <>
              <TasaText variant="caption" color={colors.inkMuted} style={styles.verifying}>
                {t('tickets.payoutTo', { bank: bank!.bankName, account: bank!.accountNumber, name: bank!.accountName })}
              </TasaText>
              {quote ? (
                <Card style={styles.fees}>
                  <Line label={t('tickets.payoutAmount')} value={formatNaira(quote.amount)} />
                  {quote.charges.map((charge) => (
                    <Line key={charge.code} label={charge.label} value={formatNaira(charge.amount)} />
                  ))}
                  <Line label={t('tickets.payoutTotal')} value={formatNaira(quote.total)} strong />
                </Card>
              ) : null}
              {payout.quote.isError && (
                <TasaText variant="caption" color={colors.danger} style={styles.verifying}>
                  {errorMessage(payout.quote.error)}
                </TasaText>
              )}
              <Button
                disabled={amount <= 0 || tooMuch}
                label={quote ? t('tickets.withdrawFor', { amount: formatNaira(quote.amount) }) : t('common.continue')}
                loading={payout.quote.isPending}
                variant="secondary"
                onPress={() => (quote ? setPinOpen(true) : payout.quote.mutate(amount))}
              />
            </>
          ) : (
            <>
              <Card style={styles.warning}>
                <TasaText variant="caption" color={colors.inkMuted}>
                  {t('tickets.moveWarning')}
                </TasaText>
              </Card>
              <Button
                disabled={amount <= 0 || tooMuch}
                label={t('tickets.moveToWallet')}
                variant="secondary"
                onPress={() => setPinOpen(true)}
              />
            </>
          )}
        </>
      )}

      <PinSheet
        visible={pinOpen}
        title={t('checkout.pinTitle')}
        processingTitle={t('tickets.withdrawing')}
        detail={
          to === 'bank' && quote && bank
            ? t('tickets.payoutDetail', { amount: formatNaira(quote.amount), bank: bank.bankName, account: bank.accountNumber })
            : t('tickets.moveDetail', { amount: formatNaira(amount) })
        }
        onSubmit={confirm}
        onClose={() => setPinOpen(false)}
      />
    </BottomSheet>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <TasaText variant={strong ? 'bodyMedium' : 'caption'} color={strong ? colors.heading : colors.inkMuted}>
        {label}
      </TasaText>
      <TasaText variant={strong ? 'bodyMedium' : 'caption'} color={colors.heading}>
        {value}
      </TasaText>
    </View>
  );
}

/** How buyers see them, at a glance, with the way to change it and to see it as buyers do. */
function Organisation({ seller }: { seller: Seller }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  return (
    <Card style={styles.organisation}>
      <OrganisationLogo uri={seller.logoUrl} size={56} />
      <View style={styles.logoCopy}>
        <ApprovalStatus status={seller.verification.status} suspended={seller.suspension.active} />
        {seller.organisation ? (
          <TasaText variant="bodyMedium">{seller.organisation}</TasaText>
        ) : (
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('tickets.organisationNeeded')}
          </TasaText>
        )}
        <TasaText variant="caption" color={colors.inkMuted} numberOfLines={2}>
          {seller.about || t('tickets.aboutMissing')}
        </TasaText>
        <View style={styles.links}>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push('/events/profile')}>
            <TasaText variant="caption" color={colors.brand}>
              {t('tickets.editProfile')}
            </TasaText>
          </Pressable>
          {!!seller.organisation && (
            <Pressable
              accessibilityRole="link"
              hitSlop={8}
              onPress={() => router.push({ pathname: '/organisers/[id]', params: { id: seller.organiserId } })}>
              <TasaText variant="caption" color={colors.brand}>
                {t('tickets.viewPage')}
              </TasaText>
            </Pressable>
          )}
        </View>
      </View>
    </Card>
  );
}

/** For sellers who agreed to older terms: they read and accept the current ones before their next event. */
function TermsUpdate() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const update = useUpdateSeller();
  const [open, setOpen] = useState(false);
  return (
    <Card style={styles.terms}>
      <TasaText variant="bodyMedium" color={colors.heading}>
        {t('tickets.termsUpdated')}
      </TasaText>
      {open ? (
        SELLER_TERMS.sections.map((section) => (
          <View key={section.title} style={styles.termsSection}>
            <TasaText variant="bodyMedium" color={colors.heading}>
              {section.title}
            </TasaText>
            <TasaText variant="caption" color={colors.inkMuted}>
              {section.body}
            </TasaText>
          </View>
        ))
      ) : (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setOpen(true)}>
          <TasaText variant="caption" color={colors.brand}>
            {t('tickets.readTerms')}
          </TasaText>
        </Pressable>
      )}
      <Button
        label={t('tickets.acceptTermsButton')}
        loading={update.isPending}
        onPress={() =>
          update.mutate(
            { acceptTerms: SELLER_TERMS.version },
            { onError: (error) => show(errorMessage(error), { tone: 'error' }) },
          )
        }
      />
    </Card>
  );
}

/** Where they want to be paid. Asks for the PIN, because this decides where money goes. */
function BankAccount({ seller }: { seller: Seller }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const save = useSaveBankAccount();
  const banks = useBanks();
  const saved = seller.bankAccount;
  const [editing, setEditing] = useState(!saved);
  const [bankCode, setBankCode] = useState<string | null>(saved?.bankCode ?? null);
  const [accountNumber, setAccountNumber] = useState(saved?.accountNumber ?? '');
  const verified = useVerifiedBankAccount(editing ? bankCode : null, accountNumber);

  // No PIN: saving where sales go moves no money. Withdrawing there asks for it.
  const saveAccount = () =>
    save.mutate(
      { bankCode: bankCode!, accountNumber },
      {
        onSuccess: () => {
          setEditing(false);
          show(t('tickets.bankSaved'));
        },
        onError: (error) => show(errorMessage(error), { tone: 'error' }),
      },
    );

  if (saved && !editing) {
    return (
      <Card style={styles.bank}>
        <TasaText variant="bodyMedium">{saved.accountName}</TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {saved.bankName} · {saved.accountNumber}
        </TasaText>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setEditing(true)}>
          <TasaText variant="caption" color={colors.brand}>
            {t('tickets.bankChange')}
          </TasaText>
        </Pressable>
      </Card>
    );
  }

  return (
    <>
      <SelectField
        title={t('tickets.bankName')}
        placeholder={t('tickets.chooseBank')}
        value={bankCode}
        onChange={setBankCode}
        options={(banks.data ?? []).map((bank) => ({ value: bank.code, label: bank.name }))}
      />
      <Input
        label={t('tickets.accountNumber')}
        keyboardType="number-pad"
        maxLength={10}
        last
        error={verified.isError ? errorMessage(verified.error) : null}
        value={accountNumber}
        onChangeText={(text) => setAccountNumber(text.replace(/\D/g, ''))}
      />
      {verified.isFetching && <ActivityIndicator color={colors.brand} style={styles.verifying} />}
      {verified.data && !verified.isFetching && (
        <TasaText variant="bodyMedium" color={colors.success} style={styles.verifying}>
          {verified.data.accountName}
        </TasaText>
      )}
      <Button
        disabled={!verified.data || verified.isFetching}
        label={t('tickets.bankSave')}
        variant="secondary"
        loading={save.isPending}
        onPress={saveAccount}
      />
    </>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    progress: {
      flexDirection: 'row',
      gap: 6,
      marginBottom: theme.spacing.sm,
    },
    progressBar: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.track,
    },
    progressBarDone: {
      backgroundColor: colors.brand,
    },
    logoPicker: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    logoCopy: {
      flex: 1,
      gap: 4,
    },
    organisation: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.md,
    },
    links: {
      flexDirection: 'row',
      gap: theme.spacing.md,
    },
    fees: {
      gap: theme.spacing.xs,
    },
    terms: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
    },
    termsSection: {
      gap: 2,
    },
    accept: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
    },
    acceptCopy: {
      flex: 1,
    },
    skip: {
      alignSelf: 'flex-end',
      alignItems: 'flex-end',
      maxWidth: '80%',
      gap: 2,
      marginTop: theme.spacing.sm,
    },
    skipHint: {
      textAlign: 'right',
    },
    warning: {
      marginBottom: theme.spacing.md,
    },
    line: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    status: {
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    statusDanger: {
      backgroundColor: colors.dangerSoft,
      borderColor: colors.dangerSoftBorder,
    },
    stepActions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.lg,
    },
    stepBack: {
      flex: 1,
    },
    stepNext: {
      flex: 2,
    },
    intro: {
      marginTop: theme.spacing.xs,
      marginBottom: theme.spacing.md,
    },
    switcher: {
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    walletAction: {
      marginTop: theme.spacing.md,
    },
    createEvent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    doorDuty: {
      paddingVertical: 0,
    },
    doorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: theme.spacing.sm + 2,
    },
    doorRowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    doorCopy: {
      flex: 1,
      gap: 2,
    },
    headerAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 6,
    },
    wallet: {
      gap: 4,
      marginBottom: theme.spacing.md,
    },
    action: {
      marginTop: theme.spacing.md,
    },
    bank: {
      gap: 4,
    },
    verifying: {
      marginBottom: theme.spacing.md,
    },
  }),
);
