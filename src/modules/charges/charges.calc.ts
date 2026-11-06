import type { ChargeLine } from '../transactions/models/transaction.model';
import type { ChargeScope, IChargeRule } from './models/charge-rule.model';

export type RuleShape = Pick<
  IChargeRule,
  'scope' | 'serviceId' | 'provider' | 'code' | 'label' | 'rateBps' | 'fixed' | 'min' | 'max' | 'active'
>;
export type ChargeTarget = { scope: ChargeScope; serviceId?: string | null; provider?: string | null };

const specificity = (r: RuleShape) => (r.provider ? 2 : 0) + (r.serviceId ? 1 : 0);

/** Rules that apply to the target, one per code: the most specific match. */
export function selectRules(rules: RuleShape[], t: ChargeTarget): RuleShape[] {
  const provider = t.provider?.toUpperCase() ?? null;
  const best = new Map<string, RuleShape>();
  for (const r of rules) {
    if (r.scope !== t.scope) continue;
    if (r.serviceId && r.serviceId !== t.serviceId) continue;
    if (r.provider && r.provider !== provider) continue;
    // A provider rule only makes sense under a service; don't let it leak across services.
    if (r.provider && !r.serviceId && t.serviceId) continue;
    const current = best.get(r.code);
    if (!current || specificity(r) > specificity(current)) best.set(r.code, r);
  }
  return [...best.values()].filter((r) => r.active).sort((a, b) => a.code.localeCompare(b.code));
}

export function feeFor(rule: Pick<RuleShape, 'rateBps' | 'fixed' | 'min' | 'max'>, amount: number) {
  const raw = Math.round((amount * rule.rateBps) / 10_000) + rule.fixed;
  const floored = Math.max(raw, rule.min);
  return rule.max == null ? floored : Math.min(floored, rule.max);
}

export function computeCharges(rules: RuleShape[], t: ChargeTarget, amount: number) {
  const charges: ChargeLine[] = selectRules(rules, t)
    .map((r) => ({ code: r.code, label: r.label, amount: feeFor(r, amount) }))
    .filter((c) => c.amount > 0);
  return { charges, fee: charges.reduce((s, c) => s + c.amount, 0) };
}

/**
 * Largest face amount whose amount + fee fits in `total` — used when money arrives first
 * (a transfer into a beneficiary account) and we must work out what it can buy.
 */
export function maxAmountWithin(rules: RuleShape[], t: ChargeTarget, total: number) {
  let lo = 0;
  let hi = total;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (mid + computeCharges(rules, t, mid).fee <= total) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
