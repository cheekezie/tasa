import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, Card } from '@/components/ui/Button';
import { CheckoutFailureView } from '@/components/ui/CheckoutFailureView';
import { DuesStatement, useDuesSelection, usePriceLine } from '@/components/ui/DuesStatement';
import { GroupNameRow } from '@/components/ui/GroupJoinPreview';
import { GroupMembersList } from '@/components/ui/GroupMembersList';
import { GroupTerms } from '@/components/ui/GroupTerms';
import { Icon } from '@/components/ui/Icon';
import { LOGO_OPTIONS, OrganisationLogo } from '@/components/ui/OrganisationLogo';
import { AmountInput, Input } from '@/components/ui/Input';
import { PinSheet } from '@/components/ui/PinSheet';
import { QueryState } from '@/components/ui/QueryState';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useCopyToClipboard, useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useCheckout } from '@/hooks/useCheckout';
import {
  useAcceptGroupTerms,
  useAddExecutive,
  useApprovePayoutChange,
  useGroup,
  useGroupLogo,
  useGroupWithdrawals,
  useObjectToPayoutChange,
  useRemoveExecutive,
  useRotateInviteCode,
  useUpdateGroup,
} from '@/hooks/useGroups';
import { errorMessage } from '@/lib/api/errors';
import { groupsService } from '@/lib/api/services/groups';
import { GroupDto, GroupDueDto } from '@/lib/api/types';
import { formatDateTime, formatNaira } from '@/lib/format';
import { groupInviteLink } from '@/lib/links';
import { kobo } from '@/lib/money';
import { queryClient, queryKeys } from '@/lib/queryClient';

type Tab = 'overview' | 'dues' | 'members' | 'settings';

/**
 * One group. Members see their dues period by period and pick what to pay. Executives get tabs:
 * the money and their own dues, each due and how it's going, the members, and the settings.
 */
export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const query = useGroup(id);
  const group = query.data;
  const [tab, setTab] = useState<Tab>('overview');
  const paying = useDuesPayment(group);
  const showPay = !!group && (!group.role || tab === 'overview') && paying.canPay;

  return (
    <Screen
      refreshable
      pinned={
        group?.role ? (
          <SegmentedControl
            options={[
              { value: 'overview', label: t('groups.tab.overview') },
              { value: 'dues', label: t('groups.tab.dues') },
              { value: 'members', label: t('groups.tab.members') },
              { value: 'settings', label: t('groups.tab.settings') },
            ]}
            value={tab}
            onChange={setTab}
            compact
          />
        ) : undefined
      }
      footer={
        showPay ? (
          <Button
            disabled={paying.count === 0 || !!group.suspended}
            label={paying.count === 0 ? t('groups.pickToPay') : t('groups.payFor', { amount: formatNaira(paying.total), count: paying.count })}
            loading={paying.checkout.quoting}
            onPress={paying.start}
          />
        ) : undefined
      }>
      <QueryState query={query} hasData={!!group} skeleton="detail" />
      {group && (
        <>
          <Header group={group} />
          {!group.role && <MemberView group={group} paying={paying} />}
          {group.role && tab === 'overview' && <Overview group={group} paying={paying} onTab={setTab} />}
          {group.role && tab === 'dues' && <DuesTab group={group} />}
          {group.role && tab === 'members' && <GroupMembersList groupId={group.id} pending={group.members.pending} />}
          {group.role && tab === 'settings' && <Settings group={group} />}
        </>
      )}
      {paying.checkout.failure && (
        <CheckoutFailureView failure={paying.checkout.failure} onRetry={paying.checkout.retry} onEdit={paying.checkout.reset} />
      )}
      {group && (
        <PinSheet
          {...paying.checkout.pinSheet}
          title={t('checkout.pinTitle')}
          processingTitle={t('groups.paying')}
          detail={paying.checkout.quote ? t('groups.payDetail', { amount: formatNaira(paying.checkout.quote.total), name: group.name }) : undefined}
        />
      )}
    </Screen>
  );
}

