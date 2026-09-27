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
Q1        QWERTYUI          4,34,880.00            34,554.00                34,554.00
Q2        ASDFGHJK          9,29,697.00            1,37,616.00              1,37,616.00
Total (Rs.)                 13,64,577.00           1,72,170.00              1,72,170.00
PART B (Annexure)
Details of Salary Paid and any other income and tax deducted
1. Gross Salary
(a) Salary as per provisions contained in section 17(1)   15,44,923.00
(b) Value of perquisites under section 17(2)   0.00
(c) Profits in lieu of salary under section 17(3)   72,226.00
(d) Total   16,17,149.00
2. Less: Allowances to the extent exempt under section 10
Total amount of exemption claimed under section 10   60,192.00
4. Less: Deductions under section 16
(a) Standard deduction under section 16(ia)   75,000.00
(c) Tax on employment under section 16(iii)   0.00
6. Income chargeable under the head "Salaries"   14,81,957.00`;

describe('Form 16', () => {
  it('reads Part A TDS and the Part B salary schedule', () => {
    expect(parseForm16(F16)).toEqual({ s171: 1544923, s172: 0, s173: 72226, exempt: 60192, sd: 75000, pt: 0, chargeable: 1481957, nps: undefined, tds: 172170, tan: 'PNEA12345C', part: 'AB' });
  });
  it('filing uses its actuals over the projection, per employer', () => {
    const d = docFromText(F16, 'form16.pdf');
    expect(d.kind).toBe('taxsheet');
    expect(d.fy).toBe(2026);
    const withF16 = { ...blankJob('Acme Software Private Limited', '2025-01-20'), end: '2026-11-11', docs: [d] };
    const next = { ...blankJob('Next Co', '2026-11-12') };
    const s: Scenario = { fy: 2026, today: '2027-06-20', employers: [withF16, next], settings: { thirtyDayMonth: false, nextFyHike: 0 } };
    const g = itr1Guide(compute(s, bundledRules), s, bundledRules);
    expect(g.sources).toEqual([
      { name: 'Acme Software Private Limited', form16: true },
      { name: 'Next Co', form16: false },
    ]);
    const acme = g.recon[0];
    expect(acme).toMatchObject({ gross: 1617149, exempt: 60192, tds: 172170, tan: 'PNEA12345C' });
  });
});
