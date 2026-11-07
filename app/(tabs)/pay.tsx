import { router } from 'expo-router';

import { ServiceTile } from '@/components/ui/Actions';
import { Screen, ScreenHeader, SectionHeader } from '@/components/ui/Screen';
import { utilityServices } from '@/constants/data';
import { useSettings } from '@/context/SettingsContext';

export default function PayScreen() {
  const { t } = useSettings();
  return (
    <Screen
      header={
        <ScreenHeader
          title={t('pay.title')}
          subtitle={t('pay.subtitle')}
        />
      }>
      <SectionHeader title={t('pay.allServices')} />
      {utilityServices.map((service) => (
        <ServiceTile
          key={service.id}
          name={t(`services.${service.id}.name`)}
          serviceId={service.id}
          subtitle={t(`services.${service.id}.subtitle`)}
          onPress={() => router.push(`/bills/${service.id}`)}
        />
      ))}
    </Screen>
  );
}
