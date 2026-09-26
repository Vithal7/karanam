/**
 * Parity with the hand-built tax_calculation.xlsx this app replaces
 * (sheets "S Computation", "A Computation" and "FY27-28").
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

// Other Nov payouts at S besides leave encashment (row 9, column F of the workbook).
const sNovOther = (12 / 31 + 17) * 3240 + (11 / 30 + 4) * 4387;

export const workbookScenario = (): Scenario => ({
  fy: 2026,
  today: '2026-09-26',
  settings: { thirtyDayMonth: true, nextFyHike: 0.1 },
  employers: [
  {
    ...job('s'),
    name: 'S',
    start: '2026-04-01',
    end: '2026-11-11',
    ctc: 0,
    structure: st(67500, 33750, 43710, 1800, 200),
    revisions: [
      { from: '2026-05', structure: st(67500, 36690, 40770, 1800, 200) },
      { from: '2026-07', structure: st(82080, 50160, 43973, 1800, 200) },
      { from: '2026-09', structure: st(82080, 50160, 42773, 3000, 200) },
    ],
    oneTimes: [
      { id: 'b', label: 'Annual bonus', kind: 'bonus', amount: 401523, month: '2026-07', taxable: true },
      { id: 'o', label: 'Other F&F payouts', kind: 'other', amount: sNovOther, month: '2026-11', taxable: true },
    ],
    recoveries: [],
    tdsKnown: {
      '2026-04': 11518,
      '2026-05': 11518,
      '2026-06': 11518,
      '2026-07': 119597,
      '2026-08': 18019,
      '2026-09': 0,
      '2026-10': 0,
      '2026-11': 0,
    },
    fnf: { leaveDays: 22, noticeDaysRecovered: 21, clawback: 0, buyoutByNext: true },
  },
  {
    ...job('a'),
    name: 'A',
    start: '2026-11-12',
    end: '',
    ctc: 0,
    structure: st(142500, 71250, 69450, 3000, 0, 0.14),
    revisions: [],
    oneTimes: [{ id: 'j', label: 'Joining bonus', kind: 'joining', amount: 150000, month: '2027-02', taxable: true }],
    recoveries: [],
    variable: { annual: 180000, payoutPct: 1, prorate: true, month: '2027-04' },
    tdsKnown: {},
  },
  ],
});

describe('workbook parity', () => {
  const r = compute(workbookScenario());
  const [S, A] = r.employers;

  it('S Computation', () => {
    expect(S.fnf!.perDay).toBe(2736);
    expect(S.fnf!.leaveEncashment).toBe(60192);
    expect(S.fnf!.noticeRecovery).toBe(57456);
    const sGross = S.lines.reduce((a, l) => a + l.gross, 0);
    expect(sGross).toBeCloseTo(1738708.76, -1);
    expect(S.lines.reduce((a, l) => a + l.tds, 0)).toBe(172170);
    const nov = S.lines.find((l) => l.month === '2026-11')!;
    expect(nov.basic).toBeCloseTo(30096, 0);
    expect(nov.epf).toBeCloseTo(1100, 0);
    expect(nov.recoveries).toBe(57456);
  });

  it('A Computation monthly rows', () => {
    const gross = A.lines.map((l) => Math.round(l.gross));
    expect(gross).toEqual([179360, 340656, 283200, 433200, 283200]);
    const nps = A.lines.reduce((a, l) => a + l.nps, 0);
    expect(nps).toBeCloseTo(92435, 2);
    expect(A.form12B).toBe('2026-12');
  });

  it('A TDS staging', () => {
    const tds = A.lines.map((l) => l.tds);
    [0, 77146.92, 77146.92, 100546.92, 100546.92].forEach((v, i) => expect(tds[i]).toBeCloseTo(v, 1));
    expect(A.stage[0].taxable).toBe(1144730);
    expect(A.stage[1].taxable).toBe(2940890);
    expect(A.stage[3].taxable).toBe(3090890);
  });

  it('combined liability and filing position', () => {
    expect(r.filing.gross).toBeCloseTo(3258324.76, -1);
    expect(r.filing.leaveExemption).toBe(60192);
    expect(r.filing.taxable).toBe(3030700);
    expect(r.filing.total).toBeCloseTo(508778.4, 2);
    expect(r.filing.tdsTotal).toBeCloseTo(172170 + 355387.68, 1);
    expect(r.filing.balance).toBeCloseTo(-18779.28, 1);
  });

  it('FY27-28 projection', () => {
    const n = r.nextFy;
    expect(n.daysServed).toBe(140);
    expect(n.effectiveHike).toBeCloseTo(0.038356164, 6);
    expect(n.gross).toBeCloseTo(3597790.68, 1);
    expect(n.taxable).toBe(3274210);
    expect(n.tax).toBeCloseTo(584753.52, 2);
    expect(n.lines[0].tds).toBeCloseTo(48729.46, 2);
    expect(n.lines[0].inHand).toBeCloseTo(290658.9, 0);
  });
});
