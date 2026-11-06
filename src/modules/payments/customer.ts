import { env } from '../../config/env';
import { localPhone } from '../../lib/schemas';
import type { IUser } from '../users/models/user.model';
import type { Customer } from './providers/gateway';
import { splitName } from './providers/sayswitch';

/** What we tell SaySwitch about a user. */
export function customerOf(user: Pick<IUser, '_id' | 'email' | 'phone' | 'fullName' | 'username'>): Customer {
  const { firstName, lastName } = splitName(user.fullName ?? user.username ?? 'Tela Customer');
  return {
    firstName,
    lastName,
    email: user.email ?? `${user._id.toString()}@${env.CUSTOMER_EMAIL_DOMAIN}`,
    phone: user.phone ? localPhone(user.phone) : (env.BUSINESS_PHONE ?? ''),
  };
}
