/**
 * Does the breakup add up? CTC = 12 × fixed monthly gross + employer PF + gratuity + insurance
 * + employer NPS paid on top + variable pay. A gap usually means an allowance wasn't read.
 */
import { monthOf } from './fy';
import { epfCeiling, type Rules } from '../rules';
import { fixedMonthly } from './schedule';
import type { Employment, Structure } from './types';

export interface Reconciliation {
  ctc: number;
  fixedMonthly: number;
  employerPf: number;
  employerPfFromLetter: boolean;
  gratuity: number;
  gratuityFromLetter: boolean;
  insurance: number;
  npsOnTop: number;
  variable: number;
  /** Monthly gross the CTC implies after the parts that never reach the payslip. */
  impliedMonthly: number;
  /** impliedMonthly - fixedMonthly; positive = something is missing from the breakup. */
  gap: number;
  ok: boolean;
}

export function reconcile(e: Employment, st: Structure, month: string, rules: Rules): Reconciliation | null {
  if (!e.ctc || !st.basic) return null;
  const parts = e.ctcParts ?? {};
  const pfLetter = parts.employerPf;
  const statutoryPf = rules.epf.rate * (st.epfMode === 'fullBasic' ? st.basic : Math.min(st.basic, epfCeiling(rules, month)));
  const employerPf = pfLetter ?? (st.epfMode === 'fixed' ? st.epf : statutoryPf);
  const insurance = parts.insurance ?? 0;
  const npsOnTop = st.npsInGross ? 0 : st.npsPct * st.basic;
  const variable = (e.variable?.annual ?? 0) / 12;
  const fixed = fixedMonthly(st);
  const base = e.ctc / 12 - employerPf - insurance - npsOnTop - variable;
  // Gratuity (4.81% of basic) is inside some CTCs and not others: when the letter doesn't say,
  // take whichever reading matches the breakup better.
  let gratuity = parts.gratuity ?? 0;
  const gratuityFromLetter = parts.gratuity !== undefined;
  if (!gratuityFromLetter) {
    const withG = base - 0.0481 * st.basic;
    if (Math.abs(withG - fixed) < Math.abs(base - fixed)) gratuity = 0.0481 * st.basic;
  } else if (Math.abs(base - fixed) < Math.abs(base - gratuity - fixed)) {
    // The letter lists gratuity below its total (a "Total Cash Component"): outside the CTC.
    gratuity = 0;
  }
  const implied = base - gratuity;
  const gap = implied - fixed;
  return {
    ctc: e.ctc,
    fixedMonthly: fixed,
    employerPf,
    employerPfFromLetter: pfLetter !== undefined,
    gratuity,
    gratuityFromLetter,
    insurance,
    npsOnTop,
    variable,
    impliedMonthly: implied,
    gap,
    ok: Math.abs(gap) <= Math.max(500, 0.01 * fixed),
  };
}

/**
 * The salary in effect now (or on your last day): the latest hike that has started, with its own
 * CTC, variable pay and gratuity. `index` is -1 when it's still the salary you joined on.
 */
export function salaryNow(e: Employment, today: string): { index: number; emp: Employment; structure: Structure; month: string } {
  const at = monthOf(e.end && e.end < today ? e.end : today);
  const index = e.revisions.reduce((best, r, i) => (r.from && r.from <= at && (best < 0 || r.from >= e.revisions[best].from) ? i : best), -1);
  if (index < 0) return { index, emp: e, structure: e.structure, month: monthOf(e.start && e.start > today ? e.start : at) };
  const r = e.revisions[index];
  const emp: Employment = {
    ...e,
    ctc: r.ctc ?? e.ctc,
    variable: r.variable !== undefined ? { ...(e.variable ?? { payoutPct: 1, prorate: true, month: '' }), annual: r.variable } : r.ctc ? undefined : e.variable,
    // A hike's gratuity: its own, else the joining rate scaled with basic.
    ctcParts: { ...e.ctcParts, ...(r.gratuity !== undefined ? { gratuity: r.gratuity } : e.ctcParts?.gratuity && e.structure.basic ? { gratuity: Math.round((e.ctcParts.gratuity * r.structure.basic) / e.structure.basic) } : {}) },
  };
  return { index, emp, structure: r.structure, month: at };
}
