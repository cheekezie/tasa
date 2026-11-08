import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ActionSheet } from '@/components/ui/ActionSheet';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Icon, IconName } from '@/components/ui/Icon';
import { Screen, ScreenHeader, SectionHeader, TasaText } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useSettings } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useAccount, useUpdateProfile } from '@/hooks/useAccount';
import { errorMessage } from '@/lib/api/errors';
import { formatNaira } from '@/lib/format';
import { KeysOf } from '@/lib/i18n';

type MenuItem = {
  title: KeysOf<'profile'>;
  route: Parameters<typeof router.push>[0];
  icon: IconName;
};

const manageItems: MenuItem[] = [
  { title: 'profile.manageProfile', route: '/account', icon: { ios: 'person.crop.circle', android: 'account_circle' } },
  { title: 'profile.beneficiaries', route: '/beneficiaries', icon: { ios: 'person.2', android: 'group' } },
  { title: 'profile.recurring', route: '/recurring', icon: { ios: 'arrow.triangle.2.circlepath', android: 'autorenew' } },
  { title: 'profile.points', route: '/points', icon: { ios: 'star', android: 'stars' } },
  { title: 'profile.events', route: '/events', icon: { ios: 'qrcode', android: 'qr_code_2' } },
  { title: 'profile.spending', route: '/insights', icon: { ios: 'chart.bar', android: 'bar_chart' } },
  { title: 'profile.fund', route: '/wallet/fund', icon: { ios: 'creditcard', android: 'credit_card' } },
  { title: 'profile.transfer', route: '/wallet/transfer', icon: { ios: 'arrow.left.arrow.right', android: 'swap_horiz' } },
  { title: 'profile.gift', route: '/gift/create', icon: { ios: 'gift', android: 'redeem' } },
  { title: 'profile.coupon', route: '/coupons/create', icon: { ios: 'ticket', android: 'confirmation_number' } },
];

const preferenceItems: MenuItem[] = [
  { title: 'profile.inbox', route: '/inbox', icon: { ios: 'tray', android: 'inbox' } },
  { title: 'profile.notifications', route: '/notifications', icon: { ios: 'bell', android: 'notifications' } },
  { title: 'profile.settings', route: '/settings', icon: { ios: 'gearshape', android: 'settings' } },
];

