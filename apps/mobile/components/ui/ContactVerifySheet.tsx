import { useEffect, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OtpInput } from '@/components/ui/OtpInput';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { errorMessage } from '@/lib/api/errors';
import { accountService } from '@/lib/api/services/account';
import { ContactInput } from '@/lib/api/types';
import { queryClient, queryKeys } from '@/lib/queryClient';
import { useSheetDrag } from '@/hooks/useSheetDrag';
import { SheetHandle } from '@/components/ui/SheetHandle';

const CODE_LENGTH = 6;

type ContactVerifySheetProps = {
  /** Sheet shows while this has entries, proving each in turn. */
  contacts: ContactInput[];
  onDone: () => void;
  onClose: () => void;
};

/** Proves a new phone or email with a code before the API will link it. */
export function ContactVerifySheet({ contacts, onDone, onClose }: ContactVerifySheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [index, setIndex] = useState(0);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const contact = contacts[index];

  useEffect(() => {
    if (contacts.length === 0) setIndex(0);
  }, [contacts.length]);

  useEffect(() => {
    if (!contact) return;
    setCode('');
    setError(null);
    accountService.requestContactCode(contact).catch((sendError) => setError(errorMessage(sendError)));
  }, [contact]);

  const verify = async (digits: string) => {
    try {
      await accountService.verifyContact(contact, digits);
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      if (index + 1 < contacts.length) setIndex(index + 1);
      else onDone();
    } catch (verifyError) {
      setCode('');
      setError(errorMessage(verifyError));
    }
  };

  const drag = useSheetDrag(!!contact, onClose);
  return (
    <Modal transparent animationType="slide" visible={!!contact} onRequestClose={onClose}>
      <Pressable accessibilityLabel={t('common.cancel')} style={styles.scrim} onPress={onClose} />
      <Animated.View {...drag.handlers} style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.lg }, drag.style]}>
        <SheetHandle />
        <TasaText variant="subtitle">{t('manageProfile.verifyTitle')}</TasaText>
        <TasaText variant="body" color={colors.inkMuted}>
          {t('signUp.otpSubtitle', { destination: contact?.value ?? '' })}
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
            if (digits.length === CODE_LENGTH) verify(digits);
          }}
        />
      </Animated.View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    sheet: {
      gap: theme.spacing.sm,
      padding: theme.spacing.screen,
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      backgroundColor: colors.surface,
    },
  }),
);
