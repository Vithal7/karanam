/**
 * Inputs a review tried against the generic flows, each of which went wrong once. Kept so they
 * can't come back.
 */
import { describe, expect, it } from 'vitest';
import { compute } from '../../domain/compute';
import type { Employment, Scenario } from '../../domain/types';
import { bundledRules } from '../../rules';
import { applyEvents } from '../events';
import { assignDocs, blankJob, docFromText, docsFromText } from '../intake';
import { applyDocs } from '../merge';
import { isNote, parseNote } from '../note';
import { parseText } from '../parse';
import { needsExGratia, staleSalary } from '../../ui/Questions';
import { fyFor } from '../../state';

const build = (text: string, name = 'letter.pdf') => {
  const docs = docsFromText(text, name).docs;
  return applyEvents(applyDocs({ ...blankJob('Job 1', '2026-04-01'), docs }, {}, bundledRules).emp, bundledRules, '2026-04').emp;
};
const note = (t: string) => parseNote(t, 'Pasted text');

describe('1. one prose sentence does not decide how a table is read', () => {
  const MONTHLY = `Salary structure (per month)
Basic  50,000
HRA  25,000
Special Allowance  35,000
PF  1,800
Total  1,11,800`;
  it('"reviewed annually" above a monthly table', () => {
    expect(parseText(`Offer of employment\nYour salary will be reviewed annually.\n${MONTHLY}`).components.basic!.monthly).toBe(50000);
  });
  it('"paid monthly" above an annual table', () => {
    const x = parseText(`Offer of employment
Your salary shall be paid monthly.
Component  Amount (INR per annum)
Basic  6,00,000
HRA  3,00,000
Special Allowance  2,78,400
Employer PF  21,600
Total CTC  12,00,000`);
    expect(x.components.basic!.monthly).toBe(50000);
    expect(x.components.ctc!.annual).toBe(1200000);
  });
  it('a name ending in "pa" is not "per annum"', () => {
    expect(parseText(`Compensation details for Deepa\n${MONTHLY}`).components.basic!.monthly).toBe(50000);
  });
});

describe('2. joining and joined dates in notes', () => {
  it('the paste box example gets its joining date', () => {
    const n = note('Got an offer from BP Pvt Ltd: 34.2 base (17.10 basic, 50% basic HRA, rest special), 1.8 variable. Joining 12 Nov 2026. Resigned 3 Sept, LWD 11 Nov 2026, 22 leaves at Suzlon.');
    expect(n.offer!.doj).toBe('2026-11-12');
    expect(n.exit!.facts!.lastWorkingDay).toBe('2026-11-11');
  });
  it('other ways of saying it', () => {
    expect(note('offer from Zeta 20 LPA, joining 1st dec 2026').offer!.doj).toBe('2026-12-01');
    expect(note('offer from Zeta 20 LPA. Start date: 1 Dec 2026').offer!.doj).toBe('2026-12-01');
  });
  it('"joined" is the job you have, not an offer', () => {
    const n = note('CTC 18 LPA, joined June 2024');
    expect(n.current).toBeDefined();
    expect(n.offer).toBeUndefined();
    expect(n.current!.doj).toBe('2024-06-01');
    expect(n.current!.fields.ctc).toBe(1800000);
  });
});

describe('3. a pasted hike updates the job, it is not a new one', () => {
  it('reads as an increment', () => {
    const d = docsFromText('my salary was hiked to 19 LPA from April 2026', 'Pasted text').docs;
    expect(d.map((x) => x.kind)).toEqual(['appraisal']);
    expect(d[0].facts!.revisedCtc).toBe(1900000);
    expect(d[0].facts!.effectiveFrom).toBe('2026-04-01');
  });
  it('an HR email with a revised CTC too', () => {
    const d = docsFromText('Hi Ravi, your revised CTC is 19 LPA effective 1 April 2026. Thanks, HR', 'Pasted text').docs;
    expect(d.map((x) => x.kind)).toEqual(['appraisal']);
  });
  it('an offer with no company or date never pushes a real job out', () => {
    const suz = docFromText(
      `Suzlon Global Services Limited\nDate: 20/01/2025\nLetter of Appointment\nYour date of joining is 20th January 2025.\nComponent  ANNUAL (INR)  MONTHLY (INR)\nBasic Salary  8,10,000  67,500\nHRA  4,05,000  33,750\nTotal CTC  18,00,000`,
      'suz.pdf',
    );
    const r = assignDocs([blankJob('New job', '2026-04-01')], [suz, ...docsFromText('20 LPA package', 'Pasted text').docs], 2026);
    expect(r.aside).toEqual([]);
  });
});

