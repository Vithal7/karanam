import { bundledRules, rulesFor, type Rules, type TaxYearRules } from '../rules';
import { addMonths, fyEnd, fyMonths, monthFactor, monthOf } from './fy';
import { projectNextFy, type NextFyResult } from './nextFy';
import {
  arrearsFor,
  buildLines,
  ctcNeutralPfCut,
  endMonthOf,
  epfFor,
  finishLine,
  fixedMonthly,
  monthlyPt,
  structureFor,
  taxableGross,
  variableAsOneTime,
  window,
} from './schedule';
import { clawbackFor, type ClawbackLine } from './clawback';
import { round10, taxOn } from './tax';
import { stageTds, type FullYearView, type PreviousIncome, type StageRow } from './tds';
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
  /** true when the clawback was worked out from the bonus terms in your letters. */
  clawbackFromTerms: boolean;
  /** Each bonus with repayment terms: whether they apply at your last day, and how much. */
  clawbackLines: ClawbackLine[];
  penalty: number;
  /** Gratuity (5+ years, exempt up to ₹20 lakh) or ex gratia in lieu of it (under 5 years, taxable). */
  gratuity: number;
  gratuityKind: 'gratuity' | 'exgratia' | 'none';
  /** Tax-free part (gratuity only). */
  gratuityExempt: number;
  /** How it was worked out, in words. */
  gratuityLabel: string;
  serviceYears: number;
  /** Ex gratia: each stretch of service at one monthly rate (it changes with hikes). */
  gratuityPeriods: GratuityPeriod[];
  /**
   * s.10(10AA) limits other than the ₹25 lakh cap: 10 months' average salary, and leave of up to
   * 30 days per completed year at the average daily salary (basic, by the last month's rate).
   */
  leaveExemptLimit: number;
  /** Month the F&F is paid. */
  month: string;
  /** Month of the last working day (pro-rata salary). */
  lastMonth: string;
  lastMonthFactor: number;
}

export interface GratuityPeriod {
  /** First and last day of the stretch. */
  from: string;
  to: string;
  /** Monthly accrual rate in this stretch, and whether it was scaled from basic. */
  monthly: number;
  scaled: boolean;
  months: number;
  amount: number;
  /** Which rate this is: -1 for the joining CTC, else the index into emp.revisions. */
  rev: number;
}

const DAY = 86_400_000;
const dayBeforeIso = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - DAY).toISOString().slice(0, 10);

const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Months from one day to another, both counted: 20 Jan–30 Jun 2026 = 12/31 + 5. */
export function calendarMonths(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  if (y1 === y2 && m1 === m2) return (d2 - d1 + 1) / dim(y1, m1);
  const first = (dim(y1, m1) - d1 + 1) / dim(y1, m1);
  const last = d2 / dim(y2, m2);
  const between = (y2 - y1) * 12 + (m2 - m1) - 1;
  return first + between + last;
}

/**
 * Ex gratia accrues at the CTC's gratuity rate for the time served at that rate: the joining rate
 * until the first hike, then each hike's rate (given, or scaled with basic) until the next.
 */
