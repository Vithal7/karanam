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
  /** First month the new salary applies to (the hike's effective month). */
  from: string;
  /**
   * Payroll month the new salary is first paid, when later than `from`. The difference for the
   * months in between is paid then as arrears.
   */
  payoutMonth?: string;
  structure: Structure;
  /** For the story view: revised CTC and hike %, and the file it came from. */
  ctc?: number;
  pct?: number;
  source?: string;
  /** true when the breakup was worked out by scaling the old one (letter gave only a total). */
  scaled?: boolean;
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
  /** Joining bonus: repayable if you leave within this many months. */
  clawbackMonths?: number;
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

/** Per-day rate used for leave encashment. */
export type LeaveBasis = 'basic30' | 'basic26' | 'gross30' | 'custom';

export interface FnF {
  leaveDays: number;
  leaveBasis?: LeaveBasis;
  /** Per-day rate when leaveBasis is 'custom'. */
  leaveRate?: number;
  /** Amount printed on the F&F slip; overrides the calculation. */
  leaveAmount?: number;
  noticeDaysRecovered: number;
  /** Notice recovery per day: basic / 30 or fixed gross / 30. */
  noticeBasis?: 'basic' | 'gross';
  /** Amount printed on the F&F slip; overrides the calculation. */
  noticeAmount?: number;
  /** Joining/relocation bonus repaid to this employer. */
  clawback: number;
  /** Bond or contract-breach penalty. */
  penalty?: number;
  /** Gratuity paid in F&F (5+ years of service). Exempt up to ₹20 lakh. */
  gratuity?: number;
  /** Month the F&F is paid; empty = with the last salary. */
  payMonth?: string;
  /** @deprecated v2: use the next job's `buyout`. */
  buyoutByNext?: boolean;
}

/** What the next employer reimburses for leaving the previous one. */
export interface Buyout {
  mode: 'none' | 'actuals' | 'cap';
  cap?: number;
  /** Also covers a joining-bonus clawback, not just notice recovery. */
  includesClawback?: boolean;
  /** Month it's paid; empty = with the Form 12B month or the first salary. */
  month?: string;
}

/** Dated facts read from a file, beyond salary components. */
export interface Facts {
  effectiveFrom?: string;
  payoutMonth?: string;
  incrementPct?: number;
  revisedCtc?: number;
  oldCtc?: number;
  lastWorkingDay?: string;
  resignationDate?: string;
  noticeDays?: number;
  shortfallDays?: number;
  leaveDays?: number;
  leaveAmount?: number;
  noticeRecoveryAmount?: number;
  gratuity?: number;
  netPayable?: number;
  fnfPayMonth?: string;
  clawback?: number;
  penalty?: number;
  buyout?: { mode: 'actuals' | 'cap'; cap?: number };
  joiningClawbackMonths?: number;
}

/** When the employer gets Form 12B (earlier salary + TDS) relative to the joining month. */
export type Form12B = 'first' | 'second' | 'never';

/** Numbers pulled from one uploaded file. File contents are never stored. */
export interface DocRecord {
  id: string;
  name: string;
  kind: 'offer' | 'appraisal' | 'payslip' | 'resignation' | 'fnf';
  /** Letter date or payslip month (YYYY-MM-DD), if found. */
  docDate?: string;
  /** Monthly component values keyed by field (basic, hra, special, epf, pt, ctc, ...). */
  fields: Record<string, number>;
  doj?: string;
  employer?: string;
  ytdTds?: number;
  facts?: Facts;
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
  /** For every job after the first: notice buyout it reimburses. */
  buyout?: Buyout;
  /** Resignation date, for the story view. */
  resignedOn?: string;
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
