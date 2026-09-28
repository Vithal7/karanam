import { describe, expect, it } from 'vitest';
import { reconcile } from '../../domain/reconcile';
import { bundledRules } from '../../rules';
import { applyEvents } from '../events';
import { findTdsToDate } from '../facts';
import { blankJob, docFromText } from '../intake';
import { applyDocs } from '../merge';

// An appointment letter's salary table (annual column first), with a prose line mentioning an allowance.
const LETTER = `Northwind Global Services Limited
Date: 22/01/2025
Letter of Appointment
Your date of joining is 22nd January 2025.
You will be entitled to a conveyance allowance as per policy. Mobile reimbursement up to Rs. 100 per month.
Component  ANNUAL (INR)  MONTHLY (INR)
Basic Salary  7,20,000  60,000
HRA  3,72,000  31,000
Miscellaneous Allow  6,49,200  54,100
PF  21,600  1,800
Gratuity  37,200  3,100
CTC  18,00,000  1,50,000
Variable pay(IN Total CTC)  2,40,000  20,000
Total CTC  20,40,000
*Employee's P.F. contribution of equal amount will be deducted from monthly salary.`;

const build = (text: string) => {
  const d = docFromText(text, 'Kiran Northwind Appointment Letter (1).pdf');
  return applyEvents(applyDocs({ ...blankJob('Job 1', '2026-04-01'), docs: [d] }, {}, bundledRules).emp, bundledRules, '2026-04').emp;
};

describe("an appointment letter with the annual column first", () => {
  const e = build(LETTER);
  it('reads every component, and nothing from the prose', () => {
    expect(e.structure.basic).toBe(60000);
    expect(e.structure.hra).toBe(31000);
    expect(e.structure.special).toBe(54100);
    expect(e.structure.others).toEqual([]);
    expect(e.variable?.annual).toBe(240000);
    expect(e.ctc).toBe(2040000);
  });
  it('adds up: CTC - PF - gratuity - variable = monthly gross', () => {
    const r = reconcile(e, e.structure, '2025-01', bundledRules)!;
    expect(r.employerPf).toBe(1800);
    expect(r.gratuity).toBe(3100);
    expect(r.variable).toBe(20000);
    expect(r.impliedMonthly).toBe(145100);
    expect(r.fixedMonthly).toBe(145100);
    expect(r.ok).toBe(true);
  });
  it('still reads the row when the label and its figures land on separate lines', () => {
    const split = build(LETTER.replace('Miscellaneous Allow  6,49,200  54,100', 'Miscellaneous Allow\n6,49,200  54,100'));
    expect(split.structure.special).toBe(54100);
  });
  it('keeps a salary row with an unfamiliar name as an allowance', () => {
    const odd = build(LETTER.replace('Miscellaneous Allow  6,49,200  54,100', 'Northwind Pay Plus  6,49,200  54,100'));
    expect(odd.structure.others.map((o) => o.amount)).toContain(54100);
  });
});

describe('tax sheet rows', () => {
  it('does not take a gross or taxable income row as tax paid', () => {
    expect(findTdsToDate('Gross income on which tax deducted 12,04,343')).toBeUndefined();
    expect(findTdsToDate('Taxable income (tax paid basis) 12,04,343\nTDS deducted  96,660')).toBe(96660);
  });
});
