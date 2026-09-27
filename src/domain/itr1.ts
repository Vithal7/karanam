/**
 * What to enter in ITR-1 (Sahaj), field by field in the order the e-filing portal asks, and what
 * the portal should work out, so you can reconcile before you submit. Salary income only, new
 * regime. From FY 2026-27 the Income-tax Act, 2025 applies: section numbers change (standard
 * deduction s.19, rebate s.156), the figures don't.
 */
import type { Result } from './compute';
import { fyLabel } from './fy';
import type { Scenario } from './types';

export interface ItrField {
  label: string;
  value: number | string;
  /** Where the figure comes from, or what to watch for. */
  note?: string;
  /** A total the portal works out itself: check it, don't type it. */
  computed?: boolean;
}

export interface ItrBlock {
  title: string;
  /** Where it is on the portal. */
  where: string;
  fields: ItrField[];
  note?: string;
}

export interface ReconRow {
  employer: string;
  tan?: string;
  gross: number;
  exempt: number;
  chargeable: number;
  tds: number;
  /** Months of TDS that are our estimate rather than from your files. */
  estimatedMonths: number;
}

export interface Itr1Guide {
  form: 'ITR-1' | 'ITR-2';
  yearLabel: string;
  dueDate: string;
  newAct: boolean;
  eligibility: { ok: boolean; checks: { text: string; ok?: boolean }[] };
  blocks: ItrBlock[];
  recon: ReconRow[];
  interest234B: number;
  interest234C: number;
  totalTax: number;
  tds: number;
  /** Positive: pay before filing (tax + interest); negative: refund. */
  balance: number;
}

const floor100 = (n: number) => Math.floor(n / 100) * 100;

/**
 * Interest when TDS falls short and no advance tax was paid (s.234B/234C of the 1961 Act, carried
 * into the 2025 Act). Applies only when the tax still due is ₹10,000 or more. 234B: 1% a month
 * from April to the month you pay and file (July for an on-time return). 234C: 1% a month on the
 * shortfall at each instalment date (15%, 45%, 75%, 100% by 15 Jun, Sep, Dec, Mar).
 */
export function advanceTaxInterest(due: number, payMonthsFromApril = 4): { b: number; c: number } {
  if (due < 10_000) return { b: 0, c: 0 };
  const b = floor100(due) * 0.01 * payMonthsFromApril;
  const c = (floor100(due * 0.15) * 3 + floor100(due * 0.45) * 3 + floor100(due * 0.75) * 3 + floor100(due) * 1) * 0.01;
  return { b: Math.round(b), c: Math.round(c) };
}

