/** All money values are in rupees. Months are "YYYY-MM" strings, dates are "YYYY-MM-DD". */

export interface Allowance {
  name: string;
  /** Monthly amount. */
  amount: number;
}

/** A monthly salary structure, as it would appear on a payslip. */
export interface Structure {
  basic: number;
  hra: number;
  /** Special / Miscellaneous / Flexi allowance. */
  special: number;
  /** Any other fixed monthly allowances (LTA, conveyance, ...). All taxable. */
  others: Allowance[];
  /** Employee PF deducted from salary each month. */
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

export type OneTimeKind =
  | 'joining'
  | 'variable'
  | 'bonus'
  | 'leaveEncashment'
  | 'buyout'
  | 'other';

export interface OneTime {
  id: string;
  label: string;
  kind: OneTimeKind;
  amount: number;
  /** Payout month. For a notice buyout, empty means "with the Form 12B month". */
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

export interface Employment {
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
   * TDS actually deducted so far, month-by-month ("YYYY-MM" -> amount). Months not listed
   * are projected the way payroll would.
   */
  tdsKnown: Record<string, number>;
}

export interface FnF {
  leaveDays: number;
  noticeDaysRecovered: number;
  clawback: number;
  /** New employer reimburses notice recovery + clawback. */
  buyoutByNew: boolean;
}

export interface PriorIncome {
  gross: number;
  tds: number;
}

export type Form12B = 'first' | 'second' | 'never';

export interface Settings {
  /** Payroll proration: divide by 30 instead of calendar days. */
  thirtyDayMonth: boolean;
  form12B: Form12B;
  /** Hike % for next FY projection (0.1 = 10%). */
  nextFyHike: number;
}

export interface Scenario {
  /** Financial year start year: 2026 means FY 2026-27. */
  fy: number;
  /** "Today", used to mark past months. */
  today: string;
  next: Employment;
  current?: Employment;
  fnf?: FnF;
  prior?: PriorIncome;
  settings: Settings;
}

export interface MonthLine {
  month: string;
  employer: 'current' | 'next' | 'prior';
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
