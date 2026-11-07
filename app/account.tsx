import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ActionSheet, ActionSheetOption } from '@/components/ui/ActionSheet';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ContactVerifySheet } from '@/components/ui/ContactVerifySheet';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Screen, TasaText } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useAccount, useRemoveAvatar, useUploadAvatar } from '@/hooks/useAccount';
import { errorMessage, hasCode } from '@/lib/api/errors';
import { accountService } from '@/lib/api/services/account';
import { ContactInput } from '@/lib/api/types';
import { queryClient, queryKeys } from '@/lib/queryClient';
import {
  accountRule,
  checkAccountNumber,
  normalizeUsername,
  validateBvn,
  validateEmail,
  validateUsername,
} from '@/lib/validation';

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'failed';

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.7,
};

export default function ManageProfileScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const { profile } = useAccount();
  const uploadAvatar = useUploadAvatar();
  const removePhoto = useRemoveAvatar();
  const [verifying, setVerifying] = useState<ContactInput[]>([]);

  const [username, setUsername] = useState(profile.username);
  const [phone, setPhone] = useState(profile.phone);
  const [email, setEmail] = useState(profile.email);
  const [bvn, setBvn] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [usernameCheckError, setUsernameCheckError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const handle = normalizeUsername(username);
  const phoneCheck = checkAccountNumber('airtime', phone);
  const bvnLocked = !!profile.bvnLast4;
  const bvnPending = profile.bvnStatus === 'pending';

  const usernameChanged = handle !== profile.username;
  const usernameError =
    validateUsername(handle) ??
    (usernameStatus === 'taken'
      ? t('manageProfile.taken', { username: handle })
      : usernameStatus === 'failed'
        ? usernameCheckError
        : null);
  // Email-only accounts may leave the phone empty; once a phone is saved it can't be cleared.
  const phoneError = phone.trim() || profile.phone ? phoneCheck.error : null;
  // Sign-in identities can be replaced but never removed, and one must always remain.
  const emailError =
    validateEmail(email.trim()) ?? (!email.trim() && (profile.email || !phone.trim()) ? t('errors.required') : null);
  const bvnError = bvnLocked ? null : validateBvn(bvn);

  const dirty =
    usernameChanged ||
    (phone.trim() ? phoneCheck.value : '') !== profile.phone ||
    email.trim() !== profile.email ||
    (!bvnLocked && bvn.length > 0);
  const canSave =
    dirty &&
    !usernameError &&
    !phoneError &&
    !emailError &&
    !bvnError &&
    (!usernameChanged || usernameStatus === 'available');

  // Live availability check, debounced so we don't hit the API on every keystroke.
  useEffect(() => {
    if (!usernameChanged || validateUsername(handle)) {
      setUsernameStatus('idle');
      return;
    }
    let cancelled = false;
    setUsernameStatus('checking');
    const timeout = setTimeout(async () => {
      try {
        const available = await accountService.isUsernameAvailable(handle);
        if (!cancelled) setUsernameStatus(available ? 'available' : 'taken');
      } catch (error) {
        if (cancelled) return;
        setUsernameCheckError(errorMessage(error));
        setUsernameStatus('failed');
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [handle, usernameChanged, profile.username]);

  const pickPhoto = async (source: 'camera' | 'library') => {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        show(t('manageProfile.cameraDenied'), { tone: 'error' });
        return;
      }
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
        : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
    if (result.canceled || !result.assets[0]) return;
    uploadAvatar.mutate(
      result.assets[0].uri,
      {
        onSuccess: () => show(t('manageProfile.photoUpdated')),
        onError: (error) => show(errorMessage(error), { tone: 'error' }),
      },
    );
  };

  const photoOptions: ActionSheetOption[] = [
    {
      label: t('manageProfile.takePhoto'),
      icon: { ios: 'camera.fill', android: 'photo_camera' },
      onPress: () => pickPhoto('camera'),
    },
    {
      label: t('manageProfile.choosePhoto'),
      icon: { ios: 'photo.on.rectangle', android: 'photo_library' },
      onPress: () => pickPhoto('library'),
    },
    ...(profile.avatarUri
      ? [
          {
            label: t('manageProfile.removePhoto'),
            icon: { ios: 'trash' as const, android: 'delete' as const },
            destructive: true,
            onPress: () =>
              removePhoto.mutate(undefined, {
                onSuccess: () => show(t('manageProfile.photoRemoved')),
                onError: (error) => show(errorMessage(error), { tone: 'error' }),
              }),
          },
        ]
      : []),
  ];

  const save = async () => {
    setTouched({ username: true, phone: true, email: true, bvn: true });
    if (!canSave) return;
    setSaving(true);
    try {
      if (usernameChanged) await accountService.updateMe({ username: handle });
      if (!bvnLocked && bvn) await accountService.setBvn(bvn);
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });

      // Phone and email sign people in, so they only change once a code proves them.
      const contacts: ContactInput[] = [];
      if (phone.trim() && phoneCheck.value !== profile.phone) {
        contacts.push({ type: 'phone', value: phoneCheck.value });
      }
      const nextEmail = email.trim().toLowerCase();
      if (nextEmail && nextEmail !== profile.email) contacts.push({ type: 'email', value: nextEmail });
      if (contacts.length > 0) {
        setVerifying(contacts);
        return;
      }
      show(t('manageProfile.saved'));
      router.back();
    } catch (error) {
      if (hasCode(error, 'USERNAME_TAKEN')) setUsernameStatus('taken');
      else show(errorMessage(error), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const touch = (field: string) => setTouched((current) => ({ ...current, [field]: true }));

  return (
    <Screen
      footer={
        <Button
          label={dirty ? t('manageProfile.save') : t('manageProfile.noChanges')}
          disabled={!canSave}
          loading={saving}
          onPress={save}
        />
      }>
      <View style={styles.photoBlock}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(profile.avatarUri ? 'manageProfile.changePhoto' : 'manageProfile.addPhoto')}
          disabled={uploadAvatar.isPending}
          onPress={() => setSheetOpen(true)}
          style={styles.photoButton}>
          <Avatar uri={profile.avatarUri} name={profile.fullName} size={96} />
          {uploadAvatar.isPending && (
            <View style={styles.uploading}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          )}
          <View style={styles.cameraBadge}>
            <Icon color="#FFFFFF" ios="camera.fill" android="photo_camera" size={16} />
          </View>
        </Pressable>
        <Pressable hitSlop={8} onPress={() => setSheetOpen(true)}>
          <TasaText variant="bodyMedium" color={colors.brand}>
            {t(profile.avatarUri ? 'manageProfile.changePhoto' : 'manageProfile.addPhoto')}
          </TasaText>
        </Pressable>
      </View>

      <Input
        label={t('manageProfile.fullName')}
        value={profile.fullName}
        editable={false}
        hint={t('manageProfile.fullNameHint')}
        style={styles.readOnly}
      />

      <Input
        label={t('manageProfile.username')}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        value={username}
        error={
          touched.username || usernameStatus === 'taken' || usernameStatus === 'failed'
            ? usernameError
            : null
        }
        onBlur={() => touch('username')}
        onChangeText={setUsername}
      />
      {usernameChanged && !validateUsername(handle) && usernameStatus !== 'taken' && usernameStatus !== 'failed' && (
        <View style={styles.status}>
          {usernameStatus === 'checking' ? (
            <>
              <ActivityIndicator size="small" color={colors.inkSubtle} />
              <TasaText variant="caption" color={colors.inkMuted}>
                {t('manageProfile.checking')}
              </TasaText>
            </>
          ) : usernameStatus === 'available' ? (
            <>
              <Icon color={colors.success} ios="checkmark.circle.fill" android="check_circle" size={16} />
              <TasaText variant="caption" color={colors.success}>
                {t('manageProfile.available', { username: handle })}
              </TasaText>
            </>
          ) : null}
        </View>
      )}

      <Input
        label={t('manageProfile.phone')}
        keyboardType={accountRule('airtime').keyboardType}
        autoComplete="tel"
        placeholder={accountRule('airtime').placeholder}
        value={phone}
        error={touched.phone ? phoneError : null}
        onBlur={() => touch('phone')}
        onChangeText={setPhone}
      />

      <Input
        label={t('manageProfile.email')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        placeholder={t('manageProfile.emailPlaceholder')}
        value={email}
        error={touched.email ? emailError : null}
        last={bvnLocked}
        onBlur={() => touch('email')}
        onChangeText={setEmail}
      />

      {bvnLocked ? (
        <View style={styles.bvnLocked}>
          {bvnPending ? (
            <Icon color={colors.inkMuted} ios="clock" android="schedule" size={20} />
          ) : (
            <Icon color={colors.success} ios="checkmark.seal.fill" android="verified" size={20} />
          )}
          <View style={styles.bvnCopy}>
            <TasaText variant="bodyMedium">
              {t(bvnPending ? 'manageProfile.bvnPending' : 'manageProfile.bvnLocked', {
                masked: `•••••••${profile.bvnLast4}`,
              })}
            </TasaText>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t(bvnPending ? 'manageProfile.bvnPendingHint' : 'manageProfile.bvnLockedHint')}
            </TasaText>
          </View>
        </View>
      ) : (
        <Input
          label={t('manageProfile.bvn')}
          last
          keyboardType="number-pad"
          maxLength={11}
          secureTextEntry
          placeholder="•••••••••••"
          value={bvn}
          hint={t('manageProfile.bvnHint')}
          error={
            (touched.bvn ? bvnError : null) ??
            (profile.bvnStatus === 'rejected' && !bvn
              ? t('manageProfile.bvnRejected', { reason: profile.bvnRejectionReason })
              : null)
          }
          onBlur={() => touch('bvn')}
          onChangeText={(text) => setBvn(text.replace(/\D/g, ''))}
        />
      )}

      <ActionSheet
        visible={sheetOpen}
        title={t(profile.avatarUri ? 'manageProfile.changePhoto' : 'manageProfile.addPhoto')}
        options={photoOptions}
        cancelLabel={t('manageProfile.cancel')}
        onClose={() => setSheetOpen(false)}
      />

      <Pressable
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => router.push('/delete-account')}
        style={styles.deleteLink}>
        <TasaText variant="bodyMedium" color={colors.danger}>
          {t('nav.deleteAccount')}
        </TasaText>
      </Pressable>

      <ContactVerifySheet
        contacts={verifying}
        onDone={() => {
          setVerifying([]);
          show(t('manageProfile.saved'));
          router.back();
        }}
        onClose={() => setVerifying([])}
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    photoBlock: {
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.lg,
    },
    photoButton: {
      position: 'relative',
    },
    uploading: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 48,
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    cameraBadge: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.brand,
      borderWidth: 3,
      borderColor: colors.surface,
    },
    deleteLink: {
      alignSelf: 'center',
      marginTop: theme.spacing.lg,
      paddingVertical: theme.spacing.sm,
    },
    readOnly: {
      opacity: 0.7,
    },
    status: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: -theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    bvnLocked: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    bvnCopy: {
      flex: 1,
      gap: 2,
    },
  }),
);
