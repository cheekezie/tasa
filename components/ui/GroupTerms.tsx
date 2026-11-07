import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/Button';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { GroupTermsDto } from '@/lib/api/types';

/** The group's terms, with the payout account on top: that's what a member is agreeing to. */
export function GroupTerms({ terms }: { terms: GroupTermsDto }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  return (
    <Card style={styles.terms}>
      <TasaText variant="caption" color={colors.inkMuted}>
        {t('groups.moneyGoesTo')}
      </TasaText>
      <TasaText variant="bodyMedium" color={colors.heading}>
        {terms.payout.accountName}
      </TasaText>
      <TasaText variant="caption" color={colors.inkMuted}>
        {terms.payout.bankName} •••• {terms.payout.last4} · {t('groups.runBy', { name: terms.runBy })}
      </TasaText>
      <View style={styles.points}>
        {terms.points.map((point) => (
          <View key={point} style={styles.point}>
            <View style={styles.dot} />
            <TasaText variant="caption" style={styles.flex}>
              {point}
            </TasaText>
          </View>
        ))}
      </View>
    </Card>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    terms: {
      gap: 2,
      marginVertical: theme.spacing.md,
      borderColor: `${colors.brand}33`,
      backgroundColor: `${colors.brand}0D`,
    },
    points: {
      gap: 6,
      marginTop: theme.spacing.sm,
    },
    point: {
      flexDirection: 'row',
      gap: 8,
    },
    dot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      marginTop: 7,
      backgroundColor: colors.brand,
    },
    flex: {
      flex: 1,
    },
  }),
);
