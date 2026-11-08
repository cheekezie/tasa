import { Schema, model, type Types } from 'mongoose';

export const ADMIN_ROLES = ['super_admin', 'finance', 'support', 'compliance'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface IAdmin {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
}

const adminSchema = new Schema<IAdmin>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ADMIN_ROLES, required: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

export const AdminModel = model<IAdmin>('Admin', adminSchema);
