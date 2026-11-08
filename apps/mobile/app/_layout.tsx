import { Sora_400Regular } from '@expo-google-fonts/sora/400Regular';
import { Sora_500Medium } from '@expo-google-fonts/sora/500Medium';
import { Sora_600SemiBold } from '@expo-google-fonts/sora/600SemiBold';
import { Sora_700Bold } from '@expo-google-fonts/sora/700Bold';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider, KeyboardToolbar } from 'react-native-keyboard-controller';
import 'react-native-reanimated';

import { AnimatedSplash } from '@/components/ui/AnimatedSplash';
import { MaintenanceView } from '@/components/ui/MaintenanceView';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { SnackbarProvider } from '@/components/ui/Snackbar';
import { palettes, theme } from '@/constants/theme';
import { AppProvider, useApp } from '@/context/AppContext';
import { SettingsProvider, useSettings } from '@/context/SettingsContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { useAppConfig } from '@/hooks/useAppConfig';
import { queryClient } from '@/lib/queryClient';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

const toolbarTheme = {
  light: {
    primary: palettes.light.brand,
    disabled: palettes.light.inkSubtle,
    background: palettes.light.surfaceElevated,
    ripple: palettes.light.overlay,
  },
  dark: {
    primary: palettes.dark.brandLight,
    disabled: palettes.dark.inkSubtle,
    background: palettes.dark.surfaceElevated,
    ripple: palettes.dark.overlay,
  },
};

