import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export const SCHOOL_KINDS = ['university', 'polytechnic', 'college'] as const;
export type SchoolKind = (typeof SCHOOL_KINDS)[number];

export const SCHOOL_OWNERSHIPS = ['federal', 'state', 'private'] as const;
export type SchoolOwnership = (typeof SCHOOL_OWNERSHIPS)[number];

/**
 * A school students can say they attend. Tasa staff keep the list: only `active` ones are offered,
 * so a pilot starts with a few. `emailDomains` are the addresses the school gives its students
 * (e.g. `live.unilag.edu.ng`); a code sent to one proves the student is there. None = ID card only.
 */
export interface ISchool {
  _id: Types.ObjectId;
  name: string;
  /** What students call it: UNILAG, UI, YABATECH. */
  shortName: string;
  kind: SchoolKind;
  ownership?: SchoolOwnership;
  state: string;
  website?: string;
  /** R2 key of its logo (public). */
  logoKey?: string;
  /** Where the seed copied the logo from; unset when staff uploaded it. */
  logoSource?: string;
  emailDomains: string[];
  /** Its own faculties and departments, filled in by staff over time. Empty = students get the general list. */
  faculties: { name: string; departments: string[] }[];
  active: boolean;
  createdAt: Date;
}

const schoolSchema = new Schema<ISchool>(
  {
    name: { type: String, required: true, trim: true },
    shortName: { type: String, required: true, trim: true },
    kind: { type: String, enum: SCHOOL_KINDS, required: true },
    ownership: { type: String, enum: SCHOOL_OWNERSHIPS },
    website: { type: String, trim: true },
    logoKey: String,
    logoSource: String,
    state: { type: String, required: true, trim: true },
    emailDomains: { type: [String], default: [] },
    faculties: { type: [{ _id: false, name: { type: String, required: true }, departments: { type: [String], default: [] } }], default: [] },
    active: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schoolSchema.index({ name: 1 }, { unique: true });
schoolSchema.index({ active: 1, shortName: 1 });

export const SchoolModel = model<ISchool>('School', schoolSchema);
export type SchoolDoc = HydratedDocument<ISchool>;
