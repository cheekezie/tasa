import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, IconName } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { SelectField } from '@/components/ui/SelectField';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { SellerIdType } from '@/lib/api/types';

export const ID_TYPES: SellerIdType[] = ['nin_slip', 'drivers_licence', 'passport', 'voters_card'];

export type VerificationDraft = { idType: SellerIdType | null; photo: string | null; id: string | null };

export const emptyDraft: VerificationDraft = { idType: null, photo: null, id: null };

export const draftReady = (d: VerificationDraft): d is { idType: SellerIdType; photo: string; id: string } => !!d.idType && !!d.photo && !!d.id;

/** The camera when there is one (a live photo is what compliance wants), the library otherwise. */
export async function capture(aspect: [number, number], front: boolean) {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect,
    quality: 0.7,
    cameraType: front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
  };
  const camera = await ImagePicker.requestCameraPermissionsAsync().catch(() => ({ granted: false }));
  const result = camera.granted ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
}

/**
 * A photo of them and of their ID, for Tasa's compliance team. Used when they opt in, and again
 * if a review sends them back. Nothing here is shown to buyers.
 */
export function VerificationForm({ draft, onChange }: { draft: VerificationDraft; onChange: (draft: VerificationDraft) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  return (
    <View style={styles.form}>
      <TasaText variant="caption" color={colors.inkMuted}>
        {t('tickets.verifyPrivacy')}
      </TasaText>
      <Shot
        icon={{ ios: 'person.crop.square', android: 'person' }}
        title={t('tickets.verifyPhoto')}
        hint={t('tickets.verifyPhotoHint')}
        uri={draft.photo}
        square
        onPick={async () => {
          const uri = await capture([1, 1], true);
          if (uri) onChange({ ...draft, photo: uri });
        }}
      />
      <SelectField
        title={t('tickets.verifyIdType')}
        placeholder={t('tickets.verifyIdTypePlaceholder')}
        value={draft.idType}
        onChange={(idType) => onChange({ ...draft, idType: idType as SellerIdType })}
        options={ID_TYPES.map((type) => ({ value: type, label: t(`tickets.idTypes.${type}`) }))}
      />
      <Shot
        icon={{ ios: 'creditcard', android: 'badge' }}
        title={t('tickets.verifyId')}
        hint={t('tickets.verifyIdHint')}
        uri={draft.id}
        onPick={async () => {
          const uri = await capture([16, 10], false);
          if (uri) onChange({ ...draft, id: uri });
        }}
      />
    </View>
  );
}

function Shot({
  icon,
  title,
  hint,
  uri,
  square,
  onPick,
}: {
  icon: IconName;
  title: string;
  hint: string;
  uri: string | null;
  square?: boolean;
  onPick: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPick} style={styles.shot}>
      {uri ? (
        <Image source={uri} contentFit="cover" style={[styles.preview, square ? styles.previewSquare : styles.previewWide]} />
      ) : (
        <View style={[styles.preview, styles.empty, square ? styles.previewSquare : styles.previewWide]}>
          <Icon {...icon} color={colors.accentHot} size={24} />
        </View>
      )}
      <View style={styles.shotCopy}>
        <TasaText variant="bodyMedium">{title}</TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {hint}
        </TasaText>
        <TasaText variant="caption" color={colors.brand}>
          {uri ? t('tickets.verifyRetake') : t('tickets.verifyTake')}
        </TasaText>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    form: {
      gap: theme.spacing.md,
    },
    shot: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    shotCopy: {
      flex: 1,
      gap: 2,
    },
    preview: {
      borderRadius: theme.radius.md,
      backgroundColor: colors.track,
    },
    previewSquare: {
      width: 72,
      height: 72,
    },
    previewWide: {
      width: 96,
      height: 60,
    },
    empty: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.warmSoftBorder,
      backgroundColor: colors.warmSoft,
    },
  }),
);
