/**
 * The year's salary laid out the way the ITR salary schedule and Form 16 present it, plus the
 * steps to file. New regime only: no HRA/LTA exemptions, no 80C; standard deduction once.
 */
import type { Result } from './compute';
import { fyLabel } from './fy';

export interface ItrEmployer {
  name: string;
  /** Gross salary u/s 17(1) including exempt receipts, as Form 16 Part B shows it. */
  gross: number;
  leaveExempt: number;
  gratuityExempt: number;
  otherExempt: number;
  npsEmployer: number;
  tds: number;
}

export interface ItrSummary {
  assessmentYear: string;
  dueDate: string;
  form: 'ITR-1' | 'ITR-2';
  employers: ItrEmployer[];
  grossSalary: number;
  exemptions: number;
  netSalary: number;
  standardDeduction: number;
  incomeFromSalary: number;
  npsDeduction: number;
  totalIncome: number;
  taxBeforeRebate: number;
  rebate: number;
  surcharge: number;
  cess: number;
  totalTax: number;
  tds: number;
  /** Positive = pay before filing, negative = refund. */
  balance: number;
  checklist: string[];
}

export function itrSummary(r: Result): ItrSummary {
  const f = r.filing;
  const employers: ItrEmployer[] = r.employers.map((e) => {
    if (e.totalsOnly) return { name: e.name, gross: e.totalsOnly.gross, leaveExempt: 0, gratuityExempt: 0, otherExempt: 0, npsEmployer: 0, tds: e.totalsOnly.tds };
    const ots = e.lines.flatMap((l) => l.oneTimes);
    const gross = e.lines.reduce((a, l) => a + l.gross, 0);
    const exemptOther = ots.filter((o) => !o.taxable);
    return {
      name: e.name,
      gross,
      leaveExempt: 0,
      gratuityExempt: exemptOther.filter((o) => /gratuity/i.test(o.label)).reduce((a, o) => a + o.amount, 0),
      otherExempt: exemptOther.filter((o) => !/gratuity/i.test(o.label)).reduce((a, o) => a + o.amount, 0),
      npsEmployer: e.lines.reduce((a, l) => a + l.npsDeductible, 0),
      tds: e.lines.reduce((a, l) => a + l.tds, 0),
    };
  });
  // The leave exemption is capped across jobs; show it against the jobs that paid it, in order.
  let leaveLeft = f.leaveExemption;
  r.employers.forEach((e, i) => {
    const paid = e.lines.flatMap((l) => l.oneTimes).filter((o) => o.kind === 'leaveEncashment').reduce((a, o) => a + o.amount, 0);
    const x = Math.min(paid, leaveLeft);
    employers[i].leaveExempt = x;
    leaveLeft -= x;
  });

  const grossSalary = employers.reduce((a, e) => a + e.gross, 0);
  const exemptions = employers.reduce((a, e) => a + e.leaveExempt + e.gratuityExempt + e.otherExempt, 0);
  const netSalary = grossSalary - exemptions;
  const incomeFromSalary = Math.max(0, netSalary - f.standardDeduction);
  const ay = `${r.fy + 1}-${String((r.fy + 2) % 100).padStart(2, '0')}`;
  const due = `31 July ${r.fy + 1}`;
  const form = f.taxable <= 5_000_000 ? 'ITR-1' : 'ITR-2';
  const multi = employers.length > 1;
  const checklist = [
    `Collect Form 16 from ${multi ? 'each employer' : 'your employer'} (usually issued by 15 June ${r.fy + 1}). Part A shows the TDS deposited, Part B the salary.`,
    'Log in to incometax.gov.in and match the TDS in Form 26AS and your AIS with the TDS per employer shown above. Ask the employer to fix any mismatch before you file.',
    ...(multi ? ['Claim the ₹75,000 standard deduction only once, even though each Form 16 shows it.'] : []),
    ...(f.leaveExemption > 0 ? ['Claim the leave encashment exemption u/s 10(10AA) yourself in the ITR. Payroll taxes it in full, which is why part of your refund comes from it.'] : []),
    ...(f.balance > 0
      ? [
          `Pay the ₹${Math.round(f.balance).toLocaleString('en-IN')} due as self-assessment tax (Challan 280, "e-Pay Tax" on the portal) before filing, and enter the challan in the ITR.`,
          ...(f.balance > 10_000 ? ['More than ₹10,000 due at year end attracts interest u/s 234B/234C. Paying advance tax by 15 March, or asking your employer to deduct more, avoids most of it.'] : []),
        ]
      : f.balance < 0
        ? ['File early to get your refund sooner. Make sure your bank account is pre-validated on the portal.']
        : []),
    `File ${form} for AY ${ay} (${fyLabel(r.fy)}) under the new regime by ${due}, then e-verify within 30 days (Aadhaar OTP is quickest).`,
  ];
  return {
    assessmentYear: ay,
    dueDate: due,
    form,
    employers,
    grossSalary,
    exemptions,
    netSalary,
    standardDeduction: f.standardDeduction,
    incomeFromSalary,
    npsDeduction: f.npsDeduction,
    totalIncome: f.taxable,
    taxBeforeRebate: f.slabTax,
    rebate: f.rebate,
    surcharge: f.surcharge,
    cess: f.cess,
    totalTax: f.total,
    tds: f.tdsTotal,
    balance: f.balance,
    checklist,
  };
}