/** Picking periods and paying them: the selection, then a quote, then the PIN. */
function useDuesPayment(group: GroupDto | undefined) {
  const t = useT();
  const { show } = useSnackbar();
  const m = group?.membership;
  const dues = m?.status === 'active' && !m.mustAcceptTerms ? m.dues : undefined;
  const picking = useDuesSelection(dues);
  const groupId = group?.id ?? '';
  const { reset: clear } = picking;
  const confirm = useCallback(
    async (quoteId: string, pin: string) => {
      const result = await groupsService.payDues(groupId, quoteId, pin);
      await queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      show(t('groups.duesPaid', { amount: formatNaira(result.amount) }));
      clear();
      return result;
    },
    [groupId, show, t, clear],
  );
  const checkout = useCheckout(confirm);
  // Paid: ready for the next payment.
  const { result, reset } = checkout;
  useEffect(() => {
    if (result) reset();
  }, [result, reset]);

  return {
    ...picking,
    checkout,
    canPay: !!dues && dues.length > 0,
    start: () => checkout.start({ kind: 'group_dues', groupId, items: picking.items }).catch((error) => show(errorMessage(error), { tone: 'error' })),
  };
}
type Paying = ReturnType<typeof useDuesPayment>;

function Header({ group }: { group: GroupDto }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  return (
    <>
      <GroupNameRow name={group.name} logoUrl={group.logoUrl} />
      {!!group.about && (
        <TasaText variant="caption" color={colors.inkMuted} numberOfLines={3}>
          {group.about}
        </TasaText>
      )}
      {group.suspended && (
        <Card style={styles.danger}>
          <TasaText variant="bodyMedium" color={colors.danger}>
            {t('groups.suspended')}
          </TasaText>
          {!!group.suspended.reason && <TasaText variant="caption">{group.suspended.reason}</TasaText>}
        </Card>
      )}
      {group.payoutChange && <PayoutChange group={group} />}
      {group.membership?.mustAcceptTerms && <AcceptTerms group={group} />}
    </>
  );
}

/** A member's page: what they owe in one line, then every due period by period. */
function MemberView({ group, paying }: { group: GroupDto; paying: Paying }) {
  const t = useT();
  return (
    <>
      <MyDues group={group} paying={paying} />
      <SectionHeader title={t('groups.whereDuesGo')} />
      <GroupTerms terms={group.terms} />
      <Withdrawals groupId={group.id} />
    </>
  );
}

function MyDues({ group, paying }: { group: GroupDto; paying: Paying }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const m = group.membership;
  if (!m) return null;
  if (m.status === 'pending') {
    return (
      <Card style={styles.card}>
        <TasaText variant="bodyMedium">{t('groups.waitingApproval')}</TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('groups.waitingApprovalBody')}
        </TasaText>
      </Card>
    );
  }
  if (m.mustAcceptTerms) return null;
  return (
    <>
      <Card style={styles.card}>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('groups.youOwe')}
        </TasaText>
        <TasaText variant="display" color={m.amountOwed > 0 ? colors.heading : colors.success}>
          {m.amountOwed > 0 ? formatNaira(m.amountOwed) : t('groups.allPaid')}
        </TasaText>
        {m.overdue > 0 && (
          <TasaText variant="caption" color={colors.danger}>
            {t('groups.overdueAmount', { amount: formatNaira(m.overdue) })}
          </TasaText>
        )}
      </Card>
      <SectionHeader title={t('groups.myDues')} />
      <TasaText variant="caption" color={colors.inkMuted} style={styles.hint}>
        {t('groups.pickHint')}
      </TasaText>
      <Legend />
      <DuesStatement dues={m.dues ?? []} selection={paying.selection} onToggle={paying.toggle} />
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/groups/receipts', params: { group: group.id } })}>
        <Card style={styles.notice}>
          <Icon ios="doc.text.fill" android="receipt_long" color={colors.brand} size={20} />
          <View style={styles.flex}>
            <TasaText variant="bodyMedium">{t('groups.receipts')}</TasaText>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t('groups.receiptsHint')}
            </TasaText>
          </View>
          <Icon ios="chevron.right" android="chevron_right" color={colors.inkMuted} size={16} />
        </Card>
      </Pressable>
    </>
  );
}

