import { describe, expect, it } from 'vitest';
import { creditFor } from './wallet.service';

describe('creditFor', () => {
  const quoted = { amount: 1_000_000, fee: 5_000, total: 1_005_000 };

  it('credits the quoted amount on an exact payment', () => {
    expect(creditFor(quoted, 1_005_000)).toEqual({ credit: 1_000_000, fee: 5_000 });
  });

  it('credits what arrived, less the charge, on an under- or over-payment', () => {
    expect(creditFor(quoted, 1_000_000)).toEqual({ credit: 995_000, fee: 5_000 });
    expect(creditFor(quoted, 2_005_000)).toEqual({ credit: 2_000_000, fee: 5_000 });
  });

  it('never credits a negative amount', () => {
    expect(creditFor(quoted, 3_000)).toEqual({ credit: 0, fee: 3_000 });
  });
});
