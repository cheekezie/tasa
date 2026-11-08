import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { PinPad } from '@/components/ui/PinPad';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { errorMessage } from '@/lib/api/errors';
import { accountService } from '@/lib/api/services/account';
import { takeLink } from '@/lib/pendingLink';
import { PIN_LENGTH, isWeakPin } from '@/lib/pin';

// Short pause so the last dot visibly fills before the screen moves on.
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

/** Last sign-up step: choose the PIN that approves payments. */
export default function CreatePinScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { startSession, isSignedIn } = useApp();
  const [step, setStep] = useState<'create' | 'confirm'>('create');
  const [firstPin, setFirstPin] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Leave the whole sign-up stack behind once signed in, so Back can't return to it.
  useEffect(() => {
    if (!isSignedIn) return;
    if (router.canDismiss()) router.dismissAll();
    router.replace('/(tabs)');
    // An invite opened before signing up picks up where it left off.
    const next = takeLink();
    if (next) router.push(next);
  }, [isSignedIn]);

  const onChange = async (next: string) => {
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

    setBusy(true);
    try {
      await accountService.setPin(next);
      const { profile } = await accountService.getMe();
      await startSession(profile);
    } catch (pinError) {
      setPin('');
      setError(errorMessage(pinError));
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <Icon color={colors.brand} ios="lock.fill" android="lock" size={28} />
        </View>
        <TasaText variant="display" color={colors.heading} style={styles.centered}>
          {t(step === 'create' ? 'auth.createTitle' : 'auth.confirmTitle')}
        </TasaText>
        <TasaText color={colors.inkMuted} style={styles.centered}>
          {busy
            ? t('signUp.creating')
            : t(step === 'create' ? 'auth.createBody' : 'auth.confirmBody')}
        </TasaText>
      </View>
      <PinPad value={pin} onChange={onChange} error={error} busy={busy} />
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
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
    badge: {
      width: 64,
      height: 64,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing.sm,
      backgroundColor: colors.overlay,
    },
    centered: {
      textAlign: 'center',
    },
  }),
);
