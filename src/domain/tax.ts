/**
 * New tax regime (s.115BAC) for salaried individuals. The numbers come from rules.json
 * (see src/rules) so a Budget change never needs a code change.
 */
import { bundledRules, rulesFor, type TaxYearRules } from '../rules';

/** Rules used when a caller doesn't pass any: the latest year in the bundled rules. */
export const DEFAULT_TAX: TaxYearRules = rulesFor(bundledRules, 9999);

/** Section 288A: taxable income rounded to the nearest ten rupees (Excel MROUND). */
export const round10 = (x: number) => Math.sign(x) * Math.round(Math.abs(x) / 10) * 10;

export function slabTax(taxable: number, t: TaxYearRules = DEFAULT_TAX): number {
  let tax = 0;
  let lower = 0;
  for (const { upto, rate } of t.slabs) {
    if (taxable <= lower) break;
    const top = upto ?? Infinity;
    tax += (Math.min(taxable, top) - lower) * rate;
    lower = top;
  }
  return tax;
}

/** Slab tax after the 87A rebate and its marginal relief. */
export function taxAfterRebate(taxable: number, t: TaxYearRules = DEFAULT_TAX): number {
  const s = slabTax(taxable, t);
  if (taxable <= t.rebateLimit) return 0;
  return Math.min(s, taxable - t.rebateLimit);
}

function surchargeRate(taxable: number, t: TaxYearRules) {
  let rate = 0;
  for (const s of t.surcharge) if (taxable > s.above) rate = s.rate;
  return rate;
}

/** Surcharge with marginal relief at each threshold. */
export function surcharge(taxable: number, t: TaxYearRules = DEFAULT_TAX): number {
  const base = taxAfterRebate(taxable, t);
  const rate = surchargeRate(taxable, t);
  if (rate === 0) return 0;
  const threshold = [...t.surcharge].reverse().find((s) => taxable > s.above)!.above;
  const atThreshold = taxAfterRebate(threshold, t) * (1 + surchargeRate(threshold, t));
  const capped = atThreshold + (taxable - threshold);
  return Math.max(0, Math.min(base * rate, capped - base));
}

/** Total tax (incl. rebate, surcharge and cess) on an already-rounded taxable income. */
export function taxOn(taxable: number, t: TaxYearRules = DEFAULT_TAX) {
  const slab = slabTax(taxable, t);
  const afterRebate = taxAfterRebate(taxable, t);
  const sur = surcharge(taxable, t);
  const cess = (afterRebate + sur) * t.cess;
  return {
    slabTax: slab,
    rebate: slab - afterRebate,
    surcharge: sur,
    cess,
    total: afterRebate + sur + cess,
  };
}
