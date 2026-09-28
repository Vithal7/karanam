/** Inputs from the third review. Each went wrong once; kept so they can't come back. */
import { describe, expect, it } from 'vitest';
import { compute } from '../../domain/compute';
import type { DocRecord, Employment, Scenario } from '../../domain/types';
import { bundledRules } from '../../rules';
import { withOffer } from '../../ui/Compare';
import { applyEvents } from '../events';
import { assignDocs, blankJob, docFromText, docsFromText } from '../intake';
import { applyDocs } from '../merge';
import { isNote, parseNote } from '../note';
import { parseText } from '../parse';

const note = (t: string) => parseNote(t, 'Pasted text');
const typed = (t: string) => docsFromText(t, 'Pasted text', true).docs;
const SUZLON = `Suzlon Global Services Limited
Date: 20/01/2025
Letter of Appointment
Your date of joining is 20th January 2025.
Component  ANNUAL (INR)  MONTHLY (INR)
Basic Salary  8,10,000  67,500
HRA  4,05,000  33,750
Miscellaneous Allow  5,24,520  43,710
Total CTC  18,00,000`;
const letter = () => docFromText(SUZLON, 'suzlon.pdf');

describe('1. a similar company name: ask before grouping or splitting', () => {
  it('a payslip from "Suzlon Energy Limited" is asked about, and never pushes the letter out', () => {
    const slip = docFromText('Suzlon Energy Limited\nPayslip for the month of August 2026\nBasic 67,500\nHRA 33,750\nNet Pay 1,20,000', 'aug.pdf');
    const r = assignDocs([blankJob('New job', '2026-04-01')], [letter(), slip], 2026);
    expect(r.aside).toEqual([]);
    expect(r.employers.length).toBe(1);
    expect(r.unassigned.map((d) => [d.name, d.similarTo])).toEqual([['aug.pdf', r.employers[0].id]]);
  });
});

describe('2. the order files come in does not matter', () => {
  it('a note about leaving "Suzlon Energy" first, then the letter', () => {
    const first = assignDocs([blankJob('New job', '2026-04-01')], typed('resigned from Suzlon Energy on 3 Sep 2026, LWD 11 Nov 2026'), 2026);
    const then = assignDocs(first.employers, [letter()], 2026);
    expect(then.employers.length + then.unassigned.length).toBe(then.unassigned.length ? 2 : 1);
    // Either one job, or the letter is asked about: never two silent jobs.
    if (!then.unassigned.length) expect(then.employers[0].docs.length).toBe(2);
  });
});

describe('3. "hike" in an offer note', () => {
  it('stays an offer', () => {
    for (const t of ['Switching to Zeta at 25 LPA (35% hike). Joining 1 Dec 2026. LWD 30 Nov 2026', 'Got 40% hike in new offer, 25 LPA, joining 1 Dec 2026', 'Zeta is offering 25 LPA with 50% hike']) {
      const n = note(t);
      expect(n.hike, t).toBeUndefined();
      expect(n.offer?.fields.ctc, t).toBe(2500000);
    }
  });
});

describe('4. "joining" + a date or an adverb is not a company', () => {
  it('no phantom companies', () => {
    for (const t of ['offer from Zeta 25 LPA, joining Nov 12, 2026', 'offer from Zeta 25 LPA. Joining December 1st', 'offer from Zeta 25 LPA, joining immediately', 'Zeta offer: 25 LPA, joining tomorrow']) {
      const n = note(t);
      expect(n.offer?.employer, t).toBe('Zeta');
      expect(n.alternatives, t).toEqual([]);
    }
    expect(note('Joining Dec 1 at Zeta, 25 LPA').offer?.employer).toBe('Zeta');
  });
});

describe('5. a company name on its own line in a note', () => {
  it('is still a note', () => {
    expect(isNote('Offer from BP Pvt Ltd\n36 LPA, joining 12 Nov 2026')).toBe(true);
    expect(isNote('Got offer from Zeta Technologies Pvt Ltd\nCTC 25 LPA\nJoining 1 Dec 2026')).toBe(true);
    expect(isNote('i got a job offer from bp pvt ltd\n34.2 base, joining 12 Nov 2026')).toBe(true);
    expect(isNote('Acme Technologies Private Limited\nOffer: CTC 18 LPA, joining 1 Dec 2026.')).toBe(false);
  });
});

describe('8. "Rs." does not end a sentence', () => {
  it('reads the amounts', () => {
    expect(note('offer from Zeta, CTC Rs. 18,00,000').offer!.fields.ctc).toBe(1800000);
    const o = note('offer from Zeta: Fixed CTC Rs. 25,00,000 p.a. Variable Rs. 2,50,000 p.a.').offer!;
    expect(o.fields.ctc).toBe(2750000);
    expect(o.fields.variable).toBe(250000);
    expect(note('offer from Zeta: basic Rs. 60,000 p.m., CTC 18 LPA').offer!.fields.basic).toBe(60000);
  });
});