function Legend() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const items = [
    ['paid', colors.success],
    ['due', colors.accentHot],
    ['overdue', colors.danger],
    ['optional', colors.inkMuted],
  ] as const;
  return (
    <View style={styles.legend}>
      {items.map(([status, color]) => (
        <View key={status} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: color }]} />
          <TasaText variant="caption" color={colors.inkMuted}>
            {t(`groups.status.${status}`)}
          </TasaText>
        </View>
      ))}
    </View>
  );
}

/** Executives' first tab: the money, what needs them, and their own dues. */
function Overview({ group, paying, onTab }: { group: GroupDto; paying: Paying; onTab: (tab: Tab) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const [withdrawing, setWithdrawing] = useState(false);
  const outstanding = kobo(group.dues.reduce((sum, d) => sum + (d.stats?.outstanding ?? 0), 0));

  return (
    <>
      <Card style={styles.card}>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('groups.balance')}
        </TasaText>
        <TasaText variant="display" color={colors.heading}>
          {formatNaira(kobo(group.balance ?? 0))}
        </TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('groups.paysOutTo', { account: `${group.payout!.accountName}, ${group.payout!.bankName} · ${group.payout!.accountNumber}` })}
        </TasaText>
        <Button
          disabled={!group.balance || !!group.payoutChange || !!group.suspended}
          label={t('groups.withdraw')}
          variant="secondary"
          style={styles.gap}
          onPress={() => setWithdrawing(true)}
        />
        {!!group.payoutChange && (
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('groups.withdrawalsWait')}
          </TasaText>
        )}
      </Card>
      <WithdrawSheet group={group} visible={withdrawing} onClose={() => setWithdrawing(false)} />

      <View style={styles.stats}>
        <Stat label={t('groups.tab.members')} value={String(group.members.active)} onPress={() => onTab('members')} />
        <Stat
          label={t('groups.outstanding')}
          value={formatNaira(outstanding)}
          tone={outstanding > 0 ? colors.accentHot : undefined}
          onPress={() => onTab('dues')}
        />
      </View>
      {group.members.pending > 0 && (
        <Pressable accessibilityRole="button" onPress={() => onTab('members')}>
          <Card style={styles.notice}>
            <Icon ios="person.badge.clock" android="pending_actions" color={colors.accentHot} size={20} />
            <TasaText variant="bodyMedium" style={styles.flex}>
              {t('groups.waitingToJoin', { count: group.members.pending })}
            </TasaText>
            <Icon ios="chevron.right" android="chevron_right" color={colors.inkMuted} size={16} />
          </Card>
        </Pressable>
      )}

      {group.membership && <MyDues group={group} paying={paying} />}
      <Withdrawals groupId={group.id} />
    </>
  );
}

function Stat({ label, value, tone, onPress }: { label: string; value: string; tone?: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.flex}>
      <Card style={styles.stat}>
        <TasaText variant="caption" color={colors.inkMuted}>
          {label}
        </TasaText>
        <TasaText variant="subtitle" color={tone ?? colors.heading} numberOfLines={1}>
          {value}
        </TasaText>
      </Card>
    </Pressable>
  );
}

/** Every due the group collects and how it's going; tap one for who paid what. */
function DuesTab({ group }: { group: GroupDto }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const open = group.dues.filter((d) => !d.endedAt);
  const ended = group.dues.filter((d) => d.endedAt);
  return (
    <>
      <SectionHeader
        title={t('groups.collecting')}
        action={
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            disabled={!!group.suspended}
            onPress={() => router.push({ pathname: '/groups/new-due', params: { group: group.id } })}
            style={styles.row}>
            <Icon ios="plus" android="add" color={colors.brand} size={16} />
            <TasaText variant="caption" color={colors.brand}>
              {t('groups.addDue')}
            </TasaText>
          </Pressable>
        }
      />
      {open.map((due) => (
        <DueCard key={due.id} group={group} due={due} />
      ))}
      {ended.length > 0 && (
        <>
          <SectionHeader title={t('groups.endedDues')} />
          {ended.map((due) => (
            <DueCard key={due.id} group={group} due={due} />
          ))}
        </>
      )}
    </>
  );
}

