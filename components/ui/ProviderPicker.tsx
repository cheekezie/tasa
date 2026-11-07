import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TasaText } from '@/components/ui/Screen';
import { SelectField } from '@/components/ui/SelectField';
import { useT } from '@/context/SettingsContext';
import { useTheme } from '@/context/ThemeContext';
import { BillProvider } from '@/lib/api/mappers';

/** The provider's logo, or its initials when there's no logo or it fails to load. */
export function ProviderLogo({ provider, size = 24 }: { provider: BillProvider; size?: number }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const frame = { width: size, height: size, borderRadius: size / 4 };

  if (!provider.logo || failed) {
    const initials = provider.name
      .split(/\s+/)
      .map((word) => word[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    return (
      <View style={[frame, styles.initials, { backgroundColor: colors.overlay }]}>
        <TasaText variant="caption" color={colors.brand} style={{ fontSize: size * 0.4 }}>
          {initials}
        </TasaText>
      </View>
    );
  }
  return (
    <Image
      accessibilityIgnoresInvertColors
      source={{ uri: provider.logo }}
      style={[frame, styles.logo]}
      contentFit="cover"
      transition={150}
      cachePolicy="memory-disk"
      onError={() => setFailed(true)}
    />
  );
}

type ProviderPickerProps = {
  providers: BillProvider[];
  value: string | null;
  onChange: (code: string) => void;
  /** Heads the sheet and names the field for screen readers. */
  label: string;
};

/** Dropdown of providers, each with its logo. */
export function ProviderPicker({ providers, value, onChange, label }: ProviderPickerProps) {
  const t = useT();
  return (
    <SelectField
      title={label}
      placeholder={t('bill.chooseProvider')}
      value={value}
      onChange={(code) => code && onChange(code)}
      options={[...providers]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((provider) => ({
          value: provider.code,
          label: provider.name,
          leading: <ProviderLogo provider={provider} size={32} />,
        }))}
    />
  );
}

const styles = StyleSheet.create({
  initials: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    // Some logos are white-on-transparent; give them something to sit on in dark mode.
    backgroundColor: '#FFFFFF',
  },
});
