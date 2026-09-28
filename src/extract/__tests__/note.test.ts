import { describe, expect, it } from 'vitest';
import { docsFromText } from '../intake';
import { isNote, parseNote } from '../note';

const NOTE = `i got a job offer from kv pvt ltd, with 30 base (15 basic, 50% basic HRA, rest special allowance), 1.6 variable payable on pro rata in next financial year. joining on 14th Nov 2026. i have 18 leaves at northwind. resigned on 5th sept, lwd is 13 Nov 2026. they agreed to buyout both joining bonus and leave encashment used for notice adjustment. also 1.2 joining bonus paid in 4th month salary. 40k reimbursable relocation which is tax free`;

describe('a note typed in your own words', () => {
  const n = parseNote(NOTE, 'Pasted text');
  it('is told apart from a letter', () => {
    expect(isNote(NOTE)).toBe(true);
    expect(isNote('ACME Technologies\nOffer of Employment\nBasic Salary 1,25,000 15,00,000\nHRA 62,500 7,50,000\nSpecial 60,700 7,28,400')).toBe(false);
  });
  it('reads the offer: company, joining date, salary in lakhs, variable, joining bonus', () => {
    const o = n.offer!;
    expect(o.employer).toBe('KV Pvt Ltd');
    expect(o.doj).toBe('2026-11-14');
    expect(o.fields.basic).toBe(125000);
    expect(o.fields.hra).toBe(62500);
    expect(o.fields.special).toBe(59500);
    expect(o.fields.variable).toBe(160000);
    expect(o.fields.joining).toBe(120000);
    expect(o.fields.joiningOffset).toBe(3);
  });
  it('reads the buyout (covering the bonus clawback) and a tax-free relocation', () => {
    expect(n.offer!.facts!.buyout).toEqual({ mode: 'actuals', includesClawback: true });
    expect(n.offer!.facts!.relocation).toEqual({ amount: 40000, reimbursement: true });
  });
  it('reads the exit from the current job, with the resignation year worked out', () => {
    const x = n.exit!;
    expect(x.kind).toBe('resignation');
    expect(x.employer).toBe('Northwind');
    expect(x.facts).toMatchObject({ resignationDate: '2026-09-05', lastWorkingDay: '2026-11-13', leaveDays: 18 });
  });
  it('becomes two records', () => {
    expect(docsFromText(NOTE, 'Pasted text').docs.map((d) => d.kind)).toEqual(['offer', 'resignation']);
  });
});

describe('notes written other ways', () => {
  const offer = (t: string) => parseNote(t, 'Pasted text').offer!;
  it('commas, per month and thousands', () => {
    const o = offer('Got an offer from Acme Software: basic 40,000 per month, HRA 20,000 per month, CTC 12,00,000. Joining bonus of 50,000. Relocation 1,00,000 paid on joining.');
    expect(o.fields.basic).toBe(40000);
    expect(o.fields.hra).toBe(20000);
    expect(o.fields.ctc).toBe(1200000);
    expect(o.fields.joining).toBe(50000);
    expect(o.facts!.relocation!.amount).toBe(100000);
  });
  it('"30,00,000" is not 34 lakh', () => {
    expect(offer('Offer from Beta Labs, CTC 30,00,000, joining 1 Dec 2026').fields.ctc).toBe(3000000);
  });
  it('shorthand: LPA, L/month, % of CTC, "joining Google"', () => {
    expect(offer('Joining Google on 5 Jan 2027, 30 LPA').employer).toBe('Google');
    expect(offer('Joining Google on 5 Jan 2027, 30 LPA').fields.ctc).toBe(3000000);
    expect(offer('offer from Zeta, ₹2.5L/month fixed').fields.ctc).toBe(3000000);
    const p = offer('offer from Zeta, CTC 20 LPA, basic 40% of CTC, HRA 50% of basic');
    expect(p.fields.basic).toBe(66667);
    expect(p.fields.hra).toBe(33334);
    expect(offer('offer from Zeta: base 60L, 15% bonus').fields.variable).toBe(900000);
  });
  it('the paste box example (no "I") is a note', () => {
    const ex = 'Got an offer from KV Pvt Ltd: 30 base (15 basic, 50% basic HRA, rest special), 1.6 variable. Joining 14 Nov 2026. Resigned 5 Sept, LWD 13 Nov 2026, 18 leaves at Northwind.';
    expect(isNote(ex)).toBe(true);
    const n = parseNote(ex, 'Pasted text');
    expect(n.offer!.employer).toBe('KV Pvt Ltd');
    expect(n.exit!.employer).toBe('Northwind');
  });
  it('two offers become one offer and one to compare', () => {
    const n = parseNote('Offer A from Acme 25 LPA, joining 1 Dec 2026. Offer B from Beta 28 LPA.', 'Pasted text');
    expect(n.offer!.employer).toBe('Acme');
    expect(n.offer!.fields.ctc).toBe(2500000);
    expect(n.alternatives.map((d) => [d.employer, d.fields.ctc])).toEqual([['Beta', 2800000]]);
  });
  it("an offer's notice period is a term of the new job, not a resignation", () => {
    const n = parseNote('Got my first job offer from Infosys, 6 LPA, joining 1 Aug 2026. Notice period 90 days.', 'Pasted text');
    expect(n.exit).toBeUndefined();
    expect(n.offer!.facts!.noticeDays).toBe(90);
  });
});
