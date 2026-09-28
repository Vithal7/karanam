/** Inputs from the fourth review. Each went wrong once; kept so they can't come back. */
import { describe, expect, it } from 'vitest';
import type { Employment, Scenario } from '../../domain/types';
import { withOffer } from '../../ui/Compare';
import { assignDocs, blankJob, docFromText, docsFromText } from '../intake';
import { parseNote } from '../note';

const note = (t: string) => parseNote(t, 'Pasted text');
const typed = (t: string) => docsFromText(t, 'Pasted text', true).docs;
const SUZLON = `Suzlon Global Services Limited
Date: 20/01/2025
Letter of Appointment
Your date of joining is 20th January 2025.
Component  ANNUAL (INR)  MONTHLY (INR)
Basic Salary  8,10,000  67,500
HRA  4,05,000  33,750
Total CTC  18,00,000`;
const letter = () => docFromText(SUZLON, 'suzlon.pdf');
const slip = (m: string) => docFromText(`Suzlon Energy Limited\nPayslip for the month of ${m} 2026\nBasic 67,500\nHRA 33,750\nNet Pay 1,20,000`, `${m}.pdf`);

describe('3. one question per company name', () => {
  it('three payslips from "Suzlon Energy Limited": one question', () => {
    const r = assignDocs([blankJob('New job', '2026-04-01')], [letter(), slip('June'), slip('July'), slip('August')], 2026);
    const asked = r.unassigned.filter((d) => d.similarTo);
    expect(asked.length).toBe(3);
    expect(new Set(asked.map((d) => d.similarKey)).size).toBe(1);
  });
});

describe('4. the same name with a later joining date', () => {
  it('is not asked "same employer as itself"', () => {
    const rejoin = docFromText(SUZLON.replace('20th January 2025', '1st December 2026').replace('20/01/2025', '01/11/2026'), 'rejoin.pdf');
    const r = assignDocs([blankJob('New job', '2026-04-01')], [letter(), rejoin], 2026);
    expect(r.unassigned.filter((d) => d.similarTo)).toEqual([]);
  });
});

describe('5. typed text the note reader does not understand', () => {
  it('goes to "which job is this for?", never a new job', () => {
    const r = assignDocs([blankJob('New job', '2026-04-01')], [letter()], 2026);
    const t = assignDocs(r.employers, typed('My CTC increased to 20 LPA from 1st April 2026'), 2026);
    expect(t.employers.length).toBe(1);
  });
  it('"percent" is a percentage', () => {
    const h = note('Got 10 percent increment in April 2026').hike!;
    expect(h.facts!.incrementPct).toBe(0.1);
    expect(h.facts!.incrementAmount).toBeUndefined();
  });
});

describe('6. a note never names your current job after the offer', () => {
  it('the resignation stays with the job you have', () => {
    const r = assignDocs([blankJob('New job', '2026-04-01')], [letter(), ...typed('got offer from Zeta 30 LPA joining 12 Nov 2026. resigned on 3 Sep 2026, lwd 11 Nov 2026, 22 leaves')], 2026);
    const suz = r.employers.find((e) => /suzlon/i.test(e.name))!;
    expect(suz.docs.some((d) => d.kind === 'resignation')).toBe(true);
  });
});

describe('9, 10. hikes and offers in one note', () => {
  it('"Ltd." before a capital ends the sentence', () => {
    const n = note('Got hike to 22 LPA at Infosys Ltd. Offer from Zeta 28 LPA, joining 1 Dec 2026');
    expect(n.offer!.fields.ctc).toBe(2800000);
    expect(n.hike?.facts?.revisedCtc).toBe(2200000);
  });
  it('"New CTC" in a hike sentence is the hike', () => {
    const n = note('Got promoted. New CTC 24 LPA from 1 Oct 2026. Also have an offer from Zeta for 30 LPA');
    expect(n.offer!.fields.ctc).toBe(3000000);
    expect(n.hike?.facts?.revisedCtc).toBe(2400000);
  });
  it('"hike of 50% over current" in an offer note sizes the offer', () => {
    const n = note('Joining Zeta on 1 Jan 2027. Hike of 50% over current CTC of 18 LPA.');
    expect(n.hike).toBeUndefined();
    expect(n.offer!.fields.ctc).toBe(2700000);
    const m = note('Joining Zeta on 1 Jan 2027. Hike of 50% over current.');
    expect(m.hike).toBeUndefined();
    expect(m.offer!.facts!.hikeOverCurrent).toBe(0.5);
  });
});

