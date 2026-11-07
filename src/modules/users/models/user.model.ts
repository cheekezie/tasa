import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface IUser {
  _id: Types.ObjectId;
  /**
   * E.164. A sign-in identity, like `email`; an account has at least one of them. Both are
   * only ever stored after the user proves they own them with a one-time code.
   */
  phone?: string;
  /** Lowercase, unique handle used for Tasa-to-Tasa transfers. Set after sign-up. */
  username?: string;
  /** Lowercase. A sign-in identity for when SMS doesn't arrive. */
  email?: string;
  /** Legal name. Comes from the BVN record once verified; until then what the user typed. */
  fullName?: string;
  bvnCipher?: string;
  bvnLast4?: string;
  /** No provider yet: an admin reviews each BVN by hand. Unset until one is submitted. */
  bvnStatus?: 'pending' | 'verified' | 'rejected';
  bvnRejectionReason?: string;
  /** The other ID that opens ticket selling. Stored like the BVN, and nothing checks it yet. */
  ninCipher?: string;
  ninLast4?: string;
  pinHash?: string;
  /** Day of month (1–31) the user gets paid; drives low-balance reminders. */
  payday: number | null;
  notificationPrefs: { shortfallReminders: boolean; push: boolean; paymentReceipts: boolean; walletFunding: boolean; offers: boolean };
  closedAt?: Date;
  /** Off = bill payments skip the PIN. Every new sign-in turns it back on. */
  billPinEnabled: boolean;
  /** R2 key of the profile photo. */
  avatarKey?: string;
  pushTokens: string[];
  /** They said they're a student and accepted the student terms (this version). */
  studentTerms?: { version: number; at: Date };
  status: 'active' | 'suspended' | 'closed';
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    phone: { type: String },
    username: { type: String, lowercase: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    fullName: { type: String, trim: true },
    bvnCipher: { type: String, select: false },
    bvnLast4: String,
    bvnStatus: { type: String, enum: ['pending', 'verified', 'rejected'] },
    bvnRejectionReason: String,
    ninCipher: { type: String, select: false },
    ninLast4: String,
    pinHash: { type: String, select: false },
    payday: { type: Number, min: 1, max: 31, default: null },
    notificationPrefs: {
      shortfallReminders: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      paymentReceipts: { type: Boolean, default: true },
      walletFunding: { type: Boolean, default: true },
      offers: { type: Boolean, default: true },
    },
    avatarKey: String,
    closedAt: Date,
    billPinEnabled: { type: Boolean, default: true },
    pushTokens: { type: [String], default: [] },
    studentTerms: { version: Number, at: Date },
    status: { type: String, enum: ['active', 'suspended', 'closed'], default: 'active' },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

userSchema.index({ bvnStatus: 1, createdAt: 1 });
userSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: 'string' } } });
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });

export const UserModel = model<IUser>('User', userSchema);
export type UserDoc = HydratedDocument<IUser>;
