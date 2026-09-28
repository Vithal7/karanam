import { describe, expect, it } from 'vitest';
import { compute } from '../../domain/compute';
import type { DocRecord, Employment, Scenario } from '../../domain/types';
import { docHints } from '../docHints';

const doc = (kind: DocRecord['kind'], docDate?: string, doj?: string): DocRecord => ({ id: kind + docDate, name: kind, kind, fields: {}, docDate, doj });
const job = (name: string, start: string, end: string, docs: DocRecord[], extra: Partial<Employment> = {}): Employment => ({
  id: name,
  name,
  start,
  end,
  structure: { basic: 60000, hra: 31000, special: 54100, others: [], epfMode: 'statutory', epf: 0, pt: 200, npsPct: 0, npsInGross: false },
  revisions: [],
  oneTimes: [],
  recoveries: [],
  ctc: 0,
  tdsKnown: {},
  form12B: 'second',
  docs,
  ...extra,
});
const scenario = (employers: Employment[]): Scenario => ({ fy: 2026, today: '2026-09-27', settings: { thirtyDayMonth: false, nextFyHike: 0 }, employers });

describe('documents that would help', () => {
  it('an old letter plus a new offer: ask for the latest hike, a payslip and the resignation email', () => {
    const s = scenario([job('Northwind', '2025-01-22', '2026-11-13', [doc('offer', '2025-01-10', '2025-01-22')], { endSource: 'assumed' }), job('KV', '2026-11-14', '', [doc('offer', '2026-10-15', '2026-11-14')])]);
    expect(docHints(s, 0).map((h) => h.kind)).toEqual(['appraisal', 'payslip', 'resignation']);
    expect(docHints(s, 1)).toEqual([]);
  });
  it('a job with this year’s payslip and exit papers needs nothing more', () => {
    const s = scenario([job('A', '2024-06-01', '2026-08-31', [doc('offer', '2024-05-01', '2024-06-01'), doc('payslip', '2026-07-31'), doc('resignation', '2026-06-01'), doc('fnf', '2026-09-15')]), job('B', '2026-09-01', '', [doc('offer', '2026-08-01', '2026-09-01'), doc('payslip', '2026-09-30')])]);
    expect(docHints(s, 0)).toEqual([]);
    expect(docHints(s, 1)).toEqual([]);
  });
  it('left already without an F&F slip: ask for it', () => {
    const s = scenario([job('A', '2024-06-01', '2026-08-31', [doc('payslip', '2026-07-31'), doc('resignation', '2026-06-01')]), job('B', '2026-09-01', '', [doc('offer', '2026-08-01', '2026-09-01')])]);
    expect(docHints(s, 0).map((h) => h.kind)).toEqual(['fnf']);
  });
});

describe('professional tax follows the state', () => {
  it('Haryana has none, even with ₹200 on the salary structure', () => {
    const s = scenario([job('A', '2024-06-01', '', [], { location: { state: 'HR', source: 'user' } })]);
    const r = compute(s);
    expect(r.steady.pt).toBe(0);
    expect(r.employers[0].lines.every((l) => l.pt === 0)).toBe(true);
  });
});