export function exGratiaPeriods(emp: Employment): GratuityPeriod[] {
  const g0 = emp.ctcParts?.gratuity;
  if (!g0 || !emp.start || !emp.end || emp.end < emp.start) return [];
  const b0 = emp.structure.basic;
  const revs = emp.revisions.map((r, i) => ({ r, i })).filter((x) => x.r.from).sort((a, b) => a.r.from.localeCompare(b.r.from));
  const cuts: { from: string; monthly: number; scaled: boolean; rev: number }[] = [{ from: emp.start, monthly: g0, scaled: false, rev: -1 }];
  for (const { r, i } of revs) {
    const from = `${r.from}-01`;
    const monthly = r.gratuity ?? (b0 ? Math.round((g0 * r.structure.basic) / b0) : g0);
    const at = from <= emp.start ? 0 : cuts.length;
    const cut = { from: from <= emp.start ? emp.start : from, monthly, scaled: r.gratuity === undefined, rev: i };
    if (cut.from > emp.end) continue;
    if (at === 0) cuts[0] = cut;
    else cuts.push(cut);
  }
  return cuts.map((c, k) => {
    const to = k + 1 < cuts.length ? dayBeforeIso(cuts[k + 1].from) : emp.end;
    const months = calendarMonths(c.from, to);
    return { from: c.from, to, monthly: c.monthly, scaled: c.scaled, months, amount: c.monthly * months, rev: c.rev };
  });
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
  const g = gratuityFor(emp, st, f);
  // An amount from the F&F slip or one you typed wins; otherwise the letter's terms decide.
  const claw = clawbackFor(emp);
  const manualClaw = !!f.clawbackManual || !!f.clawback;
  return {
    perDay,
    leaveRateLabel,
    noticePerDay,
    noticeRateLabel: `${f.noticeBasis === 'gross' ? `fixed gross ${inr(gross)}` : `basic ${inr(st.basic)}`} ÷ 30`,
    leaveEncashment: f.leaveAmount ?? Math.round(perDay * (f.leaveDays || 0)),
    leaveFromSlip: f.leaveAmount !== undefined,
    noticeRecovery: f.noticeAmount ?? Math.round(noticePerDay * (f.noticeDaysRecovered || 0)),
    noticeFromSlip: f.noticeAmount !== undefined,
    clawback: manualClaw ? f.clawback || 0 : claw.amount,
    clawbackFromTerms: !manualClaw,
    clawbackLines: claw.lines,
    penalty: f.penalty || 0,
    ...g,
    leaveExemptLimit: Math.min(
      10 * st.basic,
      f.leaveDays ? Math.min(f.leaveDays, 30 * Math.floor(g.serviceYears)) * (st.basic / 30) : Infinity,
    ),
    month: f.payMonth || lastMonth,
    lastMonth,
    lastMonthFactor: w ? monthFactor(lastMonth, w.start, w.end, thirty) : 0,
  };
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** 4 years and 240 days counts as 5 years for gratuity. */
const GRATUITY_MIN_YEARS = 4 + 240 / 365;

const GRATUITY = { daysPerYear: 15, monthDays: 26, maxAmount: 2_000_000, minYears: 5, ...bundledRules.gratuity };

/**
 * Wages for gratuity, at the rate last drawn: basic + DA. Under the Labour Codes (from 21 Nov
 * 2025), when allowances are more than half of your total pay, the excess counts as wages too.
 * Variable pay, incentives and reimbursements aren't part of it.
 */
export function gratuityWages(st: Structure, exit: string, gratuityMonthly = 0): { wages: number; label: string } {
  const da = st.others.filter((o) => /dearness|d\.?a\.?/i.test(o.name)).reduce((a, o) => a + (o.amount || 0), 0);
  const base = st.basic + da;
  const baseLabel = da ? `basic + DA ${inr(base)}` : `basic ${inr(base)}`;
  const rule = GRATUITY.wagesRule;
  if (!rule || exit < rule.from) return { wages: base, label: baseLabel };
  // All remuneration includes the gratuity part of your CTC; the allowances compared don't (FAQ 7).
  const total = fixedMonthly(st) + gratuityMonthly;
  const allowances = fixedMonthly(st) - base;
  const excess = Math.max(0, allowances - rule.allowanceShare * total);
  return excess > 0 ? { wages: base + excess, label: `wages ${inr(base + excess)} (${baseLabel} + ${inr(excess)} of allowances above half your pay)` } : { wages: base, label: baseLabel };
}

/** Completed years of service, a part year over six months counting as a year. */
const gratuityYears = (years: number) => Math.floor(years) + (years % 1 > 0.5 ? 1 : 0);

/**
 * Gratuity at exit. 5+ years: 15 days' wages per completed year, 15/26 × wages × years, up to the
 * ₹20 lakh ceiling; tax-free up to ₹20 lakh under s.10(10). Under 5 years many employers pay ex
 * gratia instead, at the yearly gratuity rate in the CTC, prorated for service; ex gratia is taxable.
 */
export function gratuityFor(emp: Employment, st: Structure, f: NonNullable<Employment['fnf']>) {
  const years = emp.start && emp.end ? Math.max(0, (Date.parse(emp.end) - Date.parse(emp.start)) / 86_400_000 + 1) / 365.25 : 0;
  const qualifies = years >= GRATUITY_MIN_YEARS;
  const { wages, label: wagesLabel } = gratuityWages(st, emp.end, emp.ctcParts?.gratuity ?? 0);
  const formula = (n: number) => Math.min(Math.round((GRATUITY.daysPerYear / GRATUITY.monthDays) * wages * n), GRATUITY.maxAmount);
  const none = { gratuity: 0, gratuityKind: 'none' as const, gratuityExempt: 0, gratuityLabel: '', serviceYears: years, gratuityPeriods: [] as GratuityPeriod[] };
  if (f.gratuityMode === 'none') return none;
  if (f.gratuity !== undefined) {
    // Tax-free: the least of what's paid, the 15/26 formula and ₹20 lakh; the rest is taxed.
    const exempt = qualifies ? Math.min(f.gratuity, formula(gratuityYears(years)), GRATUITY_EXEMPT_CAP) : 0;
    return { ...none, gratuity: f.gratuity, gratuityKind: qualifies ? ('gratuity' as const) : ('exgratia' as const), gratuityExempt: exempt, gratuityLabel: 'as per your F&F slip' };
  }
  if (qualifies) {
    const n = gratuityYears(years);
    const amount = formula(n);
    const capped = amount === GRATUITY.maxAmount ? `, capped at the ${inr(GRATUITY.maxAmount)} ceiling (anything more your employer pays is ex gratia, taxed as salary)` : '';
    return {
      ...none,
      gratuity: amount,
      gratuityKind: 'gratuity' as const,
      gratuityExempt: Math.min(amount, GRATUITY_EXEMPT_CAP),
      gratuityLabel: `${GRATUITY.daysPerYear}/${GRATUITY.monthDays} × ${wagesLabel} × ${n} years${capped}`,
    };
  }
  if (!f.exGratia) return { ...none, gratuityLabel: 'under 5 years of service, so no gratuity; ex gratia is counted only if your employer pays it' };
  const periods = exGratiaPeriods(emp);
  if (!periods.length) return { ...none, gratuityLabel: 'under 5 years of service and no gratuity rate in your CTC' };
  const amount = Math.round(periods.reduce((a, p) => a + p.amount, 0));
  return {
    ...none,
    gratuity: amount,
    gratuityKind: 'exgratia' as const,
    gratuityLabel: periods.map((p) => `${inr(p.monthly)}/month × ${p.months.toFixed(1)} months`).join(' + '),
    gratuityPeriods: periods,
  };
}

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
  const join = monthOf(w.start);
  if (/^\d{4}-\d{2}$/.test(emp.form12B)) return emp.form12B < join ? join : emp.form12B;
  return addMonths(join, emp.form12B === 'second' ? 1 : 0);
}

