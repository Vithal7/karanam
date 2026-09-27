import { describe, expect, it } from 'vitest';
import { parseText } from '../parse';

describe('single-column salary tables', () => {
  it('annual-only: every row is a year, PF included', () => {
    const x = parseText(`Offer of Employment
Component  Amount (INR per annum)
Basic  6,00,000
HRA  3,00,000
Special Allowance  2,78,400
LTA  30,000
Employer PF  21,600
Total CTC  12,30,000`);
    expect(x.components.basic!.monthly).toBe(50000);
    expect(x.components.employerPf!.monthly).toBe(1800);
    expect(x.components.lta!.monthly).toBe(2500);
    expect(x.components.ctc!.annual).toBe(1230000);
  });
  it('monthly-only: the total row is a month, not the CTC', () => {
    const x = parseText(`Salary structure (per month)
Basic  50,000
HRA  25,000
Special Allowance  35,000
PF  1,800
Total  1,11,800`);
    expect(x.components.basic!.monthly).toBe(50000);
    expect(x.components.special!.monthly).toBe(35000);
    expect(x.components.ctc!.annual).toBe(1341600);
  });
});