function RootLayoutNav({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { isReady } = useApp();
  const { isReady: themeReady, colors, scheme } = useTheme();
  const { isReady: settingsReady, t } = useSettings();
  const config = useAppConfig();
  // Settled once it has answered, failed, or is waiting for a network that isn't there: startup
  // never hangs on it, and without it everything shows as on (the API still refuses what's off).
  const configSettled = !config.isPending || config.fetchStatus !== 'fetching';
  const ready = fontsLoaded && isReady && themeReady && settingsReady && configSettled;

  // The native splash stays up until AnimatedSplash has drawn and takes over.
  if (!ready) {
    return null;
  }

  const maintenance = config.data?.maintenance;
  if (maintenance?.active) {
    return (
      <>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <MaintenanceView message={maintenance.message} until={maintenance.until} checking={config.isFetching} onRetry={() => config.refetch()} />
        <AnimatedSplash />
      </>
    );
  }

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.brand,
          headerTitleStyle: { fontFamily: theme.fonts.bodyBold, color: colors.ink },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.surface },
        }}>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="sign-up/index" options={{ title: t('nav.signUp') }} />
        <Stack.Screen name="sign-up/verify" options={{ title: t('nav.verifyPhone') }} />
        <Stack.Screen name="sign-up/details" options={{ title: t('nav.yourDetails') }} />
        <Stack.Screen name="sign-up/pin" options={{ title: t('nav.createPin') }} />
        <Stack.Screen name="pin-reset" options={{ title: t('nav.pinReset') }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="wallet/fund" options={{ title: t('nav.fundWallet') }} />
        <Stack.Screen name="wallet/fund-transfer" options={{ title: t('nav.makeTransfer') }} />
        <Stack.Screen name="wallet/account" options={{ title: t('nav.walletAccount') }} />
        <Stack.Screen name="wallet/transfer" options={{ title: t('nav.sendTasa') }} />
        <Stack.Screen name="bills/[service]" options={{ title: t('nav.payBill') }} />
        <Stack.Screen name="bills/review" options={{ title: t('nav.reviewPayment') }} />
        <Stack.Screen name="bills/insight/[service]" options={{ title: t('nav.insight') }} />
        <Stack.Screen name="recurring/index" options={{ title: t('nav.recurring') }} />
        <Stack.Screen name="recurring/[id]" options={{ title: t('nav.recurringEdit') }} />
        <Stack.Screen name="recurring/setup" options={{ title: t('nav.recurringSetup') }} />
        <Stack.Screen name="beneficiaries/index" options={{ title: t('nav.beneficiaries') }} />
        <Stack.Screen name="beneficiaries/[id]" options={{ title: t('nav.beneficiary') }} />
        <Stack.Screen name="beneficiaries/add" options={{ title: t('nav.addBeneficiary') }} />
        <Stack.Screen name="gift/history" options={{ title: t('nav.giftHistory') }} />
        <Stack.Screen name="gift/create" options={{ title: t('nav.giftBill') }} />
        <Stack.Screen name="coupons/create" options={{ title: t('nav.createCoupon') }} />
        <Stack.Screen name="coupons/[code]" options={{ title: t('nav.couponDetails') }} />
        <Stack.Screen name="activity/[id]" options={{ title: t('nav.transaction') }} />
        <Stack.Screen name="account" options={{ title: t('manageProfile.title') }} />
        <Stack.Screen name="points" options={{ title: t('nav.points') }} />
        <Stack.Screen name="points/history" options={{ title: t('nav.pointsHistory') }} />
        <Stack.Screen name="insights" options={{ title: t('nav.spending') }} />
        <Stack.Screen name="services" options={{ title: t('nav.services') }} />
        <Stack.Screen name="events/index" options={{ title: t('nav.events') }} />
        <Stack.Screen name="events/[id]" options={{ title: t('nav.event') }} />
        <Stack.Screen name="events/selling" options={{ title: t('nav.selling') }} />
        <Stack.Screen name="events/create" options={{ title: t('nav.createEvent') }} />
        <Stack.Screen name="events/manage/[id]" options={{ title: t('nav.manageEvent') }} />
        <Stack.Screen name="events/sales/[id]" options={{ title: t('nav.eventSales') }} />
        <Stack.Screen name="events/scan/[id]" options={{ title: t('nav.scanTickets') }} />
        <Stack.Screen name="events/profile" options={{ title: t('nav.organiserProfile') }} />
        <Stack.Screen name="organisers/[id]" options={{ title: t('nav.organiser') }} />
        <Stack.Screen name="tickets/index" options={{ title: t('nav.myTickets') }} />
        <Stack.Screen name="groups/index" options={{ title: t('nav.groups') }} />
        <Stack.Screen name="groups/join" options={{ title: t('nav.joinGroup') }} />
        <Stack.Screen name="groups/create" options={{ title: t('nav.createGroup') }} />
        <Stack.Screen name="groups/[id]" options={{ title: t('nav.group') }} />
        <Stack.Screen name="groups/members/[id]" options={{ title: t('nav.groupMembers') }} />
        <Stack.Screen name="groups/payout/[id]" options={{ title: t('nav.groupPayout') }} />
        <Stack.Screen name="groups/member" options={{ title: t('nav.groupMember') }} />
        <Stack.Screen name="groups/due" options={{ title: t('nav.groupDue') }} />
        <Stack.Screen name="groups/new-due" options={{ title: t('nav.newDue') }} />
        <Stack.Screen name="groups/receipts" options={{ title: t('nav.receipts') }} />
        <Stack.Screen name="groups/receipt" options={{ title: t('nav.receipt') }} />
        <Stack.Screen name="student/index" options={{ title: t('nav.student') }} />
        <Stack.Screen name="splits/index" options={{ title: t('nav.splits') }} />
        <Stack.Screen name="splits/create" options={{ title: t('nav.createSplit') }} />
        <Stack.Screen name="splits/[id]" options={{ title: t('nav.split') }} />
        <Stack.Screen name="tickets/[id]" options={{ title: t('nav.ticket') }} />
        <Stack.Screen name="inbox" options={{ title: t('nav.inbox') }} />
        <Stack.Screen name="delete-account" options={{ title: t('nav.deleteAccount') }} />
        <Stack.Screen name="settings" options={{ title: t('nav.settings') }} />
        <Stack.Screen name="notifications" options={{ title: t('nav.notifications') }} />
      </Stack>
      {/* Prev / Next / Done above every keyboard, including number pads that have no return key. */}
      <KeyboardToolbar theme={toolbarTheme} />
      <OfflineBanner />
      <AnimatedSplash />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Sora_400Regular,
    Sora_500Medium,
    Sora_600SemiBold,
    Sora_700Bold,
  });

  return (
    <KeyboardProvider>
      <ThemeProvider>
        <SettingsProvider>
          <QueryClientProvider client={queryClient}>
            <AppProvider>
              <SnackbarProvider>
                <RootLayoutNav fontsLoaded={fontsLoaded} />
              </SnackbarProvider>
            </AppProvider>
          </QueryClientProvider>
        </SettingsProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}