describe('5. the default split only when nothing was found', () => {
  it('"Base Salary" is basic, and a breakup is never overwritten', () => {
    const e = build(`Offer of Employment\nComponent Monthly Annual\nBase Salary 1,00,000 12,00,000\nHRA 40,000 4,80,000\nFlexi Benefit 30,000 3,60,000\nTotal CTC 20,00,000`);
    expect(e.structure.basic).toBe(100000);
    expect(e.structure.hra).toBe(40000);
    expect(e.splitGuessed).toBeFalsy();
    expect(e.structure.others).toEqual([]);
  });
  it('"basic will be 40% of CTC" in a letter', () => {
    const e = build(`Offer of Employment\nWe are pleased to offer you a CTC of Rs. 18,00,000 per annum. Your basic salary will be 40% of CTC.`);
    expect(e.structure.basic).toBe(60000);
  });
});

describe('6. similar names are different companies', () => {
  const offer = (co: string, doj: string) => docFromText(`${co}\nOffer of Employment\nYour date of joining will be ${doj}.\nComponent Monthly Annual\nBasic 50,000 6,00,000\nTotal CTC 12,00,000`, `${co}.pdf`);
  it('Tech Mahindra and Mahindra & Mahindra', () => {
    const r = assignDocs([blankJob('New job', '2026-04-01')], [offer('Tech Mahindra Limited', '1st June 2024'), offer('Mahindra & Mahindra Limited', '1st December 2026')], 2026);
    expect(r.employers.length).toBe(2);
  });
  it('Infosys and Infosys BPM', () => {
    const r = assignDocs([blankJob('New job', '2026-04-01')], [offer('Infosys Limited', '1st June 2024'), offer('Infosys BPM Limited', '1st December 2026')], 2026);
    expect(r.employers.length).toBe(2);
  });
});

describe('7. letters and HR emails are not notes', () => {
  it('an HR email', () => expect(isNote('From: hr@zeta.com\nSubject: Offer\nHi Ravi, we are happy to offer you CTC: 18 LPA. Thanks, Priya')).toBe(false));
  it('a relieving letter', () => expect(isNote('To whom it may concern\nThis is to certify that Ravi worked with us; his last working day was 11 Nov 2026.')).toBe(false));
  it('a short offer letter with a letterhead', () => expect(isNote('Acme Technologies Private Limited\nOffer: CTC 18 LPA, joining 1 Dec 2026.\nWarm wishes')).toBe(false));
});

describe('10-13. notes: current CTC, fixed pay, bonus kinds, annual figures', () => {
  it('current CTC is not the offer', () => {
    expect(note('my current ctc is 12 LPA at Acme. offer from Zeta 20 LPA').offer!.fields.ctc).toBe(2000000);
  });
  it('fixed pay drives the split', () => {
    const e = build('offer from Zeta: fixed 25L, variable 3L, joining 1 Dec 2026');
    expect(e.ctc).toBe(2800000);
    expect(e.structure.basic).toBe(Math.round(2500000 / 12 / 2));
    const f = build('offer from Zeta: CTC 34.2 lakhs, fixed 30 lakhs');
    expect(f.structure.basic).toBe(125000);
    expect(note('offer from Zeta: 25 LPA fixed + 3 LPA variable').offer!.fields.ctc).toBe(2800000);
  });
  it('a joining or retention bonus is not variable pay', () => {
    expect(note('offer from Zeta 20 LPA, 2L joining bonus').offer!.fields.variable).toBeUndefined();
    const r = note('offer from Zeta 20 LPA, retention bonus 2L after 1 year').offer!;
    expect(r.fields.variable).toBeUndefined();
    expect(r.fields.retention).toBe(200000);
  });
  it('annual figures below ₹2.5L next to a CTC stay annual', () => {
    const o = note('offer from Zeta: CTC 5,00,000, basic 2,00,000, HRA 1,00,000').offer!;
    expect(o.fields.basic).toBe(16667);
    expect(o.fields.hra).toBe(8333);
  });
});

describe('14. dates without a year', () => {
  it('a last day and a joining date are the next ones', () => {
    const today = new Date().toISOString().slice(0, 10);
    const n = note('resigned on 1 Oct, my last day at Acme is 31 Dec. offer from Zeta 20 LPA, joining on 5 Jan');
    expect(n.exit!.facts!.lastWorkingDay! >= today.slice(0, 7)).toBe(true);
    expect(n.offer!.doj! > n.exit!.facts!.lastWorkingDay!).toBe(true);
    expect(n.exit!.facts!.resignationDate! <= n.exit!.facts!.lastWorkingDay!).toBe(true);
  });
});

