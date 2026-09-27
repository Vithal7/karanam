import { describe, expect, it } from 'vitest';
import { compute } from '../../domain/compute';
import type { Scenario } from '../../domain/types';
import { bundledRules } from '../../rules';
import { effectiveScenario, initialState, spreadTdsSoFar } from '../../state';
import { applyEvents } from '../events';
import { blankJob, docFromText } from '../intake';
import { applyDocs } from '../merge';
import { parseMonthTable, sheetFy } from '../months';
import { needsPrevVariable } from '../../ui/PrevVariable';

// A month-wise tax sheet laid out in columns (as the PDF reader now produces), with blank cells.
const COLS = ['Apr-26', 'May-26', 'Jun-26', 'Jul-26', 'Aug-26', 'Sep-26', 'Oct-26', 'Nov-26', 'Dec-26', 'Jan-27', 'Feb-27', 'Mar-27', 'Total'];
const row = (label: string, cells: (string | number | '')[]) =>
  label.padEnd(26) + cells.map((c) => (c === '' ? '' : typeof c === 'number' ? c.toLocaleString('en-IN') : c).padStart(10)).join('');
const SHEET = [
  'SUZLON GLOBAL SERVICES LIMITED',
  'Date: 18/09/2026',
  'Income Tax Computation - Financial Year 2026-27',
  row('Particulars', COLS),
  row('Basic', [67500, 67500, 67500, 82080, 82080, 82080, 82080, 82080, 82080, 82080, 82080, 82080, 938160]),
  row('Performance Bonus', ['', '', '', 324000, '', '', '', '', '', '', '', '', 324000]),
  row('Arrears', ['', '', '', 93933, '', '', '', '', '', '', '', '', 93933]),
  row('Professional Tax', [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 300, 2500]),
  row('TDS', [16110, 16110, 16110, 98450, 32220, 32220, 32220, 32220, 32220, 32220, 32220, 32220, 403540]),
  row('Balance tax payable', ['', '', '', '', '', '', '', '', '', '', '', '', 119017]),
].join('\n');

describe('month-wise tax sheet', () => {
  it('reads the financial year', () => {
    expect(sheetFy(SHEET)).toBe(2026);
    expect(sheetFy('Assessment Year 2027-28')).toBe(2026);
  });

  const m = parseMonthTable(SHEET, 2026, '2026-09');
  it('records TDS for months before the sheet date only', () => {
    expect(Object.keys(m).sort()).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
    expect(m['2026-07'].tds).toBe(98450);
    expect(m['2026-08'].tds).toBe(32220);
  });
  it('puts the bonus and arrears in July, not in the first column', () => {
    expect(m['2026-07'].items).toEqual([
      { label: 'Performance Bonus', amount: 324000, kind: 'bonus' },
      { label: 'Arrears', amount: 93933, kind: 'arrears' },
    ]);
    expect(m['2026-04'].items).toBeUndefined();
  });
  it('never takes professional tax as TDS', () => {
    expect(m['2026-04'].tds).toBe(16110);
  });
});

describe('months down the side', () => {
  const T = ['Financial Year 2026-27', 'Month          Gross Salary     Bonus        TDS', 'Apr 2026       1,44,960            0     16,110', 'May 2026       1,44,960            0     16,110', 'Jun 2026       1,44,960            0     16,110', 'Jul 2026       1,76,271     3,24,000     98,450', 'Aug 2026       1,76,271            0     32,220'].join('\n');
  it('reads each month row', () => {
    const m = parseMonthTable(T, 2026, '2026-09');
    expect(m['2026-07'].tds).toBe(98450);
    expect(m['2026-07'].items?.[0].amount).toBe(324000);
    expect(m['2026-05'].tds).toBe(16110);
  });
});

describe('pasted text without column alignment', () => {
  it('falls back to reading cells in order', () => {
    const T = 'Financial Year 2026-27\nParticulars Apr May Jun Jul Aug\nTDS 16,110 16,110 16,110 98,450 32,220';
    const m = parseMonthTable(T, 2026, '2026-09');
    expect(m['2026-07'].tds).toBe(98450);
  });
});

describe('payslips record their month', () => {
  it('TDS and bonus paid that month', () => {
    const d = docFromText('Salary Slip for the month of July 2026\nEarnings Amount Deductions Amount\nBasic 82,080 Income Tax 98,450\nPerformance Bonus 3,24,000 Professional Tax 200', 'payslip-jul.pdf');
    expect(d.kind).toBe('payslip');
    expect(d.facts?.monthly?.['2026-07']).toEqual({ tds: 98450, items: [{ label: 'Variable pay', amount: 324000, kind: 'bonus' }] });
  });
});

