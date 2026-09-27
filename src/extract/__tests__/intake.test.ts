import { describe, expect, it } from 'vitest';
import { compute } from '../../domain/compute';
import { bundledRules } from '../../rules';
import { applyEvents } from '../events';
import { assignDocs, blankJob, docFromText } from '../intake';
import { applyDocs } from '../merge';

const SIGMA_OFFER = `Sigma Systems Private Limited
Date: 01/02/2024
Offer of Employment
Dear Priya, we are pleased to offer you the role of Engineer. Your date of joining will be 1st March 2024.
Annexure - Compensation
Component Monthly Annual
Basic 67,500 8,10,000
HRA 33,750 4,05,000
Special Allowance 43,710 5,24,520
Total CTC 18,00,000`;

const SIGMA_APPRAISAL = `Sigma Systems Private Limited
Date: 20/06/2026
Subject: Salary Revision
We are pleased to inform you of an increment of 21.6% in your compensation with effect from 1st April 2026.
The revised salary and arrears will be paid in July 2026 payroll.`;

const SIGMA_RESIGNATION = `From: HR Team <hr@sigmasystems.com>
Date: 12/09/2026
Subject: Acceptance of your resignation - Sigma Systems Private Limited
We accept your resignation dated 12/09/2026. Your last working day will be 11th November 2026.
The shortfall of 21 days of notice will be recovered in your full and final settlement.`;

const SIGMA_FNF = `Sigma Systems Private Limited
Full and Final Settlement Statement
Last Working Day: 11/11/2026
Leave Encashment (22 days)   60,192
Notice Pay Recovery (21 days) 57,456
Net Payable 1,45,300
The settlement will be credited in December 2026.`;

const ACME_OFFER = `ACME Technologies Private Limited
Date: 15/10/2026
Offer of Employment
Your date of joining will be 12th November 2026.
Component Monthly Annual
Basic Salary 1,42,500 17,10,000
House Rent Allowance 71,250 8,55,000
Special Allowance 69,450 8,33,400
Total CTC 36,98,651
Joining Bonus: Rs. 1,50,000 payable with the third month salary. It is repayable if you resign within 12 months of joining.
We will reimburse your notice buyout on actuals, up to a maximum of Rs. 1,00,000.`;

describe('drop everything, we sort it', () => {
  const files = [
    ['acme-offer.pdf', ACME_OFFER],
    ['fnf.pdf', SIGMA_FNF],
    ['appraisal-2026.pdf', SIGMA_APPRAISAL],
    ['sigma-offer-2024.pdf', SIGMA_OFFER],
    ['resignation.eml', SIGMA_RESIGNATION],
  ].map(([n, t]) => docFromText(t, n));

  it('classifies each file', () => {
    expect(files.map((d) => d.kind)).toEqual(['offer', 'fnf', 'appraisal', 'offer', 'resignation']);
  });

  const { employers, unassigned } = assignDocs([blankJob('New job', '2026-09-27')], files, 2026);
  const built = employers.map((e) => {
    const a = applyDocs(e, {}, bundledRules).emp;
    return applyEvents(a, bundledRules, '2026-04').emp;
  });
  const [sigma, acme] = built;

  it('groups by company and orders the jobs', () => {
    expect(unassigned).toEqual([]);
    expect(built.map((e) => e.name)).toEqual(['Sigma Systems Private Limited', 'ACME Technologies Private Limited']);
    expect(sigma.docs).toHaveLength(4);
  });

  it('reads an old offer as the starting salary and the appraisal as a dated hike', () => {
    expect(sigma.start).toBe('2024-03-01');
    expect(sigma.structure.basic).toBe(67500);
    expect(sigma.ctc).toBe(1800000);
    expect(sigma.revisions).toHaveLength(1);
    const h = sigma.revisions[0];
    expect(h.from).toBe('2026-04');
    expect(h.payoutMonth).toBe('2026-07');
    expect(h.structure.basic).toBe(82080);
    expect(h.ctc).toBe(2188800);
    expect(h.scaled).toBe(true);
  });

  it('reads the exit from the resignation and F&F papers', () => {
    expect(sigma.end).toBe('2026-11-11');
    expect(sigma.resignedOn).toBe('2026-09-12');
    expect(sigma.fnf).toMatchObject({ leaveDays: 22, leaveAmount: 60192, noticeDaysRecovered: 21, noticeAmount: 57456, payMonth: '2026-12' });
  });

  it('reads the new offer terms', () => {
    expect(acme.start).toBe('2026-11-12');
    expect(acme.buyout).toMatchObject({ mode: 'cap', cap: 100000 });
    const jb = acme.oneTimes.find((o) => o.kind === 'joining')!;
    expect(jb.month).toBe('2027-01');
    expect(jb.clawbackMonths).toBe(12);
  });

  it('computes the year from it', () => {
    const r = compute({ fy: 2026, today: '2026-09-27', settings: { thirtyDayMonth: true, nextFyHike: 0.1 }, employers: built });
    const jul = r.employers[0].lines.find((l) => l.month === '2026-07')!;
    expect(jul.oneTimes.find((o) => /Arrears/.test(o.label))!.amount).toBe(3 * (82080 + 41040 + 53151 - (67500 + 33750 + 43710)));
    const buyout = r.employers[1].lines.flatMap((l) => l.oneTimes).find((o) => o.kind === 'buyout')!;
    expect(buyout.amount).toBe(57456);
  });
});

