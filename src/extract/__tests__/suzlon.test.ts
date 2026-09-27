import { describe, expect, it } from 'vitest';
import { reconcile } from '../../domain/reconcile';
import { bundledRules } from '../../rules';
import { applyEvents } from '../events';
import { findTdsToDate } from '../facts';
import { blankJob, docFromText } from '../intake';
import { applyDocs } from '../merge';

// The user's real Suzlon salary table (annual column first), with a prose line mentioning an allowance.
const LETTER = `Suzlon Global Services Limited
Date: 20/01/2025
Letter of Appointment
Your date of joining is 20th January 2025.
You will be entitled to a conveyance allowance as per policy. Mobile reimbursement up to Rs. 100 per month.
Component  ANNUAL (INR)  MONTHLY (INR)
Basic Salary  8,10,000  67,500
HRA  4,05,000  33,750
Miscellaneous Allow  5,24,520  43,710
PF  21,600  1,800
Gratuity  38,880  3,240
CTC  18,00,000  1,50,000
Variable pay(IN Total CTC)  3,60,000  30,000
Total CTC  21,60,000
*Employee's P.F. contribution of equal amount will be deducted from monthly salary.`;

const build = (text: string) => {
  const d = docFromText(text, 'Vithal Suzlon Appointment Letter (1).pdf');
  return applyEvents(applyDocs({ ...blankJob('Job 1', '2026-04-01'), docs: [d] }, {}, bundledRules).emp, bundledRules, '2026-04').emp;
};

describe("the user's Suzlon letter", () => {
  const e = build(LETTER);
  it('reads every component, and nothing from the prose', () => {
    expect(e.structure.basic).toBe(67500);
    expect(e.structure.hra).toBe(33750);
    expect(e.structure.special).toBe(43710);
    expect(e.structure.others).toEqual([]);
    expect(e.variable?.annual).toBe(360000);
    expect(e.ctc).toBe(2160000);
  });
  it('adds up: CTC - PF - gratuity - variable = monthly gross', () => {
    const r = reconcile(e, e.structure, '2025-01', bundledRules)!;
    expect(r.employerPf).toBe(1800);
    expect(r.gratuity).toBe(3240);
    expect(r.variable).toBe(30000);
    expect(r.impliedMonthly).toBe(144960);
    expect(r.fixedMonthly).toBe(144960);
    expect(r.ok).toBe(true);
  });
  it('still reads the row when the label and its figures land on separate lines', () => {
    const split = build(LETTER.replace('Miscellaneous Allow  5,24,520  43,710', 'Miscellaneous Allow\n5,24,520  43,710'));
    expect(split.structure.special).toBe(43710);
  });
  it('keeps a salary row with an unfamiliar name as an allowance', () => {
    const odd = build(LETTER.replace('Miscellaneous Allow  5,24,520  43,710', 'Suzlon Pay Plus  5,24,520  43,710'));
    expect(odd.structure.others.map((o) => o.amount)).toContain(43710);
  });
});

describe('tax sheet rows', () => {
  it('does not take a gross or taxable income row as tax paid', () => {
    expect(findTdsToDate('Gross income on which tax deducted 12,04,343')).toBeUndefined();
    expect(findTdsToDate('Taxable income (tax paid basis) 12,04,343\nTDS deducted  96,660')).toBe(96660);
  });
});