describe('actuals drive the past', () => {
  const sheet = docFromText(SHEET, 'Suzlon Tax Computation.pdf');
  const e0 = { ...blankJob('Suzlon', '2025-01-20'), start: '2025-01-20', startSource: 'doc' as const, end: '2026-11-01', endSource: 'user' as const };
  e0.structure = { ...e0.structure, basic: 67500, hra: 33750, special: 43710 };
  e0.revisions = [{ from: '2026-07', structure: { ...e0.structure, basic: 82080, hra: 41040, special: 53151 } }];
  const e = applyEvents(applyDocs({ ...e0, docs: [sheet] }, {}, bundledRules).emp, bundledRules, '2026-04').emp;

  it('keeps recorded TDS per month and adds the recorded bonus', () => {
    expect(e.tdsKnown['2026-07']).toBe(98450);
    expect(e.oneTimes.find((o) => o.month === '2026-07' && o.label === 'Performance Bonus')?.amount).toBe(324000);
    expect(needsPrevVariable({ ...e, variable: { annual: 360000, payoutPct: 1, prorate: false, month: '' } }, 2026)).toBe(false);
  });

  it('uses recorded arrears instead of calculating them', () => {
    const s: Scenario = { fy: 2026, today: '2026-09-27', settings: { thirtyDayMonth: false, nextFyHike: 0 }, employers: [{ ...e, revisions: [{ ...e.revisions[0], from: '2026-04', payoutMonth: '2026-07' }] }, { ...blankJob('L', '2026-11-02'), start: '2026-11-02' }] };
    const r = compute(s);
    const jul = r.employers[0].lines.find((l) => l.month === '2026-07')!;
    expect(jul.oneTimes.filter((o) => /Arrears/.test(o.label))).toHaveLength(1);
    expect(jul.tds).toBe(98450);
    expect(jul.tdsEstimated).toBe(false);
  });

  it('a year-to-date total only fills months without a record', () => {
    const s = { fy: 2026, today: '2026-09-27', settings: { thirtyDayMonth: false, nextFyHike: 0 }, employers: [e] } as Scenario;
    const k = spreadTdsSoFar({ ...e, tdsKnown: { '2026-04': 16110, '2026-05': 16110 } }, s, 200000);
    expect(k['2026-04']).toBe(16110);
    expect(k['2026-06'] + k['2026-07'] + k['2026-08']).toBeCloseTo(200000 - 32220, 6);
  });
});

describe("last year's variable pay", () => {
  it('asks when nothing recorded it', () => {
    const e = { ...blankJob('Suzlon', '2025-01-20'), start: '2025-01-20', variable: { annual: 360000, payoutPct: 1, prorate: false, month: '' } };
    expect(needsPrevVariable(e, 2026)).toBe(true);
    expect(needsPrevVariable({ ...e, prevVariable: 'no' }, 2026)).toBe(false);
    expect(needsPrevVariable({ ...e, start: '2026-05-01' }, 2026)).toBe(false);
  });
});

describe('more TDS layouts', () => {
  it('a two-column Month | TDS table', () => {
    const T = 'Financial Year 2026-27\nMonth          Income Tax Deducted\nApr 2026            16,110\nMay 2026            16,110\nJun 2026            16,110\nJul 2026            98,450\nAug 2026            32,220';
    const m = parseMonthTable(T, 2026, '2026-09');
    expect(m['2026-04'].tds).toBe(16110);
    expect(m['2026-07'].tds).toBe(98450);
  });
  it('month-amount pairs under a TDS heading', () => {
    const T = 'Tax deducted so far (month-wise)\nApr 16,110  May 16,110  Jun 16,110  Jul 98,450  Aug 32,220';
    const m = parseMonthTable(T, 2026, '2026-09');
    expect(Object.keys(m).sort()).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
    expect(m['2026-08'].tds).toBe(32220);
  });
  it('other wordings of the TDS row', () => {
    for (const label of ['Income-tax', 'IT Deducted', 'Tax Deduction', 'TDS on Salary', 'Income Tax Recovered']) {
      const T = `Financial Year 2026-27\nParticulars  Apr  May  Jun\n${label}  16,110  16,110  16,110`;
      expect(parseMonthTable(T, 2026, '2026-09')['2026-05']?.tds, label).toBe(16110);
    }
  });
});

