import { epfCeiling, type PtRule, type Rules, type TaxYearRules } from '../rules';
import { addMonths, daysInMonth, fyEnd, fyMonths, fyOf, fyStart, daysBetween, maxDate, minDate, monthFactor, monthName, monthOf } from './fy';
import type { Employment, MonthLine, OneTime, Structure } from './types';

export const fixedMonthly = (s: Structure) =>
  s.basic + s.hra + s.special + s.others.reduce((a, o) => a + (o.amount || 0), 0);

/** Employee PF for a full month of this structure in the given wage month. */
export function epfFor(s: Structure, month: string, rules: Rules): number {
  if (s.epfMode === 'fixed') return s.epf || 0;
  if (s.epfMode === 'fullBasic') return rules.epf.rate * s.basic;
  return rules.epf.rate * Math.min(s.basic, epfCeiling(rules, month));
}

/**
 * When the EPF wage ceiling rises (₹15k -> ₹25k), the employer's PF rises with yours. If employer
 * PF is part of your CTC, the CTC doesn't change, so the extra comes out of your allowance: the
 * "₹1,200 less misc allowance from Sep 2026" in a payroll sheet.
 */
export function ctcNeutralPfCut(emp: Employment, s: Structure, month: string, rules: Rules): number {
  if (s.epfMode !== 'statutory' || pfRiseMode(emp) !== 'allowance') return 0;
  const rev = emp.revisions.find((r) => r.structure === s);
  const since = rev?.from ?? (emp.start ? emp.start.slice(0, 7) : month);
  const extra = epfFor(s, month, rules) - epfFor(s, since, rules);
  return extra > 0 ? Math.min(extra, s.special) : 0;
}

/** The first month in this FY where the EPF wage ceiling rises while this job pays statutory PF above it. */
export function pfCeilingRiseIn(emp: Employment, fy: number, rules: Rules): string | undefined {
  const w = window(emp, fy);
  if (!w) return undefined;
  const months = fyMonths(fy).filter((m) => m >= w.start.slice(0, 7) && m <= w.end.slice(0, 7));
  for (let i = 1; i < months.length; i++) {
    const s = structureFor(emp, months[i]);
    const before = epfCeiling(rules, months[i - 1]);
    if (s.epfMode === 'statutory' && epfCeiling(rules, months[i]) > before && s.basic > before) return months[i];
  }
  return undefined;
}

/** Your answer, else: a CTC-based offer keeps the CTC, so the extra comes out of the allowance. */
export const pfRiseMode = (emp: Employment): 'allowance' | 'employer' => emp.pfRise ?? (emp.ctcParts?.employerPf || emp.ctc ? 'allowance' : 'employer');

/** The PT rule for a job's state: a rule, 'none' (no PT there), or undefined (state unknown or not covered). */
export function ptRuleFor(emp: Employment, rules: Rules): PtRule | 'none' | undefined {
  const st = emp.location?.state;
  if (!st) return undefined;
  if (rules.professionalTax.none?.[st]) return 'none';
  return rules.professionalTax.states?.[st];
}

const slabAmount = (rule: PtRule, income: number) => {
  for (const s of rule.slabs) if (s.upto === null || income <= s.upto) return s.amount;
  return rule.slabs[rule.slabs.length - 1].amount;
};

/**
 * Professional tax for one month, by the state you work in. `regular` is that month's salary as
 * paid (prorated in joining and leaving months); `full` is a full month's fixed salary.
 * Unknown state: the amount on your payslip (or entered).
 */
export function ptFor(emp: Employment, s: Structure, month: string, regular: number, full: number, factor: number, rules: Rules, employedMonths: string[]): number {
  if (factor <= 0) return 0;
  const rule = ptRuleFor(emp, rules);
  if (rule === 'none') return 0;
  if (!rule) return s.pt;
  const m = Number(month.slice(5, 7));
  if (rule.basis === 'monthly') {
    const top = rule.slabs[rule.slabs.length - 1];
    const amt = slabAmount(rule, regular);
    return rule.special && rule.special.month === m && amt === top.amount && amt > 0 ? rule.special.amount : amt;
  }
  if (rule.basis === 'annual') {
    const annual = slabAmount(rule, full * 12);
    const each = Math.floor(annual / 12);
    return rule.adjustMonth === m ? annual - each * 11 : each;
  }
  // Half-yearly: collected once per half (Apr-Sep, Oct-Mar) in its collection month, or in your
  // last month there if you leave (or join) around it.
  const firstHalf = m >= 4 && m <= 9;
  const half = employedMonths.filter((x) => {
    const k = Number(x.slice(5, 7));
    return (k >= 4 && k <= 9) === firstHalf;
  });
  const collect = rule.collectMonths!.find((c) => (c >= 4 && c <= 9) === firstHalf)!;
  const collectKey = half.find((x) => Number(x.slice(5, 7)) === collect);
  const due = collectKey ?? half[half.length - 1];
  return due === month ? slabAmount(rule, full * 6) : 0;
}

/**
 * Professional tax in a normal month, averaged over the year (a February top-up or a half-yearly
 * collection spread out). Your state's rule when we have it; else the amount you entered.
 */
export function monthlyPt(emp: Employment, s: Structure, rules: Rules): number {
  const rule = ptRuleFor(emp, rules);
  if (rule === 'none') return 0;
  if (!rule) return s.pt;
  const full = fixedMonthly(s);
  if (rule.basis === 'monthly') {
    const amt = slabAmount(rule, full);
    const top = rule.slabs[rule.slabs.length - 1].amount;
    return rule.special && amt === top && amt > 0 ? (amt * 11 + rule.special.amount) / 12 : amt;
  }
  if (rule.basis === 'annual') return slabAmount(rule, full * 12) / 12;
  return (slabAmount(rule, full * 6) * 2) / 12;
}

