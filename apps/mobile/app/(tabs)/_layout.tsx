import { Redirect, Tabs } from 'expo-router';

import { FloatingTabBar } from '@/components/ui/FloatingTabBar';
import { Icon } from '@/components/ui/Icon';
import { useApp } from '@/context/AppContext';
import { useSettings } from '@/context/SettingsContext';
import { useTheme } from '@/context/ThemeContext';
import { useSessionEffects } from '@/hooks/useSessionEffects';

export default function TabLayout() {
  const { hasOnboarded, isSignedIn } = useApp();

  if (!hasOnboarded) {
    return <Redirect href="/onboarding" />;
  }
  if (!isSignedIn) {
    return <Redirect href="/sign-in" />;
  }

  return <SignedInTabs />;
}

/** Split out so session hooks only run once someone is actually signed in. */
function SignedInTabs() {
  const { colors } = useTheme();
  const { t } = useSettings();
  useSessionEffects();

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.surface },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.home'),
          tabBarIcon: ({ color }) => <Icon color={String(color)} ios="house.fill" android="home" />,
        }}
      />
      <Tabs.Screen
        name="pay"
        options={{
          title: t('tab.pay'),
          tabBarIcon: ({ color }) => <Icon color={String(color)} ios="bolt.fill" android="bolt" />,
        }}
      />
      <Tabs.Screen
        name="gifts"
        options={{
          title: t('tab.gifts'),
          tabBarIcon: ({ color }) => <Icon color={String(color)} ios="gift.fill" android="redeem" />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: t('tab.activity'),
          tabBarIcon: ({ color }) => <Icon color={String(color)} ios="clock.fill" android="history" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tab.me'),
          tabBarIcon: ({ color }) => <Icon color={String(color)} ios="person.fill" android="person" />,
        }}
      />
    </Tabs>
  );
}
