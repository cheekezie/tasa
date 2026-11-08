import { Image } from 'expo-image';
import type * as ImagePicker from 'expo-image-picker';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { theme } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

/** Logos are shown square everywhere, so they're cropped square when picked. */
export const LOGO_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.8,
};

/** Their logo, or a placeholder that says "add one". */
export function OrganisationLogo({ uri, size }: { uri: string | null; size: number }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return uri ? (
    <Image source={uri} contentFit="cover" style={[styles.logo, { width: size, height: size }]} />
  ) : (
    <View style={[styles.logo, styles.empty, { width: size, height: size }]}>
      <Icon color={colors.accentHot} ios="photo" android="add_photo_alternate" size={size / 3} />
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    logo: {
      borderRadius: theme.radius.lg,
      backgroundColor: colors.track,
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
