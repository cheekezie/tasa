import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { usePriceLine } from '@/components/ui/DuesStatement';
import { GroupTerms } from '@/components/ui/GroupTerms';
import { Input } from '@/components/ui/Input';
import { OrganisationLogo } from '@/components/ui/OrganisationLogo';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { GroupPreviewDto } from '@/lib/api/types';
import { formatNaira } from '@/lib/format';

/** The group's logo and name. */
export function GroupNameRow({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.nameRow}>
      {!!logoUrl && <OrganisationLogo uri={logoUrl} size={44} />}
      <View style={[styles.nameRow, styles.flex]}>
        <TasaText variant="title" color={colors.heading} style={styles.shrink}>
          {name}
        </TasaText>
      </View>
    </View>
  );
}

/** What a joiner types and agrees to. */
export function useJoinForm(group: GroupPreviewDto | undefined) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState(false);
  const answer = (key: string) => fields[key] ?? '';
  const ready = !!group && accepted && group.fields.every((f) => !f.required || !!answer(f.key).trim());
  const answers = Object.fromEntries(
    (group?.fields ?? []).filter((f) => fields[f.key]?.trim()).map((f) => [f.key, fields[f.key]!.trim()]),
  );
  return {
    fields,
    setField: (key: string, value: string) => setFields((current) => ({ ...current, [key]: value })),
    accepted,
    setAccepted,
    answer,
    answers,
    ready,
  };
}
export type JoinForm = ReturnType<typeof useJoinForm>;

/**
 * A group before joining: who it is, its terms (above all where the money goes), the dues they'll
 * pay and whatever it asks.
 */
export function GroupJoinPreview({ group, form }: { group: GroupPreviewDto; form: JoinForm }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const price = usePriceLine();

  return (
    <>
      <View style={styles.name}>
        <GroupNameRow name={group.name} logoUrl={group.logoUrl} />
      </View>
      {!!group.about && (
        <TasaText variant="body" color={colors.inkMuted}>
          {group.about}
        </TasaText>
      )}

      <GroupTerms terms={group.terms} />

      <TasaText variant="bodyMedium" style={styles.section}>
        {t('groups.whatYouPay')}
      </TasaText>
      {group.terms.dues.map((due) => (
        <View key={due.id} style={styles.plan}>
          <View style={styles.flex}>
            <TasaText variant="bodyMedium">{due.name}</TasaText>
            <TasaText variant="caption" color={colors.inkMuted}>
              {price(due)}
              {due.charge ? ` · ${t('groups.plusCharge', { amount: formatNaira(due.charge) })}` : ''}
            </TasaText>
          </View>
          <TasaText variant="caption" color={due.compulsory ? colors.heading : colors.inkMuted}>
            {t(due.compulsory ? 'groups.compulsory' : 'groups.optionalTag')}
          </TasaText>
        </View>
      ))}

      {group.fields.map((field) => (
        <Input
          key={field.key}
          label={field.required ? field.label : t('groups.optional', { label: field.label })}
          value={form.answer(field.key)}
          onChangeText={(value) => form.setField(field.key, value)}
        />
      ))}

      <View style={styles.accept}>
        <Switch value={form.accepted} onValueChange={form.setAccepted} />
        <TasaText variant="caption" style={styles.flex}>
          {t('groups.acceptTerms', {
            account: `${group.terms.payout.accountName} (${group.terms.payout.bankName} •••• ${group.terms.payout.last4})`,
          })}
        </TasaText>
      </View>
      {group.requireApproval && (
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('groups.needsApproval')}
        </TasaText>
      )}
    </>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    name: {
      marginTop: theme.spacing.md,
    },
    section: {
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.xs,
    },
    plan: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.sm,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    accept: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginVertical: theme.spacing.md,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    shrink: {
      flexShrink: 1,
    },
    flex: {
      flex: 1,
    },
  }),
);
