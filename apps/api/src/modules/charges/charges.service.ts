import type { Types } from 'mongoose';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { isDuplicateKey } from '../../lib/db';
import { computeCharges, maxAmountWithin, type ChargeTarget, type RuleShape } from './charges.calc';
import { DEFAULT_CHARGE_RULES } from './charges.defaults';
import type { ChargeRuleInput, ChargeRuleUpdate } from './charges.schema';
import { ChargeRuleModel, type IChargeRule } from './models/charge-rule.model';

// Every quote reads the rules; a short in-process cache keeps that off Mongo. Admin
// edits clear it here; other instances pick the change up within CACHE_MS. Quotes
// already issued keep the charges they were priced with.
const CACHE_MS = 30_000;
let cached: { at: number; rules: RuleShape[] } | null = null;

async function rules(): Promise<RuleShape[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rules;
  const docs = await ChargeRuleModel.find().lean();
  cached = { at: Date.now(), rules: docs };
  return docs;
}

const toDto = (r: IChargeRule) => ({
  id: r._id.toString(),
  scope: r.scope,
  serviceId: r.serviceId,
  provider: r.provider,
  code: r.code,
  label: r.label,
  rateBps: r.rateBps,
  fixed: r.fixed,
  min: r.min,
  max: r.max,
  active: r.active,
  updatedAt: r.updatedAt.toISOString(),
});

export const ChargesService = {
  async compute(target: ChargeTarget, amount: number) {
    return computeCharges(await rules(), target, amount);
  },

  async maxAmountWithin(target: ChargeTarget, total: number) {
    return maxAmountWithin(await rules(), target, total);
  },

  async list() {
    const docs = await ChargeRuleModel.find().sort({ scope: 1, serviceId: 1, provider: 1, code: 1 });
    return docs.map(toDto);
  },

  async create(input: ChargeRuleInput, adminId: string) {
    try {
      const doc = await ChargeRuleModel.create({ ...input, updatedBy: adminId });
      cached = null;
      return toDto(doc);
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('A rule for this scope, service, provider and code already exists', 'DUPLICATE_RULE');
      throw err;
    }
  },

  async update(id: string, changes: ChargeRuleUpdate, adminId: string) {
    const doc = await ChargeRuleModel.findById(id);
    if (!doc) throw notFound('Charge rule not found');
    Object.assign(doc, changes, { updatedBy: adminId as unknown as Types.ObjectId });
    if (doc.max != null && doc.max < doc.min) throw badRequest('max must be at least min');
    await doc.save();
    cached = null;
    return toDto(doc);
  },

  async remove(id: string) {
    const doc = await ChargeRuleModel.findByIdAndDelete(id);
    if (!doc) throw notFound('Charge rule not found');
    cached = null;
  },

  async ensureDefaults() {
    const scopes = new Set<string>(await ChargeRuleModel.distinct('scope'));
    // By scope, so a new kind of charge reaches a live database without undoing an admin's edits.
    const missing = DEFAULT_CHARGE_RULES.filter((rule) => !scopes.has(rule.scope));
    if (missing.length) await ChargeRuleModel.insertMany(missing);
    cached = null;
  },

  /** Tests only. */
  clearCache() {
    cached = null;
  },
};
