import { describe, expect, it } from 'vitest';
import { compute } from '../compute';
import type { Employment, Scenario } from '../types';
import { bundledRules } from '../../rules';
import { applyDocs } from '../../extract/merge';
import { applyEvents } from '../../extract/events';
import { blankJob, docsFromText } from '../../extract/intake';
import { withOffer } from '../../ui/Compare';

const job = (extra: Partial<Employment> = {}): Employment => ({
  id: 'j',
  name: 'A',
  start: '2024-06-01',
  end: '',
  structure: { basic: 60000, hra: 30000, special: 30000, others: [], epfMode: 'statutory', epf: 0, pt: 200, npsPct: 0, npsInGross: false },
  revisions: [],
  oneTimes: [],
  recoveries: [],
  ctc: 0,
  tdsKnown: {},
  form12B: 'second',
  docs: [],
  ...extra,
});
const scenario = (employers: Employment[]): Scenario => ({ fy: 2026, today: '2026-09-27', settings: { thirtyDayMonth: false, nextFyHike: 0 }, employers });

describe('unpaid days', () => {
  it('cut that month’s pay by the share of days', () => {
    const r = compute(scenario([job({ lopDays: { '2026-06': 15 } })]));
    const jun = r.employers[0].lines.find((l) => l.month === '2026-06')!;
    const jul = r.employers[0].lines.find((l) => l.month === '2026-07')!;
    expect(jun.basic).toBe(30000);
    expect(jul.basic).toBe(60000);
  });
});

describe('only a CTC', () => {
  it('gets a typical split, marked for you to check', () => {
    const { docs } = docsFromText('Got an offer from Delta, CTC 18 LPA, joining 1 Dec 2026', 'Pasted text');
    const e = applyEvents(applyDocs({ ...blankJob('Delta', '2026-12-01'), docs }, {}, bundledRules).emp, bundledRules, '2026-04').emp;
    expect(e.splitGuessed).toBe(true);
    expect(e.structure.basic).toBe(75000);
    expect(e.structure.hra).toBe(37500);
    expect(e.structure.special).toBeGreaterThan(20000);
  });
});

describe('professional tax in more states', () => {
  it('Sikkim ₹200 a month, Manipur ₹2,500 a year', () => {
    const sk = compute(scenario([job({ location: { state: 'SK', source: 'user' } })]));
    expect(sk.employers[0].lines[0].pt).toBe(200);
    const mn = compute(scenario([job({ start: '2024-01-01', location: { state: 'MN', source: 'user' } })]));
    expect(Math.round(mn.employers[0].lines.reduce((a, l) => a + l.pt, 0))).toBe(2500);
  });
});

describe('comparing offers', () => {
  it('puts the other offer in place of the new job, keeping your answers', () => {
    const cur = job({ id: 'b', name: 'B', start: '2026-12-01', form12B: '2027-01', form12BConfirmed: true });
    const alt = job({ id: 'c', name: 'C', start: '2026-12-01', structure: { ...cur.structure, basic: 80000 } });
    const s = withOffer(scenario([job({ end: '2026-11-30' }), cur]), alt).s;
    expect(s.employers.map((e) => e.name)).toEqual(['A', 'C']);
    expect(s.employers[1].form12B).toBe('2027-01');
    expect(compute(s).steady.gross).toBeGreaterThan(compute(scenario([job({ end: '2026-11-30' }), cur])).steady.gross);
  });
});

describe('comparing when you are staying', () => {
  const stay = job({ id: 'a', name: 'A', start: '2024-06-01', end: '' });
  const beta = job({ id: 'b', name: 'Beta', start: '2026-12-01', startSource: 'doc', structure: { ...stay.structure, basic: 80000 }, buyout: undefined });
  it('stay vs leave and join: your job ends the day before, it is not replaced', () => {
    const { s } = withOffer(scenario([stay]), beta);
    expect(s.employers.map((e) => [e.name, e.start, e.end])).toEqual([
      ['A', '2024-06-01', '2026-11-30'],
      ['Beta', '2026-12-01', ''],
    ]);
  });
  it('an offer joining before your last day moves the last day, never both salaries in a month', () => {
    const leaving = job({ id: 'a', name: 'A', end: '2026-11-13', endSource: 'doc' });
    const kv = job({ id: 'kv', name: 'KV', start: '2026-11-14', startSource: 'doc', buyout: { mode: 'actuals' } });
    const early = job({ id: 'c', name: 'Beta', start: '2026-10-01', startSource: 'doc' });
    const { s } = withOffer(scenario([leaving, kv]), early);
    expect(s.employers[0].end).toBe('2026-09-30');
    const oct = compute(s).months.find((m) => m.month === '2026-10')!;
    expect(oct.lines.length).toBe(1);
    expect(s.employers[1].buyout?.mode).toBe('none');
  });
});