/** Problems that make the timeline impossible, in plain words. */
export function validateEmployers(s: Scenario): string[] {
  const errs: string[] = [];
  const es = s.employers;
  if (es.length === 0) errs.push('Add a job first: a letter, a payslip, or the numbers you know.');
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

/** The structure paid in a month, with any PF-ceiling cut already taken out of the allowance. */
function steadyStructure(emp: Employment, month: string, rules: Rules): Structure {
  const st = structureFor(emp, month);
  return { ...st, special: st.special - ctcNeutralPfCut(emp, st, month, rules) };
}

/** What a normal full year on this structure looks like per month (no one-offs). */
export function steadyState(st: Structure, month: string, rules: Rules, t: TaxYearRules, pt = st.pt): SteadyState {
  const gross = fixedMonthly(st);
  const epf = epfFor(st, month, rules);
  const nps = st.npsInGross ? st.npsPct * st.basic : 0;
  const npsDed = st.npsInGross ? Math.min(nps, t.npsCapPctOfBasic * st.basic) : 0;
  const taxable = round10(Math.max(0, gross * 12 - t.standardDeduction - npsDed * 12));
  const annualTax = taxOn(taxable, t).total;
  const tds = annualTax / 12;
  return { gross, epf, pt, nps, tds, annualTax, inHand: gross - epf - pt - nps - tds };
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
      if (fnf.gratuityKind === 'gratuity') {
        extraOt.push({ id: 'fnf-gratuity', label: 'Gratuity', kind: 'other', amount: fnf.gratuityExempt, month: fnf.month, taxable: false });
        if (fnf.gratuity > fnf.gratuityExempt)
          extraOt.push({ id: 'fnf-gratuity-tax', label: 'Gratuity above ₹20 lakh', kind: 'other', amount: fnf.gratuity - fnf.gratuityExempt, month: fnf.month, taxable: true });
      } else if (fnf.gratuityKind === 'exgratia' && fnf.gratuity) {
        extraOt.push({ id: 'fnf-exgratia', label: 'Ex gratia (in lieu of gratuity)', kind: 'other', amount: fnf.gratuity, month: fnf.month, taxable: true });
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
    // Arrears recorded from a payslip or tax sheet replace the ones we'd work out.
    const recordedArrears = new Set(e.oneTimes.filter((o) => o.id.startsWith('actual-') && /arrear/i.test(o.label)).map((o) => o.month));
    const arrears = arrearsFor(e, thirty).filter((a) => !recordedArrears.has(a.month));
    const lines = buildLines(e, k, s.fy, thirty, [...e.oneTimes, ...arrears, ...(v ? [v] : [])], rules, t);
    // Months whose gross a payslip or tax sheet records: that's what was paid. The difference
    // (loss of pay, a part month, rounding, an item we don't model) shows as its own line.
    const todayM = monthOf(s.today);
    for (const l of lines) {
      const g = e.grossKnown?.[l.month];
      if (g === undefined || l.month >= todayM) continue;
      const diff = Math.round(g - l.gross);
      if (Math.abs(diff) < 1) continue;
      l.oneTimes.push({ label: 'Difference to your payslip / tax sheet', amount: diff, taxable: true, kind: 'other' });
      l.gross += diff;
    }

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
    // Before you resign, this payroll assumes you stay till March (see FullYearView).
    let fullYear: FullYearView | undefined;
    if (k < s.employers.length - 1 && emp.end) {
      const stay = buildLines({ ...e, end: '' }, k, s.fy, thirty, [], rules, t);
      const months = fyMonths(s.fy);
      fullYear = {
        untilMonth: monthOf(emp.resignedOn || emp.end),
        regular: stay.reduce((a, l) => a + l.basic + l.hra + l.special + l.others, 0),
        npsDeductible: stay.reduce((a, l) => a + l.npsDeductible, 0),
        monthsToMarch: (m) => 12 - months.indexOf(m),
      };
    }
    const stage = stageTds(lines, e.tdsKnown, prev, t, fullYear);
    lines.forEach(finishLine);
    out.push({ name: emp.name, lines, stage, fnf, form12B: f12 });
  });

  // --- combined position at filing ---
  const all = out.flatMap((r) => r.lines);
  const totalsGross = out.reduce((a, r) => a + (r.totalsOnly?.gross ?? 0), 0);
  const totalsTds = out.reduce((a, r) => a + (r.totalsOnly?.tds ?? 0), 0);
  const gross = all.reduce((a, l) => a + taxableGross(l), 0) + totalsGross;
  // Leave encashed on leaving: each job's payout up to its s.10(10AA) limits, then the ₹25 lakh cap.
  const leave = out.reduce((a, r) => {
    const paid = r.lines.flatMap((l) => l.oneTimes).filter((o) => o.kind === 'leaveEncashment').reduce((b, o) => b + o.amount, 0);
    return a + Math.min(paid, r.fnf?.leaveExemptLimit ?? Infinity);
  }, 0);
  const leaveExemption = Math.round(Math.min(leave, t.leaveEncashmentCap));
  const npsDeduction = all.reduce((a, l) => a + l.npsDeductible, 0);
  const taxable = round10(Math.max(0, gross - t.standardDeduction - leaveExemption - npsDeduction));
  // s.288B: the tax payable is rounded to the nearest ₹10.
  const tx0 = taxOn(taxable, t);
  const tx = { ...tx0, total: round10(tx0.total) };
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
    steady: (() => {
      const st = steadyStructure(last, lastMonth, rules);
      return steadyState(st, lastMonth, rules, t, monthlyPt(last, st, rules));
    })(),
    nextFy: projectNextFy(s, rules),
  };
}

/** Convenience for the UI: the offer being evaluated. */
export const lastOf = <T,>(xs: T[]) => xs[xs.length - 1];
