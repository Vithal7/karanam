/**
 * Does the breakup add up? CTC = 12 × fixed monthly gross + employer PF + gratuity + insurance
 * + employer NPS paid on top + variable pay. A gap usually means an allowance wasn't read.
 */
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
