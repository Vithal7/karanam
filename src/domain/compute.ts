import { addMonths, fyMonths, monthOf } from './fy';
import { projectNextFy, type NextFyResult } from './nextFy';
import {
  buildLines,
  endMonthOf,
  finishLine,
  fixedMonthly,
  structureFor,
  taxableGross,
  variableAsOneTime,
  window,
} from './schedule';
import { NEW_REGIME, round10, taxOn } from './tax';
import { stageTds, type PreviousIncome, type StageRow } from './tds';
import type { Employment, MonthLine, OneTime, Recovery, Scenario, Structure, TaxBreakdown } from './types';

export interface FnFItems {
  perDay: number;
  leaveEncashment: number;
  noticeRecovery: number;
  clawback: number;
  month: string;
}

/** Full & final settlement at the current employer: per-day rate is last full basic / 30. */
export function fnfItems(s: Scenario): FnFItems | null {
  if (!s.current || !s.fnf) return null;
  const month = endMonthOf(s.current, s.fy);
  const perDay = structureFor(s.current, month).basic / 30;
  return {
    perDay,
    leaveEncashment: Math.round(perDay * (s.fnf.leaveDays || 0)),
    noticeRecovery: Math.round(perDay * (s.fnf.noticeDaysRecovered || 0)),
    clawback: s.fnf.clawback || 0,
    month,
  };
}

export function form12BMonth(s: Scenario): string | null {
  const w = window(s.next, s.fy);
  if (!w || s.settings.form12B === 'never') return null;
  if (!s.current && !s.prior) return null;
  return addMonths(monthOf(w.start), s.settings.form12B === 'second' ? 1 : 0);
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
export function steadyState(st: Structure): SteadyState {
  const gross = fixedMonthly(st);
  const nps = st.npsInGross ? st.npsPct * st.basic : 0;
  const npsDed = st.npsInGross ? Math.min(nps, NEW_REGIME.npsCapPctOfBasic * st.basic) : 0;
  const taxable = round10(Math.max(0, gross * 12 - NEW_REGIME.standardDeduction - npsDed * 12));
  const annualTax = taxOn(taxable).total;
  const tds = annualTax / 12;
  return { gross, epf: st.epf, pt: st.pt, nps, tds, annualTax, inHand: gross - st.epf - st.pt - nps - tds };
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

export interface Result {
  fy: number;
  months: MonthSummary[];
  currentLines: MonthLine[];
  nextLines: MonthLine[];
  currentStage: StageRow[];
  nextStage: StageRow[];
  fnf: FnFItems | null;
  form12B: string | null;
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

export function compute(s: Scenario): Result {
  const thirty = s.settings.thirtyDayMonth;
  const fnf = fnfItems(s);
  const f12 = form12BMonth(s);

  // --- current employer (F&F folded in) ---
  let currentLines: MonthLine[] = [];
  let currentStage: StageRow[] = [];
  if (s.current) {
    const extraOt: OneTime[] = [];
    const extraRec: Recovery[] = [];
    if (fnf) {
      if (fnf.leaveEncashment)
        extraOt.push({ id: 'fnf-leave', label: 'Leave encashment', kind: 'leaveEncashment', amount: fnf.leaveEncashment, month: fnf.month, taxable: true });
      if (fnf.noticeRecovery) extraRec.push({ id: 'fnf-notice', label: 'Notice recovery', amount: fnf.noticeRecovery, month: fnf.month });
      if (fnf.clawback) extraRec.push({ id: 'fnf-clawback', label: 'Clawback', amount: fnf.clawback, month: fnf.month });
    }
    const cur = withExtras(s.current, extraOt, extraRec);
    const v = variableAsOneTime(cur);
    currentLines = buildLines(cur, 'current', s.fy, thirty, [...cur.oneTimes, ...(v ? [v] : [])]);
    currentStage = stageTds(currentLines, cur.tdsKnown, null);
    currentLines.forEach(finishLine);
  }

  // --- new employer ---
  const extraNext: OneTime[] = [];
  if (fnf && s.fnf?.buyoutByNew && fnf.noticeRecovery + fnf.clawback > 0) {
    extraNext.push({
      id: 'buyout',
      label: 'Notice buyout reimbursed',
      kind: 'buyout',
      amount: fnf.noticeRecovery + fnf.clawback,
      month: f12 ?? monthOf(window(s.next, s.fy)?.start ?? s.next.start),
      taxable: true,
    });
  }
  const next = withExtras(s.next, extraNext, []);
  const oneTimes = next.oneTimes.map((o) =>
    o.kind === 'buyout' && !o.month ? { ...o, month: f12 ?? monthOf(next.start) } : o,
  );
  const v = variableAsOneTime(next);
  const nextLines = buildLines(next, 'next', s.fy, thirty, [...oneTimes, ...(v ? [v] : [])]);
  const prev: PreviousIncome | null =
    s.current || s.prior
      ? {
          knownFrom: f12,
          taxableGross: currentLines.reduce((a, l) => a + taxableGross(l), 0) + (s.prior?.gross || 0),
          npsDeductible: currentLines.reduce((a, l) => a + l.npsDeductible, 0),
          tds: currentLines.reduce((a, l) => a + l.tds, 0) + (s.prior?.tds || 0),
        }
      : null;
  const nextStage = stageTds(nextLines, next.tdsKnown, prev);
  nextLines.forEach(finishLine);

  // --- combined position at filing ---
  const all = [...currentLines, ...nextLines];
  const gross = all.reduce((a, l) => a + taxableGross(l), 0) + (s.prior?.gross || 0);
  const leave = all
    .flatMap((l) => l.oneTimes)
    .filter((o) => o.kind === 'leaveEncashment')
    .reduce((a, o) => a + o.amount, 0);
  const leaveExemption = Math.min(leave, NEW_REGIME.leaveEncashmentCap);
  const npsDeduction = all.reduce((a, l) => a + l.npsDeductible, 0);
  const taxable = round10(Math.max(0, gross - NEW_REGIME.standardDeduction - leaveExemption - npsDeduction));
  const t = taxOn(taxable);
  const tdsTotal = all.reduce((a, l) => a + l.tds, 0) + (s.prior?.tds || 0);
  const filing: Filing = {
    gross,
    standardDeduction: NEW_REGIME.standardDeduction,
    leaveExemption,
    npsDeduction,
    taxable,
    ...t,
    tdsTotal,
    balance: t.total - tdsTotal,
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

  const latest = structureFor(s.next, fyMonths(s.fy)[11]);
  return {
    fy: s.fy,
    months,
    currentLines,
    nextLines,
    currentStage,
    nextStage,
    fnf,
    form12B: f12,
    filing,
    totals: {
      gross: months.reduce((a, m) => a + m.gross, 0),
      inHand: months.reduce((a, m) => a + m.inHand, 0),
      tds: months.reduce((a, m) => a + m.tds, 0),
      remainingInHand: remaining.reduce((a, m) => a + m.inHand, 0),
      remainingMonths: remaining.length,
    },
    steady: steadyState(latest),
    nextFy: projectNextFy(s),
  };
}
