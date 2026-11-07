import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, ServiceIcon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { SpendingPoint, getServiceColor } from '@/constants/data';
import { ServiceId } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { formatNaira } from '@/lib/format';
import { Kobo } from '@/lib/money';

type QuickActionProps = {
  icon: Pick<ComponentProps<typeof Icon>, 'ios' | 'android'>;
  label: string;
  color?: string;
  onPress?: () => void;
  lines?: number;
};

export function QuickAction({ icon, label, color = '#FFFFFF', lines = 1, onPress }: QuickActionProps) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      <View style={[styles.iconWrap, { backgroundColor: color }]}>
        <Icon {...icon} color='#FFFFFF' size={24} />
      </View>
      <TasaText variant='caption' color={color} numberOfLines={lines} style={styles.label}>
        {label}
      </TasaText>
    </Pressable>
  );
}

export function ServiceTile({
  name,
  subtitle,
  serviceId,
  onPress,
}: {
  name: string;
  subtitle: string;
  serviceId: ServiceId;
  onPress?: () => void;
}) {
  const styles = useStyles();
  const color = getServiceColor(serviceId);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={name}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View style={[styles.tileIcon, { backgroundColor: `${color}22` }]}>
        <ServiceIcon serviceId={serviceId} size={24} />
      </View>
      <View style={styles.tileCopy}>
        <TasaText variant='bodyMedium'>{name}</TasaText>
        <TasaText variant='caption' color={color}>
          {subtitle}
        </TasaText>
      </View>
    </Pressable>
  );
}

const MINI_HEIGHT = 44;
const MINI_FLOOR = 6;

/**
 * Six months in a thumbnail, the latest in `color` and the rest in a lighter shade. Heights are
 * in points and colours are solid, so it reads the same on a white card as on a dark one.
 */
export function MiniBars({ data, color }: { data: { amount: Kobo }[]; color: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const max = Math.max(...data.map((point) => point.amount), 1);
  return (
    <View style={styles.miniBars}>
      {data.map((point, index) => (
        <View key={index} style={styles.miniTrack}>
          <View
            style={[
              styles.miniBar,
              {
                height: Math.max(Math.round((point.amount / max) * MINI_HEIGHT), MINI_FLOOR),
                backgroundColor: index === data.length - 1 ? color : colors.brandLight,
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

export function SpendingChart({ data, color }: { data: SpendingPoint[]; color: string }) {
  const styles = useStyles();
  const max = Math.max(...data.map((point) => point.amount), 1);

  return (
    <View style={styles.chart}>
      {data.map((point) => (
        <View key={point.month} style={styles.barWrap}>
          <TasaText variant='caption' numberOfLines={1}>
            {formatNaira(point.amount, true)}
          </TasaText>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.bar,
                {
                  height: `${Math.max((point.amount / max) * 100, 8)}%`,
                  backgroundColor: color,
                },
              ]}
            />
          </View>
          <TasaText variant='caption' color={color}>
            {point.month}
          </TasaText>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    miniBars: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 4,
      height: MINI_HEIGHT,
    },
    miniTrack: {
      width: 8,
      height: MINI_HEIGHT,
      justifyContent: 'flex-end',
    },
    miniBar: {
      width: 8,
      borderRadius: 3,
    },
    // Shares the row, so all the actions fit whatever the screen width.
    item: {
      flex: 1,
      alignItems: 'center',
      gap: 8,
    },
    iconWrap: {
      width: 56,
      height: 56,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      textAlign: 'center',
    },
    pressed: {
      opacity: 0.85,
    },
    tile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 14,
      borderRadius: 16,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 10,
    },
    tileIcon: {
      width: 48,
      height: 48,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tileCopy: {
      flex: 1,
      gap: 2,
    },
    chart: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      height: 164,
      paddingTop: 8,
    },
    barWrap: {
      alignItems: 'center',
      flex: 1,
      gap: 8,
    },
    barTrack: {
      width: 18,
      height: 100,
      borderRadius: 999,
      backgroundColor: colors.track,
      justifyContent: 'flex-end',
      overflow: 'hidden',
    },
    bar: {
      width: '100%',
      borderRadius: 999,
    },
  }),
);
