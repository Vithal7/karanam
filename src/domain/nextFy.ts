import { rulesFor, type Rules } from '../rules';
import { fyEnd, fyMonths, fyStart, daysBetween, maxDate } from './fy';
import { buildLines, finishLine, structureFor, taxableGross, variableAsOneTime } from './schedule';
import { round10, taxOn } from './tax';
import type { Employment, MonthLine, Scenario, Structure } from './types';

export interface NextFyResult {
  fy: number;
  hike: number;
  effectiveHike: number;
  daysServed: number;
  structure: Structure;
  lines: MonthLine[];
  gross: number;
  npsDeduction: number;
  taxable: number;
  tax: number;
  inHand: number;
}

/**
 * The following FY at the last job: salary revised from April by the hike, prorated for days
 * served in the joining year; first-year variable pay lands if it is paid that year.
 * TDS is spread evenly because payroll knows the whole year up front.
 */
export function projectNextFy(s: Scenario, rules: Rules): NextFyResult {
  const fy = s.fy + 1;
  const t = rulesFor(rules, fy);
  const index = s.employers.length - 1;
  const emp = s.employers[index];
  const base = structureFor(emp, fyMonths(s.fy)[11]);
  const joinedIn = maxDate(emp.start || fyStart(s.fy), fyStart(s.fy));
  const daysServed = Math.min(365, Math.max(0, daysBetween(joinedIn, fyEnd(s.fy))));
  const hike = s.settings.nextFyHike || 0;
  const effectiveHike = hike * (daysServed / 365);
  const k = 1 + effectiveHike;
  const structure: Structure = {
    ...base,
    basic: base.basic * k,
    hra: base.hra * k,
    special: base.special * k,
    others: base.others.map((o) => ({ ...o, amount: o.amount * k })),
  };
  const e: Employment = { ...emp, start: fyStart(fy), end: fyEnd(fy), structure, revisions: [], recoveries: [], tdsKnown: {}, totalsOnly: undefined };
  const v = variableAsOneTime(emp);
  const ots = [...emp.oneTimes, ...(v ? [v] : [])].filter((o) => fyMonths(fy).includes(o.month));
  const lines = buildLines(e, index, fy, s.settings.thirtyDayMonth, ots, rules, t);
  const gross = lines.reduce((a, l) => a + taxableGross(l), 0);
  const npsDeduction = lines.reduce((a, l) => a + l.npsDeductible, 0);
  const taxable = round10(Math.max(0, gross - t.standardDeduction - npsDeduction));
  const tax = taxOn(taxable, t).total;
  for (const l of lines) {
    l.tds = tax / (lines.length || 1);
    finishLine(l);
  }
  return { fy, hike, effectiveHike, daysServed, structure, lines, gross, npsDeduction, taxable, tax, inHand: lines.reduce((a, l) => a + l.inHand, 0) };
}
