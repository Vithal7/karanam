import { fyEnd, fyMonths, fyOf, fyStart, daysBetween, maxDate, minDate, monthFactor, monthOf } from './fy';
import { NEW_REGIME } from './tax';
import type { Employment, MonthLine, OneTime, Structure } from './types';

export const fixedMonthly = (s: Structure) =>
  s.basic + s.hra + s.special + s.others.reduce((a, o) => a + (o.amount || 0), 0);

/** The structure in force in a given month, taking revisions into account. */
export function structureFor(emp: Employment, month: string): Structure {
  let s = emp.structure;
  const revs = [...emp.revisions].sort((a, b) => a.from.localeCompare(b.from));
  for (const r of revs) if (r.from && r.from <= month) s = r.structure;
  return s;
}

/** The employment's working window clamped to the FY, or null if it does not overlap. */
export function window(emp: Employment, fy: number) {
  const start = maxDate(emp.start || fyStart(fy), fyStart(fy));
  const end = minDate(emp.end || fyEnd(fy), fyEnd(fy));
  return start <= end ? { start, end } : null;
}

/** Days served in the first appraisal cycle (joining date to the end of that FY), capped at 365. */
export function firstCycleDays(emp: Employment) {
  const fy = fyOf(emp.start);
  return Math.min(365, daysBetween(maxDate(emp.start, fyStart(fy)), fyEnd(fy)));
}

/** First-year variable pay as a one-time payout. */
export function variableAsOneTime(emp: Employment): OneTime | null {
  const v = emp.variable;
  if (!v || !v.annual || !v.month) return null;
  const share = v.prorate ? firstCycleDays(emp) / 365 : 1;
  return {
    id: 'variable',
    label: 'Variable pay / PLI',
    kind: 'variable',
    amount: v.annual * v.payoutPct * share,
    month: v.month,
    taxable: true,
  };
}

/**
 * Month-by-month salary lines for an employment inside one FY, before TDS.
 * Mirrors a payroll register: every earning is prorated for partial months except PT.
 */
export function buildLines(
  emp: Employment,
  role: MonthLine['employer'],
  fy: number,
  thirty: boolean,
  oneTimes: OneTime[],
): MonthLine[] {
  const w = window(emp, fy);
  if (!w) return [];
  const lines: MonthLine[] = [];
  for (const month of fyMonths(fy)) {
    const f = monthFactor(month, w.start, w.end, thirty);
    const ots = oneTimes.filter((o) => o.month === month && o.amount);
    // A payout after the last working day (e.g. F&F settled later) still belongs to this employer.
    if (f === 0 && ots.length === 0) continue;
    const s = structureFor(emp, month);
    const basic = s.basic * f;
    const hra = s.hra * f;
    const special = s.special * f;
    const others = s.others.reduce((a, o) => a + (o.amount || 0), 0) * f;
    const epf = s.epf * f;
    const pt = f > 0 ? s.pt : 0;
    const npsRaw = s.npsPct * basic;
    const nps = s.npsInGross ? npsRaw : 0;
    const npsDeductible = s.npsInGross ? Math.min(npsRaw, NEW_REGIME.npsCapPctOfBasic * basic) : 0;
    const recoveries = emp.recoveries
      .filter((r) => r.month === month)
      .reduce((a, r) => a + (r.amount || 0), 0);
    const oneTimeLines = ots.map((o) => ({ label: o.label, amount: o.amount, taxable: o.taxable, kind: o.kind }));
    const gross = basic + hra + special + others + oneTimeLines.reduce((a, o) => a + o.amount, 0);
    lines.push({
      month,
      employer: role,
      employerName: emp.name,
      factor: f,
      basic,
      hra,
      special,
      others,
      oneTimes: oneTimeLines,
      gross,
      epf,
      pt,
      nps,
      npsDeductible,
      recoveries,
      tds: 0,
      tdsEstimated: true,
      inHand: 0,
    });
  }
  return lines;
}

export const regularGross = (l: MonthLine) => l.basic + l.hra + l.special + l.others;
export const taxableOneTimes = (l: MonthLine) =>
  l.oneTimes.filter((o) => o.taxable).reduce((a, o) => a + o.amount, 0);
export const taxableGross = (l: MonthLine) => regularGross(l) + taxableOneTimes(l);

export function finishLine(l: MonthLine) {
  l.inHand = l.gross - l.epf - l.pt - l.nps - l.recoveries - l.tds;
  return l;
}

export const endMonthOf = (emp: Employment, fy: number) => monthOf(window(emp, fy)?.end ?? fyEnd(fy));
