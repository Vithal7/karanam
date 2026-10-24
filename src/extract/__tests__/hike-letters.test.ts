/** Hike letters worded or laid out in ways that once read as a second offer, or as the old pay. */
import { describe, expect, it } from 'vitest';
import { bundledRules } from '../../rules';
import { applyEvents } from '../events';
import { classifyDoc } from '../facts';
import { assignDocs, blankJob, docFromText } from '../intake';
import { applyDocs } from '../merge';
import { reconcile, salaryNow } from '../../domain/reconcile';

const OFFER = `Acme Technologies Pvt Ltd
Date: 10/06/2023
Offer Letter
We are pleased to offer you the position of Engineer. Your date of joining is 1st July 2023.
Component Monthly Annual
Basic 50,000 6,00,000
HRA 25,000 3,00,000
Special Allowance 37,500 4,50,000
Total CTC 15,00,000`;

const TAX = `Acme Technologies Pvt Ltd
Income Tax Computation FY 2026-27
Tax deducted till date 60,000`;

const NEXT = `Zeta Systems Pvt Ltd
Date: 01/09/2026
Offer Letter
We are pleased to offer you. Your date of joining is 1st December 2026.
Basic 1,00,000 per month
HRA 50,000 per month
Total CTC 30,00,000`;

/** The current job's hikes after reading all four files. */
function hikesWith(hike: string) {
  const docs = [docFromText(OFFER, 'offer.pdf'), docFromText(hike, 'hike.pdf'), docFromText(TAX, 'tax.pdf'), docFromText(NEXT, 'new.pdf')];
  const { employers } = assignDocs([blankJob('New job', '2026-04-01')], docs, 2026);
  const acme = employers.find((e) => /acme/i.test(e.name))!;
  expect(acme.docs.find((d) => d.name === 'hike.pdf')?.kind).toBe('appraisal');
  return applyEvents(applyDocs(acme, {}, bundledRules).emp, bundledRules, '2026-04').emp.revisions;
}

describe('hike letters', () => {
  it('"your salary has been revised to" is a hike', () => {
    const t = `Acme Technologies Pvt Ltd\nDate: 12 June 2026\nDear Ravi,\nYour salary has been revised to Rs. 18,00,000 per annum effective 1 April 2026.`;
    expect(classifyDoc(t)).toBe('appraisal');
    const [r] = hikesWith(t);
    expect(r.from).toBe('2026-04');
    expect(r.ctc).toBe(1_800_000);
  });

  it('a "Date of Joining" field in the employee details does not make it an offer', () => {
    const t = `Acme Technologies Pvt Ltd
Compensation Letter
Employee Name: Ravi   Employee Code: AC123   Date of Joining: 01-Jul-2023
Date: 12 June 2026
We are pleased to inform you that your compensation has been revised as below, effective 1st April 2026.
Annexure
Component Monthly Annual
Basic 60,000 7,20,000
HRA 30,000 3,60,000
Special Allowance 45,000 5,40,000
Total CTC 1,50,000 18,00,000`;
    expect(classifyDoc(t)).toBe('appraisal');
    const [r] = hikesWith(t);
    expect(r.structure.basic).toBe(60_000);
  });

  it('a "Current | Revised" table gives the new pay', () => {
    const t = `Acme Technologies Pvt Ltd
Date: 12 June 2026
Salary Revision
Component Current Revised
Basic 50,000 60,000
HRA 25,000 30,000
Special Allowance 37,500 45,000
Total CTC (annual) 15,00,000 18,00,000
Effective from 1st April 2026.`;
    const [r] = hikesWith(t);
    expect(r.structure).toMatchObject({ basic: 60_000, hra: 30_000, special: 45_000 });
  });

  it('monthly and annual columns for each, with an increase column', () => {
    const t = `Acme Technologies Pvt Ltd
Date: 12 June 2026
Salary Revision effective from 1st April 2026
Component Existing (Monthly / Annual) Increase Revised (Monthly / Annual)
Basic 50,000 6,00,000 10,000 1,20,000 60,000 7,20,000
HRA 25,000 3,00,000 5,000 60,000 30,000 3,60,000`;
    const d = docFromText(t, 'hike.pdf');
    expect(d.fields).toMatchObject({ basic: 60_000, hra: 30_000 });
  });

  it('an offer letter still reads as an offer', () => {
    expect(classifyDoc(OFFER)).toBe('offer');
    expect(classifyDoc(`Acme Technologies Pvt Ltd\nDate of Joining: 01-Jul-2026\nYour date of joining is 1 July 2026.\nYou will be eligible for an annual increment.`)).toBe('offer');
  });

  it('the salary now is the hike in effect, checked against its own CTC less the variable part', () => {
    const t = `Acme Technologies Pvt Ltd
Date: 15 June 2026
Your total annual compensation (TCTC) has been revised to Rs. 24,00,000/- effective 1st April, 2026.
Component Amount (Rs. per annum)
Fixed CTC 20,00,000/-
Variable CTC 4,00,000/-
Total CTC 24,00,000/-`;
    const docs = [docFromText(OFFER, 'offer.pdf'), docFromText(t, 'hike.pdf')];
    const job = assignDocs([blankJob('New job', '2026-04-01')], docs, 2026).employers[0];
    const emp = applyEvents(applyDocs(job, {}, bundledRules).emp, bundledRules, '2026-04').emp;
    expect(emp.revisions[0]).toMatchObject({ ctc: 2_400_000, variable: 400_000 });
    const now = salaryNow(emp, '2026-10-01');
    expect(now.index).toBe(0);
    expect(now.emp.ctc).toBe(2_400_000);
    expect(now.emp.variable?.annual).toBe(400_000);
    expect(reconcile(now.emp, now.structure, now.month, bundledRules)?.variable).toBeCloseTo(400_000 / 12);
    // Before the hike starts, it's the joining salary.
    expect(salaryNow(emp, '2026-03-15').index).toBe(-1);
  });
});
