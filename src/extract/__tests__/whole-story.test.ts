/**
 * A year's papers that only add up together: an old offer with no breakup, a hike letter, a tax
 * sheet with the month-by-month pay, a resignation email, and the next offer. The group company's
 * other name, the joining date and the real breakup all come from the papers, not from questions.
 */
import { describe, expect, it } from 'vitest';
import { reconcile } from '../../domain/reconcile';
import { bundledRules } from '../../rules';
import { applyEvents, pfRiseFromMonths } from '../events';
import { findClawbackTerms } from '../facts';
import { assignDocs, blankJob, docFromText, rereadDoc } from '../intake';
import { staleSalary } from '../../ui/Questions';
import { applyDocs, sheetSlips } from '../merge';

const OFFER = `Northwind Global Services Limited
Date: 05-01-2025
CAREER OFFER
We are pleased to offer you employment as Manager.
Your Total CTC per annum will be Rs. 20,00,000.`;

const HIKE = `Emp Name: A. Person
Emp Code: 12345
Annual Performance Appraisal Letter
Date: 30-Jul-2026
Your total annual compensation has been revised to Rs. 24,00,000/- effective 1st July, 2026.`;

const row = (label: string, vals: (number | string)[]) => label.padEnd(30) + vals.map((v) => String(typeof v === 'number' ? v.toLocaleString('en-IN') : v).padStart(16)).join('');
const MONTHS = ['April-2026', 'May-2026', 'June-2026', 'July-2026', 'August-2026', 'September-2026'];
const TAX = [
  'Northwind Energy Limited',
  'Income Tax Computation For FY 2026-27',
  'Employee Code: 12345      Date of Joining: 20th January, 2025',
  row('Particulars', MONTHS),
  'Earnings',
  row('Basic Salary', [60000, 60000, 60000, 70000, 70000, 70000]),
  row('HRA', [30000, 30000, 30000, 35000, 35000, 35000]),
  row('Car Monetary Allowance', [20000, 20000, 20000, 25000, 25000, 24400]),
  row('Total Extra Payments', [0, 0, 0, 200000, 0, 0]),
  row('Gross Salary(A)', [110000, 110000, 110000, 330000, 130000, 129400]),
  'Deductions',
  row('PF', [1800, 1800, 1800, 1800, 1800, 2400]),
  row('Professional Tax', [200, 200, 200, 200, 200, 200]),
  row('TDS', [10000, 10000, 10000, 60000, 15000, 15000]),
].join('\n');

const RESIGN = `From: Manager <manager@northwind.example>
Subject: RE: Resignation (12345)
Northwind Energy Limited
Kindly accept this email as my formal resignation.
Employee Code
12345
Date of Joining
20th January 2025
Date of Resignation
3rd September 2026
Finalized Last Working Day
11th November 2026`;

const NEXT = `Zeta Systems Private Limited
Date: 01-09-2026
Offer Letter
Your Date of Joining is 12-11-2026.
Components Per Annum Per Month
Basic 12,00,000 1,00,000
HRA 6,00,000 50,000
Special Allowance 5,76,000 48,000
Provident Fund 24,000 2,000
Total Cash Component 24,00,000 2,00,000
Gratuity 57,720 4,810
Joining Bonus Clause:
You shall be paid a Joining Bonus of INR 100000 as a one-time payment upon successful completion of the probation period.
This Joining Bonus shall be subject to a claw back period of 12 months, commencing from the date of payment of the bonus. If you resign during this period, the full amount shall be recovered.
Initially, you will be on probation for a period of 90 Day(s) from the date of your joining.`;

function read() {
  const docs = [docFromText(OFFER, 'offer.pdf'), docFromText(HIKE, 'appraisal.pdf'), docFromText(TAX, 'tax.pdf'), docFromText(RESIGN, 'resignation.eml'), docFromText(NEXT, 'next.pdf')];
  return assignDocs([blankJob('New job', '2026-04-01')], docs, 2026);
}

