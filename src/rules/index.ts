import bundled from './rules.json';

/** Everything law-dependent. Updated from the network when online; see update.ts. */
export interface TaxYearRules {
  standardDeduction: number;
  /** `upto: null` is the open top slab. */
  slabs: { upto: number | null; rate: number }[];
  rebateLimit: number;
  surcharge: { above: number; rate: number }[];
  cess: number;
  npsCapPctOfBasic: number;
  leaveEncashmentCap: number;
}

/**
 * Professional tax in one state.
 *  monthly    - slab by that month's salary; `special` replaces the top slab in one month (₹300 in Feb)
 *  annual     - slab by the year's salary, collected monthly; `adjustMonth` takes the remainder
 *  halfYearly - slab by the half-year's salary, collected in `collectMonths` (one per half-year)
 */
export interface PtRule {
  name: string;
  basis: 'monthly' | 'annual' | 'halfYearly';
  slabs: { upto: number | null; amount: number }[];
  special?: { month: number; amount: number };
  collectMonths?: number[];
  adjustMonth?: number;
  note?: string;
}

export interface Rules {
  version: string;
  updated: string;
  sources: { title: string; url: string }[];
  /** Keyed by FY start year ("2025" = FY 2025-26); later years inherit the latest earlier entry. */
  incomeTax: Record<string, TaxYearRules>;
  epf: { rate: number; wageCeiling: { from: string; amount: number }[] };
  professionalTax: {
    defaultMonthly: number;
    /** States and UTs with no professional tax on salaries. */
    none?: Record<string, string>;
    /** By state code: how much PT a salary attracts and when it's collected. */
    states?: Record<string, PtRule>;
  };
  /**
   * Payment of gratuity: `daysPerYear` days' wages (monthly wages ÷ `monthDays`) per completed year
   * of service, a part year over six months counting as a year, up to `maxAmount`. From
   * `wagesRule.from` (the Labour Codes), allowances above `allowanceShare` of total pay count as wages.
   */
  gratuity?: { daysPerYear: number; monthDays: number; maxAmount: number; minYears: number; wagesRule?: { from: string; allowanceShare: number } };
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const isDate = (x: unknown) => isStr(x) && /^\d{4}-\d{2}-\d{2}$/.test(x);

function validTaxYear(t: any): boolean {
  if (!t || !isNum(t.standardDeduction) || !isNum(t.rebateLimit) || !isNum(t.cess)) return false;
  if (!isNum(t.npsCapPctOfBasic) || !isNum(t.leaveEncashmentCap)) return false;
  if (!Array.isArray(t.slabs) || t.slabs.length < 2) return false;
  let prev = 0;
  for (const [i, s] of t.slabs.entries()) {
    if (!isNum(s.rate) || s.rate < 0 || s.rate > 1) return false;
    const last = i === t.slabs.length - 1;
    if (last ? s.upto !== null : !isNum(s.upto) || s.upto <= prev) return false;
    if (!last) prev = s.upto;
  }
  return Array.isArray(t.surcharge) && t.surcharge.every((s: any) => isNum(s.above) && isNum(s.rate));
}

/** Hand-rolled shape check: a bad download must never replace working rules. */
export function validateRules(x: unknown): x is Rules {
  const r = x as any;
  if (!r || !isStr(r.version) || !isDate(r.updated) || !Array.isArray(r.sources)) return false;
  if (!r.incomeTax || typeof r.incomeTax !== 'object') return false;
  const years = Object.keys(r.incomeTax);
  if (!years.length || !years.every((y) => /^\d{4}$/.test(y) && validTaxYear(r.incomeTax[y]))) return false;
  if (!r.epf || !isNum(r.epf.rate) || !Array.isArray(r.epf.wageCeiling) || !r.epf.wageCeiling.length) return false;
  if (!r.epf.wageCeiling.every((w: any) => isDate(w.from) && isNum(w.amount))) return false;
  if (!r.professionalTax || !isNum(r.professionalTax.defaultMonthly)) return false;
  const st = r.professionalTax.states;
  if (st !== undefined && (typeof st !== 'object' || !Object.values(st).every(validPt))) return false;
  return true;
}

function validPt(p: any): boolean {
  return (
    !!p &&
    isStr(p.name) &&
    ['monthly', 'annual', 'halfYearly'].includes(p.basis) &&
    Array.isArray(p.slabs) &&
    p.slabs.length > 0 &&
    p.slabs.every((x: any) => (x.upto === null || isNum(x.upto)) && isNum(x.amount)) &&
    (p.basis !== 'halfYearly' || (Array.isArray(p.collectMonths) && p.collectMonths.length === 2))
  );
}

export const bundledRules = bundled as Rules;

/** Income tax rules in force for an FY: the latest entry at or before it. */
export function rulesFor(rules: Rules, fy: number): TaxYearRules {
  const years = Object.keys(rules.incomeTax)
    .map(Number)
    .sort((a, b) => a - b);
  const y = [...years].reverse().find((k) => k <= fy) ?? years[0];
  return rules.incomeTax[String(y)];
}

/** EPF wage ceiling for a wage month ("YYYY-MM"): a change applies from the month it takes effect. */
export function epfCeiling(rules: Rules, month: string): number {
  const list = [...rules.epf.wageCeiling].sort((a, b) => a.from.localeCompare(b.from));
  let amount = list[0].amount;
  for (const w of list) if (w.from.slice(0, 7) <= month) amount = w.amount;
  return amount;
}

/** Compare "2026.09.17"-style versions. */
export const newerVersion = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }) > 0;
