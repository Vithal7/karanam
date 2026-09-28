import { describe, expect, it } from 'vitest';
import { buyoutAmount, compute, fnfItems } from '../compute';
import { structureFor } from '../schedule';
import type { Employment, Scenario, Structure } from '../types';

const st = (basic: number): Structure => ({ basic, hra: basic / 2, special: basic / 2, others: [], epfMode: 'fixed', epf: 1800, pt: 200, npsPct: 0, npsInGross: false });

const job = (id: string, start: string, end: string, basic: number, extra: Partial<Employment> = {}): Employment => ({
  id,
  name: id,
  start,
  end,
  structure: st(basic),
  revisions: [],
  oneTimes: [],
  recoveries: [],
  ctc: 0,
  tdsKnown: {},
  form12B: 'first',
  docs: [],
  ...extra,
});

describe('hike with arrears', () => {
  // Hike effective April, first paid in July: April-June difference paid as arrears in July.
  const s: Scenario = {
    fy: 2026,
    today: '2026-04-01',
    settings: { thirtyDayMonth: false, nextFyHike: 0 },
    employers: [job('S', '2024-03-01', '', 60000, { revisions: [{ from: '2026-04', payoutMonth: '2026-07', structure: st(72000) }] })],
  };
  const r = compute(s);
  const lines = r.employers[0].lines;
  it('pays the old salary until the payout month', () => {
    expect(lines[0].basic).toBe(60000);
    expect(lines[3].basic).toBe(72000);
    expect(structureFor(s.employers[0], '2026-06').basic).toBe(60000);
  });
  it('pays arrears for the months in between', () => {
    const arrears = lines[3].oneTimes.find((o) => /Arrears/.test(o.label))!;
    expect(arrears.amount).toBe(3 * (144000 - 120000));
    expect(arrears.label).toContain('Apr');
  });
});

describe('F&F options', () => {
  const base = job('S', '2025-01-01', '2026-11-13', 72960, { fnf: { leaveDays: 18, noticeDaysRecovered: 21, clawback: 50000, penalty: 10000, gratuity: 0 } });
  it('leave encashment rate choices', () => {
    expect(fnfItems(base, 2026)!.leaveEncashment).toBe(43776);
    expect(fnfItems({ ...base, fnf: { ...base.fnf!, leaveBasis: 'basic26' } }, 2026)!.leaveEncashment).toBe(Math.round((72960 / 26) * 18));
    expect(fnfItems({ ...base, fnf: { ...base.fnf!, leaveBasis: 'gross30' } }, 2026)!.leaveEncashment).toBe(Math.round((145920 / 30) * 18));
    expect(fnfItems({ ...base, fnf: { ...base.fnf!, leaveBasis: 'custom', leaveRate: 3000 } }, 2026)!.leaveEncashment).toBe(54000);
    expect(fnfItems(base, 2026)!.leaveRateLabel).toBe('basic ₹72,960 ÷ 30');
  });
  it('F&F slip amounts win over the calculation', () => {
    const f = fnfItems({ ...base, fnf: { ...base.fnf!, leaveAmount: 59000, noticeAmount: 50000 } }, 2026)!;
    expect(f.leaveEncashment).toBe(59000);
    expect(f.noticeRecovery).toBe(50000);
    expect(f.leaveFromSlip).toBe(true);
  });
  it('notice recovery on basic or gross', () => {
    expect(fnfItems(base, 2026)!.noticeRecovery).toBe(51072);
    expect(fnfItems({ ...base, fnf: { ...base.fnf!, noticeBasis: 'gross' } }, 2026)!.noticeRecovery).toBe(Math.round((145920 / 30) * 21));
  });
  it('pro-rata last month', () => {
    expect(fnfItems(base, 2026)!.lastMonthFactor).toBeCloseTo(13 / 30, 6);
  });
});

