import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { errorMessage } from '@/lib/api/errors';
import { accountService } from '@/lib/api/services/account';

/** New accounts only. A second phone or email is added later from Manage profile, with its own code. */
export default function SignUpDetailsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const [fullName, setFullName] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const names = fullName.trim().split(/\s+/).filter((part) => part.length >= 2);
  const nameError = names.length >= 2 ? null : t('signUp.nameRequired');

  const next = async () => {
    setTouched(true);
    if (nameError) return;
    setSaving(true);
    setFailure(null);
    try {
      await accountService.updateMe({ fullName: fullName.trim().replace(/\s+/g, ' ') });
      router.replace('/sign-up/pin');
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <TasaText variant="display" color={colors.heading}>
        {t('signUp.detailsTitle')}
      </TasaText>
      <TasaText color={colors.inkMuted} style={styles.subtitle}>
        {t('signUp.detailsSubtitle')}
      </TasaText>

      <Input
        label={t('signUp.fullName')}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        placeholder={t('signUp.fullNamePlaceholder')}
        value={fullName}
        last
        error={touched ? nameError ?? failure : null}
        onBlur={() => setTouched(true)}
        onChangeText={setFullName}
        onSubmitEditing={next}
      />
      <Button label={t('signUp.continue')} loading={saving} onPress={next} style={styles.button} />
    </Screen>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    subtitle: {
      marginTop: theme.spacing.xs,
      marginBottom: theme.spacing.lg,
    },
    button: {
      marginTop: theme.spacing.sm,
    },
  }),
);
