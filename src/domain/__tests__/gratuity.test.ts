import { describe, expect, it } from 'vitest';
import { fnfItems, gratuityWages } from '../compute';
import type { Employment, Structure } from '../types';

const st = (basic: number, hra: number, special: number, others: Structure['others'] = []): Structure => ({ basic, hra, special, others, epfMode: 'statutory', epf: 0, pt: 200, npsPct: 0, npsInGross: false });
const job = (start: string, end: string, s: Structure, extra: Partial<Employment> = {}): Employment => ({
  id: 'g',
  name: 'G',
  start,
  end,
  structure: s,
  revisions: [],
  oneTimes: [],
  recoveries: [],
  ctc: 0,
  tdsKnown: {},
  form12B: 'second',
  docs: [],
  fnf: { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0 },
  ...extra,
});

describe('gratuity: 15/26 × wages × completed years', () => {
  it('5 years at basic + DA ₹30,000 = ₹86,538', () => {
    const f = fnfItems(job('2020-06-01', '2025-05-31', st(25000, 0, 0, [{ name: 'Dearness Allowance', amount: 5000 }])), 2025)!;
    expect(f.gratuityKind).toBe('gratuity');
    expect(f.gratuity).toBe(86538);
  });
  it('a part year over six months counts as a year; six months or less does not', () => {
    const over = fnfItems(job('2009-01-01', '2026-07-15', st(30000, 0, 0)), 2026)!;
    expect(over.gratuityLabel).toMatch(/× 18 years/);
    const under = fnfItems(job('2009-01-01', '2026-05-31', st(30000, 0, 0)), 2026)!;
    expect(under.gratuityLabel).toMatch(/× 17 years/);
  });
  it('capped at ₹20 lakh', () => {
    const f = fnfItems(job('1996-01-01', '2026-06-30', st(300000, 0, 0)), 2026)!;
    expect(f.gratuity).toBe(2000000);
    expect(f.gratuityLabel).toMatch(/ceiling/);
  });
});

describe('wages under the Labour Codes (from 21 Nov 2025)', () => {
  it("the ministry's example: allowances above half of all pay are added back", () => {
    // Basic + DA 20,000, allowances 40,000, gratuity part 16,000: all pay 76,000, half 38,000, 2,000 added.
    expect(gratuityWages(st(20000, 20000, 20000), '2026-01-01', 16000).wages).toBe(22000);
  });
  it('before the Codes: basic + DA only', () => {
    expect(gratuityWages(st(20000, 20000, 20000), '2025-06-30', 16000).wages).toBe(20000);
  });
  it('allowances within half of pay: basic + DA', () => {
    expect(gratuityWages(st(50000, 25000, 25000), '2026-06-30').wages).toBe(50000);
  });
});

describe('fixed-term contracts', () => {
  it('pro-rata gratuity from 1 year, without the 5-year minimum', () => {
    const e = job('2025-01-01', '2026-06-30', st(40000, 20000, 20000), { fixedTerm: true });
    const f = fnfItems(e, 2026)!;
    expect(f.gratuityKind).toBe('gratuity');
    const years = ((Date.parse('2026-06-30') - Date.parse('2025-01-01')) / 86_400_000 + 1) / 365.25;
    expect(f.gratuity).toBe(Math.round((15 / 26) * 40000 * years));
    expect(fnfItems({ ...e, fixedTerm: undefined }, 2026)!.gratuityKind).toBe('none');
  });
  it('under a year: nothing', () => {
    expect(fnfItems(job('2026-01-01', '2026-06-30', st(40000, 20000, 20000), { fixedTerm: true }), 2026)!.gratuity).toBe(0);
  });
});