const MONTH_YEAR = new Intl.DateTimeFormat('en-NG', { month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });

function DueCard({ group, due }: { group: GroupDto; due: GroupDueDto }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const price = usePriceLine();
  const stats = due.stats!;
  const share = stats.current.members ? stats.current.paid / stats.current.members : 0;
  const when =
    due.kind === 'one_off'
      ? t('groups.paidSoFar')
      : due.period === 'monthly'
        ? MONTH_YEAR.format(new Date(stats.current.start))
        : t(`groups.thisPeriod.${due.period!}`);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/groups/due', params: { group: group.id, due: due.id } })}
      style={due.endedAt ? styles.faded : undefined}>
      <Card style={styles.dueCard}>
        <View style={styles.row}>
          <View style={styles.flex}>
            <TasaText variant="bodyMedium" numberOfLines={1}>
              {due.name}
            </TasaText>
            <TasaText variant="caption" color={colors.inkMuted}>
              {price(due)} · {t(due.compulsory ? 'groups.compulsory' : 'groups.optionalTag')}
            </TasaText>
          </View>
          <Icon ios="chevron.right" android="chevron_right" color={colors.inkMuted} size={16} />
        </View>
        <View style={styles.progressRow}>
          <TasaText variant="caption" color={colors.inkMuted} style={styles.flex}>
            {when}
          </TasaText>
          <TasaText variant="caption" color={colors.heading}>
            {t('groups.paidOf', { paid: stats.current.paid, count: stats.current.members })}
          </TasaText>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
        </View>
        <View style={styles.progressRow}>
          <TasaText variant="caption" color={colors.inkMuted} style={styles.flex}>
            {t('groups.collectedAmount', { amount: formatNaira(stats.collected) })}
          </TasaText>
          {stats.outstanding > 0 && (
            <TasaText variant="caption" color={colors.accentHot}>
              {t('groups.outstandingAmount', { amount: formatNaira(stats.outstanding) })}
            </TasaText>
          )}
        </View>
      </Card>
    </Pressable>
  );
}

/** The invite, who runs it, where the money goes and the terms members accepted. */
function Settings({ group }: { group: GroupDto }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const rotate = useRotateInviteCode(group.id);
  const add = useAddExecutive(group.id);
  const remove = useRemoveExecutive(group.id);
  const [username, setUsername] = useState('');
  const copy = useCopyToClipboard();
  const link = groupInviteLink(group.inviteCode ?? '');

  return (
    <>
      <GroupDetails group={group} />
      <SectionHeader title={t('groups.invite')} />
      <Card style={styles.row}>
        <View style={styles.flex}>
          <TasaText variant="title" color={colors.heading} style={styles.code}>
            {group.inviteCode}
          </TasaText>
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('groups.inviteHint')}
          </TasaText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('groups.copyCode')}
          hitSlop={8}
          onPress={() => copy(group.inviteCode ?? '', t('groups.codeCopied'))}>
          <Icon ios="doc.on.doc" android="content_copy" color={colors.brand} size={20} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('groups.share')}
          hitSlop={8}
          onPress={() => Share.share({ message: t('groups.shareMessage', { name: group.name, code: group.inviteCode ?? '', link }) })}>
          <Icon ios="square.and.arrow.up" android="share" color={colors.brand} size={20} />
        </Pressable>
      </Card>
      <Pressable
        accessibilityRole="button"
        hitSlop={8}
        onPress={() =>
          rotate.mutate(undefined, { onSuccess: () => show(t('groups.newCode')), onError: (error) => show(errorMessage(error), { tone: 'error' }) })
        }
        style={styles.link}>
        <TasaText variant="caption" color={colors.brand}>
          {t('groups.resetCode')}
        </TasaText>
      </Pressable>

      <SectionHeader title={t('groups.executives')} />
      <Card>
        {group.executives.map((e, index) => (
          <View key={e.id} style={[styles.person, index > 0 && styles.divider]}>
            <TasaText variant="bodyMedium" style={styles.flex} numberOfLines={1}>
              {e.name ?? (e.username ? `@${e.username}` : '—')}
            </TasaText>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t(e.role === 'owner' ? 'groups.owner' : 'groups.executive')}
            </TasaText>
            {group.role === 'owner' && e.role === 'executive' && (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => remove.mutate(e.id, { onError: (error) => show(errorMessage(error), { tone: 'error' }) })}>
                <TasaText variant="caption" color={colors.danger}>
                  {t('groups.remove')}
                </TasaText>
              </Pressable>
            )}
          </View>
        ))}
      </Card>
      {group.role === 'owner' && (
        <>
          <Input
            label={t('groups.addExecutive')}
            hint={t('groups.addExecutiveHint')}
            autoCapitalize="none"
            autoCorrect={false}
            last
            value={username}
            onChangeText={setUsername}
          />
          <Button
            disabled={username.trim().length < 3}
            label={t('groups.add')}
            variant="secondary"
            loading={add.isPending}
            onPress={() =>
              add.mutate(username.trim(), {
                onSuccess: () => setUsername(''),
                onError: (error) => show(errorMessage(error), { tone: 'error' }),
              })
            }
          />
        </>
      )}

      <SectionHeader title={t('groups.payoutAccount')} />
      <GroupTerms terms={group.terms} />
      {group.role === 'owner' && !group.payoutChange && (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.push({ pathname: '/groups/payout/[id]', params: { id: group.id } })}
          style={styles.link}>
          <TasaText variant="caption" color={colors.brand}>
            {t('groups.changePayout')}
          </TasaText>
        </Pressable>
      )}
    </>
  );
}

