import { describe, expect, it } from 'vitest';
import type { DocRecord, Employment } from '../../domain/types';
import { bundledRules } from '../../rules';
import { applyDocs, docFromExtract, epfModeFor, mergeDocs } from '../merge';
import { parseText } from '../parse';

const doc = (id: string, docDate: string | undefined, fields: Record<string, number>, extra: Partial<DocRecord> = {}): DocRecord => ({
  id,
  name: id,
  kind: 'payslip',
  docDate,
  fields,
  ...extra,
});

const emp = (docs: DocRecord[]): Employment => ({
  id: 'e',
  name: 'Current job',
  start: '2026-04-01',
  end: '',
  structure: { basic: 0, hra: 0, special: 0, others: [], epfMode: 'statutory', epf: 0, pt: 200, npsPct: 0, npsInGross: true },
  revisions: [],
  oneTimes: [],
  recoveries: [],
  ctc: 0,
  tdsKnown: {},
  form12B: 'first',
  docs,
});

describe('mergeDocs', () => {
  it('merges agreeing files silently', () => {
    const r = mergeDocs([doc('a', '2026-05-01', { basic: 67500, hra: 36690 }), doc('b', '2026-06-01', { basic: 67500, special: 40770 })]);
    expect(r.conflicts).toEqual([]);
    expect(Object.keys(r.agreed).sort()).toEqual(['basic', 'hra', 'special']);
  });

  it('turns disagreements into questions, newest first', () => {
    const r = mergeDocs([doc('offer', '2025-03-01', { basic: 67500 }, { kind: 'offer' }), doc('aug', '2026-08-01', { basic: 82080 })]);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].options.map((o) => o.value)).toEqual([82080, 67500]);
    expect(r.conflicts[0].canBeRevision).toBe(true);
  });
});

describe('applyDocs', () => {
  const docs = [doc('offer', '2025-03-01', { basic: 67500, hra: 33750, ctc: 2000000 }, { kind: 'offer' }), doc('aug', '2026-08-01', { basic: 82080, hra: 50160, epf: 1800 })];

  it('uses the picked file for each conflict', () => {
    const r = applyDocs(emp(docs), { basic: 'aug', hra: 'aug' }, bundledRules);
    expect(r.emp.structure.basic).toBe(82080);
    expect(r.emp.revisions).toEqual([]);
    expect(r.emp.ctc).toBe(2000000);
    expect(r.sources.basic).toContain('aug');
  });

  it('"salary changed" keeps the old figure and adds a revision from the newer month', () => {
    const r = applyDocs(emp(docs), { basic: 'changed', hra: 'changed' }, bundledRules);
    expect(r.emp.structure.basic).toBe(67500);
    expect(r.emp.revisions).toHaveLength(1);
    expect(r.emp.revisions[0].from).toBe('2026-08');
    expect(r.emp.revisions[0].structure.basic).toBe(82080);
    expect(r.emp.revisions[0].structure.hra).toBe(50160);
  });

  it('marks unanswered conflicts for checking', () => {
    const r = applyDocs(emp(docs), {}, bundledRules);
    expect(r.marks.basic).toBe('guessed');
  });
});

describe('epfModeFor', () => {
  it('recognises statutory, full-basic and fixed PF', () => {
    expect(epfModeFor(1800, 82080, '2026-08', bundledRules).mode).toBe('statutory');
    expect(epfModeFor(3000, 82080, '2026-10', bundledRules).mode).toBe('statutory');
    expect(epfModeFor(9850, 82080, '2026-10', bundledRules).mode).toBe('fullBasic');
    expect(epfModeFor(2000, 82080, '2026-10', bundledRules).mode).toBe('fixed');
  });
});

describe('docFromExtract', () => {
  it('keeps monthly salary and annual one-offs', () => {
    const d = docFromExtract(parseText('Basic 1,42,500 17,10,000\nJoining Bonus: Rs. 1,50,000 payable with the third month salary.'), 'x', 'offer.pdf');
    expect(d.fields.basic).toBe(142500);
    expect(d.fields.joining).toBe(150000);
    expect(d.fields.joiningOffset).toBe(2);
  });
});

describe('PF from a dated payslip', () => {
  it('judges statutory PF by the payslip month, not the oldest letter', () => {
    const docs = [doc('letter', '2026-06-01', { basic: 67500 }, { kind: 'offer' }), doc('sep', '2026-09-01', { basic: 67500, epf: 3000 })];
    const r = applyDocs(emp(docs), {}, bundledRules);
    expect(r.emp.structure.epfMode).toBe('statutory');
  });
});
