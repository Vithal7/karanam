import { describe, expect, it } from 'vitest';
import { bundledRules } from '../../rules';
import { compute, validateEmployers } from '../compute';
import { epfFor } from '../schedule';
import { round10, taxOn } from '../tax';
import type { Employment, Scenario, Structure } from '../types';

const st = (basic: number, epfMode: Structure['epfMode'] = 'statutory'): Structure => ({
  basic,
  hra: basic / 2,
  special: basic / 2,
  others: [],
  epfMode,
  epf: 0,
  pt: 200,
  npsPct: 0,
  npsInGross: true,
});

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

describe('EPF wage ceiling by date', () => {
  it('is ₹1,800 before Sep 2026 and ₹3,000 from Sep 2026 on a large basic', () => {
    const s = st(72960);
    expect(epfFor(s, '2026-08', bundledRules)).toBe(1800);
    expect(epfFor(s, '2026-09', bundledRules)).toBe(3000);
    expect(epfFor(s, '2027-03', bundledRules)).toBe(3000);
  });
  it('is 12% of basic below the ceiling, and uncapped for full-basic employers', () => {
    expect(epfFor(st(20000), '2026-10', bundledRules)).toBe(2400);
    expect(epfFor(st(72960, 'fullBasic'), '2026-10', bundledRules)).toBeCloseTo(8755.2, 5);
  });
});

describe('three jobs in one year', () => {
  const s: Scenario = {
    fy: 2026,
    today: '2026-04-01',
    settings: { thirtyDayMonth: false, nextFyHike: 0 },
    employers: [
      job('A', '2025-01-01', '2026-07-31', 60000, { fnf: { leaveDays: 10, noticeDaysRecovered: 0, clawback: 0, buyoutByNext: false } }),
      job('B', '2026-08-01', '2026-11-30', 80000, { form12B: 'second', fnf: { leaveDays: 20, noticeDaysRecovered: 15, clawback: 0, buyoutByNext: true } }),
      job('C', '2026-12-01', '', 120000, { form12B: 'second' }),
    ],
  };
  const r = compute(s);
  const [A, B, C] = r.employers;

  it('builds each job in its own months', () => {
    expect(A.lines.map((l) => l.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07']);
    expect(B.lines.map((l) => l.month)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    expect(C.lines.map((l) => l.month)).toEqual(['2026-12', '2027-01', '2027-02', '2027-03']);
  });

  it('applies the new EPF ceiling from September at job B', () => {
    expect(B.lines[0].epf).toBe(1800);
    expect(B.lines[1].epf).toBe(3000);
  });

  it('each later job learns about all earlier ones only from its Form 12B month', () => {
    expect(C.form12B).toBe('2027-01');
    expect(C.stage[0].previousTds).toBe(0);
    const earlierTds = [...A.lines, ...B.lines].reduce((a, l) => a + l.tds, 0);
    expect(C.stage[1].previousTds).toBeCloseTo(earlierTds, 6);
  });

  it('pays the notice buyout at the next job and shares the leave exemption', () => {
    expect(C.lines.flatMap((l) => l.oneTimes).some((o) => o.kind === 'buyout')).toBe(true);
    // Each job's leave payout counts up to its own s.10(10AA) limits (30 days per completed year).
    const lim = (x: typeof A) => Math.min(x.fnf!.leaveEncashment, x.fnf!.leaveExemptLimit);
    expect(r.filing.leaveExemption).toBe(Math.round(lim(A) + lim(B)));
  });

  it('settles: balance = tax on combined income - all TDS', () => {
    const tds = r.employers.flatMap((e) => e.lines).reduce((a, l) => a + l.tds, 0);
    expect(r.filing.balance).toBeCloseTo(r.filing.total - tds, 6);
    expect(r.filing.total).toBe(round10(taxOn(round10(r.filing.gross - 75000 - r.filing.leaveExemption)).total));
  });

  it('flags impossible timelines', () => {
    expect(validateEmployers(s)).toEqual([]);
    const bad = { ...s, employers: [s.employers[0], { ...s.employers[1], start: '2026-07-15' }, s.employers[2]] };
    expect(validateEmployers(bad).join(' ')).toMatch(/overlaps/);
  });
});