/** What members see first: the group's picture, name and description. Executives change them here. */
function GroupDetails({ group }: { group: GroupDto }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const logo = useGroupLogo(group.id);
  const update = useUpdateGroup(group.id);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [about, setAbout] = useState(group.about ?? '');
  const fail = (error: unknown) => show(errorMessage(error), { tone: 'error' });
  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync(LOGO_OPTIONS);
    if (result.canceled || !result.assets[0]) return;
    logo.mutate(result.assets[0].uri, { onSuccess: () => show(t('groups.pictureSaved')), onError: fail });
  };
  const changed = name.trim() !== group.name || about.trim() !== (group.about ?? '');

  return (
    <>
      <SectionHeader
        title={t('groups.details')}
        action={
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              setName(group.name);
              setAbout(group.about ?? '');
              setEditing(true);
            }}>
            <TasaText variant="caption" color={colors.brand}>
              {t('groups.edit')}
            </TasaText>
          </Pressable>
        }
      />
      <Card style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('groups.changePicture')} disabled={logo.isPending} onPress={pick}>
          <OrganisationLogo uri={group.logoUrl} size={56} />
        </Pressable>
        <View style={styles.flex}>
          <TasaText variant="bodyMedium" numberOfLines={1}>
            {group.name}
          </TasaText>
          <Pressable accessibilityRole="button" hitSlop={8} disabled={logo.isPending} onPress={pick}>
            <TasaText variant="caption" color={colors.brand}>
              {logo.isPending ? t('groups.uploading') : t(group.logoUrl ? 'groups.changePicture' : 'groups.addPicture')}
            </TasaText>
          </Pressable>
        </View>
      </Card>
      <BottomSheet visible={editing} title={t('groups.editDetails')} onClose={() => setEditing(false)}>
        <Input label={t('groups.name')} maxLength={80} value={name} onChangeText={setName} />
        <Input label={t('groups.about')} multiline maxLength={600} value={about} onChangeText={setAbout} />
        <Button
          label={t('common.save')}
          disabled={!changed || name.trim().length < 3}
          loading={update.isPending}
          onPress={() =>
            update.mutate(
              { name: name.trim(), about: about.trim() },
              {
                onSuccess: () => {
                  setEditing(false);
                  show(t('groups.detailsSaved'));
                },
                onError: fail,
              },
            )
          }
        />
      </BottomSheet>
    </>
  );
}

