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