describe('19-21. names and more in notes', () => {
  it('long names, "&", "Zeta offer:", two offers in one sentence', () => {
    expect(note('Offer from Amazon Development Centre India Pvt Ltd, 30 LPA').offer!.employer).toBe('Amazon Development Centre India Pvt Ltd');
    expect(note('offer from Larsen & Toubro Limited, 12 LPA').offer!.employer).toBe('Larsen & Toubro Limited');
    expect(note('Zeta offer: 25 LPA, joining 1 Jan 2027').offer!.employer).toBe('Zeta');
    const two = note('I have two offers. Zeta offered 25 LPA and Omega offered 28 LPA');
    expect([two.offer!.employer, ...two.alternatives.map((a) => a.employer)]).toEqual(['Zeta', 'Omega']);
    const b = note('offers from Zeta (25 LPA) and Omega (28 LPA)');
    expect([b.offer!.employer, ...b.alternatives.map((a) => a.employer)]).toEqual(['Zeta', 'Omega']);
  });
  it('location and "LWD at X"', () => {
    const n = note('offer from Zeta 20 LPA, working in Bangalore. LWD at Acme is 30 Nov 2026');
    expect(n.offer!.facts!.location?.state).toBe('KA');
    expect(n.exit!.employer).toBe('Acme');
  });
  it('a notice period at your current job, without a resignation yet', () => {
    const n = note('notice period is 90 days at Acme. offer from Zeta 20 LPA');
    expect(n.offer!.facts!.noticeDays).toBeUndefined();
  });
});

describe('20. a recruiter or HR-software email address never names a job', () => {
  it('abcconsultants.com', () => {
    const d = docFromText('From: priya@abcconsultants.com\nSubject: Offer\nOffer of Employment\nYour date of joining will be 1st December 2026.\nComponent Monthly Annual\nBasic 50,000 6,00,000\nTotal CTC 12,00,000', 'offer.eml');
    const r = assignDocs([blankJob('New job', '2026-04-01')], [d], 2026);
    expect(r.employers[0].name).not.toMatch(/abc/i);
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
const scenario = (employers: Employment[]): Scenario => ({ fy: 2026, today: '2026-09-27', settings: { thirtyDayMonth: false, nextFyHike: 0 }, employers });

describe('16, 22. PF on part months, and a fully unpaid month', () => {
  it('PF stays at the cap while earned basic is above the ceiling', () => {
    const r = compute(scenario([job({ lopDays: { '2026-06': 10 } })]));
    expect(r.employers[0].lines.find((l) => l.month === '2026-06')!.epf).toBe(1800);
    const bp = compute(scenario([job({ start: '2026-11-12', structure: { ...job().structure, basic: 142500 } })]));
    expect(bp.employers[0].lines.find((l) => l.month === '2026-11')!.epf).toBe(3000);
  });
  it('a month with every day unpaid still shows, at ₹0', () => {
    const r = compute(scenario([job({ lopDays: { '2026-07': 31 } })]));
    const jul = r.employers[0].lines.find((l) => l.month === '2026-07');
    expect(jul).toBeDefined();
    expect(jul!.gross).toBe(0);
  });
});

describe('8. removing a resignation clears what it said', () => {
  it('last day and resignation date go with it', () => {
    const offer = docFromText('Acme Private Limited\nOffer of Employment\nYour date of joining will be 1st June 2024.\nComponent Monthly Annual\nBasic 50,000 6,00,000\nTotal CTC 12,00,000', 'offer.pdf');
    const res = docFromText('Acceptance of your resignation\nWe accept your resignation dated 01/08/2026. Your last working day will be 31st October 2026.', 'resignation.pdf');
    const withRes = applyEvents(applyDocs({ ...blankJob('Acme', '2024-06-01'), docs: [offer, res] }, {}, bundledRules).emp, bundledRules, '2026-04').emp;
    expect(withRes.end).toBe('2026-10-31');
    const without = applyEvents(applyDocs({ ...withRes, docs: [offer] }, {}, bundledRules).emp, bundledRules, '2026-04').emp;
    expect(without.end).toBe('');
    expect(without.resignedOn).toBeUndefined();
  });
});


describe('9, 23. who is asked what', () => {
  const letter = (date: string, doj?: string) => ({ id: date, name: 'l', kind: 'offer' as const, fields: {}, docDate: date, doj });
  it('joined this year with an offer from before it: not asked if pay changed', () => {
    expect(staleSalary(job({ start: '2026-05-01', startSource: 'doc', docs: [letter('2026-03-10', '2026-05-01')] }), 2026, '2026-09-27')).toBeUndefined();
  });
  it('a 2021 letter and a 2023 hike: asked', () => {
    expect(staleSalary(job({ start: '2021-06-01', startSource: 'doc', docs: [letter('2021-05-01', '2021-06-01')], revisions: [{ from: '2023-04', structure: job().structure, source: 'doc:appraisal:x' }] }), 2026, '2026-09-27')).toBe('2023-04-01');
  });
  it('ex gratia waits for a real joining date', () => {
    const e = job({ start: '2026-04-01', startSource: 'default', end: '2026-11-30', ctcParts: { gratuity: 3000 }, fnf: { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0 } });
    expect(needsExGratia(e, true)).toBe(false);
    expect(needsExGratia({ ...e, start: '2025-01-01', startSource: 'doc' }, true)).toBe(true);
  });
});

describe('15. joining next April keeps this year', () => {
  it('while your current job runs, the year stays', () => {
    expect(fyFor('2026-09-27', [{ start: '2025-01-20' }, { start: '2027-04-05' }])).toBe(2026);
    expect(fyFor('2026-09-27', [{ start: '2027-04-05' }])).toBe(2027);
  });
});
