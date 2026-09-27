/** All money values are in rupees. Months are "YYYY-MM" strings, dates are "YYYY-MM-DD". */

export interface Allowance {
  name: string;
  /** Monthly amount. */
  amount: number;
}

/**
 * How employee PF is worked out:
 *  statutory - 12% of basic, capped at the EPF wage ceiling in force that month (₹15k, ₹25k...)
 *  fullBasic - 12% of full basic, no cap
 *  fixed     - the amount in `epf`
 */
export type EpfMode = 'statutory' | 'fullBasic' | 'fixed';

/** A monthly salary structure, as it would appear on a payslip. */
export interface Structure {
  basic: number;
  hra: number;
  /** Special / Miscellaneous / Flexi allowance. */
  special: number;
  /** Any other fixed monthly allowances (LTA, conveyance, ...). All taxable. */
  others: Allowance[];
  epfMode: EpfMode;
  /** Employee PF per month when epfMode is 'fixed'. */
  epf: number;
  /** Professional tax deducted each month (0 in states without PT). */
  pt: number;
  /** Employer NPS as a fraction of basic (0.14 = 14%). */
  npsPct: number;
  /**
   * true  -> NPS is carved out of the salary shown above: it is part of gross and deducted
   *          from pay, and claimed under 80CCD(2).
   * false -> NPS is paid by the employer on top; it never reaches the payslip.
   */
  npsInGross: boolean;
}

export interface Revision {
  /** First month the new structure applies. */
  from: string;
  structure: Structure;
}

export type OneTimeKind = 'joining' | 'variable' | 'bonus' | 'leaveEncashment' | 'buyout' | 'other';

export interface OneTime {
  id: string;
  label: string;
  kind: OneTimeKind;
  amount: number;
  month: string;
  /** false for exempt receipts (e.g. reimbursements); true for almost everything. */
  taxable: boolean;
}

export interface VariablePay {
  /** Full-year target amount. */
  annual: number;
  /** Expected payout as a fraction (1 = 100%). */
  payoutPct: number;
  /** Prorate by days served in the first year. */
  prorate: boolean;
  /** Month it is paid for the joining year (usually the next FY). */
  month: string;
}

export interface Recovery {
  id: string;
  label: string;
  amount: number;
  month: string;
}

export interface FnF {
  leaveDays: number;
  noticeDaysRecovered: number;
  clawback: number;
  /** The next employer reimburses notice recovery + clawback. */
  buyoutByNext: boolean;
}

/** When the employer gets Form 12B (earlier salary + TDS) relative to the joining month. */
export type Form12B = 'first' | 'second' | 'never';

/** Numbers pulled from one uploaded file. File contents are never stored. */
export interface DocRecord {
  id: string;
  name: string;
  kind: 'offer' | 'payslip';
  /** Letter date or payslip month (YYYY-MM-DD), if found. */
  docDate?: string;
  /** Monthly component values keyed by field (basic, hra, special, epf, pt, ctc, ...). */
  fields: Record<string, number>;
  doj?: string;
  employer?: string;
  ytdTds?: number;
}

export interface Employment {
  id: string;
  name: string;
  /** First working day (clamped to FY start). */
  start: string;
  /** Last working day; empty = through the end of the FY. */
  end: string;
  structure: Structure;
  revisions: Revision[];
  oneTimes: OneTime[];
  recoveries: Recovery[];
  variable?: VariablePay;
  /** Annual CTC as stated in the letter, used only for the comparison view. */
  ctc: number;
  /**
   * TDS actually deducted, month-by-month ("YYYY-MM" -> amount). Months not listed are
   * projected the way payroll would.
   */
  tdsKnown: Record<string, number>;
  /** Full & final settlement, for a job that ends before the next one starts. */
  fnf?: FnF;
  /** For every job after the first: when it learns about the earlier ones. */
  form12B: Form12B;
  docs: DocRecord[];
  /** "I only know the totals": no monthly detail, just gross earned and TDS this FY. */
  totalsOnly?: { gross: number; tds: number };
}

export interface Settings {
  /** Payroll proration: divide by 30 instead of calendar days. */
  thirtyDayMonth: boolean;
  /** Hike % for next FY projection (0.1 = 10%). */
  nextFyHike: number;
}

export interface Scenario {
  /** Financial year start year: 2026 means FY 2026-27. */
  fy: number;
  /** "Today", used to mark past months. */
  today: string;
  /** 1-3 jobs in date order. The last one is the offer being evaluated. */
  employers: Employment[];
  settings: Settings;
}

export interface MonthLine {
  month: string;
  /** Index into Scenario.employers. */
  employer: number;
  employerName: string;
  factor: number;
  basic: number;
  hra: number;
  special: number;
  others: number;
  oneTimes: { label: string; amount: number; taxable: boolean; kind: OneTimeKind }[];
  gross: number;
  epf: number;
  pt: number;
  nps: number;
  /** NPS that qualifies for 80CCD(2) this month. */
  npsDeductible: number;
  recoveries: number;
  tds: number;
  tdsEstimated: boolean;
  inHand: number;
}

export interface TaxBreakdown {
  gross: number;
  standardDeduction: number;
  leaveExemption: number;
  npsDeduction: number;
  taxable: number;
  slabTax: number;
  rebate: number;
  surcharge: number;
  cess: number;
  total: number;
}
