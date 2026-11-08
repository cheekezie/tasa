import { ReactNode, useMemo, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';

import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useSheetDrag } from '@/hooks/useSheetDrag';

// Long lists (data bundles run to dozens) get a search box.
const SEARCH_FROM = 10;

export type SelectOption = {
  value: string;
  label: string;
  /** Right-aligned extra, e.g. a price. */
  detail?: string;
  /** Drawn before the label, e.g. a logo. */
  leading?: ReactNode;
  /** Stays whatever they search for, e.g. a closing "Not listed" row. */
  pinned?: boolean;
};

type SelectFieldProps = {
  options: SelectOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** Heads the sheet and names the field for screen readers. */
  title: string;
  placeholder: string;
  /** Offers a first row that clears the choice, for optional fields. */
  clearLabel?: string;
  disabled?: boolean;
  /** Searches elsewhere (the API) instead of filtering `options`: the search box always shows. */
  onSearch?: (query: string) => void;
  /** Shown when nothing matches. */
  emptyLabel?: string;
};

/** A field that opens a bottom sheet of choices: the app's dropdown. */
export function SelectField({ options, value, onChange, title, placeholder, clearLabel, disabled = false, onSearch, emptyLabel }: SelectFieldProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const keyboard = useKeyboardHeight();
  // Never taller than the space between the status bar and the keyboard.
  const room = height - keyboard - insets.top - theme.spacing.md;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((option) => option.value === value) ?? null;
  const searchable = !!onSearch || options.length >= SEARCH_FROM;

  const visible = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return wanted && !onSearch ? options.filter((option) => option.pinned || option.label.toLowerCase().includes(wanted)) : options;
  }, [options, query, onSearch]);

  const search = (next: string) => {
    setQuery(next);
    onSearch?.(next);
  };
  const close = () => {
    setOpen(false);
    search('');
  };
  const drag = useSheetDrag(open, close);
  const choose = (next: string | null) => {
    onChange(next);
    close();
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selected ? `${title}: ${selected.label}` : title}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.field, pressed && styles.pressed, disabled && styles.disabled]}>
        {selected?.leading}
        <TasaText variant={selected ? 'bodyMedium' : 'body'} color={selected ? colors.ink : colors.inkSubtle} numberOfLines={1} style={styles.grow}>
          {selected?.label ?? (value === null && clearLabel ? clearLabel : placeholder)}
        </TasaText>
        {selected?.detail && (
          <TasaText variant="bodyMedium" color={colors.inkMuted}>
            {selected.detail}
          </TasaText>
        )}
        <Icon ios="chevron.down" android="expand_more" color={colors.inkMuted} size={18} />
      </Pressable>

      <Modal transparent visible={open} animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
        <View style={[styles.host, { paddingBottom: keyboard }]}>
          <Pressable accessibilityLabel={t('common.close')} style={styles.backdrop} onPress={close} />
          <Animated.View
            style={[
              styles.sheet,
              // A searchable sheet keeps its height so the box doesn't jump as results shrink.
              searchable ? { height: Math.min(height * 0.75, room) } : { maxHeight: Math.min(height * 0.75, room) },
              { paddingBottom: (keyboard ? 0 : insets.bottom) + theme.spacing.md },
              drag.style,
            ]}>
            {/* Drag the handle or title down to close; the list below scrolls. */}
            <View {...drag.handlers}>
              <View style={styles.handle} />
              <TasaText variant="subtitle" style={styles.title}>
                {title}
              </TasaText>
            </View>
            {searchable && (
              <View style={styles.search}>
                <Icon ios="magnifyingglass" android="search" color={colors.inkSubtle} size={18} />
                <TextInput
                  value={query}
                  onChangeText={search}
                  placeholder={t('common.search')}
                  placeholderTextColor={colors.inkSubtle}
                  autoCorrect={false}
                  returnKeyType="search"
                  style={styles.searchInput}
                />
              </View>
            )}
            <ScrollView keyboardShouldPersistTaps="handled">
              {clearLabel && !query && <Option label={clearLabel} active={value === null} onPress={() => choose(null)} />}
              {visible.map((option, index) => (
                <Option
                  // Option values come from providers, so they can't be trusted to be unique.
                  key={`${option.value}-${index}`}
                  {...option}
                  active={option.value === value}
                  onPress={() => choose(option.value)}
                />
              ))}
              {visible.length === 0 && (
                <TasaText variant="body" color={colors.inkMuted} style={styles.empty}>
                  {emptyLabel ?? t('common.noResults')}
                </TasaText>
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

function Option({ label, detail, leading, active, onPress }: Omit<SelectOption, 'value' | 'pinned'> & { active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
      {leading}
      <TasaText variant="bodyMedium" numberOfLines={2} style={styles.grow}>
        {label}
      </TasaText>
      {detail && (
        <TasaText variant="bodyMedium" color={colors.inkMuted}>
          {detail}
        </TasaText>
      )}
      {active && <Icon ios="checkmark.circle.fill" android="check_circle" color={colors.brand} size={20} />}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 52,
      marginBottom: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    disabled: {
      opacity: 0.5,
    },
    grow: {
      flex: 1,
    },
    host: {
      flex: 1,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
    },
    sheet: {
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.sm,
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      backgroundColor: colors.surfaceElevated,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      marginBottom: theme.spacing.sm,
      backgroundColor: colors.border,
    },
    title: {
      paddingHorizontal: theme.spacing.sm,
      paddingBottom: theme.spacing.sm,
    },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: 44,
      marginBottom: theme.spacing.sm,
      paddingHorizontal: 12,
      borderRadius: theme.radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchInput: {
      flex: 1,
      fontFamily: theme.fonts.bodyMedium,
      fontSize: 16,
      color: colors.ink,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 56,
      paddingHorizontal: theme.spacing.sm,
      borderRadius: theme.radius.md,
    },
    pressed: {
      backgroundColor: colors.overlay,
    },
    empty: {
      paddingVertical: theme.spacing.lg,
      textAlign: 'center',
    },
  }),
);
