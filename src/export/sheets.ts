/**
 * The year's numbers laid out like a payroll workbook: one sheet per financial year with the
 * month-by-month pay, the tax computation (slab by slab), how each employer staged TDS, and the
 * F&F. The Excel and PDF downloads are both drawn from this.
 */
import type { Result } from '../domain/compute';
import { fyLabel, monthName } from '../domain/fy';
import { taxableGross } from '../domain/schedule';
import { taxOn } from '../domain/tax';
import type { MonthLine, Scenario } from '../domain/types';
import { rulesFor, type Rules, type TaxYearRules } from '../rules';

export type Cell = string | number | null;

export interface Section {
  title: string;
  head?: string[];
  rows: Cell[][];
  /** Rows to show in bold (totals, the bottom line). */
  bold?: number[];
  /** Columns that are text, not money. */
  textCols?: number[];
}

export interface Sheet {
  name: string;
  title: string;
  sections: Section[];
}

const r0 = (n: number) => Math.round(n);
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const oneTime = (l: MonthLine) => l.oneTimes.reduce((a, o) => a + o.amount, 0);
const deductions = (l: MonthLine) => (l.noncash ?? 0) + l.epf + l.pt + l.nps + l.recoveries + l.tds;

function monthly(lines: MonthLine[], names: string[], withSource: boolean): Section {
  const head = ['Company', 'Month', 'Basic', 'HRA', 'Allowances', 'Bonus & one-time', 'Gross', 'EPF', 'Prof. tax', 'NPS', 'Recoveries', 'TDS', 'Deductions', 'In hand', 'Running TDS'];
  if (withSource) head.push('TDS from');
  const running: Record<number, number> = {};
  const sorted = [...lines].sort((a, b) => a.month.localeCompare(b.month) || a.employer - b.employer);
  const rows: Cell[][] = sorted.map((l) => {
    running[l.employer] = (running[l.employer] ?? 0) + l.tds;
    const row: Cell[] = [
      names[l.employer] ?? l.employerName,
      monthName(l.month),
      r0(l.basic),
      r0(l.hra),
      r0(l.special + l.others),
      r0(oneTime(l)),
      r0(l.gross),
      r0(l.epf),
      r0(l.pt),
      r0(l.nps),
      r0(l.recoveries),
      r0(l.tds),
      r0(deductions(l)),
      r0(l.inHand),
      r0(running[l.employer]),
    ];
    if (withSource) row.push(l.tdsEstimated ? 'Estimated' : 'Your files');
    return row;
  });
  const sum = (f: (l: MonthLine) => number) => r0(lines.reduce((a, l) => a + f(l), 0));
  const total: Cell[] = ['Total', '', sum((l) => l.basic), sum((l) => l.hra), sum((l) => l.special + l.others), sum(oneTime), sum((l) => l.gross), sum((l) => l.epf), sum((l) => l.pt), sum((l) => l.nps), sum((l) => l.recoveries), sum((l) => l.tds), sum(deductions), sum((l) => l.inHand), null];
  if (withSource) total.push('');
  return { title: 'Month by month', head, rows: [...rows, total], bold: [rows.length], textCols: withSource ? [0, 1, 15] : [0, 1] };
}

/** Slab-by-slab tax on a taxable income: From, To, Rate, Tax. */
function slabRows(taxable: number, t: TaxYearRules): Cell[][] {
  let lower = 0;
  return t.slabs.map((s) => {
    const upper = s.upto ?? Infinity;
    const inSlab = Math.max(0, Math.min(taxable, upper) - lower);
    const row: Cell[] = [lower ? lower + 1 : 0, s.upto ?? 'and above', `${Math.round(s.rate * 100)}%`, r0(inSlab * s.rate)];
    lower = upper;
    return row;
  });
}

function taxSection(opts: {
  grossBy: [string, number][];
  t: TaxYearRules;
  leaveExemption: number;
  nps: number;
  tdsBy: [string, number][];
}): Section[] {
  const { t } = opts;
  const gross = opts.grossBy.reduce((a, [, v]) => a + v, 0);
  const taxable = Math.round(Math.max(0, gross - t.standardDeduction - opts.leaveExemption - opts.nps) / 10) * 10;
  const t0 = taxOn(taxable, t);
  // s.288B: tax rounded to the nearest ₹10.
  const tax = { ...t0, total: Math.round(t0.total / 10) * 10 };
  const tds = opts.tdsBy.reduce((a, [, v]) => a + v, 0);
  const balance = tax.total - tds;
  const rows: Cell[][] = [
    ...opts.grossBy.map(([n, v]) => [`Gross salary: ${n}`, r0(v)]),
    ['Total gross salary', r0(gross)],
    ['Less: standard deduction', -r0(t.standardDeduction)],
    ...(opts.leaveExemption ? [['Less: leave encashment exemption, s.10(10AA)', -r0(opts.leaveExemption)] as Cell[]] : []),
    ...(opts.nps ? [['Less: employer NPS, s.80CCD(2)', -r0(opts.nps)] as Cell[]] : []),
    ['Taxable income (rounded to ₹10)', taxable],
  ];
  const bottom: Cell[][] = [
    ['Slab tax', r0(tax.slabTax)],
    ['Less: rebate u/s 87A / marginal relief', -r0(tax.rebate)],
    ...(tax.surcharge ? [['Surcharge', r0(tax.surcharge)] as Cell[]] : []),
    [`Health & education cess @ ${Math.round(t.cess * 100)}%`, r0(tax.cess)],
    ['Tax payable for the year', r0(tax.total)],
    ...opts.tdsBy.map(([n, v]) => [`Less: TDS by ${n}`, -r0(v)] as Cell[]),
    [Math.abs(balance) < 1 ? 'Balance at filing: nothing to pay or refund' : balance > 0 ? 'Tax to pay when you file' : 'Refund when you file', r0(Math.abs(balance))],
  ];
  return [
    { title: 'Income and deductions', head: ['', 'Amount'], rows, bold: [rows.length - 1], textCols: [0] },
    { title: 'Tax by slab (new regime)', head: ['From', 'To', 'Rate', 'Tax'], rows: slabRows(taxable, t), textCols: [2] },
    { title: 'Tax and TDS', head: ['', 'Amount'], rows: bottom, bold: [bottom.length - 1, bottom.length - 2 - opts.tdsBy.length], textCols: [0] },
  ];
}

