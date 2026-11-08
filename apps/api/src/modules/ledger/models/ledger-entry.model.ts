import { Schema, model, type Types } from 'mongoose';

/**
 * Append-only double-entry ledger. Each posting is a set of lines that sum to zero;
 * entries are never edited or deleted — corrections are new postings.
 *
 * Signs: assets we hold go up (+); what we owe goes down (−). A user's wallet account is
 * therefore negative while they have money with us. `Wallet.balance` is the positive,
 * cached view of the same number, updated in the same Mongo transaction.
 */
export interface ILedgerEntry {
  _id: Types.ObjectId;
  /** Posting key shared by all lines of one posting. */
  posting: string;
  account: string;
  /** Signed kobo. */
  amount: number;
  transaction?: Types.ObjectId;
  memo: string;
  idempotencyKey: string;
  createdAt: Date;
}

const ledgerEntrySchema = new Schema<ILedgerEntry>(
  {
    posting: { type: String, required: true, index: true },
    account: { type: String, required: true },
    amount: { type: Number, required: true, validate: Number.isInteger },
    transaction: { type: Schema.Types.ObjectId, ref: 'Transaction', index: true },
    memo: { type: String, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

ledgerEntrySchema.index({ account: 1, createdAt: -1 });

export const LedgerEntryModel = model<ILedgerEntry>('LedgerEntry', ledgerEntrySchema);
