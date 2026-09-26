import { MAX_EMPLOYERS } from './domain/compute';
import { addMonths, fyEnd, fyOf, fyStart, maxDate, monthOf } from './domain/fy';
import type { Employment, Scenario, Structure } from './domain/types';
import type { Choices, Mark } from './extract/merge';
import { uid } from './format';

export type StepId = 'offer-upload' | 'offer-review' | 'jobs' | 'job-edit' | 'extras' | 'results';

export type FieldMarks = Partial<Record<string, Mark>>;

export interface AppState {
  v: 2;
  step: StepId;
  history: StepId[];
  scenario: Scenario;
  /** Job being edited on the job-edit step. */
  editing: string | null;
  /** Per job: the user's answer to each conflicting field across its files. */
  choices: Record<string, Choices>;
  marks: Record<string, FieldMarks>;
  sources: Record<string, Record<string, string>>;
  warnings: Record<string, string[]>;
  /** Per job: total TDS deducted so far this FY (from the latest payslip). */
  tdsSoFar: Record<string, number | null>;
  showNextFy: boolean;
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
  epfMode: 'statutory',
  epf: 0,
  pt: 200,
  npsPct: 0,
  npsInGross: false,
});

export const emptyEmployment = (name: string, start: string): Employment => ({
  id: uid(),
  name,
  start,
  end: '',
  structure: emptyStructure(),
  revisions: [],
  oneTimes: [],
  recoveries: [],
  ctc: 0,
  tdsKnown: {},
  form12B: 'second',
  docs: [],
});

export function initialState(): AppState {
  const today = todayISO();
  return {
    v: 2,
    step: 'offer-upload',
    history: [],
    scenario: {
      fy: fyOf(today),
      today,
      employers: [emptyEmployment('New job', today)],
      settings: { thirtyDayMonth: false, nextFyHike: 0.1 },
    },
    editing: null,
    choices: {},
    marks: {},
    sources: {},
    warnings: {},
    tdsSoFar: {},
    showNextFy: false,
  };
}

export const offerOf = (s: Scenario) => s.employers[s.employers.length - 1];
export const earlierJobs = (s: Scenario) => s.employers.slice(0, -1);
export const canAddJob = (s: Scenario) => s.employers.length < MAX_EMPLOYERS;

/** The FY the offer's cash flow belongs to: the joining FY if it's in the future. */
export const fyFor = (today: string, start: string) => fyOf(maxDate(today, start || today));

/** Joining after 1 April means earlier income this FY may need accounting for. */
export const joinsMidYear = (s: Scenario) => offerOf(s).start > fyStart(s.fy);

/** Keeps jobs in date order with the offer last. */
export function sortJobs(employers: Employment[]): Employment[] {
  const offer = employers[employers.length - 1];
  const rest = employers.slice(0, -1).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  return [...rest, offer];
}

/** A new earlier job, placed just before the first known job. */
export function newEarlierJob(s: Scenario): Employment {
  const first = s.employers[0];
  const e = emptyEmployment(`Job ${s.employers.length}`, fyStart(s.fy));
  e.end = first.start > fyStart(s.fy) ? dayBefore(first.start) : '';
  e.fnf = { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0, buyoutByNext: false };
  return e;
}

export const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Spreads "TDS so far" evenly over the job's months before this month. */
export function spreadTdsSoFar(emp: Employment, s: Scenario, total: number | null | undefined): Record<string, number> {
  if (total === null || total === undefined) return {};
  const todayMonth = monthOf(s.today);
  const start = maxDate(emp.start || fyStart(s.fy), fyStart(s.fy));
  const end = emp.end || fyEnd(s.fy);
  const months: string[] = [];
  for (let m = monthOf(start); m <= monthOf(end) && m < todayMonth; m = addMonths(m, 1)) months.push(m);
  // A job that ended in the past: the total covers all its months.
  if (!months.length) return {};
  return Object.fromEntries(months.map((m) => [m, total / months.length]));
}

/** The scenario fed to the engine, with UI-only answers applied. */
export function effectiveScenario(st: AppState): Scenario {
  const s = st.scenario;
  return {
    ...s,
    employers: s.employers.map((e, i) =>
      i === s.employers.length - 1 ? e : { ...e, tdsKnown: spreadTdsSoFar(e, s, st.tdsSoFar[e.id]) },
    ),
  };
}

/* ---------- persistence ---------- */

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
    return raw ? migrate(JSON.parse(raw)) : null;
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

/** v1 kept one current job + one offer and a numeric PF; lift it into the v2 shape. */
export function migrate(x: any): AppState | null {
  if (!x || typeof x !== 'object') return null;
  if (x.v === 2) return x as AppState;
  const s = x.scenario;
  if (!s?.next) return null;
  const up = (e: any, fnf?: any): Employment => ({
    ...emptyEmployment(e.name, e.start),
    ...e,
    id: uid(),
    structure: { ...e.structure, epfMode: 'fixed' },
    revisions: (e.revisions ?? []).map((r: any) => ({ ...r, structure: { ...r.structure, epfMode: 'fixed' } })),
    form12B: s.settings?.form12B ?? 'second',
    docs: [],
    fnf: fnf ? { ...fnf, buyoutByNext: !!fnf.buyoutByNew } : undefined,
  });
  const employers: Employment[] = [];
  if (x.status === 'current' && s.current) employers.push(up(s.current, s.fnf));
  if (x.status === 'prior' && s.prior) employers.push({ ...emptyEmployment('Earlier job', fyStart(s.fy)), totalsOnly: s.prior });
  employers.push(up(s.next));
  const st = initialState();
  const prevId = employers.length > 1 ? employers[0].id : null;
  return {
    ...st,
    step: x.step === 'results' ? 'results' : 'offer-review',
    scenario: { fy: s.fy, today: st.scenario.today, employers, settings: { thirtyDayMonth: !!s.settings?.thirtyDayMonth, nextFyHike: s.settings?.nextFyHike ?? 0.1 } },
    tdsSoFar: prevId ? { [prevId]: x.tdsSoFar ?? null } : {},
  };
}