/** The group changed where its money goes: they read it and accept before paying again. */
function AcceptTerms({ group }: { group: GroupDto }) {
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const accept = useAcceptGroupTerms(group.id);
  return (
    <Card style={styles.card}>
      <TasaText variant="bodyMedium">{t('groups.newTerms')}</TasaText>
      <GroupTerms terms={group.terms} />
      <Button
        label={t('groups.acceptNewTerms')}
        loading={accept.isPending}
        onPress={() => accept.mutate(group.terms.version, { onError: (error) => show(errorMessage(error), { tone: 'error' }) })}
      />
    </Card>
  );
}

/** A new payout account on its way: executives approve or object; members are told when it's coming. */
function PayoutChange({ group }: { group: GroupDto }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const change = group.payoutChange!;
  const approve = useApprovePayoutChange(group.id);
  const object = useObjectToPayoutChange(group.id);
  const [pinOpen, setPinOpen] = useState(false);
  const [objecting, setObjecting] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <Card style={styles.warning}>
      <TasaText variant="bodyMedium" color={colors.heading}>
        {change.status === 'cooling_off'
          ? t('groups.changeComing', { date: formatDateTime(change.effectiveAt!) })
          : t('groups.changeProposed', { name: change.proposedBy })}
      </TasaText>
      <TasaText variant="caption">
        {t('groups.changeFromTo', {
          from: `${change.from.accountName} •••• ${change.from.last4}`,
          to: `${change.to.accountName}, ${change.to.bankName} •••• ${change.to.last4}`,
        })}
      </TasaText>
      {!!group.role &&
        change.cosigners.map((c) => (
          <TasaText key={c.id} variant="caption" color={c.approvedAt ? colors.success : colors.inkMuted}>
            {c.approvedAt ? '✓ ' : '○ '}
            {c.name}
          </TasaText>
        ))}
      {!!group.role && (
        <View style={styles.actions}>
          {change.awaitingYou && <Button label={t('groups.approve')} style={styles.flex} onPress={() => setPinOpen(true)} />}
          <Button label={t('groups.object')} variant="secondary" style={styles.flex} onPress={() => setObjecting(true)} />
        </View>
      )}
      <PinSheet
        visible={pinOpen}
        title={t('groups.approveChange')}
        processingTitle={t('groups.approving')}
        detail={`${change.to.accountName} •••• ${change.to.last4}`}
        onClose={() => setPinOpen(false)}
        onSubmit={async (pin) => {
          await approve.mutateAsync(pin);
          setPinOpen(false);
          show(t('groups.approved'));
        }}
      />
      <BottomSheet visible={objecting} title={t('groups.objectTitle')} onClose={() => setObjecting(false)}>
        <Input label={t('groups.objectReason')} multiline maxLength={300} value={reason} onChangeText={setReason} />
        <Button
          disabled={reason.trim().length < 5}
          label={t('groups.stopChange')}
          variant="danger"
          loading={object.isPending}
          onPress={() =>
            object.mutate(reason.trim(), {
              onSuccess: () => {
                setObjecting(false);
                show(t('groups.changeStopped'));
              },
              onError: (error) => show(errorMessage(error), { tone: 'error' }),
            })
          }
        />
      </BottomSheet>
    </Card>
  );
}

