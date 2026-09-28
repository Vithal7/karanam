import { describe, expect, it } from 'vitest';
import { findDate, numbersIn, parseText } from '../parse';

const TABLE = `
ACME Technologies Private Limited
Offer of Employment
Dear Candidate,
We are pleased to offer you the position of Senior Engineer. Your date of joining will be 14th November 2026.

Annexure A - Compensation Structure
Component            Monthly (INR)   Annual (INR)
Basic Salary          1,25,000        15,00,000
House Rent Allowance    62,500         7,50,000
Special Allowance       60,700         7,28,400
Employer PF Contribution 3,000          36,000
Gratuity                               82,251
Total Fixed CTC                       35,16,651
Variable Pay (PLI)                     1,80,000
Total CTC                             36,96,651
Joining Bonus: Rs. 1,50,000 payable with the third month salary.
`;

const PROSE = `
Dear Priya,
Further to our discussions, we are delighted to offer you the role of Analyst at Foo Pvt Ltd.
Your annual CTC will be 18 LPA. Your basic salary will be Rs. 60,000 per month and HRA Rs. 30,000 per month.
You will be eligible for a performance bonus of 10% of CTC.
Please report to our Bangalore office on 01/12/2026.
`;

const PAYSLIP = `
Payslip for the month of August 2026
Earnings Amount Deductions Amount
Basic 72,960 Provident Fund 1,800
HRA 50,160 Professional Tax 200
Special Allowance 43,973 Income Tax 18,019
Net Pay 1,56,194
`;

describe('numbersIn', () => {
  it('handles Indian grouping, units and percents', () => {
    expect(numbersIn('Basic 1,25,000 15,00,000').map((n) => n.value)).toEqual([125000, 1500000]);
    expect(numbersIn('CTC of 18 LPA')[0].value).toBe(1_800_000);
    expect(numbersIn('₹12.5 lakh')[0].value).toBe(1_250_000);
    expect(numbersIn('10% of CTC')[0]).toEqual({ value: 0.1, pct: true });
    expect(numbersIn('joining on 12/11/2026')).toEqual([]);
  });
});

describe('findDate', () => {
  it('parses common Indian formats', () => {
    expect(findDate('14th November 2026')).toBe('2026-11-14');
    expect(findDate('on 01/12/2026')).toBe('2026-12-01');
    expect(findDate('Nov 14, 2026')).toBe('2026-11-14');
    expect(findDate('14-Nov-26')).toBe('2026-11-14');
    expect(findDate('2026-11-14')).toBe('2026-11-14');
  });
});

describe('parseText', () => {
  it('reads a monthly/annual table', () => {
    const r = parseText(TABLE);
    expect(r.kind).toBe('offer');
    expect(r.doj?.date).toBe('2026-11-14');
    expect(r.components.basic?.monthly).toBe(125000);
    expect(r.components.basic?.confidence).toBe('found');
    expect(r.components.hra?.monthly).toBe(62500);
    expect(r.components.special?.monthly).toBe(60700);
    expect(r.components.employerPf?.monthly).toBe(3000);
    expect(r.components.variable?.annual).toBe(180000);
    expect(r.components.joining?.annual).toBe(150000);
    expect(r.components.ctc?.annual).toBe(3696651);
    expect(r.employer).toBe('ACME Technologies Private Limited');
    expect(r.components.joining?.monthOffset).toBe(2);
  });

  it('reads prose with LPA and percent variable', () => {
    const r = parseText(PROSE);
    expect(r.components.ctc?.annual).toBe(1_800_000);
    expect(r.components.basic?.monthly).toBe(60000);
    expect(r.components.hra?.monthly).toBe(30000);
    expect(r.components.variable?.annual).toBe(180000);
    expect(r.doj?.date).toBe('2026-12-01');
  });

  it('reads a payslip as monthly figures', () => {
    const r = parseText(PAYSLIP);
    expect(r.kind).toBe('payslip');
    expect(r.components.basic?.monthly).toBe(72960);
    expect(r.components.hra?.monthly).toBe(50160);
    expect(r.components.special?.monthly).toBe(43973);
  });
});

describe('monthOffsetIn', () => {
  it('reads payout timing phrases', async () => {
    const { monthOffsetIn } = await import('../parse');
    expect(monthOffsetIn('payable with the third month salary')).toBe(2);
    expect(monthOffsetIn('paid in the first month')).toBe(0);
    expect(monthOffsetIn('paid after completion of 6 months')).toBe(6);
    expect(monthOffsetIn('no timing here')).toBeUndefined();
  });
});

describe('document dates and YTD tax', () => {
  it('reads the payslip month and YTD TDS', () => {
    const r = parseText(`Salary Slip for the month of September 2026
Earnings Amount Deductions Current YTD
Basic 72,960 Income Tax 0 1,72,170`);
    expect(r.docDate).toBe('2026-09-01');
    expect(r.ytdTds).toBe(172170);
  });
  it('reads a letter date near the top', () => {
    const r = parseText(`ACME Technologies Private Limited
Date: 15/10/2026
Dear Candidate, your date of joining will be 14th November 2026.`);
    expect(r.docDate).toBe('2026-10-15');
    expect(r.doj?.date).toBe('2026-11-14');
  });
});

describe('findEmployer', async () => {
  const { findEmployer } = await import('../parse');
  it('ignores salary rows that look like names', () => {
    expect(findEmployer('Offer\nComponent Annual\nPerformance Linked Incentive 2,00,000\nBasic 15,00,000')).toBeUndefined();
    expect(
      findEmployer(`LinkedIn Technology Information Private Limited
Offer letter
Performance Linked Incentive 2,00,000`),
    ).toBe('LinkedIn Technology Information Private Limited');
  });
  it('reads upper-case letterheads and prefers the header', () => {
    expect(findEmployer(`NORTHWIND ENERGY LIMITED
Appointment Letter
You will be governed by the policies of Northwind Energy Limited.`)).toBe('Northwind Energy Limited');
  });
});
