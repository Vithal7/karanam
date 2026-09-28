/**
 * A full year laid out the way a payroll register does it: a job left in November after hikes and
 * a bonus (with actual TDS for the months already paid), then a new job with employer NPS, Form 12B,
 * a joining bonus and variable pay, and the next year's projection. Illustrative figures.
 */
import { describe, expect, it } from 'vitest';
import { compute } from '../compute';
import type { Scenario, Structure } from '../types';

const st = (basic: number, hra: number, special: number, epf: number, pt: number, npsPct = 0): Structure => ({
  basic,
  hra,
  special,
  others: [],
  epfMode: 'fixed',
  epf,
  pt,
  npsPct,
  npsInGross: true,
});

const job = (id: string) => ({ id, form12B: 'second' as const, docs: [] });

// Other Nov payouts at S besides leave encashment (ex gratia at the CTC's gratuity rates).
const sNovOther = (10 / 31 + 17) * 3100 + (13 / 30 + 4) * 4197;

export const workbookScenario = (): Scenario => ({
  fy: 2026,
  today: '2026-09-26',
  settings: { thirtyDayMonth: true, nextFyHike: 0.1 },
  employers: [
  {
    ...job('s'),
    name: 'S',
    // Joined in Jan 2025: one completed year, so 30 days of leave can be exempt.
    start: '2025-01-22',
    end: '2026-11-13',
    ctc: 0,
    structure: st(60000, 31000, 54100, 1800, 200),
    revisions: [
      { from: '2026-05', structure: st(60000, 36000, 49100, 1800, 200) },
      { from: '2026-07', structure: st(72960, 45000, 45000, 1800, 200) },
      { from: '2026-09', structure: st(72960, 45000, 43800, 3000, 200) },
    ],
    oneTimes: [
      { id: 'b', label: 'Annual bonus', kind: 'bonus', amount: 350000, month: '2026-07', taxable: true },
      { id: 'o', label: 'Other F&F payouts', kind: 'other', amount: sNovOther, month: '2026-11', taxable: true },
    ],
    recoveries: [],
    tdsKnown: {
      '2026-04': 10000,
      '2026-05': 10000,
      '2026-06': 10000,
      '2026-07': 100000,
      '2026-08': 15000,
      '2026-09': 0,
      '2026-10': 0,
      '2026-11': 0,
    },
    fnf: { leaveDays: 18, noticeDaysRecovered: 21, clawback: 0, buyoutByNext: true },
  },
  {
    ...job('a'),
    name: 'A',
    start: '2026-11-14',
    end: '',
    ctc: 0,
    structure: st(125000, 62500, 60700, 3000, 0, 0.14),
    revisions: [],
    oneTimes: [{ id: 'j', label: 'Joining bonus', kind: 'joining', amount: 120000, month: '2027-02', taxable: true }],
    recoveries: [],
    variable: { annual: 160000, payoutPct: 1, prorate: true, month: '2027-04' },
    tdsKnown: {},
  },
  ],
});

describe('payroll register', () => {
  const r = compute(workbookScenario());
  const [S, A] = r.employers;

  it('S Computation', () => {
    expect(S.fnf!.perDay).toBe(2432);
    expect(S.fnf!.leaveEncashment).toBe(43776);
    expect(S.fnf!.noticeRecovery).toBe(51072);
    const sGross = S.lines.reduce((a, l) => a + l.gross, 0);
    expect(sGross).toBeCloseTo(1620918.7, -1);
    // Actual TDS for the months paid: 10,000 × 3 + 1,00,000 + 15,000.
    expect(S.lines.reduce((a, l) => a + l.tds, 0)).toBe(145000);
    const nov = S.lines.find((l) => l.month === '2026-11')!;
    // 13 of 30 days of November.
    expect(nov.basic).toBeCloseTo((72960 * 13) / 30, 0);
    expect(nov.epf).toBeCloseTo((3000 * 13) / 30, 0);
    expect(nov.recoveries).toBe(51072);
  });

  it('A Computation monthly rows', () => {
    const gross = A.lines.map((l) => Math.round(l.gross));
    expect(gross).toEqual([140647, 299272, 248200, 368200, 248200]);
    const nps = A.lines.reduce((a, l) => a + l.nps, 0);
    expect(nps).toBeCloseTo(79916.67, 1);
    expect(A.form12B).toBe('2026-12');
  });

  it('A TDS staging', () => {
    const tds = A.lines.map((l) => l.tds);
    [0, 61290.56, 61290.56, 80010.56, 80010.56].forEach((v, i) => expect(tds[i]).toBeCloseTo(v, 1));
    expect(A.stage[0].taxable).toBe(978530);
    expect(A.stage[1].taxable).toBe(2650520);
    expect(A.stage[3].taxable).toBe(2770520);
  });

  it('combined liability and filing position', () => {
    expect(r.filing.gross).toBeCloseTo(2925437.37, -1);
    expect(r.filing.leaveExemption).toBe(43776);
    expect(r.filing.taxable).toBe(2726740);
    expect(r.filing.total).toBe(413940); // rounded to ₹10 (s.288B)
    expect(r.filing.tdsTotal).toBeCloseTo(145000 + 282602.24, 1);
    expect(r.filing.balance).toBeCloseTo(-13662.24, 1);
  });

  it('FY27-28 projection', () => {
    const n = r.nextFy;
    expect(n.daysServed).toBe(138);
    expect(n.effectiveHike).toBeCloseTo((0.1 * 138) / 365, 6);
    expect(n.gross).toBeCloseTo(3151501.15, 1);
    expect(n.taxable).toBe(2858560);
    expect(n.tax).toBeCloseTo(455070.72, 2);
    expect(n.lines[0].tds).toBeCloseTo(37922.56, 2);
    expect(n.lines[0].inHand).toBeCloseTo(258992.95, 0);
  });
});
