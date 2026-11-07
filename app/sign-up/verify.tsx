import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Button } from '@/components/ui/Button';
import { OtpInput } from '@/components/ui/OtpInput';
import { Screen, TasaText } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { errorMessage } from '@/lib/api/errors';
import { Channel, authService } from '@/lib/api/services/auth';
import { maskEmail, maskPhone } from '@/lib/format';
import { takeLink } from '@/lib/pendingLink';

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;

/** Checks the code sent by SMS or email. Signs in, or creates the account on first use. */
export default function VerifyContactScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const { startSession } = useApp();
  const contact = useLocalSearchParams<{ channel: Channel; value: string; resendIn?: string }>();
  const destination = { type: contact.channel, value: contact.value };
  const byPhone = contact.channel === 'phone';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(Number(contact.resendIn) || RESEND_SECONDS);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timeout = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timeout);
  }, [resendIn]);

  const verify = async (value = code) => {
    if (value.length < CODE_LENGTH) return;
    setVerifying(true);
    setError(null);
    try {
      const { account } = await authService.verifyOtp(destination, value);
      // Whichever steps this account hasn't done yet. Returning users go straight in.
      if (!account.profile.fullName) router.replace('/sign-up/details');
      else if (!account.profile.hasPin) router.replace('/sign-up/pin');
      else {
        await startSession(account.profile);
        // Only this screen moves on after signing in: the sign-in screen beneath it doesn't, so
        // the two never race over the stack.
        if (router.canDismiss()) router.dismissAll();
        router.replace('/(tabs)');
        // An invite opened before signing in picks up where it left off.
        const next = takeLink();
        if (next) router.push(next);
      }
    } catch (verifyError) {
      setError(errorMessage(verifyError));
      setCode('');
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    try {
      const { resendInSeconds } = await authService.requestOtp(destination);
      setResendIn(resendInSeconds);
      show(t('signUp.resent'));
    } catch (resendError) {
      show(errorMessage(resendError), { tone: 'error' });
    }
  };

  return (
    <Screen>
      <TasaText variant="display" color={colors.heading}>
        {t('signUp.otpTitle')}
      </TasaText>
      <TasaText color={colors.inkMuted} style={styles.subtitle}>
        {t('signUp.otpSubtitle', {
          destination: byPhone ? maskPhone(contact.value) : maskEmail(contact.value),
        })}
      </TasaText>

      <OtpInput
        label={t('signUp.otpLabel')}
        value={code}
        length={CODE_LENGTH}
        autoFocus
        error={error}
        hint={byPhone ? undefined : t('signUp.otpEmailHint')}
        onChange={(digits) => {
          setCode(digits);
          setError(null);
          if (digits.length === CODE_LENGTH) verify(digits);
        }}
      />
      <Button label={t('signUp.verify')} disabled={code.length < CODE_LENGTH} loading={verifying} onPress={() => verify()} />

      <Pressable accessibilityRole="button" disabled={resendIn > 0} hitSlop={8} onPress={resend} style={styles.resend}>
        <TasaText variant="bodyMedium" color={resendIn > 0 ? colors.inkSubtle : colors.brand}>
          {resendIn > 0 ? t('signUp.resendIn', { seconds: resendIn }) : t('signUp.resend')}
        </TasaText>
      </Pressable>
      {byPhone && (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.dismissTo({ pathname: '/sign-up', params: { channel: 'email' } })}
          style={styles.resend}>
          <TasaText variant="bodyMedium" color={colors.brand}>
            {t('signUp.smsTrouble')}
          </TasaText>
        </Pressable>
      )}
    </Screen>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    subtitle: {
      marginTop: theme.spacing.xs,
      marginBottom: theme.spacing.lg,
    },
    resend: {
      alignSelf: 'center',
      marginTop: theme.spacing.lg,
      paddingVertical: theme.spacing.sm,
    },
  }),
);
