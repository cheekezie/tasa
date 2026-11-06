import { Schema, model, type Types } from 'mongoose';

/**
 * Every provider callback, as received. Some payload shapes aren't documented, so keeping
 * the raw body lets us fix a parser and replay. VTpass callbacks are unsigned (`signature:
 * 'none'`), which is fine: they only ever trigger a requery.
 */
export interface IWebhookEvent {
  _id: Types.ObjectId;
  provider: 'sayswitch' | 'vtpass';
  rawBody: string;
  signature: 'valid' | 'invalid' | 'none';
  status: 'received' | 'processed' | 'ignored' | 'failed';
  reference?: string;
  result?: string;
  error?: string;
  processedAt?: Date;
  createdAt: Date;
}

const webhookEventSchema = new Schema<IWebhookEvent>(
  {
    provider: { type: String, enum: ['sayswitch', 'vtpass'], required: true },
    rawBody: { type: String, required: true },
    signature: { type: String, enum: ['valid', 'invalid', 'none'], required: true },
    status: { type: String, enum: ['received', 'processed', 'ignored', 'failed'], default: 'received' },
    reference: { type: String, index: true },
    result: String,
    error: String,
    processedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

webhookEventSchema.index({ createdAt: -1 });
webhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86_400 });

export const WebhookEventModel = model<IWebhookEvent>('WebhookEvent', webhookEventSchema);
