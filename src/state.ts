import { addMonths, fyEnd, fyOf, fyStart, monthOf } from './domain/fy';
import type { Employment, Scenario, Structure } from './domain/types';
import type { ComponentKey, Confidence, Extracted } from './extract/parse';

export type StepId = 'upload-next' | 'review-next' | 'current-q' | 'upload-current' | 'review-current' | 'exit' | 'prior' | 'extras' | 'results';

export type Status = 'current' | 'prior' | 'none';

/** Which fields came from the letter and how sure we are, for highlighting in review. */
export type FieldMarks = Partial<Record<string, Confidence | 'missing'>>;

export interface AppState {
  step: StepId;
  history: StepId[];
  scenario: Scenario;
  status: Status | null;
  marksNext: FieldMarks;
  marksCurrent: FieldMarks;
  warningsNext: string[];
  warningsCurrent: string[];
  /** Total TDS deducted so far this FY at the current employer (from latest payslip). */
  tdsSoFar: number | null;
  /** Monthly TDS seen on the latest payslip, if any. */
  showNextFy: boolean;
  /** Payslip or letter has changed since - revise from this month. */
  salaryChanged: boolean | null;
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const emptyStructure = (): Structure => ({
  basic: 0,
  hra: 0,
  special: 0,
  others: [],
  epf: 1800,
  pt: 200,
  npsPct: 0,
  npsInGross: true,
});

export const emptyEmployment = (name: string, start: string): Employment => ({
  name,
  start,
  end: '',
  structure: emptyStructure(),
  revisions: [],
  oneTimes: [],
  recoveries: [],
  ctc: 0,
  tdsKnown: {},
});

export function initialState(): AppState {
  const today = todayISO();
  const fy = fyOf(today);
  return {
    step: 'upload-next',
    history: [],
    scenario: {
      fy,
      today,
      next: { ...emptyEmployment('New job', today) },
      settings: { thirtyDayMonth: false, form12B: 'second', nextFyHike: 0.1 },
    },
    status: null,
    marksNext: {},
    marksCurrent: {},
    warningsNext: [],
    warningsCurrent: [],
    tdsSoFar: null,
    showNextFy: false,
    salaryChanged: null,
  };
}

/** Builds an employment from extracted text, and marks which fields to double-check. */
export function employmentFromExtract(
  x: Extracted,
  fallbackName: string,
  fallbackStart: string,
): { emp: Employment; marks: FieldMarks } {
  const c = x.components;
  const marks: FieldMarks = {};
  const val = (k: ComponentKey, field = k as string) => {
    const f = c[k];
    marks[field] = f ? f.confidence : 'missing';
    return f?.monthly ?? 0;
  };
  const basic = val('basic');
  const hra = val('hra');
  const special = val('special');
  const others = (['lta', 'conveyance', 'otherAllowance'] as ComponentKey[])
    .filter((k) => c[k]?.monthly)
    .map((k) => ({ name: c[k]!.label, amount: Math.round(c[k]!.monthly) }));
  const pf = c.employeePf ?? c.employerPf;
  const epf = pf ? pf.monthly : Math.min(0.12 * basic, 1800);
  marks.epf = pf ? pf.confidence : 'guessed';
  const pt = c.pt?.monthly ?? 200;
  marks.pt = c.pt ? c.pt.confidence : 'guessed';
  let npsPct = 0;
  if (c.nps) npsPct = c.nps.pct ?? (basic ? c.nps.monthly / basic : 0);
  if (c.nps) marks.nps = 'guessed';
  const start = x.doj?.date ?? fallbackStart;
  marks.start = x.doj ? x.doj.confidence : 'missing';
  const emp = emptyEmployment(x.employer || fallbackName, start);
  emp.structure = {
    basic: Math.round(basic),
    hra: Math.round(hra),
    special: Math.round(special),
    others,
    epf: Math.round(epf),
    pt: Math.round(pt),
    npsPct: Math.round(npsPct * 1000) / 1000,
    // An NPS row printed next to salary rows in an offer is usually on top of salary.
    npsInGross: false,
  };
  emp.ctc = Math.round(c.ctc?.annual ?? 0);
  marks.ctc = c.ctc ? c.ctc.confidence : 'missing';
  const startFy = fyOf(start);
  if (c.joining?.annual)
    emp.oneTimes.push({ id: 'joining', label: 'Joining bonus', kind: 'joining', amount: Math.round(c.joining.annual), month: addMonths(monthOf(start), c.joining.monthOffset ?? 0), taxable: true });
  if (c.retention?.annual)
    emp.oneTimes.push({ id: 'retention', label: 'Retention bonus', kind: 'bonus', amount: Math.round(c.retention.annual), month: addMonths(monthOf(start), 12), taxable: true });
  if (c.variable?.annual) {
    emp.variable = { annual: Math.round(c.variable.annual), payoutPct: 1, prorate: true, month: `${startFy + 1}-04` };
    marks.variable = c.variable.confidence;
  }
  return { emp, marks };
}

/** Month keys in which the current employment ran before today (for spreading YTD TDS). */
export function spreadTdsSoFar(s: Scenario, total: number | null): Record<string, number> {
  if (!s.current || total === null) return {};
  const todayMonth = monthOf(s.today);
  const start = s.current.start > fyStart(s.fy) ? s.current.start : fyStart(s.fy);
  const end = s.current.end || fyEnd(s.fy);
  const months: string[] = [];
  for (let m = monthOf(start); m < todayMonth && m <= monthOf(end); m = addMonths(m, 1)) months.push(m);
  if (!months.length) return {};
  return Object.fromEntries(months.map((m) => [m, total / months.length]));
}

/** The scenario actually fed to the engine, with UI-only answers applied. */
export function effectiveScenario(st: AppState): Scenario {
  const s = st.scenario;
  const out: Scenario = { ...s, current: undefined, fnf: undefined, prior: undefined };
  if (st.status === 'current' && s.current) {
    out.current = { ...s.current, tdsKnown: spreadTdsSoFar(s, st.tdsSoFar) };
    out.fnf = s.fnf;
  } else if (st.status === 'prior' && s.prior) out.prior = s.prior;
  return out;
}

/** Joining mid-FY means there may be earlier income to account for. */
export const joinsMidYear = (s: Scenario) => s.next.start > fyStart(s.fy);

const KEY = 'karanam:v1';
export const save = (st: AppState) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(st));
  } catch {
    /* private mode */
  }
};
export const load = (): AppState | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AppState) : null;
  } catch {
    return null;
  }
};
export const clearSaved = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};
