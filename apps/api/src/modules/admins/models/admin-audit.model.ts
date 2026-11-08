import { Schema, model, type Types } from 'mongoose';

/** Who did what in the back office. Written for every change, including refused attempts. */
export interface IAdminAudit {
  _id: Types.ObjectId;
  admin: Types.ObjectId;
  role?: string;
  method: string;
  route: string;
  params: Record<string, string>;
  /** Allow-listed fields only: bodies carry passwords. */
  details: Record<string, unknown>;
  statusCode: number;
  ip?: string;
  createdAt: Date;
}

const adminAuditSchema = new Schema<IAdminAudit>(
  {
    admin: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
    role: String,
    method: { type: String, required: true },
    route: { type: String, required: true },
    params: { type: Schema.Types.Mixed, default: {} },
    details: { type: Schema.Types.Mixed, default: {} },
    statusCode: { type: Number, required: true },
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

adminAuditSchema.index({ createdAt: -1 });
adminAuditSchema.index({ admin: 1, createdAt: -1 });

export const AdminAuditModel = model<IAdminAudit>('AdminAudit', adminAuditSchema);
