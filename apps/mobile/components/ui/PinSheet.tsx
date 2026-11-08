import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PinPad } from '@/components/ui/PinPad';
import { ProcessingView } from '@/components/ui/ProcessingView';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { errorMessage, hasCode } from '@/lib/api/errors';
import { PIN_LENGTH } from '@/lib/pin';
import { useSheetDrag } from '@/hooks/useSheetDrag';
import { SheetHandle } from '@/components/ui/SheetHandle';

type PinSheetProps = {
  visible: boolean;
  title: string;
  /** What's being authorised, e.g. "₦5,100 to @ada". */
  detail?: string;
  /** Shown full screen while `onSubmit` runs. */
  processingTitle: string;
  /** Rejecting keeps the sheet open and shows the error. */
  onSubmit: (pin: string) => Promise<void>;
  onClose: () => void;
};

/** Takes the Tasa PIN to authorise a debit. Lockouts are the API's: it counts every attempt. */
export function PinSheet({ visible, title, detail, processingTitle, onSubmit, onClose }: PinSheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (visible) {
      setPin('');
      setError(null);
    }
  }, [visible]);

  const onChange = async (next: string) => {
    setPin(next);
    setError(null);
    if (next.length < PIN_LENGTH) return;
    setBusy(true);
    try {
      await onSubmit(next);
    } catch (submitError) {
      setPin('');
      setError(errorMessage(submitError));
      setLocked(hasCode(submitError, 'PIN_LOCKED'));
    } finally {
      setBusy(false);
    }
  };

  const drag = useSheetDrag(visible, () => onClose(), !busy);
  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      // Android's back button mustn't hide a payment that's running.
      onRequestClose={busy ? undefined : onClose}>
      <Pressable accessibilityLabel={t('common.cancel')} style={styles.scrim} onPress={onClose} />
      <Animated.View {...drag.handlers} style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.md }, drag.style]}>
        <SheetHandle />
        <TasaText variant="subtitle">{title}</TasaText>
        {!!detail && (
          <TasaText variant="body" color={colors.inkMuted}>
            {detail}
          </TasaText>
        )}
        <PinPad value={pin} onChange={onChange} error={error} disabled={locked} busy={busy} />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          hitSlop={8}
          onPress={() => {
            onClose();
            router.push('/pin-reset');
          }}
          style={styles.forgot}>
          <TasaText variant="bodyMedium" color={colors.brand}>
            {t('auth.forgotPin')}
          </TasaText>
        </Pressable>
      </Animated.View>
      {busy && <ProcessingView title={processingTitle} />}
    </Modal>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    forgot: {
      paddingVertical: theme.spacing.sm,
    },
    sheet: {
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.lg,
      paddingHorizontal: theme.spacing.screen,
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      backgroundColor: colors.surface,
    },
  }),
);
