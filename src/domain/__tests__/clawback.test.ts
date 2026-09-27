import { describe, expect, it } from 'vitest';
import { clawbackFor, shareRepaid } from '../clawback';
import { fnfItems } from '../compute';
import type { Employment, OneTime, Structure } from '../types';
import { findClawbackTerms, findRelocation } from '../../extract/facts';

const st: Structure = { basic: 50000, hra: 25000, special: 25000, others: [], epfMode: 'fixed', epf: 1800, pt: 200, npsPct: 0, npsInGross: false };
const bonus = (extra: Partial<OneTime>): OneTime => ({ id: 'joining', label: 'Joining bonus', kind: 'joining', amount: 120000, month: '2025-12', taxable: true, ...extra });
const job = (end: string, oneTimes: OneTime[], fnf: Employment['fnf'] = { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0 }): Employment => ({
  id: 'j',
  name: 'Acme',
  start: '2025-12-01',
  end,
  structure: st,
  revisions: [],
  oneTimes,
  recoveries: [],
  ctc: 0,
  tdsKnown: {},
  form12B: 'first',
  docs: [],
  fnf,
});

describe('bonus clawback from the letter terms', () => {
  it('full repayment inside the period, nothing after it', () => {
    expect(clawbackFor(job('2026-08-31', [bonus({ clawbackMonths: 12 })])).amount).toBe(120000);
    expect(clawbackFor(job('2026-12-15', [bonus({ clawbackMonths: 12 })])).amount).toBe(0);
  });
  it('pro-rata for the unserved months', () => {
    // 9 months served of 12: a quarter repaid.
    const r = clawbackFor(job('2026-08-31', [bonus({ clawbackMonths: 12, clawbackBasis: 'prorata' })]));
    expect(r.amount).toBeGreaterThan(29000);
    expect(r.amount).toBeLessThan(31000);
  });
  it('tiered by years of service', () => {
    const tiers = [
      { months: 12, share: 1 },
      { months: 24, share: 0.5 },
    ];
    expect(shareRepaid({ months: 24, basis: 'tiered', tiers }, 6)).toBe(1);
    expect(shareRepaid({ months: 24, basis: 'tiered', tiers }, 18)).toBe(0.5);
    expect(shareRepaid({ months: 24, basis: 'tiered', tiers }, 30)).toBe(0);
    expect(clawbackFor(job('2027-02-28', [bonus({ clawbackBasis: 'tiered', clawbackTiers: tiers })])).amount).toBe(60000);
  });
  it('a bonus not yet paid when you leave is not repaid', () => {
    expect(clawbackFor(job('2026-02-28', [bonus({ month: '2026-03', clawbackMonths: 12 })])).amount).toBe(0);
  });
  it('the F&F uses the terms unless the slip or you give an amount', () => {
    expect(fnfItems(job('2026-08-31', [bonus({ clawbackMonths: 12 })]), 2026)!.clawback).toBe(120000);
    expect(fnfItems(job('2026-08-31', [bonus({ clawbackMonths: 12 })], { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0, clawbackManual: true }), 2026)!.clawback).toBe(0);
    expect(fnfItems(job('2026-08-31', [bonus({ clawbackMonths: 12 })], { leaveDays: 0, noticeDaysRecovered: 0, clawback: 40000 }), 2026)!.clawback).toBe(40000);
  });
});

describe('reading the terms', () => {
  it('full within a period', () => {
    expect(findClawbackTerms('A joining bonus of Rs. 1,00,000 is payable with your first salary. It is repayable in full if you leave the\ncompany within 12 months of joining.', 'joining')).toEqual({
      months: 12,
      basis: 'full',
    });
  });
  it('pro-rata', () => {
    expect(findClawbackTerms('Sign-on bonus: if you resign before completing one year, it will be recovered on a pro-rata basis.', 'joining')).toEqual({ months: 12, basis: 'prorata' });
  });
  it('tiers by years of service', () => {
    expect(
      findClawbackTerms('The joining bonus shall be recovered 100% if you leave within 12 months and 50% if you leave between 12 and 24 months of joining.', 'joining'),
    ).toEqual({
      months: 24,
      basis: 'tiered',
      tiers: [
        { months: 12, share: 1 },
        { months: 24, share: 0.5 },
      ],
    });
  });
  it('retention bonus in an increment letter, counted from payment', () => {
    expect(findClawbackTerms('You will receive a retention bonus of Rs. 2,00,000 in July. If you leave within 12 months of its payment, you will have to refund it.', 'retention')).toEqual({
      months: 12,
      basis: 'full',
      from: 'payment',
    });
  });
  it('no terms', () => {
    expect(findClawbackTerms('A joining bonus of Rs. 50,000 is paid with the first salary.', 'joining')).toBeUndefined();
  });
  it('relocation', () => {
    expect(findRelocation('Relocation: expenses up to Rs. 75,000 will be reimbursed against bills.')).toEqual({ amount: 75000, reimbursement: true });
    expect(findRelocation('A one-time relocation allowance of Rs. 50,000 will be paid.')).toEqual({ amount: 50000, reimbursement: false });
  });
});