describe('TDS typed in month by month', () => {
  it('wins over the files and survives the year-to-date spread', () => {
    const st = initialState();
    const a = { ...blankJob('A', '2025-01-20'), start: '2025-01-20', end: '2026-11-01', tdsKnown: { '2026-04': 10_000, '2026-05': 10_000 }, tdsManual: { '2026-05': 12_000, '2026-06': 11_000 } };
    const b = { ...blankJob('B', '2026-11-02'), start: '2026-11-02' };
    const s = { ...st.scenario, fy: 2026, today: '2026-09-27', employers: [a, b] };
    const eff = effectiveScenario({ ...st, scenario: s, tdsSoFar: {} });
    expect(eff.employers[0].tdsKnown).toEqual({ '2026-04': 10_000, '2026-05': 12_000, '2026-06': 11_000 });
    const last = effectiveScenario({ ...st, scenario: { ...s, employers: [a] }, tdsSoFar: {} });
    expect(last.employers[0].tdsKnown['2026-06']).toBe(11_000);
  });
});

describe('a payroll tax computation with off-cycle rows and a summary below', () => {
  // Same shape as a real Suzlon sheet: months as "April-2026", TDS on its own row, an all-zero
  // "Off Cycle TDS Deduction" row after it, and a summary that repeats labels with one figure.
  const W = 36;
  const row = (label: string, cells: string[]) => `  ${label.padEnd(60)}${cells.map((c) => c.padStart(W)).join('')}`;
  const heads = ['April-2026', 'May-2026', 'June-2026', 'July-2026', 'August-2026', 'September-2026', 'October-2026', 'November-2026', 'December-2026', 'January-2027', 'February-2027', 'March-2027', 'Total'];
  const zeros = (n: number) => Array(n).fill('0');
  const T = [
    'Income Tax Computation For FY 2026-27',
    row('Particulars', heads),
    row('Basic Salary', ['67,500', '67,500', '67,500', '82,080', '82,080', '82,080', '82,080', '30,096', ...zeros(4), '5,60,916']),
    row('Total Extra Payments', ['0', '0', '0', '4,01,523', ...zeros(8), '4,01,523']),
    row('Gross Salary(A)', ['1,44,960', '1,44,960', '1,44,960', '5,77,736', '1,76,213', '1,76,213', '1,76,213', '64,611', ...zeros(4), '16,05,866']),
    row('Professional Tax', ['200', '200', '200', '200', '200', '200', '200', '200', ...zeros(4), '1,600']),
    row('TDS', ['11,518', '11,518', '11,518', '1,19,597', '18,019', ...zeros(7), '1,72,170']),
    row('Total Deductions(B)', ['13,518', '13,518', '13,518', '1,21,597', '20,019', '2,000', '2,000', '2,000', ...zeros(4), '1,88,170']),
    row('Off Cycle TDS Deduction (E)', zeros(13)),
    '  DETAILS OF SALARY PAID AND ANY OTHER INCOME AND TAX DEDUCTED',
    `  ${'Total Extra Payments'.padEnd(250)}4,01,523`,
    `  ${'Previous Employer TDS (B)'.padEnd(420)}0`,
    `  ${'Tax Deducted till Date by Current Employer (D)'.padEnd(420)}1,72,170`,
    'Downloaded on 20-09-2026',
  ].join('\n');
  it('adds the TDS rows instead of letting the zero row win, and reads extra payments once', () => {
    const m = parseMonthTable(T, 2026, '2026-09');
    expect(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'].map((k) => m[k]?.tds)).toEqual([11518, 11518, 11518, 119597, 18019]);
    expect(m['2026-07'].items).toEqual([{ label: 'Extra payments (bonus, arrears)', amount: 401523, kind: 'bonus' }]);
    expect(Object.values(m).flatMap((a) => a.items ?? [])).toHaveLength(1);
  });
  it('a "Total TDS" row counts only when there is no other', () => {
    const X = ['FY 2026-27', row('Particulars', heads.slice(0, 3)), row('TDS', ['100', '100', '100']), row('Total TDS', ['100', '100', '100'])].join('\n');
    expect(parseMonthTable(X, 2026, '2026-09')['2026-04'].tds).toBe(100);
  });
});
