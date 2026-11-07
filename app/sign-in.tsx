import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { ContactField } from '@/components/ui/ContactField';
import { Logo } from '@/components/ui/Logo';
import { Screen, ScreenHeader, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { errorMessage } from '@/lib/api/errors';
import { Channel, authService } from '@/lib/api/services/auth';
import { checkContact } from '@/lib/validation';

/** Phone or email, for an account that isn't on this device yet. The API sends a code either way. */
export default function SignInScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const [channel, setChannel] = useState<Channel>('phone');
  const [contactText, setContactText] = useState('');
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const contact = checkContact(channel, contactText);

  const sendCode = async () => {
    setTouched(true);
    if (contact.error) return;
    setSending(true);
    setFailure(null);
    try {
      const { resendInSeconds } = await authService.requestOtp({ type: channel, value: contact.value });
      router.push({
        pathname: '/sign-up/verify',
        params: { channel, value: contact.value, resendIn: String(resendInSeconds) },
      });
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const createAccount = () =>
    router.push({
      pathname: '/sign-up',
      params: contact.error ? { channel } : { channel, value: contact.value },
    });

  return (
    <Screen
      header={
        <View style={styles.brandHeader}>
          <View style={styles.logo}>
            <Logo />
          </View>
          <ScreenHeader title={t('signIn.title')} subtitle={t('signIn.subtitle')} />
        </View>
      }>
      <ContactField
        channel={channel}
        onChannelChange={(next) => {
          setChannel(next);
          setContactText('');
          setTouched(false);
          setFailure(null);
        }}
        value={contactText}
        error={touched ? (contact.error ?? failure) : null}
        onBlur={() => setTouched(true)}
        onChangeText={(text) => {
          setContactText(text);
          setFailure(null);
        }}
        onSubmitEditing={sendCode}
      />
      <Button label={t('signIn.continue')} loading={sending} onPress={sendCode} />

      <View style={styles.footer}>
        <TasaText color={colors.inkMuted}>{t('signIn.newHere')}</TasaText>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={createAccount}>
          <TasaText variant="bodyMedium" color={colors.brand}>
            {t('signIn.createAccount')}
          </TasaText>
        </Pressable>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    brandHeader: {
      gap: theme.spacing.xxl,
      paddingTop: theme.spacing.md,
    },
    logo: {
      alignSelf: 'center',
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      marginTop: theme.spacing.lg,
    },
  }),
);
