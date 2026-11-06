import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface ITicketTier {
  _id: Types.ObjectId;
  name: string;
  /** What this ticket gets you: free drinks, popcorn, backstage. */
  covers?: string;
  /** Kobo. */
  price: number;
  /** How many can be sold. null = no limit. */
  limit: number | null;
  sold: number;
}

/**
 * A ticketed event. There's no cancelling one: the organiser stops selling instead, and
 * `adminPaused` lets Tela's staff do the same. `refundDays` is fixed once created, because
 * buyers paid on those terms.
 */
/** A photo or video the organiser shows off the event with, usually from past ones. In R2. */
export interface IEventMedia {
  _id: Types.ObjectId;
  kind: 'image' | 'video';
  key: string;
  createdAt: Date;
}

export interface IEvent {
  _id: Types.ObjectId;
  owner: Types.ObjectId;
  /**
   * Legacy: events made before organisers named themselves once, on opting in. Buyers now see
   * `Seller.organisation`, and this only fills in for a seller who hasn't set one yet.
   */
  organiserName?: string;
  /** Who buyers call about the event. */
  phone?: string;
  /** Who buyers write to about the event. */
  email?: string;
  title: string;
  description?: string;
  venue: string;
  /** The poster, in R2. */
  imageKey?: string;
  gallery: Types.DocumentArray<IEventMedia>;
  startsAt: Date;
  /** Sales stop here, or at `startsAt` when there's no end time. */
  endsAt?: Date;
  /** For the share link. */
  code: string;
  /** 0 = no refunds. */
  refundDays: number;
  salesPaused: boolean;
  adminPaused: boolean;
  /** Paused by the organiser's suspension, so lifting it resumes exactly these. */
  pausedBySuspension?: boolean;
  tiers: Types.DocumentArray<ITicketTier>;
  /** Users the organiser let scan at the door, for this event only. */
  staff: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export type EventDoc = HydratedDocument<IEvent>;

const tierSchema = new Schema<ITicketTier>({
  name: { type: String, required: true, trim: true },
  covers: { type: String, trim: true },
  price: { type: Number, required: true, min: 0, validate: Number.isInteger },
  limit: { type: Number, default: null, min: 1 },
  sold: { type: Number, default: 0, min: 0 },
});

const mediaSchema = new Schema<IEventMedia>({
  kind: { type: String, enum: ['image', 'video'], required: true },
  key: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const eventSchema = new Schema<IEvent>(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    organiserName: String,
    phone: String,
    email: { type: String, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    venue: { type: String, required: true, trim: true },
    imageKey: String,
    gallery: { type: [mediaSchema], default: [] },
    startsAt: { type: Date, required: true },
    endsAt: Date,
    code: { type: String, required: true, unique: true },
    refundDays: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    salesPaused: { type: Boolean, default: false },
    adminPaused: { type: Boolean, default: false },
    pausedBySuspension: Boolean,
    tiers: { type: [tierSchema], required: true },
    staff: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true },
);

eventSchema.index({ startsAt: 1 });
eventSchema.index({ staff: 1 });

export const EventModel = model<IEvent>('Event', eventSchema);
