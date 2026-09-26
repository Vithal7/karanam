import { describe, expect, it } from 'vitest';
import { round10, slabTax, taxOn } from '../tax';

describe('new regime tax', () => {
  it('slabs', () => {
    expect(slabTax(400000)).toBe(0);
    expect(slabTax(800000)).toBe(20000);
    expect(slabTax(1200000)).toBe(60000);
    expect(slabTax(2400000)).toBe(300000);
    expect(slabTax(3030700)).toBeCloseTo(489210, 0);
  });

  it('87A rebate up to 12L', () => {
    expect(taxOn(1200000).total).toBe(0);
    expect(taxOn(1144730).total).toBe(0);
  });

  it('87A marginal relief just above 12L', () => {
    // Slab tax 61,500 but relief caps it at the 10,000 earned above 12L.
    const t = taxOn(1210000);
    expect(t.slabTax).toBe(61500);
    expect(t.total).toBeCloseTo(10400, 5);
  });

  it('no relief once slab tax is lower than the excess', () => {
    expect(taxOn(1300000).total).toBeCloseTo(75000 * 1.04, 5);
  });

  it('surcharge above 50L with marginal relief', () => {
    const at50 = taxOn(5000000).total;
    const t = taxOn(5010000);
    // Marginal relief: extra tax + surcharge limited to the extra income (before cess).
    expect(t.total).toBeLessThanOrEqual(at50 + 10000 * 1.04 + 1e-6);
    const far = taxOn(6000000);
    expect(far.surcharge).toBeCloseTo((slabTax(6000000)) * 0.1, 5);
  });

  it('round10 matches Excel MROUND', () => {
    expect(round10(1144725)).toBe(1144730);
    expect(round10(3030697.76)).toBe(3030700);
    expect(round10(3274208.2)).toBe(3274210);
  });
});
