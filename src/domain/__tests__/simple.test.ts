import { describe, expect, it } from 'vitest';
import { compute } from '../compute';
import type { Scenario } from '../types';

const base = (start: string): Scenario => ({
  fy: 2026,
  today: '2026-04-01',
  settings: { thirtyDayMonth: false, form12B: 'first', nextFyHike: 0 },
  next: {
    name: 'X',
    start,
    end: '',
    ctc: 1_800_000,
    structure: { basic: 60000, hra: 30000, special: 50000, others: [], epf: 1800, pt: 200, npsPct: 0, npsInGross: true },
    revisions: [],
    oneTimes: [],
    recoveries: [],
    tdsKnown: {},
  },
});

describe('single employer, full year', () => {
  const r = compute(base('2020-06-01'));
  it('spreads tax evenly and settles to zero at filing', () => {
    expect(r.nextLines).toHaveLength(12);
    const tds = r.nextLines.map((l) => l.tds);
    tds.forEach((t) => expect(t).toBeCloseTo(tds[0], 6));
    expect(Math.abs(r.filing.balance)).toBeLessThan(1);
    // 16.8L gross - 75k = 16.05L taxable -> 60k + 60k + 1k... slab tax 1,21,000; +4% cess
    expect(r.filing.taxable).toBe(1_605_000);
    expect(r.filing.total).toBeCloseTo(121_000 * 1.04, 2);
  });
  it('in-hand = gross - PF - PT - TDS', () => {
    const l = r.nextLines[0];
    expect(l.inHand).toBeCloseTo(140000 - 1800 - 200 - l.tds, 6);
  });
});

describe('joining mid-year with no earlier income', () => {
  const r = compute(base('2026-10-16'));
  it('prorates the first month by calendar days and stays under the 87A limit', () => {
    expect(r.nextLines[0].factor).toBeCloseTo(16 / 31, 6);
    expect(r.filing.total).toBe(0);
  });
});