describe('story and ITR', async () => {
  const { buildStory } = await import('../../domain/story');
  const { itrSummary } = await import('../../domain/itr');
  const files = [SIGMA_OFFER, SIGMA_APPRAISAL, SIGMA_RESIGNATION, SIGMA_FNF, ACME_OFFER].map((t, i) => docFromText(t, `f${i}.pdf`));
  const { employers } = assignDocs([blankJob('New job', '2026-09-27')], files, 2026);
  const built = employers.map((e) => applyEvents(applyDocs(e, {}, bundledRules).emp, bundledRules, '2026-04').emp);
  const s = { fy: 2026, today: '2026-09-27', settings: { thirtyDayMonth: true, nextFyHike: 0.1 }, employers: built };
  const r = compute(s);
  const story = buildStory(s, r);
  const text = story.map((j) => j.lines.map((l) => l.text).join('\n'));

  it('tells the Sigma story', () => {
    expect(text[0]).toContain('Joined on 1 Mar 2024 at ₹67,500 basic');
    expect(text[0]).toContain('Hike from Apr 2026: CTC ₹18,00,000 → ₹21,88,800 (+21.6%)');
    expect(text[0]).toContain('First paid in Jul 2026, with');
    expect(text[0]).toContain('Resigned on 12 Sept 2026');
    expect(text[0]).toContain('pro-rata for 11 of 30 days');
    expect(text[0]).toContain('Leave encashment ₹60,192 as per your F&F slip (22 days)');
    expect(text[0]).toContain('F&F settled in Dec 2026');
  });

  it('tells the ACME story', () => {
    expect(story[1].isNew).toBe(true);
    expect(text[1]).toContain('Joining on 12 Nov 2026');
    expect(text[1]).toContain('Repayable if you leave before Nov 2027');
    expect(text[1]).toContain('Notice buyout reimbursed up to ₹1,00,000: ₹57,456 of ₹57,456 comes back to you');
    expect(text[1]).toContain('Form 12B given before the Dec 2026 salary');
  });

  it('lays out the ITR figures', () => {
    const t = itrSummary(r);
    expect(t.assessmentYear).toBe('2027-28');
    expect(t.dueDate).toBe('31 July 2027');
    expect(t.employers.map((e) => e.name)).toEqual(['Sigma Systems Private Limited', 'ACME Technologies Private Limited']);
    expect(t.employers[0].leaveExempt).toBe(60192);
    expect(t.netSalary - t.standardDeduction - t.npsDeduction).toBeCloseTo(r.filing.taxable, -1);
    expect(t.balance).toBeCloseTo(r.filing.balance, 6);
    expect(t.checklist.join(' ')).toMatch(/standard deduction only once/);
  });
});