describe('moving jobs', () => {
  const S = job('S', '2019-01-01', '2026-11-13', 72960, {
    fnf: { leaveDays: 18, noticeDaysRecovered: 21, clawback: 50000, penalty: 10000, gratuity: 300000, payMonth: '2026-12' },
  });
  const A = job('A', '2026-11-14', '', 125000, { form12B: 'second', buyout: { mode: 'cap', cap: 100000, includesClawback: true } });
  const s: Scenario = { fy: 2026, today: '2026-04-01', settings: { thirtyDayMonth: true, nextFyHike: 0 }, employers: [S, A] };
  const r = compute(s);

  it('caps the buyout', () => {
    const f = fnfItems(S, 2026)!;
    expect(buyoutAmount(f, A, S)).toEqual({ amount: 100000, claimed: 51072 + 50000 });
    expect(buyoutAmount(f, { ...A, buyout: { mode: 'actuals' } }, S).amount).toBe(51072);
    expect(buyoutAmount(f, { ...A, buyout: { mode: 'none' } }, S).amount).toBe(0);
    const paid = r.employers[1].lines.flatMap((l) => l.oneTimes).find((o) => o.kind === 'buyout')!;
    expect(paid.amount).toBe(100000);
  });

  it('pays F&F in its own month, after the last salary', () => {
    const dec = r.employers[0].lines.find((l) => l.month === '2026-12')!;
    expect(dec.factor).toBe(0);
    expect(dec.oneTimes.map((o) => o.label)).toEqual(['Leave encashment', 'Gratuity']);
    expect(dec.recoveries).toBe(51072 + 50000 + 10000);
  });

  it('keeps gratuity out of taxable income', () => {
    const grossWithGratuity = r.employers.flatMap((e) => e.lines).reduce((a, l) => a + l.gross, 0);
    expect(r.filing.gross).toBeCloseTo(grossWithGratuity - 300000, 6);
  });
});

describe('payroll before it knows you are leaving', () => {
  // Earning ₹1.46L/month from Apr, leaving 1 Nov, resignation not handed in yet.
  const S = job('S', '2025-01-06', '2026-11-01', 72960, { tdsKnown: { '2026-04': 16110, '2026-05': 16110, '2026-06': 16110, '2026-07': 32220, '2026-08': 32220 } });
  const L = job('L', '2026-11-02', '', 125000, { form12B: 'second' });
  const s: Scenario = { fy: 2026, today: '2026-09-27', settings: { thirtyDayMonth: false, nextFyHike: 0 }, employers: [S, L] };
  const r = compute(s);
  const sep = r.employers[0].stage.find((x) => x.month === '2026-09')!;

  it('projects a full year and spreads tax over the months to March', () => {
    expect(sep.monthsLeft).toBe(7);
    expect(sep.projectedIncome).toBeCloseTo(12 * 145920, 0);
    expect(sep.tds).toBeGreaterThan(0);
  });

  it('switches to the actual exit once you resign', () => {
    const r2 = compute({ ...s, employers: [{ ...S, resignedOn: '2026-09-15' }, L] });
    const sep2 = r2.employers[0].stage.find((x) => x.month === '2026-09')!;
    expect(sep2.monthsLeft).toBe(3);
    expect(sep2.projectedIncome).toBeLessThan(sep.projectedIncome);
  });
});