describe('9. stated allowances, matched to the fixed pay', () => {
  it('special allowance is read, and the rest of fixed pay is an allowance', () => {
    const o = note('Offer from Zeta: basic 60000 per month, hra 30000 pm, special 40000 pm').offer!;
    expect(o.fields.special).toBe(40000);
    const f = note('Offer from Zeta: fixed 18 LPA, basic 60000 per month, hra 30000 pm, special 40000 pm').offer!;
    expect(f.fields.special).toBe(40000);
    const other = Object.entries(f.fields).find(([k]) => k.startsWith('other:'));
    expect(other?.[1]).toBe(150000 - 60000 - 30000 - 40000 - 3000);
  });
});

describe('10. current job figures stay with the current job', () => {
  it('hike before an offer', () => {
    const n = note('Got a hike to 22 LPA from July 2026. Also got an offer from Zeta 28 LPA');
    expect(n.offer!.fields.ctc).toBe(2800000);
    expect(n.hike?.facts?.revisedCtc).toBe(2200000);
  });
  it('joined, hiked, then an offer', () => {
    expect(note('joined Acme in June 2024 at 12 LPA. got hiked to 15 LPA in April 2025. now got offer from Zeta 22 LPA').offer!.fields.ctc).toBe(2200000);
  });
  it('"offered X vs my current Y"', () => {
    const n = note('Zeta offered 25 LPA vs my current 18 LPA');
    expect(n.offer!.fields.ctc).toBe(2500000);
    expect(n.current?.facts?.revisedCtc).toBe(1800000);
  });
  it('"40% more than my current basic"', () => {
    expect(note('offer from Zeta: basic 80,000 per month which is 40% more than my current basic').offer!.fields.basic).toBe(80000);
  });
});

describe('11. a date with no year next to 1 April is asked about', () => {
  it('last day and joining keep this year, and ask', () => {
    const n = note('offer from BP 36 LPA, joining 1st April. LWD 31st March at Suzlon');
    expect(n.exit!.facts!.yearGuess?.field).toBe('lastWorkingDay');
    expect(n.exit!.facts!.yearGuess!.options.length).toBe(2);
    expect(n.offer!.facts!.yearGuess?.field).toBe('doj');
    expect(n.offer!.doj! > n.exit!.facts!.lastWorkingDay!).toBe(true);
  });
});

describe('12, 14. hikes in notes', () => {
  it('w.e.f., "promoted in", a hike amount', () => {
    expect(note('salary revised to 25 LPA w.e.f. 1st July 2026').hike!.facts!.effectiveFrom).toBe('2026-07-01');
    const p = note('promoted in July 2026, new CTC 24 LPA').hike!;
    expect(p.facts!.effectiveFrom).toBe('2026-07-01');
    expect(p.facts!.revisedCtc).toBe(2400000);
    expect(note('got 2L hike from April 2026').hike!.facts!.incrementAmount).toBe(200000);
  });
  it('a hike with no date asks for the month', () => {
    const d = typed('salary revised to 25 LPA');
    const e = applyEvents(applyDocs({ ...blankJob('Acme', '2024-06-01'), structure: { ...blankJob('x', '').structure, basic: 50000 }, docs: [letter(), ...d] }, {}, bundledRules).emp, bundledRules, '2026-04');
    expect(e.needs.some((x) => x.askMonth)).toBe(true);
  });
  it('"monthly salary 1,50,000" is a month', () => {
    const o = note('offer from Zeta, monthly salary 1,50,000').offer!;
    expect(o.fields.fixed).toBe(1800000);
    expect(note('offer from Zeta, gross 1.5L per month').offer!.fields.fixed).toBe(1800000);
  });
});

describe('13. a different current CTC is a hike: it changes the breakup', () => {
  it('scales the pay and asks when', () => {
    const d = typed('current CTC 24 LPA at Suzlon');
    const r = applyEvents(applyDocs({ ...blankJob('Suzlon', '2025-01-20'), docs: [letter(), ...d] }, {}, bundledRules).emp, bundledRules, '2026-04');
    expect(r.needs.some((x) => x.askMonth)).toBe(true);
  });
});

