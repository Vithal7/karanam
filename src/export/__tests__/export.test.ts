import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { compute } from '../../domain/compute';
import type { Employment, Scenario, Structure } from '../../domain/types';
import { bundledRules } from '../../rules';
import { toPdf } from '../pdf';
import { buildSheets } from '../sheets';
import { toXlsx } from '../xlsx';

const st = (basic: number, special: number): Structure => ({ basic, hra: basic / 2, special, others: [], epfMode: 'statutory', epf: 0, pt: 200, npsPct: 0, npsInGross: false });
const job = (name: string, start: string, end: string, s: Structure, extra: Partial<Employment> = {}): Employment => ({
  id: name, name, start, end, structure: s, revisions: [], oneTimes: [], recoveries: [], ctc: 0, tdsKnown: {}, form12B: '2026-12', docs: [], ...extra,
});
const s: Scenario = {
  fy: 2026,
  today: '2026-09-27',
  settings: { thirtyDayMonth: false, nextFyHike: 0.1 },
  employers: [
    job('Northwind', '2025-01-22', '2026-11-13', st(72960, 43973), { tdsKnown: { '2026-04': 11518 }, fnf: { leaveDays: 18, noticeDaysRecovered: 21, clawback: 0 }, ctcParts: { gratuity: 3100 } }),
    job('Resilient', '2026-11-14', '', st(125000, 60700), { oneTimes: [{ id: 'joining', label: 'Joining bonus', kind: 'joining', amount: 150000, month: '2027-02', taxable: true }] }),
  ],
};
const r = compute(s, bundledRules);
const sheets = buildSheets(r, s, bundledRules);

describe('download: a sheet per financial year', () => {
  it('this year and next year', () => {
    expect(sheets.map((x) => x.name)).toEqual(['FY 2026-27', 'FY 2027-28 projection']);
  });
  it('this year: every month with gross, TDS, deductions and in hand, totals matching the engine', () => {
    const m = sheets[0].sections[0];
    expect(m.head).toContain('In hand');
    const total = m.rows[m.rows.length - 1];
    const col = (h: string) => m.head!.indexOf(h);
    expect(total[col('Gross')]).toBe(Math.round(r.months.reduce((a, x) => a + x.gross, 0)));
    expect(total[col('TDS')]).toBe(Math.round(r.months.reduce((a, x) => a + x.tds, 0)));
    expect(total[col('In hand')]).toBe(Math.round(r.months.reduce((a, x) => a + x.inHand, 0)));
    expect(m.rows[0][col('TDS from')]).toBe('Your files');
  });
  it('the tax computation, slab by slab, ends at the refund or the balance to pay', () => {
    const titles = sheets[0].sections.map((x) => x.title);
    expect(titles).toEqual(expect.arrayContaining(['Income and deductions', 'Tax by slab (new regime)', 'Tax and TDS']));
    const tax = sheets[0].sections.find((x) => x.title === 'Tax and TDS')!;
    expect(tax.rows.find((x) => x[0] === 'Tax payable for the year')?.[1]).toBe(Math.round(r.filing.total));
    expect(sheets[0].sections.some((x) => x.title.startsWith('F&F from Northwind'))).toBe(true);
  });
  it('writes a real .xlsx with both sheets', () => {
    const files = unzipSync(toXlsx(sheets));
    expect(strFromU8(files['xl/workbook.xml'])).toMatch(/name="FY 2026-27".*name="FY 2027-28 projection"/);
    expect(strFromU8(files['xl/worksheets/sheet1.xml'])).toContain('Month by month');
  });
  it('writes a PDF', () => {
    const pdf = toPdf(sheets, 'Northwind, Resilient');
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
  });
});