describe('11. more wordings', () => {
  it('reads them', () => {
    expect(note('Salary hiked by 10% from April 2026').hike!.facts!.incrementPct).toBe(0.1);
    expect(note('my salary is now 20 LPA').current!.facts!.revisedCtc ?? note('my salary is now 20 LPA').current!.fields.ctc).toBe(2000000);
    expect(note('offer from Zeta 20 LPA, Rs 50 thousand relocation').offer!.facts!.relocation!.amount).toBe(50000);
    expect(note('Offer: BP Pvt. Ltd., 36 LPA, joining 12 Nov 2026').offer!.employer).toBe('BP Pvt. Ltd');
    const z = note('Zeta offer 30 LPA vs current 18 LPA');
    expect(z.offer!.employer).toBe('Zeta');
    expect(z.offer!.fields.ctc).toBe(3000000);
    const bp = note('New job at BP from 12 Nov 2026');
    expect(bp.offer!.employer).toBe('BP');
    expect(bp.offer!.doj).toBe('2026-11-12');
    expect(note('joined in June 2024 at 12 LPA').current!.fields.ctc).toBe(1200000);
    const a = note('appraisal: 20 LPA from Apr-26').hike!;
    expect(a.facts!.revisedCtc).toBe(2000000);
    expect(a.facts!.effectiveFrom).toBe('2026-04-01');
  });
});

describe('12. an offer typed in a note is never held behind "same employer?"', () => {
  it('Tata Motors offer while at Tata Steel', () => {
    const steel = docFromText(SUZLON.replace(/Suzlon Global Services Limited/g, 'Tata Steel Limited'), 'steel.pdf');
    const r = assignDocs([blankJob('New job', '2026-04-01')], [steel, ...typed('offer from Tata Motors 30 LPA joining 1 Dec 2026. resigned on 3 Sep 2026, LWD 30 Nov 2026')], 2026);
    expect(r.unassigned.filter((d) => d.similarTo)).toEqual([]);
    expect(r.employers.map((e) => e.name).sort()).toEqual(['Tata Motors', 'Tata Steel Limited']);
  });
});

const job = (extra: Partial<Employment> = {}): Employment => ({
  id: 'j',
  name: 'A',
  start: '2024-06-01',
  end: '',
  structure: { basic: 60000, hra: 30000, special: 30000, others: [], epfMode: 'statutory', epf: 0, pt: 200, npsPct: 0, npsInGross: false },
  revisions: [],
  oneTimes: [],
  recoveries: [],
  ctc: 0,
  tdsKnown: {},
  form12B: 'second',
  docs: [],
  ...extra,
});
const scenario = (employers: Employment[]): Scenario => ({ fy: 2026, today: '2026-09-28', settings: { thirtyDayMonth: false, nextFyHike: 0 }, employers });

describe('8. comparing a later offer moves an assumed last day', () => {
  it('no unexplained gap', () => {
    const suz = job({ id: 's', name: 'Suzlon', end: '2026-11-11', endSource: 'assumed' });
    const bp = job({ id: 'b', name: 'BP', start: '2026-11-12', startSource: 'doc' });
    const zeta = job({ id: 'z', name: 'Zeta', start: '2027-01-01', startSource: 'doc' });
    const { s } = withOffer(scenario([suz, bp]), zeta);
    expect(s.employers[0].end).toBe('2026-12-31');
  });
});

describe('"Same employer" is remembered', () => {
  it('a later file with that name joins the job without asking', () => {
    const r = assignDocs([blankJob('New job', '2026-04-01')], [letter()], 2026);
    const withAlias = r.employers.map((e) => ({ ...e, aliases: ['suzlon energy'] }));
    const t = assignDocs(withAlias, [slip('September')], 2026);
    expect(t.unassigned).toEqual([]);
    expect(t.employers[0].docs.length).toBe(2);
  });
});
