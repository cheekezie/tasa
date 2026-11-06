import { createHash, randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { inTransaction, isDuplicateKey } from '../../lib/db';
import { bus } from '../../lib/events';
import { getQueue } from '../../lib/queue';
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors';
import { formatNaira } from '../../lib/money';
import { newReference } from '../../lib/references';
import { r2 } from '../../lib/r2';
import { redis } from '../../lib/redis';
import { paginate } from '../../lib/response';
import { localPhone } from '../../lib/schemas';
import { ChargesService } from '../charges/charges.service';
import { Accounts, LedgerService } from '../ledger/ledger.service';
import { gateway } from '../payments/providers';
import { QuotesService, toQuoteDto } from '../quotes/quotes.service';
import { TransactionModel, type TransactionDoc } from '../transactions/models/transaction.model';
import { toTransactionDto } from '../transactions/transactions.mapper';
import { UserModel } from '../users/models/user.model';
import { AVATAR_MAX_BYTES, AvatarsService, sniffImage } from '../users/avatars.service';
import { PinService } from '../users/pin.service';
import { publicName } from '../users/users.service';
import { EventModel, type IEvent } from './models/event.model';
import { RatingModel } from './models/rating.model';
import { sellingBlock, suspensionDto, verificationDto } from './seller-review.service';
import { SellerModel, TicketModel, type ITicket } from './models/ticket.model';
import { SELLER_TERMS_VERSION } from './tickets.schema';
import type {
  BankAccountInput,
  CreateEventInput,
  OptInInput,
  ProfileInput,
  TicketPayoutQuoteInput,
  TicketQuoteInput,
  UpdateEventInput,
  UpdateSellerInput,
} from './tickets.schema';
import type { PayoutResult } from '../payments/providers/gateway';

const DAY_MS = 86_400_000;
export const TICKETS_QUEUE = 'tickets';
/** How long after an event ends we ask the people who came to rate it. */
export const RATING_REMINDER_AFTER_MS = 2 * 60 * 60_000;
/** Without an end time, when we take an event to be over. */
const ASSUMED_EVENT_LENGTH_MS = 4 * 60 * 60_000;
/**
 * Payouts to a bank, sent and settled by one engine: ticket sales (from the organiser's ticket
 * wallet) and group dues (from the group's balance, `fundedFrom`). A failure returns the money
 * to wherever it came from.
 */
export const PAYOUT_KINDS = ['ticket_payout', 'group_payout'] as const;
type PayoutKind = (typeof PAYOUT_KINDS)[number];
const payoutKey = (t: Pick<TransactionDoc, 'kind' | 'reference'>) => `${t.kind === 'group_payout' ? 'group-payout' : 'ticket-payout'}:${t.reference}`;
const payoutSource = (t: Pick<TransactionDoc, 'fundedFrom' | 'user'>) => t.fundedFrom ?? Accounts.ticketWallet(t.user);

/** When to ask SaySwitch again about a payout it hasn't finished. After the last, staff look at it. */
export const PAYOUT_REQUERY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 12 * 60 * 60_000];
/** "No such payout" only means it never went once a request still in flight can't land any more. */
const PAYOUT_NOT_FOUND_GRACE_MS = 10 * 60_000;
const BANKS_KEY = 'catalog:banks';
const BANKS_CACHE_SECONDS = 24 * 60 * 60;

const newCode = (bytes: number) => randomBytes(bytes).toString('hex').toUpperCase();

/** Sales stop when the event ends, so people can still buy at the door. */
const salesEnd = (e: Pick<IEvent, 'startsAt' | 'endsAt'>) => e.endsAt ?? e.startsAt;

function salesState(e: IEvent, now = new Date()) {
  if (salesEnd(e) <= now) return 'ended' as const;
  return e.salesPaused || e.adminPaused ? ('paused' as const) : ('on_sale' as const);
}

/** Who's behind an event, as buyers see them: the organisation, how many events, how they rated. */
type Organiser = {
  id: string;
  name: string;
  logoUrl: string | null;
  /** Tela's compliance team has checked who they are. Buyers see a badge for it. */
  verified: boolean;
  events: number;
  rating: number | null;
  ratings: number;
};

/** Photos and videos on an event, and how big each may be. */
export const GALLERY_MAX = 12;
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;

/** Like `sniffImage`, for the containers phones record in. The bucket is public, so the bytes decide. */
export function sniffVideo(b: Buffer) {
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') {
    return b.subarray(8, 12).toString('latin1') === 'qt  '
      ? { extension: 'mov', mimeType: 'video/quicktime' }
      : { extension: 'mp4', mimeType: 'video/mp4' };
  }
  if (b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { extension: 'webm', mimeType: 'video/webm' };
  return null;
}

/** Profile fields as stored: blanks dropped (so they clear), the phone in local form. */
function profileUpdate({ about, phone, email, website, instagram }: ProfileInput) {
  const set: Record<string, string> = {};
  const unset: Record<string, 1> = {};
  const put = (field: string, value: string | undefined) => {
    if (value === undefined) return;
    if (value === '') unset[field] = 1;
    else set[field] = value;
  };
  put('about', about);
  put('contact.phone', phone && localPhone(phone));
  put('contact.email', email);
  put('contact.website', website);
  put('contact.instagram', instagram);
  return { set, unset };
}

/** One lookup for every owner on the page, so a list costs three queries, not three per event. */
async function organisersOf(events: Pick<IEvent, 'owner'>[]) {
  const owners = [...new Set(events.map((e) => e.owner.toString()))].map((id) => new Types.ObjectId(id));
  const [sellers, counts, ratings] = await Promise.all([
    SellerModel.find({ user: { $in: owners } }).select('user organisation logoKey verification.status'),
    EventModel.aggregate<{ _id: Types.ObjectId; events: number }>([{ $match: { owner: { $in: owners } } }, { $group: { _id: '$owner', events: { $sum: 1 } } }]),
    RatingModel.aggregate<{ _id: Types.ObjectId; average: number; ratings: number }>([
      { $match: { seller: { $in: owners } } },
      { $group: { _id: '$seller', average: { $avg: '$stars' }, ratings: { $sum: 1 } } },
    ]),
  ]);
  const profiles = new Map(sellers.map((x) => [x.user.toString(), x]));
  const eventCounts = new Map(counts.map((c) => [c._id.toString(), c.events]));
  const averages = new Map(ratings.map((r) => [r._id.toString(), r]));
  return (e: Pick<IEvent, 'owner' | 'organiserName'>): Organiser => {
    const owner = e.owner.toString();
    const rated = averages.get(owner);
    const profile = profiles.get(owner);
    return {
      id: owner,
      name: profile?.organisation || e.organiserName || 'Tela organiser',
      logoUrl: profile?.logoKey ? r2.publicUrl(profile.logoKey) : null,
      verified: profile?.verification?.status === 'approved',
      events: eventCounts.get(owner) ?? 0,
      rating: rated ? Math.round(rated.average * 10) / 10 : null,
      ratings: rated?.ratings ?? 0,
    };
  };
}

