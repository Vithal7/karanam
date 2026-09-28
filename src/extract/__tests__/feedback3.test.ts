import { describe, expect, it } from 'vitest';
import { reconcile } from '../../domain/reconcile';
import { epfFor, noticeShortfall } from '../../domain/schedule';
import { bundledRules } from '../../rules';
import { applyEvents } from '../events';
import { findNoticeDays, findTdsToDate } from '../facts';
import { blankJob, docFromText } from '../intake';
import { applyDocs } from '../merge';

const APPOINTMENT = `Northwind Global Services Limited
Date: 18/12/2024
Letter of Appointment
We are pleased to appoint you as Manager with effect from 08.01.2025.
Either party may terminate this appointment by giving three months' written notice.
Annexure - Compensation Structure
Component                      Monthly     Annual
Basic                          60,000      7,20,000
House Rent Allowance           31,000      3,72,000
Dearness Allowance              5,000        60,000
Miscellaneous Allowance        28,000      3,36,000
Northwind Allowance                3,000        36,000
Special Allowance               5,880        70,560
Gross Salary                 1,32,880    15,94,560
Employer PF Contribution        1,800       21,600
Gratuity                        2,886       34,632
Total CTC                              16,50,792`;

const job = (docs: ReturnType<typeof docFromText>[]) => {
  const a = applyDocs({ ...blankJob('Job 1', '2026-04-01'), docs }, {}, bundledRules).emp;
  return applyEvents(a, bundledRules, '2026-04').emp;
};

describe('every allowance is read', () => {
  const d = docFromText(APPOINTMENT, 'Kiran Northwind Appointment Letter.pdf');
  const e = job([d]);
  it('keeps each allowance by its own name', () => {
    expect(e.structure.basic).toBe(60000);
    expect(e.structure.hra).toBe(31000);
    const names = [e.structure.special > 0 ? 'special' : '', ...e.structure.others.map((o) => o.name)];
    expect(names.join('|')).toMatch(/Dearness/);
    expect(names.join('|')).toMatch(/Northwind Allowance/);
    const fixed = e.structure.basic + e.structure.hra + e.structure.special + e.structure.others.reduce((a, o) => a + o.amount, 0);
    expect(fixed).toBe(132880);
  });
  it('matches the CTC once employer PF and gratuity are taken out', () => {
    const r = reconcile(e, e.structure, '2025-01', bundledRules)!;
    expect(r.employerPf).toBe(1800);
    expect(r.gratuity).toBe(2886);
    expect(r.ok).toBe(true);
  });
  it('flags a missing allowance', () => {
    const missing = { ...e, structure: { ...e.structure, others: e.structure.others.slice(1) } };
    const r = reconcile(missing, missing.structure, '2025-01', bundledRules)!;
    expect(r.ok).toBe(false);
    expect(r.gap).toBeGreaterThan(0);
  });
  it('reads the notice period from the appointment letter', () => {
    expect(e.noticeDays).toBe(90);
    expect(e.start).toBe('2025-01-08');
  });
});

describe('notice period', () => {
  it('reads common phrasings', () => {
    expect(findNoticeDays('The notice period is 60 days.')).toBe(60);
    expect(findNoticeDays("by giving three months' notice")).toBe(90);
    expect(findNoticeDays('notice period of 2 (two) months')).toBe(60);
    expect(findNoticeDays('30 days notice in writing')).toBe(30);
    expect(findNoticeDays('no mention here')).toBeUndefined();
  });
  it('works out the shortfall from your dates', () => {
    const e = { ...blankJob('S', '2025-01-08'), noticeDays: 90, resignedOn: '2026-09-30', end: '2026-11-01' };
    expect(noticeShortfall(e)).toBe(90 - 32);
  });
});

describe('EPF follows the ceiling', () => {
  it('₹1,800 in a letter is the legal cap, so it becomes ₹3,000 from Sep 2026', () => {
    const d = docFromText(APPOINTMENT.replace('Date: 18/12/2024', 'Date: 20/10/2026'), 'appointment.pdf');
    const e = job([d]);
    expect(e.structure.epfMode).toBe('statutory');
    expect(epfFor(e.structure, '2026-08', bundledRules)).toBe(1800);
    expect(epfFor(e.structure, '2026-10', bundledRules)).toBe(3000);
  });
});

describe('tax already deducted, however it is phrased', () => {
  it('reads direct phrases and table rows', () => {
    expect(findTdsToDate('Tax Deducted So Far: 1,12,770')).toBe(112770);
    expect(findTdsToDate('TDS deducted till date 96,660')).toBe(96660);
    expect(findTdsToDate('Particulars Apr May Jun Jul Aug Total\nTDS Recovered 16,110 16,110 16,110 32,220 32,220 1,12,770')).toBe(112770);
    expect(findTdsToDate('Income Tax Recovered (YTD) 1,12,770\nBalance tax payable 1,19,017')).toBe(112770);
    expect(findTdsToDate('Balance tax payable 1,19,017')).toBeUndefined();
  });
});
