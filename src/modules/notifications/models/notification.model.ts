import { Schema, model, type Types } from 'mongoose';

export const NOTIFICATION_TYPES = ['wallet', 'bill', 'transfer', 'gift', 'coupon', 'recurring', 'reminder', 'system', 'offer'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface INotification {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Stops the same reminder going out twice (e.g. `shortfall:<recurringId>:<cycle>`). */
  dedupeKey?: string;
  readAt?: Date;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: Map, of: String },
    dedupeKey: String,
    readAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
// The feed keeps 90 days.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86_400 });

export const NotificationModel = model<INotification>('Notification', notificationSchema);
