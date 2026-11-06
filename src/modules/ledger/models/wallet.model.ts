import { Schema, model, type Types } from 'mongoose';

/** Cached balance of `wallet:<userId>`. Only LedgerService.post changes it. */
export interface IWallet {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  /** Kobo, never negative. */
  balance: number;
  updatedAt: Date;
}

const walletSchema = new Schema<IWallet>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    balance: { type: Number, required: true, default: 0, min: 0, validate: Number.isInteger },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

export const WalletModel = model<IWallet>('Wallet', walletSchema);