const toEventDto = (e: IEvent, organiser: Organiser) => ({
  id: e._id.toString(),
  code: e.code,
  title: e.title,
  description: e.description ?? null,
  venue: e.venue,
  imageUrl: e.imageKey ? r2.publicUrl(e.imageKey) : null,
  /** Photos and videos, usually from past events. */
  gallery: (e.gallery ?? []).map((m) => ({ id: m._id.toString(), kind: m.kind, url: r2.publicUrl(m.key) })),
  organiser,
  phone: e.phone ?? null,
  email: e.email ?? null,
  startsAt: e.startsAt.toISOString(),
  endsAt: e.endsAt?.toISOString() ?? null,
  /** 0 = no refunds. */
  refundDays: e.refundDays,
  sales: salesState(e),
  tiers: e.tiers.map((t) => ({
    id: t._id.toString(),
    name: t.name,
    covers: t.covers ?? null,
    price: t.price,
    /** null = no limit. */
    remaining: t.limit === null ? null : Math.max(0, t.limit - t.sold),
  })),
});

async function eventDtos(events: IEvent[]) {
  const organiser = await organisersOf(events);
  return events.map((e) => toEventDto(e, organiser(e)));
}

const eventDto = async (e: IEvent) => (await eventDtos([e]))[0]!;

/** The organiser's view; door staff only ever get the public one. */
async function toOwnerDto(e: IEvent, organiser?: Organiser) {
  const [used, staff, owner] = await Promise.all([
    TicketModel.countDocuments({ event: e._id, status: 'used' }),
    UserModel.find({ _id: { $in: e.staff } }).select('username fullName'),
    organiser ?? organisersOf([e]).then((of) => of(e)),
  ]);
  return {
    ...toEventDto(e, owner),
    salesPaused: e.salesPaused,
    adminPaused: e.adminPaused,
    tiers: e.tiers.map((t) => ({
      id: t._id.toString(),
      name: t.name,
      covers: t.covers ?? null,
      price: t.price,
      limit: t.limit,
      sold: t.sold,
      remaining: t.limit === null ? null : Math.max(0, t.limit - t.sold),
    })),
    sold: e.tiers.reduce((sum, t) => sum + t.sold, 0),
    gross: e.tiers.reduce((sum, t) => sum + t.sold * t.price, 0),
    checkedIn: used,
    staff: staff.map((u) => ({ id: u.id as string, name: publicName(u), username: u.username ?? null })),
  };
}

/** Many events at once, with one organiser lookup between them. */
async function ownerDtos(events: IEvent[]) {
  const organiser = await organisersOf(events);
  return Promise.all(events.map((e) => toOwnerDto(e, organiser(e))));
}

const toTicketDto = (t: ITicket, event?: IEvent | null, organiser?: Organiser, rating?: number | null) => ({
  id: t._id.toString(),
  /** What the QR holds. */
  code: t.code,
  /** Tickets bought together share this. */
  purchaseId: t.purchase.toString(),
  status: t.status,
  eventId: t.event.toString(),
  eventTitle: t.eventTitle,
  tierName: t.tierName,
  holderName: t.holderName,
  covers: t.covers ?? null,
  price: t.price,
  refundableUntil: t.refundableUntil?.toISOString() ?? null,
  canRefund: t.status === 'valid' && !!t.refundableUntil && t.refundableUntil > new Date(),
  scannedAt: t.scannedAt?.toISOString() ?? null,
  /** Only once it's been scanned: you rate an event you went to. */
  canRate: t.status === 'used',
  /** The buyer's stars for this event, on any of their tickets to it. */
  rating: rating ?? null,
  ...(event && {
    venue: event.venue,
    startsAt: event.startsAt.toISOString(),
    organiser: organiser?.name ?? event.organiserName ?? null,
    phone: event.phone ?? null,
    email: event.email ?? null,
  }),
});

/** Tickets with their events, organisers and the buyer's own ratings, in four queries. */
async function ticketDtos(tickets: ITicket[], buyer?: string) {
  const eventIds = [...new Set(tickets.map((t) => t.event.toString()))];
  const [events, ratings] = await Promise.all([
    EventModel.find({ _id: { $in: eventIds } }),
    buyer ? RatingModel.find({ user: buyer, event: { $in: eventIds } }).select('event stars') : [],
  ]);
  const organiser = await organisersOf(events);
  const byId = new Map(events.map((e) => [e.id as string, e]));
  const stars = new Map(ratings.map((r) => [r.event.toString(), r.stars]));
  return tickets.map((t) => {
    const event = byId.get(t.event.toString());
    return toTicketDto(t, event, event && organiser(event), stars.get(t.event.toString()));
  });
}

/** A refund window can't outlive the start of the event: nobody cancels after attending. */
function refundDeadline(event: IEvent, now: Date) {
  if (event.refundDays === 0) return null;
  const until = new Date(Math.min(now.getTime() + event.refundDays * DAY_MS, event.startsAt.getTime()));
  return until > now ? until : null;
}

/**
 * Selling needs an ID on file. A rejected BVN is erased, so that also ends the right to
 * sell, and to withdraw, until they send another.
 */
async function assertSeller(userId: string) {
  const [seller, user] = await Promise.all([SellerModel.exists({ user: userId }), UserModel.findById(userId).select('bvnLast4 ninLast4')]);
  if (!seller) throw new AppError(403, 'Opt in to selling tickets first', 'NOT_A_SELLER');
  if (!user?.bvnLast4 && !user?.ninLast4) throw unprocessable('Add your BVN or NIN to sell tickets', 'ID_REQUIRED');
}

/**
 * What a search box matches: the title, venue or organisation by any part, or the exact share
 * code. Organisations live on sellers, so they're turned into owner ids first.
 */
async function eventSearch(search: string) {
  const pattern = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const owners = await SellerModel.find({ organisation: pattern }).select('user').limit(200).lean();
  return {
    $or: [
      { title: pattern },
      { venue: pattern },
      { code: search.toUpperCase() },
      ...(owners.length ? [{ owner: { $in: owners.map((o) => o.user) } }] : []),
    ],
  };
}

/** Withdrawals wait while Tela reviews a suspended organiser: the money may need to go back to buyers. */
async function assertNotSuspended(userId: string) {
  if (await SellerModel.exists({ user: userId, 'suspension.active': true })) {
    throw new AppError(403, "Your selling account is suspended, so withdrawals are on hold while we review it.", 'SELLER_SUSPENDED');
  }
}

async function ownedEvent(userId: string, id: string) {
  const event = await EventModel.findOne({ _id: id, owner: userId });
  if (!event) throw notFound('Event not found');
  return event;
}

function assertOnSale(event: IEvent) {
  const state = salesState(event);
  if (state === 'ended') throw conflict('Sales for this event have ended', 'SALES_ENDED');
  if (state === 'paused') throw conflict('Sales for this event are paused', 'SALES_PAUSED');
}

