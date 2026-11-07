import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ApprovalStatus } from '@/components/ui/EventCard';
import { LOGO_OPTIONS, OrganisationLogo } from '@/components/ui/OrganisationLogo';
import { QueryState } from '@/components/ui/QueryState';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useSeller, useUpdateSeller } from '@/hooks/useTickets';
import { errorMessage } from '@/lib/api/errors';
import { Seller } from '@/lib/api/mappers';
import { validateEmail } from '@/lib/validation';

/** The organiser's page as they'd like buyers to see it: name, logo, story and contacts. */
export default function OrganiserProfileScreen() {
  const seller = useSeller();
  return (
    <Screen>
      <QueryState query={seller} hasData={!!seller.data} skeleton="detail" />
      {seller.data && <ProfileForm seller={seller.data} />}
    </Screen>
  );
}

function ProfileForm({ seller }: { seller: Seller }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const update = useUpdateSeller();
  const logo = useUpdateSeller();
  const [name, setName] = useState(seller.organisation ?? '');
  const [about, setAbout] = useState(seller.about ?? '');
  const [phone, setPhone] = useState(seller.contact.phone ?? '');
  const [email, setEmail] = useState(seller.contact.email ?? '');
  const [website, setWebsite] = useState(seller.contact.website ?? '');
  const [instagram, setInstagram] = useState(seller.contact.instagram ?? '');
  const emailError = validateEmail(email.trim());

  const changeLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync(LOGO_OPTIONS);
    if (result.canceled || !result.assets[0]) return;
    logo.mutate(
      { logo: result.assets[0].uri },
      {
        onSuccess: () => show(t('tickets.logoSaved')),
        onError: (error) => show(errorMessage(error), { tone: 'error' }),
      },
    );
  };

  const save = () =>
    update.mutate(
      {
        organisation: name.trim(),
        about: about.trim(),
        phone: phone.trim(),
        email: email.trim(),
        website: website.trim(),
        instagram: instagram.trim(),
      },
      {
        onSuccess: () => {
          show(t('tickets.profileSaved'));
          router.back();
        },
        onError: (error) => show(errorMessage(error), { tone: 'error' }),
      },
    );

  return (
    <>
      <View style={styles.status}>
        <ApprovalStatus status={seller.verification.status} suspended={seller.suspension.active} />
        <TasaText variant="caption" color={colors.inkMuted}>
          {seller.suspension.active
            ? t('tickets.suspendedTitle')
            : t(
                seller.verification.status === 'approved'
                  ? 'tickets.statusApprovedHint'
                  : seller.verification.status === 'pending'
                    ? 'tickets.reviewPendingBody'
                    : seller.verification.status === 'rejected'
                      ? 'tickets.statusRejectedHint'
                      : 'tickets.verifyNeededTitle',
              )}
        </TasaText>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(seller.logoUrl ? 'tickets.changeLogo' : 'tickets.addLogo')}
        disabled={logo.isPending}
        onPress={changeLogo}
        style={styles.logoRow}>
        <OrganisationLogo uri={seller.logoUrl} size={72} />
        <View style={styles.logoCopy}>
          <TasaText variant="bodyMedium">{t(seller.logoUrl ? 'tickets.changeLogo' : 'tickets.addLogo')}</TasaText>
          <TasaText variant="caption" color={colors.inkMuted}>
            {logo.isPending ? t('processing.saving') : t('tickets.logoHint')}
          </TasaText>
        </View>
      </Pressable>

      <Input
        label={t('tickets.organisation')}
        hint={t('tickets.organisationHint')}
        autoCapitalize="words"
        maxLength={60}
        value={name}
        onChangeText={setName}
      />
      <Input
        label={t('tickets.about')}
        hint={t('tickets.aboutHint')}
        multiline
        maxLength={600}
        last
        value={about}
        onChangeText={setAbout}
      />

      <SectionHeader title={t('tickets.contactOrganiser')} />
      <TasaText variant="caption" color={colors.inkMuted} style={styles.hint}>
        {t('tickets.contactsHint')}
      </TasaText>
      <Input label={t('tickets.contactPhone')} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      <Input
        label={t('tickets.contactEmailShort')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        error={emailError}
        value={email}
        onChangeText={setEmail}
      />
      <Input
        label={t('tickets.website')}
        placeholder="https://"
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        value={website}
        onChangeText={setWebsite}
      />
      <Input
        label={t('tickets.instagram')}
        placeholder="@"
        autoCapitalize="none"
        autoCorrect={false}
        last
        value={instagram}
        onChangeText={setInstagram}
      />

      <Button
        disabled={name.trim().length < 2 || !!emailError}
        label={t('tickets.profileSave')}
        loading={update.isPending}
        style={styles.save}
        onPress={save}
      />
    </>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    status: {
      gap: 6,
      marginBottom: theme.spacing.lg,
    },
    logoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    logoCopy: {
      flex: 1,
      gap: 4,
    },
    hint: {
      marginBottom: theme.spacing.sm,
    },
    save: {
      marginTop: theme.spacing.md,
    },
  }),
);