describe('16. pasted text is read as your words', () => {
  it('mentions of payslip, Form 16 or regards do not turn it into a document', () => {
    const d = typed('My payslip says basic 67,500. Got offer from BP 36 LPA, joining 12 Nov 2026');
    expect(d.some((x) => x.kind === 'offer' && x.employer === 'BP')).toBe(true);
    expect(d.some((x) => x.kind === 'payslip')).toBe(false);
    expect(typed('offer from Zeta 20 LPA, joining 1 Dec 2026. Thanks & regards')[0].fields.ctc).toBe(2000000);
  });
  it('a pasted salary table keeps its company and joining date', () => {
    const d = typed('Offer from Zeta, joining 1 Dec 2026\nBasic 1,42,500\nHRA 71,250\nSpecial 69,450');
    const o = d.find((x) => x.kind === 'offer')!;
    expect(o.employer).toBe('Zeta');
    expect(o.doj).toBe('2026-12-01');
    expect(o.fields.basic).toBe(142500);
  });
});

describe('17. more ways of writing it', () => {
  it('leaving and left', () => {
    expect(note('Leaving Acme on 30 Nov 2026').exit!.facts!.lastWorkingDay).toBe('2026-11-30');
    expect(note('Left Acme on 31 Jul 2026').exit!.facts!.lastWorkingDay).toBe('2026-07-31');
  });
  it('company of the current job', () => {
    expect(note('Current company Infosys. offer from Zeta 20 LPA').current?.employer ?? note('Current company Infosys. offer from Zeta 20 LPA').exit?.employer).toBe('Infosys');
    expect(note('Resigned on 3 Sep 2026 at Acme, LWD 30 Nov 2026').exit!.employer).toBe('Acme');
    expect(note('joined Acme in June 2024').current!.employer).toBe('Acme');
  });
  it('new employer', () => {
    expect(note('New offer: BP India, 36 LPA').offer!.employer).toBe('BP India');
    expect(note('Starting at Zeta on 1 Dec 2026, 25 LPA').offer!.employer).toBe('Zeta');
    expect(note('Joining Zeta as Senior Engineer on 1 Dec 2026, 25 LPA').offer!.employer).toBe('Zeta');
    expect(note('Offer letter from Acme Corp received, 20 LPA').offer!.employer).toBe('Acme Corp');
  });
  it('dates', () => {
    expect(note('offer from Zeta 25 LPA, joining in December').offer!.doj?.slice(5)).toBe('12-01');
    expect(note("offer from Zeta 25 LPA, joining 12 Nov '26").offer!.doj).toBe('2026-11-12');
  });
  it('"basic 50% of ctc" with the CTC elsewhere', () => {
    const o = note('offer from Zeta 18 LPA, basic 50% of ctc').offer!;
    expect(o.fields.ctc).toBe(1800000);
    expect(o.fields.basic).toBe(75000);
  });
  it('a second offer with no date does not take the first one\'s', () => {
    const n = note('offer from Zeta 25 LPA joining 1 Dec 2026. offer from Omega 28 LPA');
    expect(n.alternatives[0].doj).toBeUndefined();
  });
  it('"Larsen & Toubro Limited" on a letterhead', () => {
    expect(parseText('Larsen & Toubro Limited\nOffer of Employment\nBasic 50,000').employer).toBe('Larsen & Toubro Limited');
  });
});

const job = (extra: Partial<Employment> = {}): Employment => ({
  id: 'j',
  name: 'A',
  start: '2024-06-01',
  end: '',
  structure: { basic: 100000, hra: 50000, special: 50000, others: [], epfMode: 'statutory', epf: 0, pt: 200, npsPct: 0, npsInGross: false },
  revisions: [],
  oneTimes: [],
  recoveries: [],
  ctc: 0,
  tdsKnown: {},
  form12B: 'second',
  docs: [] as DocRecord[],
  ...extra,
});
const scenario = (employers: Employment[], today = '2026-09-27'): Scenario => ({ fy: 2026, today, settings: { thirtyDayMonth: false, nextFyHike: 0 }, employers });

describe('6. no TDS from a month with no pay', () => {
  it('a fully unpaid month has no TDS and in-hand is never negative', () => {
    const r = compute(scenario([job({ lopDays: { '2026-12': 31 } })]));
    const dec = r.employers[0].lines.find((l) => l.month === '2026-12')!;
    expect(dec.tds).toBe(0);
    expect(r.employers[0].lines.every((l) => l.inHand >= 0)).toBe(true);
  });
});

describe('18. a fresher weighing two offers', () => {
  it('the only job, not started yet, is replaced', () => {
    const zeta = job({ id: 'z', name: 'Zeta', start: '2026-12-01', startSource: 'doc' });
    const omega = job({ id: 'o', name: 'Omega', start: '2026-11-15', startSource: 'doc' });
    const { s } = withOffer(scenario([zeta]), omega);
    expect(s.employers.map((e) => e.name)).toEqual(['Omega']);
  });
});
