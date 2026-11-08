import { Schema, model, type Types } from 'mongoose';

/**
 * What someone who went thought of an event: one per person per event, and only once their
 * ticket was scanned at the door. `seller` is copied from the event so an organiser's
 * average is one indexed query.
 */
export interface IRating {
  _id: Types.ObjectId;
  event: Types.ObjectId;
  seller: Types.ObjectId;
  user: Types.ObjectId;
  /** 1 to 5. */
  stars: number;
  createdAt: Date;
  updatedAt: Date;
}

const ratingSchema = new Schema<IRating>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    stars: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  },
  { timestamps: true },
);

ratingSchema.index({ event: 1, user: 1 }, { unique: true });

export const RatingModel = model<IRating>('Rating', ratingSchema);
