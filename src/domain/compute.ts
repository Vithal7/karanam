import { bundledRules, rulesFor, type Rules, type TaxYearRules } from '../rules';
import { addMonths, fyEnd, fyMonths, monthOf } from './fy';
import { projectNextFy, type NextFyResult } from './nextFy';
import {
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
  perDay: number;
  leaveEncashment: number;
  noticeRecovery: number;
  clawback: number;
  month: string;
}

/** Full & final settlement: per-day rate is the last month's full basic / 30. */
export function fnfItems(emp: Employment, fy: number): FnFItems | null {
  if (!emp.fnf || emp.totalsOnly) return null;
  const month = endMonthOf(emp, fy);
  const perDay = structureFor(emp, month).basic / 30;
  return {
    perDay,
    leaveEncashment: Math.round(perDay * (emp.fnf.leaveDays || 0)),
    noticeRecovery: Math.round(perDay * (emp.fnf.noticeDaysRecovered || 0)),
    clawback: emp.fnf.clawback || 0,
    month,
  };
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
  let buyoutFromPrev = 0;

  s.employers.forEach((emp, k) => {
    const f12 = form12BMonth(s, k);
    if (emp.totalsOnly) {
      out.push({ name: emp.name, lines: [], stage: [], fnf: null, form12B: f12, totalsOnly: emp.totalsOnly });
      buyoutFromPrev = 0;
      return;
    }
    const fnf = k < s.employers.length - 1 || emp.end ? fnfItems(emp, s.fy) : null;
    const extraOt: OneTime[] = [];
    const extraRec: Recovery[] = [];
    if (fnf) {
      if (fnf.leaveEncashment)
        extraOt.push({ id: 'fnf-leave', label: 'Leave encashment', kind: 'leaveEncashment', amount: fnf.leaveEncashment, month: fnf.month, taxable: true });
      if (fnf.noticeRecovery) extraRec.push({ id: 'fnf-notice', label: 'Notice recovery', amount: fnf.noticeRecovery, month: fnf.month });
      if (fnf.clawback) extraRec.push({ id: 'fnf-clawback', label: 'Clawback', amount: fnf.clawback, month: fnf.month });
    }
    if (buyoutFromPrev > 0) {
      extraOt.push({
        id: 'buyout',
        label: 'Notice buyout reimbursed',
        kind: 'buyout',
        amount: buyoutFromPrev,
        month: f12 ?? monthOf(window(emp, s.fy)?.start ?? emp.start),
        taxable: true,
      });
    }
    buyoutFromPrev = fnf && emp.fnf?.buyoutByNext ? fnf.noticeRecovery + fnf.clawback : 0;

    const e = withExtras(emp, extraOt, extraRec);
    const v = variableAsOneTime(e);
    const lines = buildLines(e, k, s.fy, thirty, [...e.oneTimes, ...(v ? [v] : [])], rules, t);

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