/** The structure actually paid in a given month: a hike counts from the month it's first paid. */
export function structureFor(emp: Employment, month: string): Structure {
  let s = emp.structure;
  const revs = [...emp.revisions].sort((a, b) => a.from.localeCompare(b.from));
  for (const r of revs) if (r.from && (r.payoutMonth && r.payoutMonth > r.from ? r.payoutMonth : r.from) <= month) s = r.structure;
  return s;
}

/**
 * A hike effective before it is first paid comes as arrears in the payout month: the difference
 * between the new and old fixed pay for each month in between (prorated for partial months).
 */
export function arrearsFor(emp: Employment, thirty: boolean): OneTime[] {
  const out: OneTime[] = [];
  for (const r of emp.revisions) {
    if (!r.from || !r.payoutMonth || r.payoutMonth <= r.from) continue;
    let total = 0;
    for (let m = r.from; m < r.payoutMonth; m = addMonths(m, 1)) {
      const f = monthFactor(m, emp.start || `${m}-01`, emp.end || '9999-12-31', thirty);
      if (f > 0) total += (fixedMonthly(r.structure) - fixedMonthly(structureFor(emp, m))) * f;
    }
    if (total > 0.5)
      out.push({ id: `arrears-${r.from}`, label: `Arrears for hike from ${monthName(r.from)}`, kind: 'bonus', amount: Math.round(total), month: r.payoutMonth, taxable: true });
  }
  return out;
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
  index: number,
  fy: number,
  thirty: boolean,
  oneTimes: OneTime[],
  rules: Rules,
  tax: TaxYearRules,
): MonthLine[] {
  const w = window(emp, fy);
  if (!w) return [];
  const lines: MonthLine[] = [];
  const employed = fyMonths(fy).filter((m) => monthFactor(m, w.start, w.end, thirty) > 0);
  for (const month of fyMonths(fy)) {
    const worked = monthFactor(month, w.start, w.end, thirty);
    // Unpaid (loss of pay) days come off that month's pay like days not employed.
    const lop = emp.lopDays?.[month] ?? 0;
    const dim = thirty ? 30 : daysInMonth(+month.slice(0, 4), +month.slice(5, 7));
    const f = worked > 0 ? Math.max(0, worked - lop / dim) : 0;
    const ots = oneTimes.filter((o) => o.month === month && o.amount);
    // A payout after the last working day (e.g. F&F settled later) still belongs to this employer.
    if (f === 0 && ots.length === 0) continue;
    const s = structureFor(emp, month);
    const basic = s.basic * f;
    const hra = s.hra * f;
    const special = (s.special - ctcNeutralPfCut(emp, s, month, rules)) * f;
    const others = s.others.reduce((a, o) => a + (o.amount || 0), 0) * f;
    const epf = (epfFor(s, month, rules) + (s.vpf ?? 0)) * f;
    const pt = ptFor(emp, s, month, basic + hra + special + others, fixedMonthly(s), f, rules, employed);
    const npsRaw = s.npsPct * basic;
    const nps = s.npsInGross ? npsRaw : 0;
    const npsDeductible = s.npsInGross ? Math.min(npsRaw, tax.npsCapPctOfBasic * basic) : 0;
    const recoveries = emp.recoveries.filter((r) => r.month === month).reduce((a, r) => a + (r.amount || 0), 0);
    const oneTimeLines = ots.map((o) => ({ label: o.label, amount: o.amount, taxable: o.taxable, kind: o.kind, cash: o.cash }));
    const noncash = oneTimeLines.filter((o) => o.cash === false).reduce((a, o) => a + o.amount, 0);
    const gross = basic + hra + special + others + oneTimeLines.reduce((a, o) => a + o.amount, 0);
    lines.push({
      month,
      employer: index,
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
      noncash,
      tds: 0,
      tdsEstimated: true,
      inHand: 0,
    });
  }
  return lines;
}

export const regularGross = (l: MonthLine) => l.basic + l.hra + l.special + l.others;
export const taxableOneTimes = (l: MonthLine) => l.oneTimes.filter((o) => o.taxable).reduce((a, o) => a + o.amount, 0);
export const taxableGross = (l: MonthLine) => regularGross(l) + taxableOneTimes(l);

export function finishLine(l: MonthLine) {
  l.inHand = l.gross - (l.noncash ?? 0) - l.epf - l.pt - l.nps - l.recoveries - l.tds;
  return l;
}

export const endMonthOf = (emp: Employment, fy: number) => monthOf(window(emp, fy)?.end ?? fyEnd(fy));

/** Notice days not served: notice period minus days between resignation and last working day. */
export function noticeShortfall(emp: Employment): number | undefined {
  if (!emp.noticeDays || !emp.resignedOn || !emp.end) return undefined;
  if (emp.noticeMonths) {
    // "3 months" from 15 Jan runs to 15 Apr: count the days short of that date.
    const [y, m, d] = emp.resignedOn.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + emp.noticeMonths, 1));
    const dim = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    const due = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`;
    return Math.max(0, daysBetween(emp.end, due) - 1);
  }
  const served = daysBetween(emp.resignedOn, emp.end) - 1;
  return Math.max(0, emp.noticeDays - served);
}
