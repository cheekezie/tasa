import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { errorMessage } from '@/lib/api/errors';
import { accountService } from '@/lib/api/services/account';
import { RecipientInput } from '@/lib/api/types';
import { checkAccountNumber, looksLikePhone, normalizeUsername, validateEmail } from '@/lib/validation';

export type RecipientMatch = { recipient: RecipientInput; name: string; username: string | null };

export type RecipientLookup =
  | { status: 'idle' | 'checking' | 'notFound' | 'self' }
  /** The lookup itself failed; `message` says why, so the send button can't sit there dead. */
  | { status: 'failed'; message: string }
  /** Not on Tasa yet: a gift can still go as an invite, a transfer can't. */
  | { status: 'invite'; recipient: RecipientInput }
  | { status: 'found'; match: RecipientMatch };

const toRecipient = (text: string): RecipientInput => {
  if (looksLikePhone(text)) return { type: 'phone', value: checkAccountNumber('airtime', text).value };
  if (text.includes('@') && !text.startsWith('@')) return { type: 'email', value: text.toLowerCase() };
  return { type: 'username', value: normalizeUsername(text) };
};

/** Looks up a Tasa user by phone, email or @username once typing pauses. */
export function useRecipientLookup(query: string): RecipientLookup {
  const [lookup, setLookup] = useState<RecipientLookup>({ status: 'idle' });

  useEffect(() => {
    const text = query.trim();
    const recipient = toRecipient(text);
    const complete =
      recipient.type === 'phone'
        ? !checkAccountNumber('airtime', text).error
        : recipient.type === 'email'
          ? !validateEmail(text)
          : recipient.value.length >= 3;
    if (!complete) {
      setLookup({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setLookup({ status: 'checking' });
    const timeout = setTimeout(async () => {
      try {
        const result = await accountService.lookupUser(recipient);
        if (cancelled) return;
        if (!result.found) {
          setLookup(result.canInvite ? { status: 'invite', recipient } : { status: 'notFound' });
        } else if (result.isSelf) {
          setLookup({ status: 'self' });
        } else {
          setLookup({
            status: 'found',
            match: { recipient, name: result.user.name, username: result.user.username },
          });
        }
      } catch (error) {
        if (!cancelled) setLookup({ status: 'failed', message: errorMessage(error) });
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  return lookup;
}

type RecipientFieldProps = {
  /** Gifts can reach people who aren't on Tasa yet; transfers can't. */
  allowInvite?: boolean;
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  lookup: RecipientLookup;
};

/** Phone-or-username field that shows who the money is going to before it's sent. */
export function RecipientField({ allowInvite, label, value, onChangeText, lookup }: RecipientFieldProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const error =
    lookup.status === 'notFound' || (lookup.status === 'invite' && !allowInvite)
      ? t('recipient.notFound')
      : lookup.status === 'self'
        ? t('recipient.self')
        : lookup.status === 'failed'
          ? lookup.message
          : null;

  return (
    <View style={styles.root}>
      <Input
        label={label}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t('recipient.placeholder')}
        value={value}
        error={error}
        onChangeText={onChangeText}
        style={styles.input}
      />
      {lookup.status === 'checking' && (
        <View style={styles.checking}>
          <ActivityIndicator size="small" color={colors.inkSubtle} />
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('recipient.checking')}
          </TasaText>
        </View>
      )}
      {lookup.status === 'invite' && allowInvite && (
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('recipient.invite')}
        </TasaText>
      )}
      {lookup.status === 'found' && (
        <View
          accessible
          accessibilityLabel={`${t('recipient.sendingTo')} ${lookup.match.name}`}
          style={styles.match}>
          <Avatar uri={null} name={lookup.match.name} size={40} />
          <View style={styles.matchCopy}>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t('recipient.sendingTo')}
            </TasaText>
            <TasaText variant="bodyMedium" numberOfLines={1}>
              {lookup.match.name}
            </TasaText>
            <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
              {lookup.match.username ? `@${lookup.match.username}` : ''}
            </TasaText>
          </View>
          <Icon color={colors.success} ios="checkmark.seal.fill" android="verified" size={22} />
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    root: {
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.lg,
    },
    input: {
      marginBottom: 0,
    },
    checking: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    match: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    matchCopy: {
      flex: 1,
    },
  }),
);
