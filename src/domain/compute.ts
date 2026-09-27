import { bundledRules, rulesFor, type Rules, type TaxYearRules } from '../rules';
import { addMonths, fyEnd, fyMonths, monthFactor, monthOf } from './fy';
import { projectNextFy, type NextFyResult } from './nextFy';
import {
  arrearsFor,
  buildLines,
  endMonthOf,
  epfFor,
  finishLine,
  fixedMonthly,
  structureFor,
  taxableGross,
  variableAsOneTime,
  window,
} from './schedule';
import { round10, taxOn } from './tax';
import { stageTds, type PreviousIncome, type StageRow } from './tds';
import type { Employment, MonthLine, OneTime, Recovery, Scenario, Structure, TaxBreakdown } from './types';

export const MAX_EMPLOYERS = 3;

export interface FnFItems {
  /** Leave encashment rate per day, and how it was worked out. */
  perDay: number;
  leaveRateLabel: string;
  noticePerDay: number;
  noticeRateLabel: string;
  leaveEncashment: number;
  /** true when the amount came from the F&F slip rather than days × rate. */
  leaveFromSlip: boolean;
  noticeRecovery: number;
  noticeFromSlip: boolean;
  clawback: number;
  penalty: number;
  gratuity: number;
  /** Month the F&F is paid. */
  month: string;
  /** Month of the last working day (pro-rata salary). */
  lastMonth: string;
  lastMonthFactor: number;
}

/** Gratuity exemption limit under s.10(10)(iii). */
export const GRATUITY_EXEMPT_CAP = 2_000_000;

/**
 * Full & final settlement. Leave is encashed at a per-day rate the user picks (basic ÷ 30 by
 * default, as most payrolls do); notice shortfall is recovered at basic ÷ 30 or gross ÷ 30.
 * Amounts printed on the F&F slip win over the calculation.
 */