describe('time axis first, even without company names', () => {
  // Letters whose letterheads were images: no company in the text. File names and dates must do.
  const appointment = docFromText(`Appointment Letter
Dear Vithal, we are pleased to appoint you. Your date of joining will be 6th January 2025.
Component Monthly Annual
Basic 50,000 6,00,000
HRA 25,000 3,00,000
Special Allowance 45,000 5,40,000
Total CTC 15,00,000`, 'Vithal Suzlon Appointment Letter (1).pdf');
  const appraisal = docFromText(`Salary Revision
Date: 25/06/2026
We are pleased to inform you that your annual CTC has been revised to Rs. 18,00,000 with effect from 1st July 2026.`, 'Suzlon Appraisal Letter 2025-26.pdf');
  const newOffer = docFromText(`LinkedIn Technology Information Private Limited
Offer Letter
Your date of joining will be 2nd November 2026.
Component Monthly Annual
Basic 1,42,500 17,10,000
HRA 71,250 8,55,000
Performance Linked Incentive 2,00,000
Total CTC 38,00,000
Joining Bonus: Rs. 1,50,000 payable with your first salary.`, 'Vithal LinkedIn Offer.pdf');

  const { employers, unassigned } = assignDocs([blankJob('New job', '2026-09-27')], [newOffer, appraisal, appointment], 2026);

  it('keeps each job to its own letters', () => {
    expect(unassigned).toEqual([]);
    expect(employers.map((e) => e.name)).toEqual(['Suzlon', 'LinkedIn Technology Information Private Limited']);
    expect(employers[0].docs.map((d) => d.name).sort()).toEqual(['Suzlon Appraisal Letter 2025-26.pdf', 'Vithal Suzlon Appointment Letter (1).pdf']);
    expect(employers[1].docs.map((d) => d.name)).toEqual(['Vithal LinkedIn Offer.pdf']);
  });

  it('never files a letter under a job that started after it', () => {
    const lone = assignDocs([blankJob('New job', '2026-09-27')], [newOffer, docFromText(appraisal.name && `Salary Revision\nDate: 25/06/2026\nYour CTC has been revised to Rs. 18,00,000 with effect from 1st July 2026.`, 'revision.pdf')], 2026);
    expect(lone.employers).toHaveLength(2);
    expect(lone.employers[0].docs[0].kind).toBe('appraisal');
    expect(lone.employers[1].docs[0].kind).toBe('offer');
  });

  it('reads "CTC has been revised to"', () => {
    expect(appraisal.facts?.revisedCtc).toBe(1800000);
    expect(appraisal.facts?.effectiveFrom).toBe('2026-07-01');
  });
});

describe('timeline for a move that has not happened yet', async () => {
  const { buildTimeline } = await import('../../domain/story');
  const appointment = docFromText(`SUZLON ENERGY LIMITED
Appointment Letter
Your date of joining will be 6th January 2025.
Component Monthly Annual
Basic 75,000 9,00,000
HRA 37,500 4,50,000
Special Allowance 62,500 7,50,000
Total CTC 22,00,000`, 'Vithal Suzlon Appointment Letter (1).pdf');
  const appraisal = docFromText(`Date: 25/06/2026\nSubject: Annual Salary Revision\nYour annual CTC has been revised to Rs. 25,30,000 with effect from 1st July 2026.`, 'Suzlon Appraisal Letter 2025-26.pdf');
  const offer = docFromText(`LinkedIn Technology Information Private Limited
Offer Letter
Your date of joining will be 2nd November 2026.
Component Monthly Annual
Basic Salary 1,42,500 17,10,000
Performance Linked Incentive 2,00,000
Total CTC 38,00,000
Joining Bonus: Rs. 1,50,000 payable with your first salary.`, 'Vithal LinkedIn Offer.pdf');
  const { employers } = assignDocs([blankJob('New job', '2026-09-27')], [offer, appraisal, appointment], 2026);
  const built = employers.map((e) => applyEvents(applyDocs(e, {}, bundledRules).emp, bundledRules, '2026-04').emp);
  built[0].end = '2026-11-01';
  const s = { fy: 2026, today: '2026-09-27', settings: { thirtyDayMonth: false, nextFyHike: 0 }, employers: built };
  const r = compute(s);
  const t = buildTimeline(s, r);
  const texts = t.map((e) => e.text);

  it('names both companies correctly', () => {
    expect(built.map((e) => e.name)).toEqual(['Suzlon Energy Limited', 'LinkedIn Technology Information Private Limited']);
  });
  it('keeps the old job on its own salary until the move', () => {
    const oct = r.employers[0].lines.find((l) => l.month === '2026-10')!;
    expect(oct.basic).toBe(86250);
    expect(r.employers[1].lines[0].month).toBe('2026-11');
  });
  it('orders events and uses the right tense', () => {
    const i = (re: RegExp) => texts.findIndex((x) => re.test(x));
    expect(texts[i(/Joined Suzlon/)]).toBe('Joined Suzlon Energy');
    expect(i(/Hike at Suzlon/)).toBeLessThan(i(/Last day at Suzlon/));
    expect(i(/^Join LinkedIn/)).toBeLessThan(i(/Joining bonus/));
    expect(t[i(/^Join LinkedIn/)].date > s.today).toBe(true);
    expect(texts.some((x) => /^Joined LinkedIn/.test(x))).toBe(false);
  });
});