export function buildSheets(r: Result, s: Scenario, rules: Rules): Sheet[] {
  const names = s.employers.map((e) => e.name || 'Job');
  const lines = r.employers.flatMap((e) => e.lines);
  const t = rulesFor(rules, r.fy);
  const now: Sheet = {
    name: fyLabel(r.fy),
    title: `${fyLabel(r.fy)}: salary, tax and in-hand`,
    sections: [monthly(lines, names, true)],
  };
  const grossBy: [string, number][] = r.employers.map((e, k) => [names[k], e.totalsOnly ? e.totalsOnly.gross : e.lines.reduce((a, l) => a + taxableGross(l), 0)]);
  const tdsBy: [string, number][] = r.employers.map((e, k) => [names[k], e.totalsOnly ? e.totalsOnly.tds : e.lines.reduce((a, l) => a + l.tds, 0)]);
  now.sections.push(...taxSection({ grossBy, t, leaveExemption: r.filing.leaveExemption, nps: r.filing.npsDeduction, tdsBy }));

  r.employers.forEach((e, k) => {
    if (e.stage.length)
      now.sections.push({
        title: `How ${names[k]} deducted TDS (s.192: re-estimated every month)`,
        head: ['Month', 'Income payroll projects', 'Taxable', 'Tax for the year', 'Earlier employer TDS', 'Already deducted', 'Months left', 'TDS this month', 'TDS from'],
        rows: e.stage.map((x) => [monthName(x.month), r0(x.projectedIncome), r0(x.taxable), r0(x.tax), r0(x.previousTds), r0(x.alreadyDeducted), x.monthsLeft, r0(x.tds), x.known ? 'Your files' : 'Estimated']),
        textCols: [0, 8],
      });
    const f = e.fnf;
    if (f) {
      const rows: Cell[][] = [];
      if (f.leaveEncashment) rows.push([`Leave encashment${f.leaveFromSlip ? ' (F&F slip)' : ` (${f.leaveRateLabel}, ${r0(f.perDay)}/day)`}`, r0(f.leaveEncashment)]);
      if (f.gratuity) rows.push([f.gratuityKind === 'exgratia' ? 'Ex gratia in lieu of gratuity (taxable)' : 'Gratuity (tax-free up to ₹20 lakh)', r0(f.gratuity)]);
      for (const p of f.gratuityPeriods) rows.push([`   ${day(p.from)} to ${day(p.to)}: ${r0(p.monthly)}/month × ${p.months.toFixed(2)} months`, r0(p.amount)]);
      if (f.noticeRecovery) rows.push([`Notice recovery${f.noticeFromSlip ? ' (F&F slip)' : ` (${f.noticeRateLabel})`}`, -r0(f.noticeRecovery)]);
      if (f.clawback) rows.push(['Joining bonus clawback', -r0(f.clawback)]);
      if (f.penalty) rows.push(['Penalty / bond', -r0(f.penalty)]);
      if (rows.length) now.sections.push({ title: `F&F from ${names[k]} (paid ${monthName(f.month)})`, head: ['', 'Amount'], rows, textCols: [0] });
    }
  });

  // Next FY at the last job.
  const n = r.nextFy;
  const tn = rulesFor(rules, n.fy);
  const next: Sheet = {
    name: `${fyLabel(n.fy)} projection`,
    title: `${fyLabel(n.fy)} projection at ${names[names.length - 1]}`,
    sections: [
      {
        title: 'Assumptions',
        head: ['', 'Value'],
        rows: [
          ['Hike from April', `${(n.hike * 100).toFixed(1)}%`],
          ['Days served in the joining year', n.daysServed],
          ['Hike applied (prorated for days served)', `${(n.effectiveHike * 100).toFixed(2)}%`],
          ['TDS', 'Spread evenly: payroll knows the whole year'],
        ],
        textCols: [0, 1],
      },
      monthly(n.lines, names, false),
      ...taxSection({
        grossBy: [[names[names.length - 1], n.lines.reduce((a, l) => a + taxableGross(l), 0)]],
        t: tn,
        leaveExemption: 0,
        nps: n.npsDeduction,
        tdsBy: [[names[names.length - 1], n.lines.reduce((a, l) => a + l.tds, 0)]],
      }),
    ],
  };
  return [now, next];
}
