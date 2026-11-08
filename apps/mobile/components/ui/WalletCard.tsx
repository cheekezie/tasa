import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { router } from 'expo-router';

import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { useCopyToClipboard } from '@/components/ui/Snackbar';
import { useSettings } from '@/context/SettingsContext';
import { useWalletAccount } from '@/hooks/useAccount';
import { formatNaira } from '@/lib/format';
import { Kobo } from '@/lib/money';
import { palettes, theme } from '@/constants/theme';

// The wallet card is a branded surface and keeps its greens in both light and dark mode.
const brand = palettes.light;

// Logo yellow, white, mint and coral confetti, kept to the right and edges so the
// balance on the left stays easy to read.
const YELLOW = '#EBBB01';
const MINT = '#7FE0B8';
const CORAL = '#FF8A65';
const WHITE = '#FFFFFF';

type Piece = {
  left: `${number}%`;
  top: `${number}%`;
  color: string;
  rotate: number;
  shape: 'strip' | 'dot';
  size: number;
  opacity: number;
};

const CONFETTI: Piece[] = [
  { left: '58%', top: '8%', color: YELLOW, rotate: 24, shape: 'strip', size: 12, opacity: 0.9 },
  { left: '66%', top: '30%', color: WHITE, rotate: -18, shape: 'strip', size: 10, opacity: 0.35 },
  { left: '72%', top: '14%', color: CORAL, rotate: 0, shape: 'dot', size: 6, opacity: 0.85 },
  { left: '80%', top: '40%', color: MINT, rotate: 62, shape: 'strip', size: 12, opacity: 0.8 },
  { left: '88%', top: '22%', color: YELLOW, rotate: 0, shape: 'dot', size: 5, opacity: 0.9 },
  { left: '93%', top: '6%', color: WHITE, rotate: -40, shape: 'strip', size: 9, opacity: 0.4 },
  { left: '62%', top: '48%', color: YELLOW, rotate: -30, shape: 'strip', size: 9, opacity: 0.55 },
  { left: '90%', top: '52%', color: CORAL, rotate: 15, shape: 'strip', size: 11, opacity: 0.75 },
  { left: '74%', top: '58%', color: WHITE, rotate: 0, shape: 'dot', size: 4, opacity: 0.5 },
  { left: '84%', top: '66%', color: YELLOW, rotate: 78, shape: 'strip', size: 10, opacity: 0.6 },
  { left: '96%', top: '78%', color: MINT, rotate: 0, shape: 'dot', size: 6, opacity: 0.7 },
  { left: '46%', top: '4%', color: MINT, rotate: 0, shape: 'dot', size: 4, opacity: 0.6 },
  { left: '38%', top: '92%', color: YELLOW, rotate: 40, shape: 'strip', size: 9, opacity: 0.5 },
  { left: '4%', top: '94%', color: WHITE, rotate: -12, shape: 'strip', size: 9, opacity: 0.3 },
  { left: '2%', top: '42%', color: CORAL, rotate: 0, shape: 'dot', size: 4, opacity: 0.5 },
];

// Keeps the pattern a faint texture rather than a feature.
const CONFETTI_STRENGTH = 0.4;

function Confetti() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {CONFETTI.map((piece, index) => (
        <View
          key={index}
          style={{
            position: 'absolute',
            left: piece.left,
            top: piece.top,
            width: piece.shape === 'dot' ? piece.size : piece.size * 0.45,
            height: piece.size,
            borderRadius: piece.shape === 'dot' ? piece.size / 2 : 1.5,
            backgroundColor: piece.color,
            opacity: piece.opacity * CONFETTI_STRENGTH,
            transform: [{ rotate: `${piece.rotate}deg` }],
          }}
        />
      ))}
    </View>
  );
}

/** The user's own account number: send to it from any bank and it lands in the wallet. */
function FundingAccount() {
  const { t } = useSettings();
  const copy = useCopyToClipboard();
  const { account, failed, retry } = useWalletAccount();

  if (account) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('common.copy')} ${account.accountNumber}`}
        hitSlop={6}
        onPress={() => copy(account.accountNumber, t('cards.virtualCopied'))}
        style={styles.accountDetails}>
        {/* Its own line, so long bank and account names can only ever shorten themselves. */}
        <View style={styles.account}>
          <TasaText variant="bodyMedium" color="#FFFFFF">
            {account.accountNumber}
          </TasaText>
          <Icon color="rgba(255,255,255,0.85)" ios="doc.on.doc" android="content_copy" size={14} />
        </View>
        <TasaText variant="caption" color="rgba(255,255,255,0.72)" numberOfLines={1}>
          {account.bankName} · {account.accountName}
        </TasaText>
      </Pressable>
    );
  }
  if (failed) {
    return (
      <Pressable accessibilityRole="button" hitSlop={6} onPress={retry} style={styles.account}>
        <TasaText variant="caption" color="#FFFFFF">
          {t('wallet.getAccount')}
        </TasaText>
      </Pressable>
    );
  }
  return (
    <TasaText variant="caption" color="rgba(255,255,255,0.72)">
      {t('wallet.settingUpAccount')}
    </TasaText>
  );
}

type WalletCardProps = {
  balance: Kobo;
  style?: ViewStyle;
  onFund?: () => void;
  onTransfer?: () => void;
};

export function WalletCard({ balance, style, onFund, onTransfer }: WalletCardProps) {
  const { t } = useSettings();
  return (
    <LinearGradient
      colors={[brand.brandDeep, brand.brand, brand.brandLight]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, style]}>
      <Confetti />
      <View style={styles.topRow}>
        <TasaText variant="label" color="rgba(255,255,255,0.72)">
          {t('wallet.title')}
        </TasaText>
        <View style={styles.badge}>
          <TasaText variant="caption" color="#FFFFFF">
            {t('wallet.instant')}
          </TasaText>
        </View>
      </View>

      <TasaText variant="display" color="#FFFFFF" style={styles.balance}>
        {formatNaira(balance)}
      </TasaText>
      <FundingAccount />

      {/* Pushes the buttons to the bottom when a carousel stretches the card to match its neighbour. */}
      <View style={styles.spacer} />
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('wallet.fund')}
          onPress={onFund ?? (() => router.push('/wallet/fund'))}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <TasaText variant="bodyMedium" color={brand.brand}>
            {t('wallet.fund')}
          </TasaText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('wallet.send')}
          onPress={onTransfer ?? (() => router.push('/wallet/transfer'))}
          style={({ pressed }) => [styles.action, styles.actionGhost, pressed && styles.pressed]}>
          <TasaText variant="bodyMedium" color="#FFFFFF">
            {t('wallet.send')}
          </TasaText>
        </Pressable>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  accountDetails: {
    gap: 2,
  },
  card: {
    borderRadius: theme.radius.xl,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    overflow: 'hidden',
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
  balance: {
    marginTop: theme.spacing.sm,
    marginBottom: 2,
  },
  spacer: {
    flexGrow: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  action: {
    flex: 1,
    minHeight: 40,
    borderRadius: theme.radius.md,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
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
