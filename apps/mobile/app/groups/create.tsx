import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { DueFields, dueReady, emptyDue, toDueInput, type DueForm } from '@/components/ui/DueFields';
import { Input } from '@/components/ui/Input';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { SelectField } from '@/components/ui/SelectField';
import { useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useCreateGroup } from '@/hooks/useGroups';
import { useBanks, useVerifiedBankAccount } from '@/hooks/useTickets';
import { errorMessage } from '@/lib/api/errors';

type FieldForm = { key: number; label: string; required: boolean };
type DueDraft = DueForm & { key: number };

/**
 * Starting a group: what it's called, the dues it collects, what to ask members, and the
 * account dues are paid out to. That account is in the terms every member accepts, so changing it
 * later takes co-signing executives.
 */
export default function CreateGroupScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const create = useCreateGroup();
  const banks = useBanks();
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [dues, setDues] = useState<DueDraft[]>([{ key: 0, ...emptyDue(t('groups.defaultDue')) }]);
  const [fields, setFields] = useState<FieldForm[]>([]);
  const [requireApproval, setRequireApproval] = useState(true);
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const verified = useVerifiedBankAccount(bankCode, accountNumber);

  const editDue = (key: number, changes: Partial<DueForm>) => {
    setDues((current) => current.map((d) => (d.key === key ? { ...d, ...changes } : d)));
  };
  const editField = (key: number, changes: Partial<FieldForm>) => {
    setFields((current) => current.map((f) => (f.key === key ? { ...f, ...changes } : f)));
  };
  const ready =
    name.trim().length >= 3 &&
    dues.every(dueReady) &&
    fields.every((f) => f.label.trim().length >= 2) &&
    !!verified.data &&
    !verified.isFetching;

  const submit = () =>
    create.mutate(
      {
        name: name.trim(),
        ...(about.trim() && { about: about.trim() }),
        requireApproval,
        fields: fields.map((f) => ({ label: f.label.trim(), required: f.required })),
        dues: dues.map(toDueInput),
        bankCode: bankCode!,
        accountNumber,
      },
      {
        onSuccess: (group) => {
          show(t('groups.created'));
          router.replace({ pathname: '/groups/[id]', params: { id: group.id } });
        },
        onError: (error) => show(errorMessage(error), { tone: 'error' }),
      },
    );

  return (
    <Screen footer={<Button disabled={!ready} label={t('groups.createGroup')} loading={create.isPending} onPress={submit} />}>
      <Input
        label={t('groups.name')}
        placeholder={t('groups.namePlaceholder')}
        maxLength={80}
        value={name}
        onChangeText={setName}
      />
      <Input label={t('groups.about')} multiline maxLength={600} value={about} onChangeText={setAbout} />

      <SectionHeader title={t('groups.dues')} />
      <TasaText variant="caption" color={colors.inkMuted} style={styles.hint}>
        {t('groups.duesHint')}
      </TasaText>
      {dues.map((due) => (
        <Card key={due.key} style={styles.plan}>
          <DueFields value={due} onChange={(changes) => editDue(due.key, changes)} />
          {dues.length > 1 && (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setDues((current) => current.filter((d) => d.key !== due.key))}>
              <TasaText variant="caption" color={colors.danger}>
                {t('groups.removeDue')}
              </TasaText>
            </Pressable>
          )}
        </Card>
      ))}
      {dues.length < 5 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setDues((current) => [...current, { key: Date.now(), ...emptyDue() }])}
          style={styles.add}>
          <TasaText variant="caption" color={colors.brand}>
            {t('groups.addAnotherDue')}
          </TasaText>
        </Pressable>
      )}
      <TasaText variant="caption" color={colors.inkMuted}>
        {t('groups.ownerMember')}
      </TasaText>

      <SectionHeader title={t('groups.askMembers')} />
      {fields.map((field) => (
        <View key={field.key} style={styles.field}>
          <Input
            label={t('groups.question')}
            placeholder={t('groups.questionPlaceholder')}
            maxLength={40}
            value={field.label}
            onChangeText={(label) => editField(field.key, { label })}
          />
          <View style={styles.switchRow}>
            <Switch value={field.required} onValueChange={(required) => editField(field.key, { required })} />
            <TasaText variant="caption" style={styles.flex}>
              {t('groups.required')}
            </TasaText>
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setFields((current) => current.filter((f) => f.key !== field.key))}>
              <TasaText variant="caption" color={colors.danger}>
                {t('groups.remove')}
              </TasaText>
            </Pressable>
          </View>
        </View>
      ))}
      {fields.length < 5 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setFields((current) => [...current, { key: Date.now(), label: '', required: true }])}
          style={styles.add}>
          <TasaText variant="caption" color={colors.brand}>
            {t('groups.addQuestion')}
          </TasaText>
        </Pressable>
      )}
      <View style={styles.switchRow}>
        <Switch value={requireApproval} onValueChange={setRequireApproval} />
        <TasaText variant="caption" style={styles.flex}>
          {t('groups.approveJoins')}
        </TasaText>
      </View>

      <SectionHeader title={t('groups.payoutAccount')} />
      <TasaText variant="caption" color={colors.inkMuted} style={styles.hint}>
        {t('groups.payoutHint')}
      </TasaText>
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
      {verified.isFetching && <ActivityIndicator color={colors.brand} />}
      {verified.data && !verified.isFetching && (
        <TasaText variant="bodyMedium" color={colors.success}>
          {verified.data.accountName}
        </TasaText>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    plan: {
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
    },
    field: {
      marginBottom: theme.spacing.sm,
      paddingBottom: theme.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginVertical: theme.spacing.sm,
    },
    add: {
      alignSelf: 'flex-start',
      paddingVertical: theme.spacing.sm,
    },
    hint: {
      marginBottom: theme.spacing.sm,
    },
    flex: {
      flex: 1,
    },
  }),
);