/** Out of the group's balance, only to its payout account. Priced first, then the PIN. */
function WithdrawSheet({ group, visible, onClose }: { group: GroupDto; visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const [amount, setAmount] = useState(kobo(0));
  const [error, setError] = useState<string | null>(null);
  const confirm = useCallback(
    async (quoteId: string, pin: string) => {
      const result = await groupsService.withdraw(group.id, quoteId, pin);
      await queryClient.invalidateQueries({ queryKey: ['groups', group.id] });
      show(t('groups.withdrawalSent', { amount: formatNaira(result.amount) }));
      setAmount(kobo(0));
      onClose();
      return result;
    },
    [group.id, show, t, onClose],
  );
  const checkout = useCheckout(confirm);
  const tooMuch = amount > (group.balance ?? 0);

  const { result, failure, reset } = checkout;
  useEffect(() => {
    if (failure) show(failure.status === 'failed' ? failure.reason : t('groups.withdrawalUnknown'), { tone: 'error' });
    if (result || failure) reset();
  }, [result, failure, reset, show, t]);

  return (
    <BottomSheet visible={visible} title={t('groups.withdrawTitle')} onClose={onClose}>
      <TasaText variant="caption" color={colors.inkMuted} style={styles.hint}>
        {t('groups.paysOutTo', { account: `${group.payout!.accountName}, ${group.payout!.bankName} · ${group.payout!.accountNumber}` })}
      </TasaText>
      <AmountInput
        label={t('groups.amount')}
        error={tooMuch ? t('groups.moreThanBalance', { amount: formatNaira(kobo(group.balance ?? 0)) }) : error}
        value={amount}
        onChangeValue={(next) => {
          setAmount(next);
          setError(null);
        }}
      />
      <Button
        disabled={amount <= 0 || tooMuch}
        label={t('common.continue')}
        loading={checkout.quoting}
        onPress={() => checkout.start({ kind: 'group_payout', groupId: group.id, amount }).catch((e) => setError(errorMessage(e)))}
      />
      <PinSheet
        {...checkout.pinSheet}
        title={t('checkout.pinTitle')}
        processingTitle={t('groups.withdrawing')}
        detail={
          checkout.quote
            ? t('groups.withdrawDetail', { amount: formatNaira(checkout.quote.amount), fee: formatNaira(checkout.quote.fee) })
            : undefined
        }
      />
    </BottomSheet>
  );
}

/** Where the money went, for everyone in the group to see. */
function Withdrawals({ groupId }: { groupId: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { data = [] } = useGroupWithdrawals(groupId);
  if (data.length === 0) return null;
  return (
    <>
      <SectionHeader title={t('groups.withdrawals')} />
      <Card>
        {data.slice(0, 10).map((w, index) => (
          <View key={w.id} style={[styles.withdrawal, index > 0 && styles.divider]}>
            <View style={styles.flex}>
              <TasaText variant="bodyMedium">{formatNaira(w.amount)}</TasaText>
              <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
                {w.to ? `${w.to.accountName} •••• ${w.to.last4}` : ''} · {formatDateTime(w.at)}
                {w.by ? ` · ${w.by}` : ''}
              </TasaText>
            </View>
            <TasaText variant="caption" color={w.status === 'success' ? colors.success : w.status === 'failed' ? colors.danger : colors.inkMuted}>
              {t(`groups.withdrawalStatus.${w.status}`)}
            </TasaText>
          </View>
        ))}
      </Card>
    </>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    card: {
      gap: 4,
      marginTop: theme.spacing.md,
    },
    danger: {
      gap: 4,
      marginTop: theme.spacing.md,
      borderColor: `${colors.danger}55`,
    },
    warning: {
      gap: 6,
      marginTop: theme.spacing.md,
      borderColor: `${colors.accentHot}55`,
      backgroundColor: `${colors.accentHot}0D`,
    },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: theme.spacing.sm,
      borderColor: `${colors.accentHot}55`,
    },
    stats: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    stat: {
      gap: 2,
    },
    dueCard: {
      gap: 4,
      marginBottom: theme.spacing.sm,
    },
    faded: {
      opacity: 0.6,
    },
    progressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginTop: 6,
    },
    track: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.track,
      overflow: 'hidden',
      marginTop: 4,
    },
    fill: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.success,
    },
    legend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.sm,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    legendDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    actions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    code: {
      letterSpacing: 2,
    },
    person: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: theme.spacing.sm,
    },
    link: {
      alignSelf: 'flex-start',
      paddingVertical: theme.spacing.sm,
    },
    withdrawal: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: theme.spacing.sm,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    gap: {
      marginTop: theme.spacing.sm,
    },
    hint: {
      marginBottom: theme.spacing.sm,
    },
    flex: {
      flex: 1,
    },
  }),
);
