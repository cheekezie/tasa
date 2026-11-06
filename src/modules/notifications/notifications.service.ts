import type { Types } from 'mongoose';
import { isDuplicateKey } from '../../lib/db';
import { paginate } from '../../lib/response';
import { getQueue } from '../../lib/queue';
import type { IUser } from '../users/models/user.model';
import { NotificationModel, type INotification, type NotificationType } from './models/notification.model';

export const NOTIFY_QUEUE = 'notifications';

const PUSH_PREF: Partial<Record<NotificationType, 'paymentReceipts' | 'walletFunding' | 'offers'>> = {
  bill: 'paymentReceipts',
  transfer: 'paymentReceipts',
  gift: 'paymentReceipts',
  coupon: 'paymentReceipts',
  recurring: 'paymentReceipts',
  wallet: 'walletFunding',
  offer: 'offers',
};

/** Every notification stays in the in-app feed; prefs only silence the push. Security notices always go. */
export function pushAllowed(prefs: IUser['notificationPrefs'], type: NotificationType) {
  const pref = PUSH_PREF[type];
  return prefs.push && (!pref || prefs[pref]);
}

export type NotifyInput = {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  dedupeKey?: string;
  /** Also push to the user's devices (default true). */
  push?: boolean;
};

const toDto = (n: INotification) => ({
  id: n._id.toString(),
  type: n.type,
  title: n.title,
  body: n.body,
  data: n.data ? Object.fromEntries(n.data as unknown as Map<string, string>) : {},
  read: Boolean(n.readAt),
  createdAt: n.createdAt.toISOString(),
});

export const NotificationsService = {
  /** Writes to the in-app feed and queues a push. Returns false if `dedupeKey` was already sent. */
  async notify(userId: string | Types.ObjectId, input: NotifyInput) {
    try {
      const n = await NotificationModel.create({ user: userId, ...input });
      if (input.push !== false) {
        await getQueue(NOTIFY_QUEUE).add('push', { notificationId: n.id }, { jobId: `push-${n.id}` });
      }
      return true;
    } catch (err) {
      if (isDuplicateKey(err)) return false;
      throw err;
    }
  },

  /** For people who aren't users yet (gift recipients), or as a backup channel. */
  async sms(to: string, body: string) {
    await getQueue(NOTIFY_QUEUE).add('sms', { to, body });
  },

  async email(to: string, subject: string, text: string) {
    await getQueue(NOTIFY_QUEUE).add('email', { to, subject, text });
  },

  async list(userId: string, page: number, limit: number) {
    const filter = { user: userId };
    const [items, total, unread] = await Promise.all([
      NotificationModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      NotificationModel.countDocuments(filter),
      NotificationModel.countDocuments({ ...filter, readAt: null }),
    ]);
    return { ...paginate(items.map(toDto), total, page, limit), unread };
  },

  async markRead(userId: string, ids?: string[]) {
    await NotificationModel.updateMany(
      { user: userId, readAt: null, ...(ids?.length && { _id: { $in: ids } }) },
      { readAt: new Date() },
    );
  },
};
