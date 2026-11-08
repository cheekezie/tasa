import { Schema, model, type Types } from 'mongoose';

/** One user's points. Only PointsService changes it, always together with a PointsEntry. */
export interface IPointsBalance {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  balance: number;
  lifetimeEarned: number;
}

const pointsBalanceSchema = new Schema<IPointsBalance>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  lifetimeEarned: { type: Number, default: 0, min: 0 },
});

export const PointsBalanceModel = model<IPointsBalance>('PointsBalance', pointsBalanceSchema);

export const POINTS_ENTRY_TYPES = ['earn', 'redeem', 'forfeit'] as const;

/** Every change to a balance. `key` is unique, so a replayed event can't count twice. */
export interface IPointsEntry {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  type: (typeof POINTS_ENTRY_TYPES)[number];
  /** + earned, − redeemed or forfeited. */
  points: number;
  key: string;
  transaction?: Types.ObjectId;
  createdAt: Date;
}

const pointsEntrySchema = new Schema<IPointsEntry>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: POINTS_ENTRY_TYPES, required: true },
    points: { type: Number, required: true, validate: Number.isInteger },
    key: { type: String, required: true, unique: true },
    transaction: { type: Schema.Types.ObjectId, ref: 'Transaction' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

pointsEntrySchema.index({ user: 1, createdAt: -1 });

export const PointsEntryModel = model<IPointsEntry>('PointsEntry', pointsEntrySchema);

/** The one settings document. Finance edits it; these defaults apply until they do. */
export interface IPointsSettings {
  _id: string;
  active: boolean;
  /** Points per ₦100 actually paid on a bill, after discounts. */
  billPointsPer100Naira: number;
  /** Keep this worth less than the transfer charge, or looping transfers earns money. */
  transferPoints: number;
  /** Kobo one point is worth when converted. */
  pointValue: number;
  minRedeemPoints: number;
}

const pointsSettingsSchema = new Schema<IPointsSettings>(
  {
    _id: { type: String, default: 'default' },
    active: { type: Boolean, default: true },
    billPointsPer100Naira: { type: Number, default: 1, min: 0 },
    transferPoints: { type: Number, default: 1, min: 0 },
    pointValue: { type: Number, default: 10, min: 1, validate: Number.isInteger },
    minRedeemPoints: { type: Number, default: 100, min: 1 },
  },
  { timestamps: true },
);

export const PointsSettingsModel = model<IPointsSettings>('PointsSettings', pointsSettingsSchema);