export default function ProfileScreen() {
  const { colors } = useTheme();
  const { t } = useSettings();
  const styles = useStyles();
  const { forgetAccount } = useApp();
  const { walletBalance, payday, profile } = useAccount();
  const updateProfile = useUpdateProfile();
  const [paydayInput, setPaydayInput] = useState(payday ? String(payday) : '');

  // The saved day arrives after first render, once `GET /me` answers.
  useEffect(() => {
    setPaydayInput(payday ? String(payday) : '');
  }, [payday]);

  const paydayValue = Number(paydayInput);
  const paydayInvalid = paydayInput !== '' && (paydayValue < 1 || paydayValue > 31);
  // Only offer Save when there's a valid change; clearing the field turns reminders off.
  const paydayChanged = (paydayInput === '' ? null : paydayValue) !== payday;
  const { show } = useSnackbar();

  const savePayday = () => {
    if (paydayInvalid || !paydayChanged) return;
    const day = paydayInput === '' ? null : paydayValue;
    Keyboard.dismiss();
    updateProfile.mutate(
      { payday: day },
      {
        onSuccess: () => show(day ? t('profile.paydaySaved', { day }) : t('profile.paydayCleared')),
        onError: (error) => show(errorMessage(error), { tone: 'error' }),
      },
    );
  };
  const [confirmLogout, setConfirmLogout] = useState(false);

  return (
    <Screen refreshable header={<ScreenHeader title={t('profile.title')} />}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.manageProfile')}
        onPress={() => router.push('/account')}
        style={({ pressed }) => [styles.profileCard, pressed && styles.pressed]}>
        <Avatar uri={profile.avatarUri} name={profile.fullName} size={56} />
        <View style={styles.profileCopy}>
          <TasaText variant="title" numberOfLines={1}>
            {profile.fullName}
          </TasaText>
          <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
            @{profile.username} · {t('profile.wallet', { amount: formatNaira(walletBalance, true) })}
          </TasaText>
        </View>
        <Icon color={colors.inkSubtle} ios="chevron.right" android="chevron_right" size={18} />
      </Pressable>

      <SectionHeader title={t('profile.payday')} />
      <View style={styles.paydayCard}>
        <TasaText variant="body" color={colors.inkMuted}>
          {t('profile.paydayBody')}
        </TasaText>
        <View style={styles.paydayRow}>
          <TextInput
            keyboardType="number-pad"
            maxLength={2}
            placeholder="28"
            returnKeyType="done"
            placeholderTextColor={colors.inkSubtle}
            accessibilityLabel={t('profile.paydayDay')}
            style={[styles.paydayInput, paydayInvalid && styles.paydayInputError]}
            value={paydayInput}
            onChangeText={(text) => setPaydayInput(text.replace(/\D/g, ''))}
            onSubmitEditing={savePayday}
          />
          <TasaText variant="caption" color={colors.inkMuted} style={styles.paydayStatus}>
            {t('profile.paydayDay')}
            {payday ? ` · ${t('profile.remindersOn')}` : ''}
          </TasaText>
          {paydayChanged && (
            <Button
              label={t('profile.paydaySave')}
              disabled={paydayInvalid}
              loading={updateProfile.isPending}
              onPress={savePayday}
              style={styles.paydaySave}
            />
          )}
        </View>
        {paydayInvalid && (
          <TasaText variant="caption" color={colors.danger}>
            {t('profile.paydayInvalid')}
          </TasaText>
        )}
      </View>

      <SectionHeader title={t('profile.manage')} />
      <MenuList items={manageItems} />

      <SectionHeader title={t('profile.preferences')} />
      <MenuList items={preferenceItems} />

      <Pressable
        accessibilityRole="button"
        onPress={() => setConfirmLogout(true)}
        style={({ pressed }) => [styles.logout, pressed && styles.pressed]}>
        <Icon color={colors.danger} ios="rectangle.portrait.and.arrow.right" android="logout" size={20} />
        <TasaText variant="bodyMedium" color={colors.danger}>
          {t('profile.logout')}
        </TasaText>
      </Pressable>

      <ActionSheet
        visible={confirmLogout}
        title={t('profile.logoutTitle')}
        message={t('profile.logoutBody')}
        options={[
          {
            label: t('profile.logout'),
            icon: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout' },
            destructive: true,
            // The tabs redirect to sign-in once the session is gone.
            onPress: forgetAccount,
          },
        ]}
        cancelLabel={t('manageProfile.cancel')}
        onClose={() => setConfirmLogout(false)}
      />
    </Screen>
  );
}

function MenuList({ items }: { items: MenuItem[] }) {
  const { colors } = useTheme();
  const { t } = useSettings();
  const styles = useStyles();
  return items.map((item) => (
    <Pressable
      key={item.title}
      accessibilityRole="button"
      accessibilityLabel={t(item.title)}
      onPress={() => router.push(item.route)}
      style={styles.menuRow}>
      <Icon {...item.icon} color={colors.brand} size={22} />
      <TasaText variant="bodyMedium" style={styles.menuLabel}>
        {t(item.title)}
      </TasaText>
      <Icon color={colors.inkSubtle} ios="chevron.right" android="chevron_right" size={18} />
    </Pressable>
  ));
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    profileCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: theme.spacing.lg,
      borderRadius: theme.radius.xl,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: theme.spacing.md,
    },
    profileCopy: {
      flex: 1,
    },
    pressed: {
      opacity: 0.85,
    },
    logout: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: theme.spacing.xl,
      minHeight: 52,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.dangerSoftBorder,
      backgroundColor: colors.dangerSoft,
    },
    paydayCard: {
      gap: 12,
      padding: theme.spacing.lg,
      borderRadius: theme.radius.xl,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: theme.spacing.md,
    },
    paydayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    paydayInput: {
      width: 72,
      minHeight: 48,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: theme.spacing.md,
      fontFamily: theme.fonts.bodyMedium,
      fontSize: 16,
      backgroundColor: colors.surface,
      color: colors.ink,
      textAlign: 'center',
    },
    paydayInputError: {
      borderColor: colors.danger,
    },
    paydayStatus: {
      flex: 1,
    },
    paydaySave: {
      minHeight: 44,
      paddingHorizontal: theme.spacing.md,
    },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    menuLabel: {
      flex: 1,
    },
  }),
);
