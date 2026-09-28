import { describe, expect, it } from 'vitest';
import { compute } from '../../domain/compute';
import { itr1Guide } from '../../domain/itr1';
import type { Scenario } from '../../domain/types';
import { bundledRules } from '../../rules';
import { parseForm16 } from '../form16';
import { blankJob, docFromText } from '../intake';

const F16 = `FORM NO. 16
[See rule 31(1)(a)]
PART A
Certificate under Section 203 of the Income-tax Act, 1961 for tax deducted at source on salary
Name and address of the Employer: Acme Software Private Limited, Pune
PAN of the Deductor AAACA1234B   TAN of the Deductor PNEA12345C
Assessment Year 2027-28
Summary of amount paid/credited and tax deducted at source thereon in respect of the employee
Quarter   Receipt Numbers   Amount paid/credited   Amount of tax deducted   Amount of tax deposited
Q1        QWERTYUI          4,00,000.00            30,000.00                30,000.00
Q2        ASDFGHJK          8,50,000.00            1,15,000.00              1,15,000.00
Total (Rs.)                 12,50,000.00           1,45,000.00              1,45,000.00
PART B (Annexure)
Details of Salary Paid and any other income and tax deducted
1. Gross Salary
(a) Salary as per provisions contained in section 17(1)   14,20,000.00
(b) Value of perquisites under section 17(2)   0.00
(c) Profits in lieu of salary under section 17(3)   60,000.00
(d) Total   14,80,000.00
2. Less: Allowances to the extent exempt under section 10
Total amount of exemption claimed under section 10   43,776.00
4. Less: Deductions under section 16
(a) Standard deduction under section 16(ia)   75,000.00
(c) Tax on employment under section 16(iii)   0.00
6. Income chargeable under the head "Salaries"   13,61,224.00`;

describe('Form 16', () => {
  it('reads Part A TDS and the Part B salary schedule', () => {
    expect(parseForm16(F16)).toEqual({ s171: 1420000, s172: 0, s173: 60000, exempt: 43776, sd: 75000, pt: 0, chargeable: 1361224, nps: undefined, tds: 145000, tan: 'PNEA12345C', part: 'AB' });
  });
  it('filing uses its actuals over the projection, per employer', () => {
    const d = docFromText(F16, 'form16.pdf');
    expect(d.kind).toBe('taxsheet');
    expect(d.fy).toBe(2026);
    const withF16 = { ...blankJob('Acme Software Private Limited', '2025-01-22'), end: '2026-11-13', docs: [d] };
    const next = { ...blankJob('Next Co', '2026-11-14') };
    const s: Scenario = { fy: 2026, today: '2027-06-20', employers: [withF16, next], settings: { thirtyDayMonth: false, nextFyHike: 0 } };
    const g = itr1Guide(compute(s, bundledRules), s, bundledRules);
    expect(g.sources).toEqual([
      { name: 'Acme Software Private Limited', form16: true },
      { name: 'Next Co', form16: false },
    ]);
    const acme = g.recon[0];
    expect(acme).toMatchObject({ gross: 1480000, exempt: 43776, tds: 145000, tan: 'PNEA12345C' });
  });
});
