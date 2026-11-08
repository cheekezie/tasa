import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { OtpInput } from '@/components/ui/OtpInput';
import { PinPad } from '@/components/ui/PinPad';
import { Screen, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { errorMessage } from '@/lib/api/errors';
import { accountService } from '@/lib/api/services/account';
import { maskContact } from '@/lib/format';
import { PIN_LENGTH, isWeakPin } from '@/lib/pin';

const CODE_LENGTH = 6;

// Short pause so the last dot visibly fills before the screen moves on.
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

/** Forgot PIN: a code to the contact on the account, a new PIN, then straight into the app. */
export default function PinResetScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { rememberedAccount, startSession } = useApp();
  const [step, setStep] = useState<'code' | 'create' | 'confirm'>('code');
  const [code, setCode] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const sendCode = useCallback(async () => {
    setError(null);
    try {
      const { resendInSeconds } = await accountService.requestPinReset();
      setResendIn(resendInSeconds);
    } catch (sendError) {
      setError(errorMessage(sendError));
    }
  }, []);

  useEffect(() => {
    sendCode();
  }, [sendCode]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timeout = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timeout);
  }, [resendIn]);

  const backToCode = (message: string) => {
    setPin('');
    setFirstPin('');
    setCode('');
    setStep('code');
    setError(message);
  };

  const finish = async (chosen: string) => {
    setBusy(true);
    try {
      // The API only checks the code here, so a wrong one comes back from this call.
      await accountService.resetPin(code, chosen);
      const { profile } = await accountService.getMe();
      await startSession(profile);
      if (router.canDismiss()) router.dismissAll();
      router.replace('/(tabs)');
    } catch (resetError) {
      setBusy(false);
      backToCode(errorMessage(resetError));
    }
  };

  const onPinChange = async (next: string) => {
    setPin(next);
    setError(null);
    if (next.length < PIN_LENGTH) return;
    await settle();

    if (step === 'create') {
      setPin('');
      if (isWeakPin(next)) {
        setError(t('auth.weak'));
        return;
      }
      setFirstPin(next);
      setStep('confirm');
      return;
    }

    if (next !== firstPin) {
      setPin('');
      setFirstPin('');
      setStep('create');
      setError(t('auth.mismatch'));
      return;
    }
    await finish(next);
  };

  if (step === 'code') {
    return (
      <Screen>
        <TasaText variant="display" color={colors.heading}>
          {t('pinReset.codeTitle')}
        </TasaText>
        <TasaText color={colors.inkMuted} style={styles.subtitle}>
          {rememberedAccount
            ? t('signUp.otpSubtitle', { destination: maskContact(rememberedAccount) })
            : t('pinReset.codeBody')}
        </TasaText>
        <OtpInput
          label={t('signUp.otpLabel')}
          value={code}
          length={CODE_LENGTH}
          autoFocus
          error={error}
          onChange={(digits) => {
            setCode(digits);
            setError(null);
            if (digits.length === CODE_LENGTH) setStep('create');
          }}
        />
        <Button
          label={t('signUp.continue')}
          disabled={code.length < CODE_LENGTH}
          onPress={() => setStep('create')}
        />
        <Pressable
          accessibilityRole="button"
          disabled={resendIn > 0}
          hitSlop={8}
          onPress={sendCode}
          style={styles.resend}>
          <TasaText variant="bodyMedium" color={resendIn > 0 ? colors.inkSubtle : colors.brand}>
            {resendIn > 0 ? t('signUp.resendIn', { seconds: resendIn }) : t('signUp.resend')}
          </TasaText>
        </Pressable>
      </Screen>
    );
  }

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
      <View style={styles.header}>
        <TasaText variant="display" color={colors.heading} style={styles.centered}>
          {t(step === 'create' ? 'pinReset.createTitle' : 'auth.confirmTitle')}
        </TasaText>
        <TasaText color={colors.inkMuted} style={styles.centered}>
          {t(step === 'create' ? 'pinReset.createBody' : 'auth.confirmBody')}
        </TasaText>
      </View>
      <PinPad value={pin} onChange={onPinChange} error={error} busy={busy} />
    </View>
  );
}

const useStyles = makeStyles((colors) =>
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
    root: {
      flex: 1,
      justifyContent: 'space-between',
      paddingTop: theme.spacing.lg,
      paddingHorizontal: theme.spacing.screen,
      backgroundColor: colors.surface,
    },
    header: {
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    centered: {
      textAlign: 'center',
    },
  }),
);