describe('hard real-world documents', () => {
  it('reads a tax computation sheet as TDS so far, not a salary breakup', () => {
    const d = docFromText(`SUZLON GLOBAL SERVICES LIMITED
Income Tax Computation for the Financial Year 2026-27
Employee Code: 10234567   PAN: ABCDE1234F   UAN: 100987654321
Particulars          Actual      Projected     Total
Basic               4,05,000     5,05,440      9,10,440
House Rent Allowance 2,02,500    2,52,720      4,55,220
Gross Salary        8,69,760    10,84,176     19,53,936
Less: Standard Deduction                       75,000
Taxable Income                                18,78,936
Tax on Total Income                            2,31,787
Tax deducted till date                         1,72,170
Balance tax payable                              59,617`, 'Suzlon Tax Computation Sep 2026.pdf');
    expect(d.kind).toBe('taxsheet');
    expect(d.fields).toEqual({});
    expect(d.ytdTds).toBe(172170);
    expect(d.employer).toBe('Suzlon Global Services Limited');
  });

  it('joins a company name that wraps onto the next line', () => {
    const d = docFromText(`LinkedIn Technology Information
Private Limited
Offer Letter
Your date of joining will be 2nd November 2026.
Basic Salary 1,42,500 17,10,000`, 'offer.pdf');
    expect(d.employer).toBe('LinkedIn Technology Information Private Limited');
  });

  it('never names a company "Private Limited"', () => {
    const d = docFromText(`Offer Letter\nPrivate Limited\nYour date of joining will be 2nd November 2026.`, 'offer.pdf');
    expect(d.employer).toBeUndefined();
  });

  it('ignores account numbers and IDs as amounts', () => {
    const d = docFromText(`Offer Letter\nBank Account 50100123456789\nBasic 67,500 8,10,000\nTotal CTC 21,60,000`, 'offer.pdf');
    expect(d.fields.basic).toBe(67500);
    expect(d.fields.ctc).toBe(2160000);
  });

  it('finds a joining date given as "with effect from"', () => {
    const d = docFromText(`Suzlon Global Services Limited
Date: 20/12/2024
Letter of Appointment
We are pleased to appoint you as Manager with effect from 06.01.2025.
Basic 67,500 8,10,000`, 'appointment.pdf');
    expect(d.kind).toBe('offer');
    expect(d.doj).toBe('2025-01-06');
  });

  it("says so when a letter has no joining date instead of inventing one", () => {
    const d = docFromText(`Suzlon Global Services Limited\nDate: 20/12/2024\nLetter of Appointment\nBasic 67,500 8,10,000`, 'appointment.pdf');
    const e = applyDocs({ ...blankJob('Job 1', '2026-04-01'), docs: [d] }, {}, bundledRules).emp;
    expect(e.startSource).toBe('approx');
    expect(e.start).toBe('2024-12-20');
    const none = applyDocs({ ...blankJob('Job 1', '2026-04-01'), docs: [{ ...d, docDate: undefined }] }, {}, bundledRules).emp;
    expect(none.startSource).toBe('default');
  });
});

