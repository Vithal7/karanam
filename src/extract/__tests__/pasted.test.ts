/** Pasted text: a pasted document is read like its file; your own words are read as a note. */
import { describe, expect, it } from 'vitest';
import { docsFromText } from '../intake';

const typed = (t: string) => docsFromText(t, 'Pasted text', true).docs;

describe('a pasted document reads like the file', () => {
  it('a payslip', () => {
    const d = typed(`Northwind Global Services Limited
Payslip for the month of August 2026
Employee Code: 12345   Date of Joining: 22/01/2025
Earnings            Amount
Basic               60,000
HRA                 31,000
Miscellaneous Allow 54,100
Gross Earnings      1,45,100
Deductions
Provident Fund      1,800
Professional Tax    200
Income Tax          12,000
Net Pay             1,30,960`);
    expect(d.map((x) => x.kind)).toEqual(['payslip']);
    expect(d[0].fields.basic).toBe(60000);
  });
  it('an F&F statement', () => {
    const d = typed(`Sigma Systems Private Limited
Full and Final Settlement Statement
Last Working Day: 13/11/2026
Leave Encashment (18 days)   36,000
Notice Pay Recovery (21 days) 50,000
Net Payable 1,32,000`);
    expect(d[0].kind).toBe('fnf');
    expect(d[0].facts!.leaveAmount).toBe(36000);
    expect(d[0].facts!.noticeRecoveryAmount).toBe(50000);
  });
  it('an offer letter keeps its company, notice and clawback terms', () => {
    const d = typed(`Zeta Technologies Private Limited
Date: 01/10/2026
Dear Ravi,
We are pleased to offer you the role of Engineer. Your date of joining will be 1st December 2026.
Notice period: 60 days.
Joining Bonus: Rs. 1,00,000 payable with the first salary. It is repayable in full if you resign within 12 months of joining.
Component Monthly Annual
Basic 1,00,000 12,00,000
HRA 50,000 6,00,000
Special Allowance 40,000 4,80,000
Total CTC 23,00,000
Regards, HR`);
    expect(d[0].kind).toBe('offer');
    expect(d[0].employer).toBe('Zeta Technologies Private Limited');
    expect(d[0].doj).toBe('2026-12-01');
    expect(d[0].fields.basic).toBe(100000);
    expect(d[0].facts!.noticeDays).toBe(60);
    expect(d[0].facts!.clawbackTerms?.joining?.months).toBe(12);
  });
});

describe('your own words stay a note', () => {
  it('mentioning a payslip is not a payslip', () => {
    const d = typed('My payslip says basic 60,000. Got offer from KV 36 LPA, joining 14 Nov 2026');
    expect(d.some((x) => x.kind === 'offer' && x.employer === 'KV')).toBe(true);
  });
  it('a note about an offer and leaving a job', () => {
    const d = typed(
      'i got a job offer from kv pvt ltd, with 30 base (15 basic, 50% basic HRA, rest special allowance), 1.6 variable payable on pro rata in next financial year. joining on 14th Nov 2026. i have 18 leaves at northwind. resigned on 5th sept, lwd is 13 Nov 2026.',
    );
    expect(d.map((x) => x.kind).sort()).toEqual(['offer', 'resignation']);
  });
});
