import type { Types } from 'mongoose';
import { AppError } from '../../lib/errors';
import { AppSettingsModel, type IAppSettings } from './models/app-settings.model';
import type { MaintenanceInput, UpdateFeaturesInput } from './config.schema';

/**
 * What can be switched off. Turning one off stops new actions of that kind: quotes and the
 * action endpoints answer FEATURE_DISABLED. It never stops money already moving: requeries,
 * refunds, webhooks and incoming transfers carry on, so nobody's money gets stuck.
 * Keys never contain dots: they're Map keys in Mongo, where a dot means a nested path.
 */
export const FEATURES = {
  funding: 'Wallet funding',
  bills: 'Bill payments',
  bill_electricity: 'Electricity',
  bill_airtime: 'Airtime & data',
  bill_tv: 'Cable TV',
  bill_internet: 'Internet',
  bill_jamb: 'Exams',
  transfers: 'Tela transfers',
  gifts: 'Gifts',
  coupons: 'Creating giveaways',
  recurring: 'Recurring bills',
  points: 'Converting points',
  tickets: 'Buying tickets',
  ticket_selling: 'Selling tickets',
  ticket_payouts: 'Ticket withdrawals to bank',
  groups: 'Groups and dues',
  group_payouts: 'Group withdrawals to bank',
  splits: 'Splitting bills',
  guest_pay: 'Paying bills on the website',
} as const;
export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as [FeatureKey, ...FeatureKey[]];

/** The switch for one bill service. Water has none: it isn't sold yet. */
export const billFeature = (serviceId: string) => (`bill_${serviceId}` in FEATURES ? (`bill_${serviceId}` as FeatureKey) : 'bills');

const DEFAULT_MAINTENANCE_MESSAGE = "We're making Tela better. We'll be back shortly.";

// Read on most requests. Admin edits clear it here; other instances catch up within CACHE_MS.
const CACHE_MS = 15_000;
let cached: { at: number; settings: IAppSettings } | null = null;

async function settings() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.settings;
  const doc = await AppSettingsModel.findByIdAndUpdate('default', {}, { upsert: true, new: true, setDefaultsOnInsert: true });
  cached = { at: Date.now(), settings: doc!.toObject() };
  return cached.settings;
}

const defaultMessage = (key: FeatureKey) => `${FEATURES[key]} ${key.startsWith('bill_') ? 'payments are' : 'is'} paused for now. Try again later.`;

function featureState(s: IAppSettings, key: FeatureKey) {
  const f = s.features.get(key);
  const enabled = f?.enabled ?? true;
  return { enabled, message: enabled ? null : f?.message || defaultMessage(key) };
}

export const ConfigService = {
  /** What the app reads at startup and every so often after: what to show, and whether to show anything at all. */
  async publicConfig() {
    const s = await settings();
    return {
      maintenance: {
        active: s.maintenance?.active ?? false,
        message: s.maintenance?.active ? s.maintenance.message || DEFAULT_MAINTENANCE_MESSAGE : null,
        until: s.maintenance?.active ? (s.maintenance.until?.toISOString() ?? null) : null,
      },
      features: Object.fromEntries(FEATURE_KEYS.map((key) => [key, featureState(s, key)])) as Record<FeatureKey, { enabled: boolean; message: string | null }>,
    };
  },

  async adminConfig() {
    const s = await settings();
    return {
      ...(await this.publicConfig()),
      labels: FEATURES,
      maintenanceStartedAt: s.maintenance?.active ? (s.maintenance.startedAt?.toISOString() ?? null) : null,
      updatedAt: s.updatedAt?.toISOString() ?? null,
    };
  },

  async isEnabled(key: FeatureKey) {
    return featureState(await settings(), key).enabled;
  },

  /** Throws FEATURE_DISABLED (503) with the message staff set, so the app can say why. */
  async assertEnabled(...keys: FeatureKey[]) {
    const s = await settings();
    for (const key of keys) {
      const state = featureState(s, key);
      if (!state.enabled) throw new AppError(503, state.message!, 'FEATURE_DISABLED', { feature: key });
    }
  },

  async maintenance() {
    const s = await settings();
    return s.maintenance?.active ? { message: s.maintenance.message || DEFAULT_MAINTENANCE_MESSAGE, until: s.maintenance.until ?? null } : null;
  },

  async updateFeatures(changes: UpdateFeaturesInput) {
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      set[`features.${key}`] = { enabled: value!.enabled, ...(value!.message && { message: value!.message }) };
    }
    await AppSettingsModel.updateOne({ _id: 'default' }, { $set: set }, { upsert: true });
    cached = null;
    return this.adminConfig();
  },

  async setMaintenance({ active, message, until }: MaintenanceInput, adminId: string | Types.ObjectId) {
    const set: Record<string, unknown> = { 'maintenance.active': active, 'maintenance.updatedBy': adminId };
    const unset: Record<string, 1> = {};
    if (active) {
      set['maintenance.startedAt'] = new Date();
      if (message) set['maintenance.message'] = message;
      else unset['maintenance.message'] = 1;
      if (until) set['maintenance.until'] = until;
      else unset['maintenance.until'] = 1;
    } else {
      Object.assign(unset, { 'maintenance.message': 1, 'maintenance.until': 1, 'maintenance.startedAt': 1 });
    }
    await AppSettingsModel.updateOne({ _id: 'default' }, { $set: set, ...(Object.keys(unset).length && { $unset: unset }) }, { upsert: true });
    cached = null;
    return this.adminConfig();
  },

  /** For tests: forget the cached document. */
  resetCache() {
    cached = null;
  },
};