export function itr1Guide(r: Result, s: Scenario): Itr1Guide {
  const f = r.filing;
  const newAct = r.fy >= 2026;
  const sec = (oldRef: string, newRef?: string) => (newAct && newRef ? `${newRef} (${oldRef} of the old Act)` : oldRef);
  const yearLabel = newAct ? `Tax year ${fyLabel(r.fy).replace('FY ', '')}` : `AY ${r.fy + 1}-${String((r.fy + 2) % 100).padStart(2, '0')}`;
  const dueDate = `31 July ${r.fy + 1}`;

  // Per employer, as Form 16 shows it.
  const per = r.employers.map((e, k) => {
    const emp = s.employers[k];
    if (e.totalsOnly) return { name: e.name, tan: tanOf(emp), s171: e.totalsOnly.gross, s172: 0, s173: 0, leave: 0, gratuity: 0, nps: 0, tds: e.totalsOnly.tds, est: 0 };
    const ots = e.lines.flatMap((l) => l.oneTimes);
    const exGratia = ots.filter((o) => o.taxable && /ex\s*gratia|in lieu of gratuity|compensation/i.test(o.label)).reduce((a, o) => a + o.amount, 0);
    const gross = e.lines.reduce((a, l) => a + l.gross, 0);
    const perqs = ots.filter((o) => o.cash === false).reduce((a, o) => a + o.amount, 0);
    return {
      name: e.name,
      tan: tanOf(emp),
      s171: gross - exGratia - perqs,
      s172: perqs,
      s173: exGratia,
      leave: 0,
      gratuity: ots.filter((o) => !o.taxable && /gratuity/i.test(o.label)).reduce((a, o) => a + o.amount, 0),
      nps: e.lines.reduce((a, l) => a + l.npsDeductible, 0),
      tds: e.lines.reduce((a, l) => a + l.tds, 0),
      est: e.lines.filter((l) => l.tdsEstimated && l.month < s.today.slice(0, 7)).length,
    };
  });
  // Leave encashment exemption (on leaving), capped across jobs: against the jobs that paid it.
  let leaveLeft = f.leaveExemption;
  r.employers.forEach((e, k) => {
    const paid = e.lines.flatMap((l) => l.oneTimes).filter((o) => o.kind === 'leaveEncashment').reduce((a, o) => a + o.amount, 0);
    per[k].leave = Math.min(paid, leaveLeft);
    leaveLeft -= per[k].leave;
  });

  const s171 = per.reduce((a, p) => a + p.s171, 0);
  const s172 = per.reduce((a, p) => a + p.s172, 0);
  const s173 = per.reduce((a, p) => a + p.s173, 0);
  const leave = per.reduce((a, p) => a + p.leave, 0);
  const gratuity = per.reduce((a, p) => a + p.gratuity, 0);
  const gross = s171 + s172 + s173;
  const net = gross - leave - gratuity;
  const sd = Math.min(f.standardDeduction, net);
  const salaryIncome = Math.max(0, net - sd);
  const ptPaid = r.employers.flatMap((e) => e.lines).reduce((a, l) => a + l.pt, 0);
  const tds = f.tdsTotal;
  const due = Math.max(0, Math.round(f.total / 10) * 10 - tds);
  const { b, c } = advanceTaxInterest(due);
  const balance = f.total - tds + b + c;
  const form = f.taxable <= 5_000_000 ? 'ITR-1' : 'ITR-2';
  const multi = per.length > 1;

  const blocks: ItrBlock[] = [
    {
      title: 'Filing type and regime',
      where: 'Personal information → Filing section',
      fields: [
        { label: 'Filed under', value: `Section 139(1): on or before the due date (${dueDate})` },
        { label: 'Opting out of the new tax regime?', value: 'No', note: 'The new regime is the default. Your employers deducted TDS under it.' },
      ],
    },
    ...per.map<ItrBlock>((p, k) => ({
      title: multi ? `Salary from ${p.name} (employer ${k + 1} of ${per.length})` : `Salary from ${p.name}`,
      where: 'Gross total income → Income from salary → Add salary details',
      fields: [
        { label: 'Nature of employment', value: 'Others (private sector)' },
        { label: 'Name of employer', value: p.name },
        { label: 'TAN of employer', value: p.tan ?? 'From Form 16 Part A', note: p.tan ? 'Read from your files: check it against Form 16.' : undefined },
        { label: 'Salary as per section 17(1)', value: Math.round(p.s171), note: 'Basic, allowances, bonuses, leave encashment and gratuity paid; before any exemption.' },
        { label: 'Value of perquisites, 17(2)', value: Math.round(p.s172), note: p.s172 ? 'ESOP/RSU perquisites from your payslips. Check against Form 12BA.' : 'Enter the Form 12BA figure if your employer lists any (car, loans, ESOPs).' },
        { label: 'Profits in lieu of salary, 17(3)', value: Math.round(p.s173), note: p.s173 ? 'Ex gratia or compensation on leaving. Some employers put it in 17(1) instead; the total is what matters.' : undefined },
      ],
    })),
    {
      title: 'Exemptions and deductions from salary',
      where: 'Gross total income → Income from salary',
      fields: [
        { label: `Leave encashment on leaving, ${sec('s.10(10AA)', 's.11')}`, value: Math.round(leave), note: leave ? 'Payroll taxes it in full; you claim the exemption here. It is part of your refund.' : undefined },
        { label: `Gratuity, ${sec('s.10(10)', 's.11')}`, value: Math.round(gratuity) },
        { label: 'Net salary', value: Math.round(net), computed: true },
        { label: `Standard deduction, ${sec('s.16(ia)', 's.19')}`, value: Math.round(sd), note: multi ? 'Once in total, though each Form 16 shows it.' : undefined },
        { label: `Professional tax, ${sec('s.16(iii)')}`, value: 0, note: `Not allowed under the new regime, although ₹${Math.round(ptPaid).toLocaleString('en-IN')} was deducted from your pay.` },
        { label: 'Income chargeable under the head Salaries', value: Math.round(salaryIncome), computed: true },
      ],
    },
    {
      title: 'Other income',
      where: 'Gross total income → Income from other sources',
      fields: [
        { label: 'Savings and deposit interest, dividends', value: 'From your AIS', note: 'Not in your salary documents. Add them here: they change the tax below.' },
      ],
    },
    {
      title: 'Deductions',
      where: 'Total deductions (Chapter VI-A / Part C)',
      fields: [
        { label: `Employer's NPS contribution, ${sec('s.80CCD(2)')}`, value: Math.round(f.npsDeduction), note: 'Up to 14% of basic. The only Chapter VI-A deduction most salaried people get under the new regime.' },
        { label: 'Everything else (80C, 80D, HRA, home loan interest)', value: 0, note: 'Not allowed under the new regime.' },
      ],
    },
    {
      title: 'Tax the portal should work out',
      where: 'Tax computation',
      fields: [
        { label: 'Total income (rounded to ₹10)', value: Math.round(f.taxable), computed: true },
        { label: 'Tax on total income (slabs)', value: Math.round(f.slabTax), computed: true },
        { label: `Rebate, ${sec('s.87A', 's.156')}`, value: Math.round(f.rebate), computed: true, note: 'Up to ₹12 lakh of income; marginal relief just above it.' },
        { label: 'Surcharge', value: Math.round(f.surcharge), computed: true },
        { label: 'Health and education cess (4%)', value: Math.round(f.cess), computed: true },
        { label: 'Total tax and cess', value: Math.round(f.total), computed: true },
        { label: 'Relief u/s 89', value: 0, note: 'Only for arrears of earlier years (Form 10E).' },
        { label: 'Interest for deferred advance tax (234B)', value: b, computed: true, note: b ? 'Because ₹10,000 or more is still due. Estimated for paying and filing in July.' : undefined },
        { label: 'Interest for deferred instalments (234C)', value: c, computed: true },
        { label: 'Late filing fee (234F)', value: 0, note: `Nil if you file by ${dueDate}.` },
      ],
    },
    {
      title: 'Taxes already paid',
      where: 'Taxes paid → TDS on salary (Schedule TDS1)',
      fields: per.flatMap<ItrField>((p) => [
        { label: `${p.name}: TAN`, value: p.tan ?? 'From Form 16 Part A' },
        { label: `${p.name}: income chargeable under Salaries`, value: Math.round(Math.max(0, p.s171 + p.s172 + p.s173 - p.leave - p.gratuity - (multi ? 0 : sd))), note: multi ? "As on this employer's Form 16 (after its standard deduction, if it gave one)." : undefined },
        { label: `${p.name}: total tax deducted`, value: Math.round(p.tds), note: p.est ? `${p.est} month${p.est === 1 ? '' : 's'} of this is our estimate; use Form 16 / 26AS.` : 'Pre-filled from 26AS: check it matches.' },
      ]),
    },
    {
      title: balance > 0 ? 'Pay before you file' : 'Refund',
      where: balance > 0 ? 'e-Pay Tax → Challan 280 (self-assessment tax), then Taxes paid → Self-assessment tax' : 'Bank account (pre-validated) → select for refund',
      fields:
        balance > 0
          ? [
              { label: 'Self-assessment tax to pay', value: Math.round(Math.ceil(balance / 10) * 10), note: 'Tax plus interest. Pay it, then enter the BSR code, date and challan number.' },
            ]
          : [{ label: 'Refund due', value: Math.round(-balance), note: balance === 0 ? 'Nothing to pay or claim.' : 'Comes to your pre-validated bank account after processing.' }],
    },
  ];

  const recon: ReconRow[] = per.map((p) => ({
    employer: p.name,
    tan: p.tan,
    gross: Math.round(p.s171 + p.s173),
    exempt: Math.round(p.leave + p.gratuity),
    chargeable: Math.round(Math.max(0, p.s171 + p.s172 + p.s173 - p.leave - p.gratuity - (multi ? 0 : sd))),
    tds: Math.round(p.tds),
    estimatedMonths: p.est,
  }));

  const checks: { text: string; ok?: boolean }[] = [
    { text: `Total income up to ₹50 lakh (yours: ₹${Math.round(f.taxable).toLocaleString('en-IN')})`, ok: f.taxable <= 5_000_000 },
    { text: 'You are resident in India this year' },
    { text: 'No capital gains other than listed-equity gains up to ₹1.25 lakh (s.112A)' },
    { text: 'At most one house property; agricultural income up to ₹5,000' },
    { text: 'Not a company director, no unlisted shares, no foreign assets or income' },
    { text: 'No deferred tax on startup ESOPs and no losses carried forward' },
  ];
  return {
    form,
    yearLabel,
    dueDate,
    newAct,
    eligibility: { ok: f.taxable <= 5_000_000, checks },
    blocks,
    recon,
    interest234B: b,
    interest234C: c,
    totalTax: f.total,
    tds,
    balance,
  };
}

function tanOf(emp: Scenario['employers'][number] | undefined): string | undefined {
  return emp?.docs.map((d) => d.facts?.tan).filter(Boolean).pop();
}