describe('files from other years are set aside, with the reason', () => {
  const OLD_OFFER = `Globex Software Private Limited
Date: 10/05/2019
Offer of Employment
Your date of joining will be 1st June 2019.
Basic 40,000 4,80,000
HRA 20,000 2,40,000
Total CTC 9,00,000`;
  const OLD_RELIEVING = `Globex Software Private Limited
Date: 20/02/2024
Full and Final Settlement Statement
Last Working Day: 29/02/2024
Leave Encashment (10 days) 13,333
Net Payable 50,000`;
  const LAST_YEAR_SHEET = `Sigma Systems Private Limited
Income Tax Computation For FY 2025-26
Particulars Apr-25 May-25 Jun-25
TDS 9,000 9,000 9,000
Date: 15/03/2026`;
  const OLD_SLIP = `Sigma Systems Private Limited
Payslip for the month of May 2024
Basic 67,500
HRA 33,750
Income Tax 5,000`;
  const NEW_SLIP = `Sigma Systems Private Limited
Payslip for the month of August 2026
Basic 82,080
HRA 41,040
Income Tax 16,110`;
  const files = [
    ['globex-offer.pdf', OLD_OFFER],
    ['globex-fnf.pdf', OLD_RELIEVING],
    ['sigma-offer-2024.pdf', SIGMA_OFFER],
    ['acme-offer.pdf', ACME_OFFER],
    ['sigma-tax-2025-26.pdf', LAST_YEAR_SHEET],
    ['sigma-may-2024.pdf', OLD_SLIP],
    ['sigma-aug-2026.pdf', NEW_SLIP],
  ].map(([n, t]) => docFromText(t, n));
  const { employers, aside, unassigned } = assignDocs([blankJob('New job', '2026-09-27')], files, 2026);
  const reason = (name: string) => aside.find((a) => a.doc.name === name)?.reason;

  it('keeps only this year’s jobs', () => {
    expect(unassigned).toEqual([]);
    expect(employers.map((e) => e.name)).toEqual(['Sigma Systems Private Limited', 'ACME Technologies Private Limited']);
  });
  it('a job you left before the year began', () => {
    expect(reason('globex-offer.pdf')).toMatch(/You left Globex .* 29 Feb 2024, before FY 2026-27 began/);
    expect(reason('globex-fnf.pdf')).toBeDefined();
  });
  it('last year’s tax sheet, and an old payslip when a newer one exists', () => {
    expect(reason('sigma-tax-2025-26.pdf')).toMatch(/FY 2025-26; this is FY 2026-27/);
    expect(reason('sigma-may-2024.pdf')).toMatch(/newer one/);
    expect(employers[0].docs.map((d) => d.name).sort()).toEqual(['sigma-aug-2026.pdf', 'sigma-offer-2024.pdf']);
  });
  it('a job you had already left for a later one, with no exit papers', () => {
    const r = assignDocs([blankJob('New job', '2026-09-27')], [docFromText(OLD_OFFER, 'globex-offer.pdf'), docFromText(SIGMA_OFFER, 'sigma.pdf'), docFromText(ACME_OFFER, 'acme.pdf')], 2026);
    expect(r.employers.map((e) => e.name)).toEqual(['Sigma Systems Private Limited', 'ACME Technologies Private Limited']);
    expect(r.aside[0].reason).toMatch(/You joined Sigma Systems Private Limited on 1 Mar 2024/);
  });
  it('"use it anyway" keeps a file', () => {
    const kept = { ...files[4], keep: true };
    const r = assignDocs(employers, [kept], 2026);
    expect(r.aside).toEqual([]);
  });
});