describe('papers that add up together', () => {
  it('the group company\'s other name goes to the same job: same employee code, same joining date', () => {
    const r = read();
    expect(r.unassigned).toEqual([]);
    const job = r.employers.find((e) => /northwind/i.test(e.name))!;
    expect(job.docs.map((d) => d.kind).sort()).toEqual(['appraisal', 'offer', 'resignation', 'taxsheet']);
  });

  it('a name match with nothing to back it is still asked about', () => {
    const slip = docFromText('Northwind Energy Limited\nPayslip for the month of June 2026\nBasic 60,000\nNet Pay 1,00,000', 'june.pdf');
    const r = assignDocs([blankJob('New job', '2026-04-01')], [docFromText(OFFER, 'offer.pdf'), slip], 2026);
    expect(r.unassigned.map((d) => d.name)).toEqual(['june.pdf']);
  });

  it('the joining date, the real breakup and the hike come from the tax sheet', () => {
    const job = read().employers.find((e) => /northwind/i.test(e.name))!;
    const a = applyDocs(job, {}, bundledRules);
    expect(a.emp.start).toBe('2025-01-20');
    expect(a.emp.structure).toMatchObject({ basic: 60000, hra: 30000 });
    expect(a.emp.structure.others).toEqual([{ name: 'Car Monetary Allowance', amount: 20000 }]);
    const ev = applyEvents(a.emp, bundledRules, '2026-04');
    expect(ev.emp.revisions).toHaveLength(1);
    expect(ev.emp.revisions[0]).toMatchObject({ from: '2026-07', scaled: false, structure: { basic: 70000, hra: 35000 } });
    expect(ev.emp.end).toBe('2026-11-11');
    // Undated sheet: tax so far is as of its last recorded month, so it isn't taken as too high.
    expect(a.ytdTds?.asOf?.slice(0, 7)).toBe('2026-09');
  });

  it('PF up with the same basic and pay down by as much: out of the allowance', () => {
    const job = read().employers.find((e) => /northwind/i.test(e.name))!;
    expect(pfRiseFromMonths(job.docs)).toBe('allowance');
  });

  it('a month at its own pay level (joining mid-month) is not read as a full month', () => {
    const d = docFromText(TAX, 'tax.pdf');
    d.facts!.monthly!['2026-04'].pay!.basic = 30000;
    d.facts!.monthly!['2026-05'].pay!.basic = 60000;
    expect(sheetSlips(d).map((s) => s.docDate)).toEqual(['2026-06-01', '2026-09-01']);
  });

  it('the next offer: TCC is the CTC, gratuity below it is outside, and the joining bonus terms', () => {
    const job = read().employers.find((e) => /zeta/i.test(e.name))!;
    const ev = applyEvents(applyDocs(job, {}, bundledRules).emp, bundledRules, '2026-04');
    expect(ev.emp.ctc).toBe(2_400_000);
    expect(reconcile(ev.emp, ev.emp.structure, '2026-11', bundledRules)?.ok).toBe(true);
    const jb = ev.emp.oneTimes.find((o) => o.kind === 'joining')!;
    expect(jb).toMatchObject({ amount: 100000, month: '2027-02', clawbackMonths: 12, clawbackFrom: 'payment' });
    expect(ev.notes.join(' ')).toMatch(/pays the joining bonus once your 3 months' probation is over/);
  });

  it('"a claw back period of 12 months" is the repayment window', () => {
    expect(findClawbackTerms('Joining Bonus of INR 50,000. It is subject to a claw back period of 12 months; it will be recovered if you resign.', 'joining')?.months).toBe(12);
  });

  it('without the hike letter, the tax sheet\'s pay change is a dated hike, and nothing asks whether pay changed', () => {
    const docs = [docFromText(OFFER, 'offer.pdf'), docFromText(TAX, 'tax.pdf'), docFromText(RESIGN, 'resignation.eml')];
    const job = assignDocs([blankJob('New job', '2026-04-01')], docs, 2026).employers.find((e) => /northwind/i.test(e.name))!;
    const ev = applyEvents(applyDocs(job, {}, bundledRules).emp, bundledRules, '2026-04');
    expect(ev.emp.structure.basic).toBe(60000);
    expect(ev.emp.revisions.map((r) => [r.from, r.structure.basic])).toEqual([['2026-07', 70000]]);
    expect(ev.notes.join(' ')).not.toMatch(/if you've had a hike since/);
    expect(staleSalary(ev.emp, 2026, '2026-10-01')).toBeUndefined();
  });

  it('a file read by an older reader is read again, keeping the type you chose', () => {
    const old = { ...docFromText(HIKE, 'appraisal.pdf'), kind: 'offer' as const, facts: {} };
    expect(rereadDoc(old).kind).toBe('appraisal');
    expect(rereadDoc(old).facts?.employeeCode).toBe('12345');
    expect(rereadDoc({ ...old, kindByUser: true }).kind).toBe('offer');
  });
});
