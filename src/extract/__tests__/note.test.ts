import { describe, expect, it } from 'vitest';
import { docsFromText } from '../intake';
import { isNote, parseNote } from '../note';

const NOTE = `i got a job offer from bp pvt ltd, with 34.2 base (17.10 basic, 50% basic HRA, rest special allowance), 1.8 variable payable on pro rata in next financial year. joining on 12th Nov 2026. i have 22 leaves at suzlon. resigned on 3rd sept, lwd is 11 Nov 2026. AB agreed to buyout both joining bonus and leave encashment used for notice adjustment. also 1.5 joining bonus paid in 4th month salary. 50k reimbursable relocation which is tax free`;

describe('a note typed in your own words', () => {
  const n = parseNote(NOTE, 'Pasted text');
  it('is told apart from a letter', () => {
    expect(isNote(NOTE)).toBe(true);
    expect(isNote('ACME Technologies\nOffer of Employment\nBasic Salary 1,42,500 17,10,000\nHRA 71,250 8,55,000\nSpecial 69,450 8,33,400')).toBe(false);
  });
  it('reads the offer: company, joining date, salary in lakhs, variable, joining bonus', () => {
    const o = n.offer!;
    expect(o.employer).toBe('BP Pvt Ltd');
    expect(o.doj).toBe('2026-11-12');
    expect(o.fields.basic).toBe(142500);
    expect(o.fields.hra).toBe(71250);
    expect(o.fields.special).toBeGreaterThan(60000);
    expect(o.fields.variable).toBe(180000);
    expect(o.fields.joining).toBe(150000);
    expect(o.fields.joiningOffset).toBe(3);
  });
  it('reads the buyout (covering the bonus clawback) and a tax-free relocation', () => {
    expect(n.offer!.facts!.buyout).toEqual({ mode: 'actuals', includesClawback: true });
    expect(n.offer!.facts!.relocation).toEqual({ amount: 50000, reimbursement: true });
  });
  it('reads the exit from the current job, with the resignation year worked out', () => {
    const x = n.exit!;
    expect(x.kind).toBe('resignation');
    expect(x.employer).toBe('Suzlon');
    expect(x.facts).toMatchObject({ resignationDate: '2026-09-03', lastWorkingDay: '2026-11-11', leaveDays: 22 });
  });
  it('becomes two records', () => {
    expect(docsFromText(NOTE, 'Pasted text').docs.map((d) => d.kind)).toEqual(['offer', 'resignation']);
  });
});
