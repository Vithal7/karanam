import { describe, expect, it } from 'vitest';
import { classifyDoc, companyFromEmail, companyKey, extractFacts, findMonthYear } from '../facts';

const APPRAISAL = `Sigma Systems Private Limited
Date: 20/06/2026
Subject: Salary Revision
Dear Priya,
Based on your performance review, we are pleased to inform you of an increment of 21.6% in your compensation.
Your revised annual CTC will be Rs. 21,88,800 with effect from 1st April 2026.
The revised salary and arrears will be paid in July 2026 payroll.`;

const APPRAISAL_FROM_TO = `Sigma Systems Pvt Ltd
Salary revision letter
Your CTC has been revised from ₹18,00,000 to ₹21,60,000 effective April 2026.`;

const RESIGNATION = `From: HR Team <hr@sigma-systems.com>
Date: 12/09/2026
Subject: Acceptance of your resignation
Dear Priya,
We accept your resignation dated 12/09/2026. As per your appointment terms your notice period is 90 days.
Your last working day will be 11th November 2026. The shortfall of 21 days will be recovered in your full and final settlement.
Please note the joining bonus recovery of Rs. 50,000 applies as you are leaving within 12 months.`;

const FNF = `Sigma Systems Private Limited
Full and Final Settlement Statement
Employee: Priya    Last Working Day: 11/11/2026
Earnings                     Amount
Leave Encashment (22 days)   60,192
Gratuity                     0
Deductions
Notice Pay Recovery (21 days) 57,456
Net Payable                  1,45,300
The settlement will be credited in December 2026.`;

const OFFER = `ACME Technologies Private Limited
Offer of Employment
Your date of joining will be 12th November 2026.
Joining Bonus: Rs. 1,50,000 payable with the third month salary. The joining bonus is repayable in full if you resign within 12 months of joining.
We will reimburse your notice period buyout on actuals, up to a maximum of Rs. 1,00,000, against proof of recovery.`;

describe('classifyDoc', () => {
  it('tells documents apart', () => {
    expect(classifyDoc(APPRAISAL)).toBe('appraisal');
    expect(classifyDoc(APPRAISAL_FROM_TO)).toBe('appraisal');
    expect(classifyDoc(RESIGNATION)).toBe('resignation');
    expect(classifyDoc(FNF)).toBe('fnf');
    expect(classifyDoc(OFFER)).toBe('offer');
    expect(classifyDoc('Payslip for the month of August 2026\nBasic 82,080\nNet Pay 1,56,194')).toBe('payslip');
  });
  it("doesn't mistake an offer's relieving-letter requirement for a resignation", () => {
    expect(classifyDoc(`Offer of Employment\nWe are pleased to offer you the role. Date of joining: 1/12/2026.\nPlease bring your relieving letter from your previous employer.`)).toBe('offer');
  });
});

describe('extractFacts', () => {
  it('appraisal: effective date, payout month, % and revised CTC', () => {
    const f = extractFacts(APPRAISAL, 'appraisal');
    expect(f.effectiveFrom).toBe('2026-04-01');
    expect(f.payoutMonth).toBe('2026-07');
    expect(f.incrementPct).toBeCloseTo(0.216, 6);
    expect(f.revisedCtc).toBe(2188800);
  });
  it('appraisal: "from X to Y"', () => {
    const f = extractFacts(APPRAISAL_FROM_TO, 'appraisal');
    expect(f.oldCtc).toBe(1800000);
    expect(f.revisedCtc).toBe(2160000);
    expect(f.effectiveFrom).toBe('2026-04-01');
  });
  it('resignation: LWD, notice, shortfall, clawback', () => {
    const f = extractFacts(RESIGNATION, 'resignation');
    expect(f.lastWorkingDay).toBe('2026-11-11');
    expect(f.resignationDate).toBe('2026-09-12');
    expect(f.noticeDays).toBe(90);
    expect(f.shortfallDays).toBe(21);
    expect(f.clawback).toBe(50000);
  });
  it('F&F slip: amounts and pay month', () => {
    const f = extractFacts(FNF, 'fnf');
    expect(f.lastWorkingDay).toBe('2026-11-11');
    expect(f.leaveDays).toBe(22);
    expect(f.leaveAmount).toBe(60192);
    expect(f.noticeRecoveryAmount).toBe(57456);
    expect(f.shortfallDays).toBe(21);
    expect(f.netPayable).toBe(145300);
    expect(f.fnfPayMonth).toBe('2026-12');
  });
  it('offer: buyout cap and joining bonus clawback', () => {
    const f = extractFacts(OFFER, 'offer');
    expect(f.buyout).toEqual({ mode: 'cap', cap: 100000 });
    expect(f.joiningClawbackMonths).toBe(12);
  });
  it('offer: buyout on actuals without a cap', () => {
    expect(extractFacts('We will reimburse your notice buyout on actuals.', 'offer').buyout).toEqual({ mode: 'actuals' });
  });
});

describe('helpers', () => {
  it('month-year formats', () => {
    expect(findMonthYear('from April 2026 onwards')).toBe('2026-04');
    expect(findMonthYear("Jul'26 payroll")).toBe('2026-07');
    expect(findMonthYear('in 07/2026')).toBe('2026-07');
  });
  it('groups company names', () => {
    expect(companyKey('ACME Technologies Pvt. Ltd.')).toBe(companyKey('Acme'));
    expect(companyKey('Sigma Systems Private Limited')).toBe('sigma');
    expect(companyFromEmail('From: HR <hr@sigma-systems.com>')).toBe('Sigma Systems');
    expect(companyFromEmail('priya@gmail.com')).toBeUndefined();
  });
});
