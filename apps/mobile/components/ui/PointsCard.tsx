import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { PointsSummary } from '@/lib/api/mappers';
import { formatNaira } from '@/lib/format';
import { timesKobo } from '@/lib/money';

// Gold, from the logo's yellow: points read as a reward, not as more wallet money.
const GOLD = ['#5C3A00', '#9A6400', '#D39A06'] as const;
const INK = '#FFFFFF';
const INK_SOFT = 'rgba(255,255,255,0.78)';

type PointsCardProps = {
  points: PointsSummary;
  style?: ViewStyle;
};

/** The points balance as a card beside the wallet, with how close it is to cashing out. */
export function PointsCard({ points, style }: PointsCardProps) {
  const t = useT();
  const remaining = Math.max(0, points.minRedeemPoints - points.balance);
  const progress = points.minRedeemPoints > 0 ? Math.min(1, points.balance / points.minRedeemPoints) : 1;

  return (
    <LinearGradient
      colors={GOLD}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, style]}>
      {/* A faint oversized star as texture, kept clear of the numbers on the left. */}
      <Icon
        ios="star.fill"
        android="star"
        color="rgba(255,255,255,0.10)"
        size={150}
        style={styles.watermark}
      />

      <View style={styles.topRow}>
        <TasaText variant="label" color={INK_SOFT}>
          {t('pointsCard.title')}
        </TasaText>
        <View style={styles.badge}>
          <TasaText variant="caption" color={INK}>
            {t('pointsCard.rate', { amount: formatNaira(timesKobo(points.pointValue, 100)) })}
          </TasaText>
        </View>
      </View>

      <View style={styles.balanceRow}>
        <TasaText variant="display" color={INK}>
          {points.balance.toLocaleString('en-NG')}
        </TasaText>
        <TasaText variant="bodyMedium" color={INK_SOFT}>
          {t('pointsCard.unit')}
        </TasaText>
      </View>
      <TasaText variant="caption" color={INK_SOFT}>
        {t('pointsCard.worth', { amount: formatNaira(points.value) })}
      </TasaText>

      <View style={styles.spacer} />
      {remaining > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityHint={t('pointsCard.openHint')}
          onPress={() => router.push('/points')}
          style={({ pressed }) => [styles.progressBlock, pressed && styles.pressed]}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${progress * 100}%` }]} />
          </View>
          <TasaText variant="caption" color={INK_SOFT}>
            {t('pointsCard.toGo', { points: remaining.toLocaleString('en-NG') })}
          </TasaText>
        </Pressable>
      )}
      <View style={styles.actions}>
        {/* Always there so the card reads the same; inactive until they reach the minimum. */}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: remaining > 0 }}
          disabled={remaining > 0}
          onPress={() => router.push('/points')}
          style={({ pressed }) => [
            styles.action,
            remaining > 0 && styles.actionDisabled,
            pressed && styles.pressed,
          ]}>
          <TasaText variant="bodyMedium" color={GOLD[0]}>
            {t('points.convert')}
          </TasaText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/points/history')}
          style={({ pressed }) => [styles.action, styles.actionGhost, pressed && styles.pressed]}>
          <TasaText variant="bodyMedium" color={INK}>
            {t('pointsCard.history')}
          </TasaText>
        </Pressable>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.radius.xl,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    overflow: 'hidden',
  },
  watermark: {
    position: 'absolute',
    right: -28,
    bottom: -30,
    transform: [{ rotate: '-14deg' }],
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: theme.spacing.sm,
    marginBottom: 2,
  },
  spacer: {
    flexGrow: 1,
    minHeight: theme.spacing.sm,
  },
  progressBlock: {
    gap: 8,
  },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  action: {
    flex: 1,
    minHeight: 40,
    borderRadius: theme.radius.md,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionGhost: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  pressed: {
    opacity: 0.85,
  },
});
