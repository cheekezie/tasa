import { Schema, model, type Types } from 'mongoose';

export type FeatureSetting = { enabled: boolean; message?: string };

/**
 * The one switchboard document. Support and super admins edit it; until they do, everything is on
 * and nothing is under maintenance.
 */
export interface IAppSettings {
  _id: string;
  /** By feature key (see FEATURES). A key with no entry is on. */
  features: Map<string, FeatureSetting>;
  maintenance: {
    active: boolean;
    /** What the app shows. */
    message?: string;
    /** When we expect to be back. Shown only; maintenance ends when someone turns it off. */
    until?: Date;
    startedAt?: Date;
    updatedBy?: Types.ObjectId;
  };
  updatedAt: Date;
}

const featureSchema = new Schema<FeatureSetting>({ enabled: { type: Boolean, required: true }, message: String }, { _id: false });

const appSettingsSchema = new Schema<IAppSettings>(
  {
    _id: { type: String, default: 'default' },
    features: { type: Map, of: featureSchema, default: {} },
    maintenance: {
      active: { type: Boolean, default: false },
      message: String,
      until: Date,
      startedAt: Date,
      updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
    },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

export const AppSettingsModel = model<IAppSettings>('AppSettings', appSettingsSchema);