describe('gratuity and ex gratia', () => {
  const base = job('S', '2025-01-22', '2026-11-01', 72960, { fnf: { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0, exGratia: true }, ctcParts: { gratuity: 3100 } });
  it('under 5 years, ex gratia only when your employer pays it', () => {
    const f = fnfItems({ ...base, fnf: { ...base.fnf!, exGratia: undefined } }, 2026)!;
    expect(f.gratuity).toBe(0);
    expect(f.gratuityKind).toBe('none');
  });
  it('under 5 years: ex gratia at the CTC gratuity rate, prorated, taxable', () => {
    const f = fnfItems(base, 2026)!;
    expect(f.gratuityKind).toBe('exgratia');
    expect(f.gratuity).toBe(Math.round(3100 * (10 / 31 + 21 + 1 / 30)));
    expect(f.gratuityExempt).toBe(0);
    expect(f.gratuityLabel).toMatch(/\/month × 21\.4 months/);
  });
  it('ex gratia follows the rate in force: joining rate until the hike, the new rate after', () => {
    const old = { ...base.structure, basic: 60000 };
    const emp = { ...base, structure: old, ctcParts: { gratuity: 3100 }, revisions: [{ from: '2026-07', payoutMonth: '2026-08', structure: { ...old, basic: 72960 } }] };
    const f = fnfItems(emp, 2026)!;
    expect(f.gratuityPeriods.map((p) => [p.from, p.to, p.monthly])).toEqual([
      ['2025-01-22', '2026-06-30', 3100],
      ['2026-07-01', '2026-11-01', 3770],
    ]);
    expect(f.gratuity).toBe(Math.round(f.gratuityPeriods.reduce((a, p) => a + p.monthly * p.months, 0)));
    // A rate stated in the appraisal letter wins over scaling.
    const given = fnfItems({ ...emp, revisions: [{ ...emp.revisions[0], gratuity: 4000 }] }, 2026)!;
    expect(given.gratuityPeriods[1].monthly).toBe(4000);
    // A payroll sheet's formula: ((10/31)+17) x 3,100 + ((13/30)+4) x 4,197 for a last day of 13 Nov 2026.
    const wb = fnfItems({ ...emp, end: '2026-11-13', revisions: [{ ...emp.revisions[0], gratuity: 4197 }] }, 2026)!;
    expect(wb.gratuity).toBe(Math.round((10 / 31 + 17) * 3100 + (13 / 30 + 4) * 4197));
  });
  it('5+ years (4 years 240 days counts): 15/26 x basic x years, exempt', () => {
    const f = fnfItems({ ...base, start: '2021-03-01' }, 2026)!;
    expect(f.gratuityKind).toBe('gratuity');
    expect(f.gratuity).toBe(Math.round((15 / 26) * 72960 * 6));
    expect(f.gratuityExempt).toBe(f.gratuity);
  });
  it('can be switched off', () => {
    expect(fnfItems({ ...base, fnf: { ...base.fnf!, gratuityMode: 'none' } }, 2026)!.gratuity).toBe(0);
  });
  it('ex gratia is taxed as salary', () => {
    const s: Scenario = { fy: 2026, today: '2026-04-01', settings: { thirtyDayMonth: false, nextFyHike: 0 }, employers: [base, job('L', '2026-11-02', '', 125000)] };
    const r = compute(s);
    const nov = r.employers[0].lines.find((l) => l.month === '2026-11')!;
    const eg = nov.oneTimes.find((o) => /Ex gratia/.test(o.label))!;
    expect(eg.taxable).toBe(true);
  });
});

describe('EPF ceiling rise inside a fixed CTC', () => {
  const statutory = { ...st(72960), epfMode: 'statutory' as const };
  const s = (e: Employment): Scenario => ({ fy: 2026, today: '2026-09-27', employers: [e], settings: { thirtyDayMonth: false, nextFyHike: 0 } });
  it('employer PF in the CTC: the extra PF comes out of the allowance from Sep 2026', () => {
    const r = compute(s(job('S', '2025-01-22', '', 72960, { structure: statutory, ctcParts: { employerPf: 1800 } })));
    const aug = r.employers[0].lines.find((l) => l.month === '2026-08')!;
    const sep = r.employers[0].lines.find((l) => l.month === '2026-09')!;
    expect([aug.epf, sep.epf]).toEqual([1800, 3000]);
    expect(aug.special - sep.special).toBe(1200);
  });
  it('employer PF not in the CTC: the allowance stays', () => {
    const r = compute(s(job('S', '2025-01-22', '', 72960, { structure: statutory })));
    const lines = r.employers[0].lines;
    expect(lines.find((l) => l.month === '2026-09')!.special).toBe(lines.find((l) => l.month === '2026-08')!.special);
  });
});