export function fnfItems(emp: Employment, fy: number, thirty = false): FnFItems | null {
  if (!emp.fnf || emp.totalsOnly) return null;
  const f = emp.fnf;
  const lastMonth = endMonthOf(emp, fy);
  const st = structureFor(emp, lastMonth);
  const gross = fixedMonthly(st);
  const basis = f.leaveBasis ?? 'basic30';
  const perDay =
    basis === 'custom' ? f.leaveRate || 0 : basis === 'basic26' ? st.basic / 26 : basis === 'gross30' ? gross / 30 : st.basic / 30;
  const leaveRateLabel =
    basis === 'custom'
      ? 'your rate'
      : basis === 'basic26'
        ? `basic ${inr(st.basic)} ÷ 26`
        : basis === 'gross30'
          ? `fixed gross ${inr(gross)} ÷ 30`
          : `basic ${inr(st.basic)} ÷ 30`;
  const noticePerDay = (f.noticeBasis === 'gross' ? gross : st.basic) / 30;
  const w = window(emp, fy);
  return {
    perDay,
    leaveRateLabel,
    noticePerDay,
    noticeRateLabel: `${f.noticeBasis === 'gross' ? `fixed gross ${inr(gross)}` : `basic ${inr(st.basic)}`} ÷ 30`,
    leaveEncashment: f.leaveAmount ?? Math.round(perDay * (f.leaveDays || 0)),
    leaveFromSlip: f.leaveAmount !== undefined,
    noticeRecovery: f.noticeAmount ?? Math.round(noticePerDay * (f.noticeDaysRecovered || 0)),
    noticeFromSlip: f.noticeAmount !== undefined,
    clawback: f.clawback || 0,
    penalty: f.penalty || 0,
    gratuity: f.gratuity || 0,
    month: f.payMonth || lastMonth,
    lastMonth,
    lastMonthFactor: w ? monthFactor(lastMonth, w.start, w.end, thirty) : 0,
  };
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** What the next job reimburses: notice recovery (and clawback if covered), up to any cap. */
export function buyoutAmount(prev: FnFItems | null, next: Employment, prevEmp?: Employment): { amount: number; claimed: number } {
  const mode = next.buyout?.mode ?? (prevEmp?.fnf?.buyoutByNext ? 'actuals' : 'none');
  if (!prev || mode === 'none') return { amount: 0, claimed: 0 };
  const claimed = prev.noticeRecovery + (next.buyout?.includesClawback || (!next.buyout && prevEmp?.fnf?.buyoutByNext) ? prev.clawback : 0);
  const amount = mode === 'cap' && next.buyout?.cap ? Math.min(claimed, next.buyout.cap) : claimed;
  return { amount, claimed };
}

/** Month from which employer k knows about earlier jobs' salary and TDS (Form 12B). */
export function form12BMonth(s: Scenario, k: number): string | null {
  const emp = s.employers[k];
  if (k === 0 || !emp || emp.form12B === 'never') return null;
  const w = window(emp, s.fy);
  if (!w) return null;
  return addMonths(monthOf(w.start), emp.form12B === 'second' ? 1 : 0);
}

/** Problems that make the timeline impossible, in plain words. */
export function validateEmployers(s: Scenario): string[] {
  const errs: string[] = [];
  const es = s.employers;
  if (es.length === 0) errs.push('Add your offer first.');
  if (es.length > MAX_EMPLOYERS) errs.push(`At most ${MAX_EMPLOYERS} jobs in one year.`);
  es.forEach((e, i) => {
    const name = e.name || `Job ${i + 1}`;
    if (e.end && e.start && e.end < e.start) errs.push(`${name}: the last working day is before the start date.`);
    const next = es[i + 1];
    if (next) {
      if (!e.end && !e.totalsOnly) errs.push(`${name}: add the last working day.`);
      if (e.end && next.start && e.end >= next.start) errs.push(`${name} overlaps with ${next.name || `job ${i + 2}`}. The last day must be before the next job starts.`);
    }
  });
  return errs;
}

export interface SteadyState {
  gross: number;
  epf: number;
  pt: number;
  nps: number;
  tds: number;
  inHand: number;
  annualTax: number;
}

/** What a normal full year on this structure looks like per month (no one-offs). */
export function steadyState(st: Structure, month: string, rules: Rules, t: TaxYearRules): SteadyState {
  const gross = fixedMonthly(st);
  const epf = epfFor(st, month, rules);
  const nps = st.npsInGross ? st.npsPct * st.basic : 0;
  const npsDed = st.npsInGross ? Math.min(nps, t.npsCapPctOfBasic * st.basic) : 0;
  const taxable = round10(Math.max(0, gross * 12 - t.standardDeduction - npsDed * 12));
  const annualTax = taxOn(taxable, t).total;
  const tds = annualTax / 12;
  return { gross, epf, pt: st.pt, nps, tds, annualTax, inHand: gross - epf - st.pt - nps - tds };
}

export interface MonthSummary {
  month: string;
  lines: MonthLine[];
  gross: number;
  tds: number;
  inHand: number;
  past: boolean;
}

export interface Filing extends TaxBreakdown {
  tdsTotal: number;
  /** Positive = pay at filing, negative = refund. */
  balance: number;
}

export interface EmployerResult {
  name: string;
  lines: MonthLine[];
  stage: StageRow[];
  fnf: FnFItems | null;
  form12B: string | null;
  totalsOnly?: { gross: number; tds: number };
}

export interface Result {
  fy: number;
  rulesVersion: string;
  months: MonthSummary[];
  employers: EmployerResult[];
  filing: Filing;
  totals: { gross: number; inHand: number; tds: number; remainingInHand: number; remainingMonths: number };
  steady: SteadyState;
  nextFy: NextFyResult;
}

const withExtras = (emp: Employment, oneTimes: OneTime[], recoveries: Recovery[]): Employment => ({
  ...emp,
  oneTimes: [...emp.oneTimes, ...oneTimes],
  recoveries: [...emp.recoveries, ...recoveries],
});

export function compute(s: Scenario, rules: Rules = bundledRules): Result {
  const t = rulesFor(rules, s.fy);
  const thirty = s.settings.thirtyDayMonth;
  const out: EmployerResult[] = [];
  let prevFnf: FnFItems | null = null;

  s.employers.forEach((emp, k) => {
    const f12 = form12BMonth(s, k);
    if (emp.totalsOnly) {
      out.push({ name: emp.name, lines: [], stage: [], fnf: null, form12B: f12, totalsOnly: emp.totalsOnly });
      prevFnf = null;
      return;
    }
    const fnf = k < s.employers.length - 1 || emp.end ? fnfItems(emp, s.fy, thirty) : null;
    const extraOt: OneTime[] = [];
    const extraRec: Recovery[] = [];
    if (fnf) {
      if (fnf.leaveEncashment)
        extraOt.push({ id: 'fnf-leave', label: 'Leave encashment', kind: 'leaveEncashment', amount: fnf.leaveEncashment, month: fnf.month, taxable: true });
      if (fnf.noticeRecovery) extraRec.push({ id: 'fnf-notice', label: 'Notice recovery', amount: fnf.noticeRecovery, month: fnf.month });
      if (fnf.clawback) extraRec.push({ id: 'fnf-clawback', label: 'Bonus clawback', amount: fnf.clawback, month: fnf.month });
      if (fnf.penalty) extraRec.push({ id: 'fnf-penalty', label: 'Penalty / bond recovery', amount: fnf.penalty, month: fnf.month });
      if (fnf.gratuity) {
        const exempt = Math.min(fnf.gratuity, GRATUITY_EXEMPT_CAP);
        extraOt.push({ id: 'fnf-gratuity', label: 'Gratuity', kind: 'other', amount: exempt, month: fnf.month, taxable: false });
        if (fnf.gratuity > exempt)
          extraOt.push({ id: 'fnf-gratuity-tax', label: 'Gratuity above ₹20 lakh', kind: 'other', amount: fnf.gratuity - exempt, month: fnf.month, taxable: true });
      }
    }
    const bo = k > 0 ? buyoutAmount(prevFnf, emp, s.employers[k - 1]) : { amount: 0, claimed: 0 };
    if (bo.amount > 0) {
      extraOt.push({
        id: 'buyout',
        label: 'Notice buyout reimbursed',
        kind: 'buyout',
        amount: bo.amount,
        month: emp.buyout?.month || f12 || monthOf(window(emp, s.fy)?.start ?? emp.start),
        taxable: true,
      });
    }
    prevFnf = fnf;

    const e = withExtras(emp, extraOt, extraRec);
    const v = variableAsOneTime(e);
    const lines = buildLines(e, k, s.fy, thirty, [...e.oneTimes, ...arrearsFor(e, thirty), ...(v ? [v] : [])], rules, t);

    // Everything earned at earlier jobs this FY, which this payroll learns from Form 12B.
    const earlier = out;
    const prev: PreviousIncome | null =
      k > 0
        ? {
            knownFrom: f12,
            taxableGross: earlier.reduce((a, r) => a + (r.totalsOnly?.gross ?? r.lines.reduce((b, l) => b + taxableGross(l), 0)), 0),
            npsDeductible: earlier.reduce((a, r) => a + r.lines.reduce((b, l) => b + l.npsDeductible, 0), 0),
            tds: earlier.reduce((a, r) => a + (r.totalsOnly?.tds ?? r.lines.reduce((b, l) => b + l.tds, 0)), 0),
          }
        : null;
    const stage = stageTds(lines, e.tdsKnown, prev, t);
    lines.forEach(finishLine);
    out.push({ name: emp.name, lines, stage, fnf, form12B: f12 });
  });

  // --- combined position at filing ---
  const all = out.flatMap((r) => r.lines);
  const totalsGross = out.reduce((a, r) => a + (r.totalsOnly?.gross ?? 0), 0);
  const totalsTds = out.reduce((a, r) => a + (r.totalsOnly?.tds ?? 0), 0);
  const gross = all.reduce((a, l) => a + taxableGross(l), 0) + totalsGross;
  const leave = all
    .flatMap((l) => l.oneTimes)
    .filter((o) => o.kind === 'leaveEncashment')
    .reduce((a, o) => a + o.amount, 0);
  const leaveExemption = Math.min(leave, t.leaveEncashmentCap);
  const npsDeduction = all.reduce((a, l) => a + l.npsDeductible, 0);
  const taxable = round10(Math.max(0, gross - t.standardDeduction - leaveExemption - npsDeduction));
  const tx = taxOn(taxable, t);
  const tdsTotal = all.reduce((a, l) => a + l.tds, 0) + totalsTds;
  const filing: Filing = {
    gross,
    standardDeduction: t.standardDeduction,
    leaveExemption,
    npsDeduction,
    taxable,
    ...tx,
    tdsTotal,
    balance: tx.total - tdsTotal,
  };

  const todayMonth = monthOf(s.today);
  const months: MonthSummary[] = fyMonths(s.fy).map((month) => {
    const lines = all.filter((l) => l.month === month);
    return {
      month,
      lines,
      gross: lines.reduce((a, l) => a + l.gross, 0),
      tds: lines.reduce((a, l) => a + l.tds, 0),
      inHand: lines.reduce((a, l) => a + l.inHand, 0),
      past: month < todayMonth,
    };
  });
  const remaining = months.filter((m) => !m.past && m.lines.length);

  const last = s.employers[s.employers.length - 1];
  const lastMonth = monthOf(fyEnd(s.fy));
  return {
    fy: s.fy,
    rulesVersion: rules.version,
    months,
    employers: out,
    filing,
    totals: {
      gross: months.reduce((a, m) => a + m.gross, 0),
      inHand: months.reduce((a, m) => a + m.inHand, 0),
      tds: months.reduce((a, m) => a + m.tds, 0),
      remainingInHand: remaining.reduce((a, m) => a + m.inHand, 0),
      remainingMonths: remaining.length,
    },
    steady: steadyState(structureFor(last, lastMonth), lastMonth, rules, t),
    nextFy: projectNextFy(s, rules),
  };
}

/** Convenience for the UI: the offer being evaluated. */
export const lastOf = <T,>(xs: T[]) => xs[xs.length - 1];
