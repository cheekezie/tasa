import { Href, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { QuickAction } from '@/components/ui/Actions';
import { IconName } from '@/components/ui/Icon';
import { Screen, SectionHeader } from '@/components/ui/Screen';
import { useT } from '@/context/SettingsContext';
import { useTheme } from '@/context/ThemeContext';

type Service = { label: string; icon: IconName; color: string; href: Href };

/** Everything Tasa does, in one place. Home's quick actions are the shortlist of this. */
export default function ServicesScreen() {
  const { colors } = useTheme();
  const t = useT();

  const groups: { title: string; items: Service[] }[] = [
    {
      title: t('servicesScreen.money'),
      items: [
        { label: t('servicesScreen.bills'), icon: { ios: 'creditcard.fill', android: 'credit_card' }, color: colors.brand, href: '/(tabs)/pay' },
        { label: t('servicesScreen.fund'), icon: { ios: 'plus', android: 'add' }, color: colors.brand, href: '/wallet/fund' },
        {
          label: t('servicesScreen.send'),
          icon: { ios: 'arrow.left.arrow.right', android: 'swap_horiz' },
          color: colors.brand,
          href: '/wallet/transfer',
        },
        {
          label: t('servicesScreen.account'),
          icon: { ios: 'building.columns.fill', android: 'account_balance' },
          color: colors.brand,
          href: '/wallet/account',
        },
        { label: t('servicesScreen.points'), icon: { ios: 'star.fill', android: 'stars' }, color: colors.brand, href: '/points' },
        { label: t('servicesScreen.spending'), icon: { ios: 'chart.bar.fill', android: 'bar_chart' }, color: colors.brand, href: '/insights' },
      ],
    },
    {
      title: t('servicesScreen.gifts'),
      items: [
        { label: t('servicesScreen.gift'), icon: { ios: 'gift.fill', android: 'redeem' }, color: colors.coupon, href: '/gift/create' },
        { label: t('servicesScreen.coupon'), icon: { ios: 'tag.fill', android: 'sell' }, color: colors.coupon, href: '/coupons/create' },
        { label: t('servicesScreen.giftHistory'), icon: { ios: 'clock.fill', android: 'history' }, color: colors.coupon, href: '/gift/history' },
      ],
    },
    {
      title: t('servicesScreen.events'),
      items: [
        {
          label: t('servicesScreen.tickets'),
          icon: { ios: 'ticket.fill', android: 'confirmation_number' },
          color: colors.accentHot,
          href: '/events',
        },
        { label: t('servicesScreen.sell'), icon: { ios: 'plus', android: 'add' }, color: colors.accentHot, href: '/events/selling' },
        { label: t('servicesScreen.groups'), icon: { ios: 'person.3.fill', android: 'groups' }, color: colors.accentHot, href: '/groups' },
      ],
    },
    {
      title: t('servicesScreen.plan'),
      items: [
        {
          label: t('servicesScreen.recurring'),
          icon: { ios: 'arrow.triangle.2.circlepath', android: 'autorenew' },
          color: colors.success,
          href: '/recurring',
        },
        { label: t('servicesScreen.people'), icon: { ios: 'person.2.fill', android: 'group' }, color: colors.success, href: '/beneficiaries' },
        { label: t('servicesScreen.splits'), icon: { ios: 'divide.circle.fill', android: 'call_split' }, color: colors.success, href: '/splits' },
      ],
    },
  ];

  return (
    <Screen>
      {groups.map((group) => (
        <View key={group.title}>
          <SectionHeader title={group.title} />
          <View style={styles.grid}>
            {group.items.map((item) => (
              <View key={item.label} style={styles.cell}>
                <QuickAction color={item.color} icon={item.icon} label={item.label} lines={2} onPress={() => router.push(item.href)} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 16,
  },
  cell: {
    width: '33.33%',
    flexDirection: 'row',
  },
});
