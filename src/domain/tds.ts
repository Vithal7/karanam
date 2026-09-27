import { regularGross, taxableOneTimes } from './schedule';
import type { TaxYearRules } from '../rules';
import { DEFAULT_TAX, round10, taxOn } from './tax';
import type { MonthLine } from './types';

export interface PreviousIncome {
  /** First month from which this payroll knows about the earlier income (Form 12B); null = never. */
  knownFrom: string | null;
  taxableGross: number;
  npsDeductible: number;
  tds: number;
}

export interface StageRow {
  month: string;
  projectedIncome: number;
  taxable: number;
  tax: number;
  previousTds: number;
  alreadyDeducted: number;
  monthsLeft: number;
  tds: number;
  known: boolean;
}

/**
 * Projects TDS the way an Indian payroll does (s.192): every month it re-estimates the annual
 * tax from what it knows so far and spreads the unpaid balance over the remaining months.
 *
 * What the payroll knows in month m:
 *  - its own regular salary for the whole stay in the FY,
 *  - its own one-time payouts made in or before m,
 *  - the previous employer's income and TDS once Form 12B is in.
 * Payroll does not apply the s.10(10AA) leave encashment exemption.
 */
/**
 * Until payroll knows you're leaving, it projects a full year at your current salary and spreads
 * the tax over the months to March. `untilMonth` is when it learns (your resignation month).
 */
export interface FullYearView {
  untilMonth: string;
  regular: number;
  npsDeductible: number;
  /** Months from each month to March, inclusive. */
  monthsToMarch: (month: string) => number;
}

export function stageTds(
  lines: MonthLine[],
  known: Record<string, number>,
  prev: PreviousIncome | null,
  t: TaxYearRules = DEFAULT_TAX,
  fullYear?: FullYearView,
): StageRow[] {
  const actualRegular = lines.reduce((a, l) => a + regularGross(l), 0);
  const actualNps = lines.reduce((a, l) => a + l.npsDeductible, 0);
  const rows: StageRow[] = [];
  let deducted = 0;
  lines.forEach((l, i) => {
    const unaware = fullYear && l.month < fullYear.untilMonth;
    const regular = unaware ? fullYear!.regular : actualRegular;
    const npsDed = unaware ? fullYear!.npsDeductible : actualNps;
    const oneTimesSoFar = lines.slice(0, i + 1).reduce((a, x) => a + taxableOneTimes(x), 0);
    const prevIn = prev && prev.knownFrom !== null && prev.knownFrom <= l.month;
    const projectedIncome = regular + oneTimesSoFar + (prevIn ? prev!.taxableGross : 0);
    const taxable = round10(
      Math.max(0, projectedIncome - t.standardDeduction - npsDed - (prevIn ? prev!.npsDeductible : 0)),
    );
    const tax = taxOn(taxable, t).total;
    const previousTds = prevIn ? prev!.tds : 0;
    const monthsLeft = unaware ? fullYear!.monthsToMarch(l.month) : lines.length - i;
    const isKnown = known[l.month] !== undefined && known[l.month] !== null && !Number.isNaN(known[l.month]);
    const tds = isKnown ? known[l.month] : Math.max(0, (tax - previousTds - deducted) / monthsLeft);
    rows.push({ month: l.month, projectedIncome, taxable, tax, previousTds, alreadyDeducted: deducted, monthsLeft, tds, known: isKnown });
    deducted += tds;
    l.tds = tds;
    l.tdsEstimated = !isKnown;
  });
  return rows;
}