describe('joining bonus after probation', () => {
  const OFFER = `Resilient Innovations Private Limited
Date: 01/10/2026
Offer of Employment
Your date of joining will be 12th November 2026. You will be on probation for a period of three months.
Basic Salary 1,42,500 17,10,000
HRA 71,250 8,55,000
Special Allowance 69,450 8,33,400
Total CTC 38,00,000
Joining Bonus 1,50,000`;
  it('is paid with the salary of the month after probation', () => {
    const { employers } = assignDocs([blankJob('New job', '2026-09-27')], [docFromText(OFFER, 'bp offer.pdf')], 2026);
    const ev = applyEvents(applyDocs(employers[0], {}, bundledRules).emp, bundledRules, '2026-04');
    expect(ev.emp.oneTimes.find((o) => o.kind === 'joining')?.month).toBe('2027-02');
    expect(ev.notes.join(' ')).toMatch(/3 months' probation/);
  });
  it('a stated month wins', () => {
    const t = OFFER.replace('Joining Bonus 1,50,000', 'Joining Bonus 1,50,000 payable with the first month salary');
    const { employers } = assignDocs([blankJob('New job', '2026-09-27')], [docFromText(t, 'bp offer.pdf')], 2026);
    const ev = applyEvents(applyDocs(employers[0], {}, bundledRules).emp, bundledRules, '2026-04');
    expect(ev.emp.oneTimes.find((o) => o.kind === 'joining')?.month).toBe('2026-11');
  });
});

describe('audit: dates are asked, not invented', () => {
  it('a relieving letter without a resignation date recovers nothing and asks when you resigned', async () => {
    const { exitQuestionFor } = await import('../../ui/ExitQuestion');
    const APPT = `Acme Private Limited\nDate: 01/01/2022\nOffer of Employment\nYour date of joining will be 1st February 2022.\nBasic 50,000 6,00,000\nHRA 25,000 3,00,000\nNotice period: 90 days`;
    const RELIEVING = `Acme Private Limited\nDate: 31/10/2026\nRelieving Letter\nThis is to certify that you have been relieved from your duties. Your last working day was 31st October 2026.`;
    const { employers } = assignDocs([blankJob('New job', '2026-09-27')], [docFromText(APPT, 'appt.pdf'), docFromText(RELIEVING, 'relieving.pdf')], 2026);
    const e = applyEvents(applyDocs(employers[0], {}, bundledRules).emp, bundledRules, '2026-04').emp;
    expect(e.end).toBe('2026-10-31');
    expect(e.resignedOn).toBeUndefined();
    expect(e.fnf?.noticeDaysRecovered ?? 0).toBe(0);
    expect(exitQuestionFor(e, 0, 1)).toMatch(/When you resigned/);
  });
  it('notice in months runs to the same date N months on', async () => {
    const { noticeShortfall } = await import('../../domain/schedule');
    const e = { ...blankJob('A', '2020-01-01'), noticeDays: 90, noticeMonths: 3, resignedOn: '2027-01-15' };
    expect(noticeShortfall({ ...e, end: '2027-04-15' })).toBe(0);
    expect(noticeShortfall({ ...e, end: '2027-04-05' })).toBe(10);
  });
});

describe('company from an email address is only a hint', () => {
  const LETTER = `Acme Software Private Limited
Date: 01/05/2024
Letter of Appointment
Your date of joining will be 1st June 2024.
Component Monthly Annual
Basic 50,000 6,00,000
HRA 25,000 3,00,000
Special Allowance 30,000 3,60,000
Total CTC 13,00,000`;
  const EMAIL = `From: HR <hr@acmesoftware.com>
Date: 01/08/2026
Subject: Acceptance of your resignation
We accept your resignation dated 01/08/2026. Your last working day will be 31st October 2026.`;
  it('an email from acmesoftware.com joins the Acme Software job', () => {
    const r = assignDocs([blankJob('New job', '2026-04-01')], [docFromText(LETTER, 'appointment.pdf'), docFromText(EMAIL, 'resignation.eml')], 2026);
    expect(r.employers.map((e) => [e.name, e.docs.length])).toEqual([['Acme Software Private Limited', 2]]);
    expect(r.aside).toEqual([]);
  });
});