/** The seller's money, split into what can leave now and what a buyer can still ask back. */
async function walletOf(userId: string) {
  const [balance, holds] = await Promise.all([
    LedgerService.balance(Accounts.ticketWallet(userId)),
    TicketModel.aggregate<{ _id: string; amount: number; tickets: number }>([
      { $match: { seller: new Types.ObjectId(userId), status: 'valid', refundableUntil: { $gt: new Date() } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$refundableUntil', timezone: 'Africa/Lagos' } },
          amount: { $sum: { $subtract: ['$price', '$sellingFee'] } },
          tickets: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const total = balance === 0 ? 0 : -balance;
  const held = holds.reduce((sum, h) => sum + h.amount, 0);
  return {
    balance: total,
    /** Can't be withdrawn yet: buyers can still cancel these. */
    held,
    available: Math.max(0, total - held),
    holds: holds.map((h) => ({ until: h._id, amount: h.amount, tickets: h.tickets })),
  };
}

export const TicketsService = {
  // ── Selling ───────────────────────────────────────────────────────────
  async seller(userId: string) {
    const [seller, user] = await Promise.all([SellerModel.findOne({ user: userId }), UserModel.findById(userId).select('bvnLast4 ninLast4')]);
    return {
      optedIn: Boolean(seller),
      /** Their public page is GET /api/organisers/:organiserId. */
      organiserId: userId,
      /** null for sellers from before it was asked: they set it before their next event. */
      organisation: seller?.organisation ?? null,
      logoUrl: seller?.logoKey ? r2.publicUrl(seller.logoKey) : null,
      about: seller?.about ?? null,
      contact: {
        phone: seller?.contact?.phone ?? null,
        email: seller?.contact?.email ?? null,
        website: seller?.contact?.website ?? null,
        instagram: seller?.contact?.instagram ?? null,
      },
      /** False for sellers who agreed to older terms: they accept again before their next event. */
      termsAccepted: seller?.termsVersion === SELLER_TERMS_VERSION,
      /** Their photo and ID, as compliance has judged them. Creating events needs `approved`. */
      verification: verificationDto(seller),
      suspension: suspensionDto(seller),
      termsVersion: SELLER_TERMS_VERSION,
      hasId: Boolean(user?.bvnLast4 || user?.ninLast4),
      idOnFile: user?.bvnLast4 ? 'bvn' : user?.ninLast4 ? 'nin' : null,
      ...(seller && { wallet: await walletOf(userId), bankAccount: seller.bankAccount?.accountNumber ? seller.bankAccount : null }),
    };
  },

  async banks() {
    const hit = await redis.get(BANKS_KEY);
    if (hit) return JSON.parse(hit) as { code: string; name: string }[];
    const banks = await gateway.listBanks();
    await redis.set(BANKS_KEY, JSON.stringify(banks), 'EX', BANKS_CACHE_SECONDS);
    return banks;
  },

  async verifyBankAccount(bankCode: string, accountNumber: string) {
    const bank = (await this.banks()).find((item) => item.code === bankCode);
    if (!bank) throw unprocessable('Choose a bank from the list', 'BANK_UNSUPPORTED');
    return { bankCode, bankName: bank.name, accountNumber, accountName: await gateway.resolveAccount(bankCode, accountNumber) };
  },

  /** No PIN: this moves no money. The bank names the account, and a withdrawal to it takes the PIN. */
  async setBankAccount(userId: string, { bankCode, accountNumber }: BankAccountInput) {
    await assertSeller(userId);
    await SellerModel.updateOne({ user: userId }, { bankAccount: await this.verifyBankAccount(bankCode, accountNumber) });
    return this.seller(userId);
  },

  /** No PIN: setting up a seller profile moves no money. The bank names the account. */
  async optIn(userId: string, { organisation, bankCode, accountNumber, ...profile }: OptInInput) {
    const user = await UserModel.findById(userId).select('bvnLast4 ninLast4');
    if (!user?.bvnLast4 && !user?.ninLast4) throw unprocessable('Add your BVN or NIN to sell tickets', 'ID_REQUIRED');
    if (await SellerModel.exists({ user: userId, 'suspension.active': true })) {
      throw new AppError(403, 'Your selling account is suspended. Contact Tela support.', 'SELLER_SUSPENDED');
    }
    const bankAccount = bankCode && accountNumber ? await this.verifyBankAccount(bankCode, accountNumber) : undefined;
    const { set } = profileUpdate(profile);
    await SellerModel.updateOne(
      { user: userId },
      {
        $set: { ...set, organisation, termsVersion: SELLER_TERMS_VERSION, termsAcceptedAt: new Date(), ...(bankAccount && { bankAccount }) },
        $setOnInsert: { user: userId },
      },
      { upsert: true },
    );
    return this.seller(userId);
  },

  async updateSeller(userId: string, { organisation, acceptTerms, ...profile }: UpdateSellerInput) {
    await assertSeller(userId);
    const { set, unset } = profileUpdate(profile);
    await SellerModel.updateOne(
      { user: userId },
      {
        $set: { ...set, ...(organisation && { organisation }), ...(acceptTerms && { termsVersion: acceptTerms, termsAcceptedAt: new Date() }) },
        ...(Object.keys(unset).length && { $unset: unset }),
      },
    );
    return this.seller(userId);
  },

  /** The organiser's page: who they are, how to reach them, how they've done, and what's coming up. */
  /** `viewerId` only decides `mine`, so their own page can read as theirs; what's shown is what buyers see. */
  async organiser(ownerId: string, viewerId?: string) {
    const seller = await SellerModel.findOne({ user: ownerId });
    if (!seller) throw notFound('Organiser not found');
    const now = new Date();
    const upcoming = await EventModel.find({
      owner: ownerId,
      adminPaused: false,
      salesPaused: false,
      $or: [{ endsAt: { $gt: now } }, { endsAt: null, startsAt: { $gt: now } }],
    })
      .sort({ startsAt: 1 })
      .limit(20);
    const stats = (await organisersOf([{ owner: seller.user }]))({ owner: seller.user });
    return {
      ...stats,
      mine: viewerId === ownerId,
      about: seller.about ?? null,
      contact: {
        phone: seller.contact?.phone ?? null,
        email: seller.contact?.email ?? null,
        website: seller.contact?.website ?? null,
        instagram: seller.contact?.instagram ?? null,
      },
      since: seller.createdAt.toISOString(),
      upcoming: upcoming.map((e) => toEventDto(e, stats)),
    };
  },

  /** Shown beside their name on every event. Replacing it removes the old file. */
  async setLogo(userId: string, buffer: Buffer) {
    await assertSeller(userId);
    const image = sniffImage(buffer);
    if (!image) throw unprocessable('Use a JPEG, PNG or WebP image', 'PHOTO_INVALID');
    const { key } = await r2.uploadFile(buffer, image.extension, image.mimeType, `sellers/${userId}`);
    const previous = await SellerModel.findOneAndUpdate({ user: userId }, { logoKey: key });
    if (previous?.logoKey) await AvatarsService.purge(previous.logoKey);
    return this.seller(userId);
  },

  /** What a ticket at this price costs each side today, from the charge rules. */
  async fees(price: number) {
    const [{ fee: serviceCharge }, { fee: sellingFee }] = await Promise.all([
      ChargesService.compute({ scope: 'ticket' }, price),
      ChargesService.compute({ scope: 'ticket_sale' }, price),
    ]);
    const kept = Math.min(sellingFee, price);
    return { price, serviceCharge, buyerPays: price + serviceCharge, sellingFee: kept, youReceive: price - kept };
  },

  async createEvent(userId: string, input: CreateEventInput) {
    await assertSeller(userId);
    const profile = await SellerModel.findOne({ user: userId }).select('organisation termsVersion verification suspension');
    // Buyers see the organisation, never the person, so there has to be one.
    if (!profile?.organisation) throw unprocessable('Add your organisation name before creating an event', 'ORGANISATION_REQUIRED');
    if (profile.termsVersion !== SELLER_TERMS_VERSION) throw unprocessable('Accept the latest selling terms before creating an event', 'TERMS_REQUIRED');
    const blocked = sellingBlock(profile);
    if (blocked) throw blocked.statusCode === 403 ? new AppError(403, blocked.message, 'SELLER_SUSPENDED') : blocked;
    const { phone, ...details } = input;
    const event = await EventModel.create({
      ...details,
      owner: userId,
      phone: localPhone(phone),
      code: newCode(4),
    });
    return toOwnerDto(event);
  },

  async myEvents(userId: string) {
    const [owned, staffed] = await Promise.all([
      EventModel.find({ owner: userId }).sort({ startsAt: -1 }).limit(100),
      EventModel.find({ staff: userId }).sort({ startsAt: -1 }).limit(100),
    ]);
    return { owned: await ownerDtos(owned), staffed: await eventDtos(staffed) };
  },

  async ownerEvent(userId: string, id: string) {
    return toOwnerDto(await ownedEvent(userId, id));
  },

  async updateEvent(userId: string, id: string, { salesPaused, limits }: UpdateEventInput) {
    const event = await ownedEvent(userId, id);
    if (salesPaused !== undefined) event.salesPaused = salesPaused;
    for (const { tierId, limit } of limits ?? []) {
      const tier = event.tiers.id(tierId);
      if (!tier) throw notFound('Ticket type not found');
      if (limit !== null && limit < tier.sold) throw unprocessable(`${tier.sold} ${tier.name} tickets are already sold`, 'LIMIT_BELOW_SOLD');
      tier.limit = limit;
    }
    await event.save();
    return toOwnerDto(event);
  },

  /** Photos and videos for the event page. Videos are checked by their bytes, like images. */
  async addMedia(userId: string, id: string, buffer: Buffer) {
    const event = await ownedEvent(userId, id);
    if (event.gallery.length >= GALLERY_MAX) throw unprocessable(`An event can show up to ${GALLERY_MAX} photos and videos`, 'GALLERY_FULL');
    const image = sniffImage(buffer);
    const video = image ? null : sniffVideo(buffer);
    const file = image ?? video;
    if (!file) throw unprocessable('Use a JPEG, PNG or WebP photo, or an MP4 or MOV video', 'MEDIA_INVALID');
    if (image && buffer.length > AVATAR_MAX_BYTES) throw unprocessable('Use a photo under 5MB', 'PHOTO_TOO_LARGE');
    const { key } = await r2.uploadFile(buffer, file.extension, file.mimeType, `events/${id}/gallery`);
    // Pushed with a size guard, so two uploads at once can't go over the limit.
    const added = await EventModel.updateOne(
      { _id: event._id, [`gallery.${GALLERY_MAX - 1}`]: { $exists: false } },
      { $push: { gallery: { kind: image ? 'image' : 'video', key } } },
    );
    if (added.modifiedCount === 0) {
      await AvatarsService.purge(key);
      throw unprocessable(`An event can show up to ${GALLERY_MAX} photos and videos`, 'GALLERY_FULL');
    }
    return toOwnerDto((await EventModel.findById(id))!);
  },

  async removeMedia(userId: string, id: string, mediaId: string) {
    const event = await ownedEvent(userId, id);
    const media = event.gallery.id(mediaId);
    if (!media) throw notFound('Photo or video not found');
    await event.updateOne({ $pull: { gallery: { _id: media._id } } });
    await AvatarsService.purge(media.key);
    return toOwnerDto((await EventModel.findById(id))!);
  },

  /** Who bought what, newest first, one row per purchase: the organiser's view of the door list filling up. */
  async sales(userId: string, id: string) {
    const event = await ownedEvent(userId, id);
    const rows = await TicketModel.aggregate<{
      _id: Types.ObjectId;
      buyer: Types.ObjectId;
      tierName: string;
      quantity: number;
      amount: number;
      used: number;
      refunded: number;
      at: Date;
    }>([
      { $match: { event: event._id } },
      {
        $group: {
          _id: '$purchase',
          buyer: { $first: '$buyer' },
          tierName: { $first: '$tierName' },
          quantity: { $sum: 1 },
          amount: { $sum: '$price' },
          used: { $sum: { $cond: [{ $eq: ['$status', 'used'] }, 1, 0] } },
          refunded: { $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0] } },
          at: { $min: '$createdAt' },
        },
      },
      { $sort: { at: -1 } },
      { $limit: 200 },
    ]);
    const buyers = await UserModel.find({ _id: { $in: rows.map((r) => r.buyer) } }).select('username fullName');
    const names = new Map(buyers.map((u) => [u.id as string, publicName(u)]));
    return {
      purchases: rows.map((r) => ({
        id: r._id.toString(),
        buyer: names.get(r.buyer.toString()) ?? 'Tela user',
        tierName: r.tierName,
        quantity: r.quantity,
        /** Kobo, at ticket price: what the buyer paid for the tickets, before charges. */
        amount: r.amount,
        checkedIn: r.used,
        refunded: r.refunded,
        at: r.at.toISOString(),
      })),
      byTier: event.tiers.map((t) => ({ id: t._id.toString(), name: t.name, sold: t.sold, limit: t.limit, gross: t.sold * t.price })),
    };
  },

  async addStaff(userId: string, id: string, username: string) {
    const event = await ownedEvent(userId, id);
    const staff = await UserModel.findOne({ username: username.replace(/^@/, '').toLowerCase(), status: 'active' }).select('_id');
    if (!staff) throw notFound(`There's no Tela user @${username.replace(/^@/, '')}`);
    await event.updateOne({ $addToSet: { staff: staff._id } });
    return toOwnerDto((await EventModel.findById(id))!);
  },

  async removeStaff(userId: string, id: string, staffId: string) {
    const event = await ownedEvent(userId, id);
    await event.updateOne({ $pull: { staff: staffId } });
    return toOwnerDto((await EventModel.findById(id))!);
  },

  /** Pulls an event's sales. The organiser can't turn this one back on. */
  /** The poster. Replacing one removes the old file. */
  async setEventImage(userId: string, id: string, buffer: Buffer) {
    const event = await ownedEvent(userId, id);
    const image = sniffImage(buffer);
    if (!image) throw unprocessable('Use a JPEG, PNG or WebP image', 'PHOTO_INVALID');
    const { key } = await r2.uploadFile(buffer, image.extension, image.mimeType, `events/${id}`);
    const previous = event.imageKey;
    event.imageKey = key;
    await event.save();
    if (previous) await AvatarsService.purge(previous);
    return toOwnerDto(event);
  },

  async adminPause(id: string, paused: boolean) {
    const current = await EventModel.findById(id).select('owner');
    if (!current) throw notFound('Event not found');
    if (!paused && (await SellerModel.exists({ user: current.owner, 'suspension.active': true }))) {
      throw conflict("This organiser is suspended. Lift the suspension to start their sales again.", 'SELLER_SUSPENDED');
    }
    // A hand-made decision replaces the suspension's: lifting it later leaves this one alone.
    const event = await EventModel.findByIdAndUpdate(id, { adminPaused: paused, $unset: { pausedBySuspension: 1 } }, { new: true });
    return toOwnerDto(event!);
  },

  /** Newest first, a page at a time. `sales` filters on what buyers see now; `owner` is one organiser's events. */
  async adminEvents(q: { search?: string; sales?: 'on_sale' | 'paused' | 'ended' | 'tela_paused'; owner?: string; page: number; limit: number }) {
    const now = new Date();
    const live = { $or: [{ endsAt: { $gt: now } }, { endsAt: null, startsAt: { $gt: now } }] };
    const over = { $or: [{ endsAt: { $lte: now } }, { endsAt: null, startsAt: { $lte: now } }] };
    const filter: Record<string, unknown> = {
      ...(q.owner && { owner: q.owner }),
      ...(q.sales === 'tela_paused' && { adminPaused: true }),
      ...(q.sales === 'paused' && { ...live, $and: [{ $or: [{ salesPaused: true }, { adminPaused: true }] }] }),
      ...(q.sales === 'on_sale' && { ...live, salesPaused: false, adminPaused: false }),
      ...(q.sales === 'ended' && over),
    };
    if (q.search) filter.$and = [...((filter.$and as unknown[]) ?? []), await eventSearch(q.search)];
    const [items, total] = await Promise.all([
      EventModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
      EventModel.countDocuments(filter),
    ]);
    return paginate(await ownerDtos(items), total, q.page, q.limit);
  },

  // ── Payouts to a bank ─────────────────────────────────────────────────
  /** Priced like every debit. The account is copied into the quote, so changing it afterwards can't redirect this one. */
  async quotePayout(userId: string, { amount }: TicketPayoutQuoteInput) {
    await assertSeller(userId);
    await assertNotSuspended(userId);
    const seller = await SellerModel.findOne({ user: userId }).select('bankAccount');
    const bank = seller?.bankAccount;
    if (!bank?.accountNumber) throw unprocessable('Add the bank account to pay your sales into first', 'BANK_ACCOUNT_REQUIRED');
    const { charges, fee } = await ChargesService.compute({ scope: 'ticket_payout' }, amount);
    const { available } = await walletOf(userId);
    if (amount + fee > available) {
      throw new AppError(422, `You can withdraw up to ${formatNaira(Math.max(0, available - fee))} right now`, 'TICKET_FUNDS_ON_HOLD', {
        available: String(Math.max(0, available - fee)),
      });
    }
    const quote = await QuotesService.create(userId, {
      kind: 'ticket_payout',
      amount,
      charges,
      fee,
      ticketPayout: { bankCode: bank.bankCode, bankName: bank.bankName, accountNumber: bank.accountNumber, accountName: bank.accountName },
    });
    return toQuoteDto(quote);
  },

  /**
   * Out of the ticket wallet and into `payouts:in_flight` first, then to SaySwitch. The money
   * only leaves the books on a confirmed success, and only an explicit failure puts it back.
   */
  async payout(userId: string, quoteId: string, pin: string) {
    const existing = await TransactionModel.findOne({ quote: quoteId, user: userId });
    if (existing) return toTransactionDto(existing);
    await PinService.verify(userId, pin);
    await assertSeller(userId);
    await assertNotSuspended(userId);
    const tx = await inTransaction(async (session) => {
      const quote = await QuotesService.consume(quoteId, userId, 'ticket_payout', session);
      // Bumped first, so a second withdrawal racing this one waits for it.
      await SellerModel.updateOne({ user: userId }, { $inc: { withdrawals: 1 } }, { session });
      const balance = -(await LedgerService.balance(Accounts.ticketWallet(userId), session));
      const { held } = await walletOf(userId);
      const available = balance - held;
      if (quote.total > available) {
        throw new AppError(422, `You can withdraw ${formatNaira(Math.max(0, available - quote.fee))} right now`, 'TICKET_FUNDS_ON_HOLD', {
          available: String(Math.max(0, available - quote.fee)),
        });
      }
      const reference = newReference('ticket_payout');
      const now = new Date();
      const [created] = await TransactionModel.create(
        [
          {
            reference,
            user: userId,
            kind: 'ticket_payout',
            direction: 'debit',
            status: 'pending',
            amount: quote.amount,
            fee: quote.fee,
            total: quote.total,
            charges: quote.charges,
            quote: quote._id,
            payout: quote.ticketPayout,
            narration: `${quote.ticketPayout!.bankName} · ${quote.ticketPayout!.accountNumber}`,
            events: [{ type: 'created', at: now }],
          },
        ],
        { session },
      );
      await LedgerService.post(
        {
          key: `ticket-payout:${reference}`,
          memo: `Ticket sales to bank ${reference}`,
          transactionId: created!._id,
          lines: [
            { account: Accounts.ticketWallet(userId), amount: quote.total },
            { account: Accounts.payoutsInFlight, amount: -quote.amount },
            { account: Accounts.charges('ticket_payout'), amount: -quote.fee },
          ],
        },
        session,
      );
      return created!;
    });
    return toTransactionDto(await this.sendPayout(tx));
  },

  /** Claims the send by compare-and-set, so a crash-retry or the sweep can never send it twice. */
  async sendPayout(tx: TransactionDoc) {
    const claimed = await TransactionModel.findOneAndUpdate(
      { _id: tx._id, status: 'pending', 'providerData.sentAt': { $exists: false } },
      { 'providerData.sentAt': new Date(), $push: { events: { type: 'payout_sent', at: new Date(), note: tx.reference } } },
      { new: true },
    );
    if (!claimed) return (await TransactionModel.findById(tx._id))!;
    const result = await gateway.payout({
      reference: claimed.reference,
      amount: claimed.amount,
      ...claimed.payout!,
      narration: claimed.kind === 'group_payout' ? `Tela · ${claimed.group?.name ?? 'group dues'}` : 'Tela ticket sales',
    });
    return this.applyPayoutResult(claimed._id, result, 'send');
  },

  /** The single place a payout's outcome is decided: once, by compare-and-set, with its ledger posting. */
  async applyPayoutResult(txId: Types.ObjectId | string, result: PayoutResult, source: 'send' | 'requery' | 'webhook' | 'admin', attempt = 0): Promise<TransactionDoc> {
    const current = await TransactionModel.findById(txId);
    if (!current) throw notFound('Transaction not found');
    if (current.status !== 'pending') {
      // Paid out before SaySwitch said what it charged: book the fee now that it has, once.
      if (current.status === 'success' && current.providerData?.cost === undefined && result.providerFee !== undefined) {
        await this.bookLatePayoutFee(current, result.providerFee);
        return (await TransactionModel.findById(txId))!;
      }
      return current;
    }

    let outcome = result.outcome;
    if (outcome === 'not_found') {
      const sentAt = current.providerData?.sentAt?.getTime();
      outcome = sentAt === undefined || Date.now() - sentAt > PAYOUT_NOT_FOUND_GRACE_MS ? 'failed' : 'unknown';
    }
    const note = `${source}: ${result.message ?? outcome}`;

    if (outcome === 'success') {
      const fee = result.providerFee ?? current.providerData?.fee;
      const done = await inTransaction(async (session) => {
        const t = await TransactionModel.findOneAndUpdate(
          { _id: txId, status: 'pending' },
          {
            status: 'success',
            needsReview: false,
            completedAt: new Date(),
            // Set only when SaySwitch said: a missing fee is counted as unreported in the P&L.
            ...(fee !== undefined && { 'providerData.cost': fee }),
            $push: { events: { type: 'paid_out', at: new Date(), note } },
          },
          { new: true, session },
        );
        if (!t) return null;
        // SaySwitch takes its fee from our wallet on top of the amount; the recipient gets it all.
        const providerFee = fee ?? 0;
        await LedgerService.post(
          {
            key: `${payoutKey(t)}:settle`,
            memo: `Payout ${t.reference} sent`,
            transactionId: t._id,
            lines: [
              { account: Accounts.payoutsInFlight, amount: t.amount },
              { account: Accounts.collections, amount: -(t.amount + providerFee) },
              { account: Accounts.providerFees('payout'), amount: providerFee },
            ],
          },
          session,
        );
        return t;
      });
      return done ?? (await TransactionModel.findById(txId))!;
    }

    if (outcome === 'failed') {
      const done = await inTransaction(async (session) => {
        const t = await TransactionModel.findOneAndUpdate(
          { _id: txId, status: 'pending' },
          { status: 'failed', needsReview: false, completedAt: new Date(), $push: { events: { type: 'failed', at: new Date(), note } } },
          { new: true, session },
        );
        if (!t) return null;
        // Exactly what the request took, back where it came from, fee included.
        await LedgerService.post(
          {
            key: `${payoutKey(t)}:refund`,
            memo: `Payout ${t.reference} failed — returned`,
            transactionId: t._id,
            lines: [
              { account: payoutSource(t), amount: -t.total },
              { account: Accounts.payoutsInFlight, amount: t.amount },
              { account: Accounts.charges(t.kind as PayoutKind), amount: t.fee },
            ],
          },
          session,
        );
        return t;
      });
      return done ?? (await TransactionModel.findById(txId))!;
    }

    // pending / unknown: held in flight until SaySwitch gives a final answer or staff do. Its fee
    // comes back as soon as the payout is logged, so keep it for when it settles.
    const quotedFee = result.providerFee !== undefined ? { 'providerData.fee': result.providerFee } : {};
    if (source === 'webhook') {
      await TransactionModel.updateOne({ _id: txId }, { ...quotedFee, $push: { events: { type: 'awaiting_provider', at: new Date(), note } } });
      return (await TransactionModel.findById(txId))!;
    }
    const next = PAYOUT_REQUERY_DELAYS_MS[attempt];
    const exhausted = next === undefined;
    const t = await TransactionModel.findByIdAndUpdate(
      txId,
      { ...quotedFee, ...(exhausted && { needsReview: true }), $push: { events: { type: exhausted ? 'needs_review' : 'awaiting_provider', at: new Date(), note } } },
      { new: true },
    );
    if (!exhausted) {
      await getQueue(TICKETS_QUEUE).add(
        'payout.requery',
        { transactionId: String(txId), attempt: attempt + 1 },
        { delay: next, jobId: `payout-requery-${String(txId)}-${attempt + 1}`, attempts: 1 },
      );
    }
    return t!;
  },

  /** SaySwitch's fee on a payout it confirmed without one. Compare-and-set on the fee, so it's booked once. */
  async bookLatePayoutFee(tx: TransactionDoc, fee: number) {
    await inTransaction(async (session) => {
      const claimed = await TransactionModel.findOneAndUpdate(
        { _id: tx._id, status: 'success', 'providerData.cost': { $exists: false } },
        { 'providerData.cost': fee, $push: { events: { type: 'provider_fee', at: new Date(), note: String(fee) } } },
        { session },
      );
      if (!claimed || fee === 0) return;
      await LedgerService.post(
        {
          key: `${payoutKey(tx)}:fee`,
          memo: `SaySwitch fee on payout ${tx.reference}`,
          transactionId: tx._id,
          lines: [
            { account: Accounts.collections, amount: -fee },
            { account: Accounts.providerFees('payout'), amount: fee },
          ],
        },
        session,
      );
    });
  },

  async requeryPayout(transactionId: string, attempt: number, source: 'requery' | 'webhook' = 'requery') {
    const tx = await TransactionModel.findById(transactionId);
    if (!tx || !(PAYOUT_KINDS as readonly string[]).includes(tx.kind) || tx.status !== 'pending') return tx;
    // Taken from the wallet but never sent (crash in between): send it now.
    if (!tx.providerData?.sentAt) return this.sendPayout(tx);
    return this.applyPayoutResult(tx._id, await gateway.payoutStatus(tx.reference), source, attempt);
  },

  /** Safety net for a process that died mid-payout, or a requery schedule that got lost. */
  async sweepPayouts() {
    const now = Date.now();
    const unsent = await TransactionModel.find({
      kind: { $in: PAYOUT_KINDS },
      status: 'pending',
      'providerData.sentAt': { $exists: false },
      createdAt: { $lt: new Date(now - 2 * 60_000) },
    }).limit(100);
    for (const t of unsent) await this.sendPayout(t).catch((err) => console.error(`[tickets] resend payout ${t.reference}`, err));

    const scheduleMs = PAYOUT_REQUERY_DELAYS_MS.reduce((sum, d) => sum + d, 0) + 30 * 60_000;
    const orphaned = await TransactionModel.find({
      kind: { $in: PAYOUT_KINDS },
      status: 'pending',
      needsReview: false,
      'providerData.sentAt': { $lt: new Date(now - scheduleMs) },
    })
      .select('_id reference')
      .limit(100);
    for (const t of orphaned) {
      await this.requeryPayout(t.id, PAYOUT_REQUERY_DELAYS_MS.length).catch((err) => console.error(`[tickets] requery payout ${t.reference}`, err));
    }
  },

  /** A payout webhook only says which payout changed; SaySwitch's own record says what happened. */
  async onPayoutUpdate(reference: string, fee?: number) {
    const tx = await TransactionModel.findOne({ reference, kind: { $in: PAYOUT_KINDS } });
    if (!tx) return null;
    // Its body is signed, so its fee counts as a cost figure; the outcome still comes from SaySwitch's own record.
    if (fee !== undefined && tx.status === 'pending' && tx.providerData?.fee === undefined) {
      await TransactionModel.updateOne({ _id: tx._id, 'providerData.fee': { $exists: false } }, { 'providerData.fee': fee });
    }
    if (fee !== undefined && tx.status === 'success' && tx.providerData?.cost === undefined) await this.bookLatePayoutFee(tx, fee);
    return this.requeryPayout(tx.id, 0, 'webhook');
  },

  /** To the bill payment wallet. It can't come back: wallet money is for bills, never for a bank. */
  async withdraw(userId: string, amount: number, pin: string, idempotencyKey: string) {
    const key = `ticket-withdrawal:${userId}:${idempotencyKey}`;
    const reference = `TLW${createHash('sha256').update(key).digest('hex').slice(0, 14).toUpperCase()}`;
    const replay = () => TransactionModel.findOne({ reference, user: userId });
    const done = await replay();
    if (done) return toTransactionDto(done);

    await PinService.verify(userId, pin);
    await assertSeller(userId);
    await assertNotSuspended(userId);
    try {
      const tx = await inTransaction(async (session) => {
        await SellerModel.updateOne({ user: userId }, { $inc: { withdrawals: 1 } }, { session });
        const balance = -(await LedgerService.balance(Accounts.ticketWallet(userId), session));
        const { held } = await walletOf(userId);
        const available = balance - held;
        if (amount > available) {
          throw new AppError(422, `You can withdraw ${formatNaira(Math.max(0, available))} right now`, 'TICKET_FUNDS_ON_HOLD', { available: String(Math.max(0, available)) });
        }
        const [created] = await TransactionModel.create(
          [
            {
              reference,
              user: userId,
              kind: 'ticket_withdrawal',
              direction: 'credit',
              status: 'success',
              amount,
              fee: 0,
              total: amount,
              completedAt: new Date(),
              events: [{ type: 'success', at: new Date() }],
            },
          ],
          { session },
        );
        await LedgerService.post(
          {
            key,
            memo: `Ticket sales withdrawn ${reference}`,
            transactionId: created!._id,
            lines: [
              { account: Accounts.ticketWallet(userId), amount },
              { account: Accounts.wallet(userId), amount: -amount },
            ],
          },
          session,
        );
        return created!;
      });
      return toTransactionDto(tx);
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      return toTransactionDto((await replay())!);
    }
  },

  // ── Buying ────────────────────────────────────────────────────────────
  async listEvents(search?: string) {
    const now = new Date();
    const events = await EventModel.find({
      adminPaused: false,
      salesPaused: false,
      $or: [{ endsAt: { $gt: now } }, { endsAt: null, startsAt: { $gt: now } }],
      // A code from a share message finds its event too.
      ...(search && { $and: [await eventSearch(search)] }),
    })
      .sort({ startsAt: 1 })
      .limit(50);
    return eventDtos(events);
  },

  async eventByCode(code: string) {
    const event = await EventModel.findOne({ code: code.toUpperCase() });
    if (!event) throw notFound('Event not found');
    return eventDto(event);
  },

  async event(id: string) {
    const event = await EventModel.findById(id);
    if (!event) throw notFound('Event not found');
    return eventDto(event);
  },

  /** You rate the event you went to; it counts towards its organiser's average. */
  async rate(userId: string, eventId: string, stars: number) {
    const event = await EventModel.findById(eventId);
    if (!event) throw notFound('Event not found');
    if (!(await TicketModel.exists({ event: event._id, buyer: userId, status: 'used' }))) {
      throw new AppError(403, 'Only people who were at this event can rate it', 'RATING_NOT_ALLOWED');
    }
    await RatingModel.updateOne(
      { event: event._id, user: userId },
      { $set: { stars }, $setOnInsert: { seller: event.owner } },
      { upsert: true },
    );
    return { stars, event: await eventDto(event) };
  },

  async quote(userId: string, input: TicketQuoteInput) {
    const event = await EventModel.findById(input.eventId);
    if (!event) throw notFound('Event not found');
    assertOnSale(event);
    const tier = event.tiers.id(input.tierId);
    if (!tier) throw notFound('Ticket type not found');
    if (tier.limit !== null && tier.limit - tier.sold < input.quantity) throw conflict(`Only ${Math.max(0, tier.limit - tier.sold)} left`, 'SOLD_OUT');

    const amount = tier.price * input.quantity;
    const [{ charges, fee }, { fee: sellingFee }] = await Promise.all([
      ChargesService.compute({ scope: 'ticket' }, amount),
      ChargesService.compute({ scope: 'ticket_sale' }, tier.price),
    ]);
    const quote = await QuotesService.create(userId, {
      kind: 'ticket',
      amount,
      charges,
      fee,
      ticket: {
        event: event._id,
        tier: tier._id,
        tierName: tier.name,
        eventTitle: event.title,
        quantity: input.quantity,
        unitPrice: tier.price,
        sellingFee: Math.min(sellingFee, tier.price),
      },
    });
    return toQuoteDto(quote);
  },

  async buy(userId: string, quoteId: string, pin: string, holders: string[]) {
    const existing = await TransactionModel.findOne({ quote: quoteId, user: userId });
    if (existing) return this.purchaseResult(existing._id, toTransactionDto(existing));
    await PinService.verify(userId, pin);

    const tx = await inTransaction(async (session) => {
      const quote = await QuotesService.consume(quoteId, userId, 'ticket', session);
      const q = quote.ticket!;
      const event = await EventModel.findById(q.event).session(session);
      if (!event) throw notFound('Event not found');
      assertOnSale(event);
      const tier = event.tiers.id(q.tier);
      if (!tier) throw notFound('Ticket type not found');
      // Thrown before anything is claimed, so the quote stays usable once they add the names.
      if (holders.length !== q.quantity) throw unprocessable('Enter a name for each ticket', 'HOLDER_NAMES_REQUIRED');

      // The tier's own document update is what stops the last ticket selling twice.
      const claimed = await EventModel.updateOne(
        { _id: event._id, tiers: { $elemMatch: { _id: tier._id, ...(tier.limit !== null && { sold: { $lte: tier.limit - q.quantity } }) } } },
        { $inc: { 'tiers.$.sold': q.quantity } },
        { session },
      );
      if (claimed.modifiedCount === 0) throw conflict('Those tickets just sold out', 'SOLD_OUT');

      const now = new Date();
      const reference = newReference('ticket');
      const [created] = await TransactionModel.create(
        [
          {
            reference,
            user: userId,
            kind: 'ticket_purchase',
            direction: 'debit',
            status: 'success',
            amount: quote.amount,
            fee: quote.fee,
            total: quote.total,
            charges: quote.charges,
            quote: quote._id,
            narration: `${q.quantity} × ${q.tierName} · ${q.eventTitle}`,
            completedAt: now,
            events: [{ type: 'success', at: now }],
          },
        ],
        { session },
      );
      const refundableUntil = refundDeadline(event, now);
      await TicketModel.insertMany(
        Array.from({ length: q.quantity }, (_, index) => ({
          event: event._id,
          tier: tier._id,
          tierName: q.tierName,
          ...(tier.covers && { covers: tier.covers }),
          eventTitle: q.eventTitle,
          buyer: userId,
          holderName: holders[index],
          seller: event.owner,
          code: `TK${newCode(8)}`,
          price: q.unitPrice,
          sellingFee: q.sellingFee,
          refundableUntil,
          purchase: created!._id,
        })),
        { session, ordered: true },
      );
      const sellingFees = q.sellingFee * q.quantity;
      await LedgerService.post(
        {
          key: `ticket:${reference}`,
          memo: `Tickets ${reference}`,
          transactionId: created!._id,
          lines: [
            { account: Accounts.wallet(userId), amount: quote.total },
            { account: Accounts.ticketWallet(event.owner), amount: -(quote.amount - sellingFees) },
            { account: Accounts.charges('ticket'), amount: -quote.fee },
            { account: Accounts.charges('ticket_sale'), amount: -sellingFees },
          ],
        },
        session,
      );
      return created!;
    });
    return this.purchaseResult(tx._id, toTransactionDto(tx));
  },

  async purchaseResult(purchase: Types.ObjectId, transaction: ReturnType<typeof toTransactionDto>) {
    const tickets = await TicketModel.find({ purchase }).sort({ createdAt: 1 });
    return { transaction, tickets: await ticketDtos(tickets) };
  },

  async myTickets(userId: string) {
    const tickets = await TicketModel.find({ buyer: userId }).sort({ createdAt: -1 }).limit(200);
    return ticketDtos(tickets, userId);
  },

  async ticket(userId: string, id: string) {
    const ticket = await TicketModel.findOne({ _id: id, buyer: userId });
    if (!ticket) throw notFound('Ticket not found');
    return (await ticketDtos([ticket], userId))[0]!;
  },

  /** The seller agreed to this when they set a refund window, so there's nothing to approve. */
  async refund(userId: string, id: string) {
    const now = new Date();
    const result = await inTransaction(async (session) => {
      const ticket = await TicketModel.findOneAndUpdate(
        { _id: id, buyer: userId, status: 'valid', refundableUntil: { $gt: now } },
        { status: 'refunded', refundedAt: now },
        { session, new: true },
      );
      if (!ticket) {
        const seen = await TicketModel.findOne({ _id: id, buyer: userId }).session(session);
        if (!seen) throw notFound('Ticket not found');
        throw conflict(
          seen.status === 'refunded' ? 'This ticket has already been refunded' : seen.status === 'used' ? 'This ticket has been used' : 'The refund window for this ticket has closed',
          'REFUND_CLOSED',
        );
      }
      await EventModel.updateOne({ _id: ticket.event, 'tiers._id': ticket.tier }, { $inc: { 'tiers.$.sold': -1 } }, { session });
      const reference = newReference('ticket_refund');
      const [created] = await TransactionModel.create(
        [
          {
            reference,
            user: userId,
            kind: 'ticket_refund',
            direction: 'credit',
            status: 'success',
            amount: ticket.price,
            fee: 0,
            total: ticket.price,
            narration: `${ticket.tierName} · ${ticket.eventTitle}`,
            completedAt: now,
            events: [{ type: 'success', at: now }],
          },
        ],
        { session },
      );
      await LedgerService.post(
        {
          key: `ticket-refund:${ticket._id.toString()}`,
          memo: `Ticket refund ${reference}`,
          transactionId: created!._id,
          lines: [
            { account: Accounts.ticketWallet(ticket.seller), amount: ticket.price - ticket.sellingFee },
            { account: Accounts.charges('ticket_sale'), amount: ticket.sellingFee },
            { account: Accounts.wallet(userId), amount: -ticket.price },
          ],
        },
        session,
      );
      return ticket;
    });
    return (await ticketDtos([result], userId))[0]!;
  },

  // ── At the door ───────────────────────────────────────────────────────
  async scan(userId: string, eventId: string, code: string) {
    const event = await EventModel.findOne({ _id: eventId, $or: [{ owner: userId }, { staff: userId }] });
    if (!event) throw notFound('Event not found');
    const now = new Date();
    const ticket = await TicketModel.findOneAndUpdate(
      { event: event._id, code: code.toUpperCase(), status: 'valid' },
      { status: 'used', scannedAt: now, scannedBy: userId },
      { new: true },
    );
    if (!ticket) {
      const seen = await TicketModel.findOne({ event: event._id, code: code.toUpperCase() });
      if (!seen) throw new AppError(404, 'This ticket is not for this event', 'TICKET_NOT_FOR_EVENT');
      if (seen.status === 'used') {
        throw new AppError(409, 'This ticket has already been used', 'TICKET_USED', { scannedAt: seen.scannedAt?.toISOString() ?? '' });
      }
      throw conflict('This ticket was refunded', 'TICKET_REFUNDED');
    }
    // Once the event's over, ask them how it was. One reminder per person per event, however
    // many of their tickets are scanned (the job id is the dedupe).
    const over = (event.endsAt ?? new Date(event.startsAt.getTime() + ASSUMED_EVENT_LENGTH_MS)).getTime();
    await getQueue(TICKETS_QUEUE).add(
      'rating.reminder',
      { eventId: String(event._id), userId: String(ticket.buyer) },
      {
        delay: Math.max(RATING_REMINDER_AFTER_MS, over + RATING_REMINDER_AFTER_MS - now.getTime()),
        jobId: `rating-reminder-${String(event._id)}-${String(ticket.buyer)}`,
        attempts: 1,
      },
    );
    return { ticket: (await ticketDtos([ticket]))[0]! };
  },

  /** The delayed reminder: only for someone who was there and hasn't rated it meanwhile. */
  async remindToRate(eventId: string, userId: string) {
    const [event, rated, attended] = await Promise.all([
      EventModel.findById(eventId),
      RatingModel.exists({ event: eventId, user: userId }),
      TicketModel.exists({ event: eventId, buyer: userId, status: 'used' }),
    ]);
    if (!event || rated || !attended) return;
    const organiser = (await organisersOf([{ owner: event.owner }]))({ owner: event.owner });
    bus.emit('event.rateReminder', { userId, eventId, title: event.title, organiser: organiser.name });
  },
};

