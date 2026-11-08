import { describe, expect, it } from 'vitest';
import { computeCharges, feeFor, maxAmountWithin, selectRules, type RuleShape } from './charges.calc';

const rule = (r: Partial<RuleShape>): RuleShape => ({
  scope: 'bill',
  serviceId: null,
  provider: null,
  code: 'service_charge',
  label: 'Service charge',
  rateBps: 0,
  fixed: 0,
  min: 0,
  max: null,
  active: true,
  ...r,
});

describe('feeFor', () => {
  it('adds percentage and fixed, then clamps', () => {
    expect(feeFor({ rateBps: 150, fixed: 1_000, min: 0, max: null }, 1_000_000)).toBe(16_000); // 1.5% + ₦10
    expect(feeFor({ rateBps: 150, fixed: 0, min: 5_000, max: null }, 10_000)).toBe(5_000); // floor
    expect(feeFor({ rateBps: 150, fixed: 0, min: 0, max: 200_000 }, 100_000_000)).toBe(200_000); // cap
  });

  it('rounds half-kobo to the nearest kobo', () => {
    expect(feeFor({ rateBps: 125, fixed: 0, min: 0, max: null }, 100)).toBe(1); // 1.25 → 1
    expect(feeFor({ rateBps: 150, fixed: 0, min: 0, max: null }, 100)).toBe(2); // 1.5 → 2
  });
});

describe('selectRules', () => {
  const rules = [
    rule({ fixed: 5_000 }),
    rule({ serviceId: 'electricity', fixed: 10_000 }),
    rule({ serviceId: 'electricity', provider: 'IKEDC', fixed: 7_500 }),
    rule({ serviceId: 'airtime', active: false }),
    rule({ code: 'vat', label: 'VAT', rateBps: 750, serviceId: 'electricity' }),
    rule({ scope: 'funding', fixed: 99_999 }),
  ];

  it('picks the most specific rule per code', () => {
    expect(selectRules(rules, { scope: 'bill', serviceId: 'electricity', provider: 'IKEDC' }).map((r) => r.fixed)).toEqual([7_500, 0]);
    expect(selectRules(rules, { scope: 'bill', serviceId: 'electricity', provider: 'AEDC' }).map((r) => r.fixed)).toEqual([10_000, 0]);
    expect(selectRules(rules, { scope: 'bill', serviceId: 'tv' }).map((r) => r.fixed)).toEqual([5_000]);
  });

  it('lets an inactive specific rule switch a charge off', () => {
    expect(selectRules(rules, { scope: 'bill', serviceId: 'airtime', provider: 'MTN' })).toEqual([]);
  });

  it('itemises every charge and totals them', () => {
    const { charges, fee } = computeCharges(rules, { scope: 'bill', serviceId: 'electricity', provider: 'AEDC' }, 1_000_000);
    expect(charges).toEqual([
      { code: 'service_charge', label: 'Service charge', amount: 10_000 },
      { code: 'vat', label: 'VAT', amount: 75_000 },
    ]);
    expect(fee).toBe(85_000);
  });
});

describe('maxAmountWithin', () => {
  it('finds the biggest bill that fits once charges are added', () => {
    const rules = [rule({ rateBps: 100, fixed: 10_000 })]; // 1% + ₦100
    const amount = maxAmountWithin(rules, { scope: 'bill' }, 1_020_000);
    expect(amount + computeCharges(rules, { scope: 'bill' }, amount).fee).toBeLessThanOrEqual(1_020_000);
    expect(amount + 1 + computeCharges(rules, { scope: 'bill' }, amount + 1).fee).toBeGreaterThan(1_020_000);
  });

  it('returns 0 when the money cannot cover the charge', () => {
    expect(maxAmountWithin([rule({ fixed: 10_000 })], { scope: 'bill' }, 5_000)).toBe(0);
  });
});
