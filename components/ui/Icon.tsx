import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { ActivityItem, ServiceId, getServiceById, getServiceColor } from '@/constants/data';

type SymbolName = Exclude<ComponentProps<typeof SymbolView>['name'], string>;

/** An icon on both platforms: SF Symbol on iOS, Material Symbol on Android and web. */
export type IconName = {
  ios: NonNullable<SymbolName['ios']>;
  android: NonNullable<SymbolName['android']>;
};

type IconProps = IconName & {
  color: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export function Icon({ ios, android, color, size = 22, style }: IconProps) {
  return (
    <SymbolView
      name={{ ios, android, web: android }}
      tintColor={color}
      size={size}
      style={[{ width: size, height: size }, style]}
    />
  );
}

/** A bill service's icon, in the service's colour unless overridden. */
export function ServiceIcon({
  serviceId,
  color,
  size,
  style,
}: {
  serviceId: ServiceId;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Icon
      {...getServiceById(serviceId).icon}
      color={color ?? getServiceColor(serviceId)}
      size={size}
      style={style}
    />
  );
}

const activityIcons: Record<ActivityItem['type'], IconName> = {
  payment: { ios: 'doc.text', android: 'receipt_long' },
  fund: { ios: 'arrow.down.circle', android: 'arrow_circle_down' },
  gift: { ios: 'gift', android: 'redeem' },
  transfer: { ios: 'arrow.left.arrow.right', android: 'swap_horiz' },
  coupon: { ios: 'ticket', android: 'confirmation_number' },
};

/** A transaction's icon: the bill's own icon for payments, otherwise one per kind of activity. */
export function ActivityIcon({
  item,
  color,
  size,
}: {
  item: Pick<ActivityItem, 'type' | 'serviceId'>;
  color: string;
  size?: number;
}) {
  return item.type === 'payment' && item.serviceId ? (
    <ServiceIcon serviceId={item.serviceId} size={size} />
  ) : (
    <Icon {...activityIcons[item.type]} color={color} size={size} />
  );
}
