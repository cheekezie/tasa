import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { ContactField } from '@/components/ui/ContactField';
import { Screen, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { errorMessage } from '@/lib/api/errors';
import { Channel, authService } from '@/lib/api/services/auth';
import { checkContact } from '@/lib/validation';

/** First sign-up step: phone (code by SMS) or email (code by email), for when SMS doesn't arrive. */
export default function SignUpContactScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const params = useLocalSearchParams<{ channel?: Channel; value?: string }>();
  const [channel, setChannel] = useState<Channel>(params.channel ?? 'phone');
  const [contactText, setContactText] = useState(params.value ?? '');
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const contact = checkContact(channel, contactText);

  const switchChannel = (next: Channel) => {
    setChannel(next);
    setContactText('');
    setTouched(false);
    setFailure(null);
  };

  // The code screen can send people back here to try email instead of SMS.
  useEffect(() => {
    if (params.channel && params.channel !== channel) switchChannel(params.channel);
    // Only react to the param changing, not to the user flipping the switch here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.channel]);

  const error = contact.error ?? failure;

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
    } catch (sendError) {
      setFailure(errorMessage(sendError));
    } finally {
      setSending(false);
    }
  };

  const logIn = () => (router.canGoBack() ? router.back() : router.replace('/sign-in'));

  return (
    <Screen>
      <TasaText variant="display" color={colors.heading}>
        {t('signUp.phoneTitle')}
      </TasaText>
      <TasaText color={colors.inkMuted} style={styles.subtitle}>
        {t('signUp.phoneSubtitle')}
      </TasaText>

      <ContactField
        channel={channel}
        onChannelChange={switchChannel}
        value={contactText}
        error={touched ? error : null}
        onBlur={() => setTouched(true)}
        onChangeText={(text) => {
          setContactText(text);
          setFailure(null);
        }}
        onSubmitEditing={sendCode}
      />
      {channel === 'phone' && (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => switchChannel('email')}
          style={styles.switchLink}>
          <TasaText variant="caption" color={colors.brand}>
            {t('signUp.smsTrouble')}
          </TasaText>
        </Pressable>
      )}
      <Button label={t('signUp.sendCode')} loading={sending} onPress={sendCode} />

      <View style={styles.footer}>
        <TasaText color={colors.inkMuted}>{t('signUp.haveAccount')}</TasaText>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={logIn}>
          <TasaText variant="bodyMedium" color={colors.brand}>
            {t('signUp.logIn')}
          </TasaText>
        </Pressable>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    subtitle: {
      marginTop: theme.spacing.xs,
      marginBottom: theme.spacing.lg,
    },
    switchLink: {
      alignSelf: 'flex-start',
      marginTop: -theme.spacing.sm,
      marginBottom: theme.spacing.lg,
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      marginTop: theme.spacing.lg,
    },
  }),
);
