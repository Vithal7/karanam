import { MAX_EMPLOYERS } from './domain/compute';
import { addMonths, fyEnd, fyOf, fyStart, maxDate, monthOf } from './domain/fy';
import type { DocRecord, Employment, Scenario, Structure } from './domain/types';
import type { AsideDoc } from './extract/intake';
import type { Choices, Mark } from './extract/merge';
import { uid } from './format';

export type StepId = 'upload' | 'story' | 'job-edit' | 'extras' | 'results';

export type FieldMarks = Partial<Record<string, Mark>>;

export interface AppState {
  v: 3;
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
  /** Per job: how its files were read (assumptions, stale letters). */
  notes: Record<string, string[]>;
  /** Files whose company we couldn't tell; the user picks the job. */
  inbox: DocRecord[];
  /** Files that aren't about this financial year (old jobs, last year's tax sheet), and why. */
  aside: AsideDoc[];
  /** Per job: appraisal letters whose hike size we need from the user. */
  needs: Record<string, { docId: string; docName: string; month: string }[]>;
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
    v: 3,
    step: 'upload',
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
    notes: {},
    inbox: [],
    aside: [],
    needs: {},
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
  e.fnf = { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0 };
  return e;
}

export const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * TDS for past months: amounts recorded from payslips or a tax sheet as they are; a year-to-date
 * total you entered covers the remaining past months evenly.
 */
export function spreadTdsSoFar(emp: Employment, s: Scenario, total: number | null | undefined): Record<string, number> {
  const recorded = emp.tdsKnown ?? {};
  if (total === null || total === undefined) return recorded;
  const todayMonth = monthOf(s.today);
  const start = maxDate(emp.start || fyStart(s.fy), fyStart(s.fy));
  const end = emp.end || fyEnd(s.fy);
  const months: string[] = [];
  for (let m = monthOf(start); m <= monthOf(end) && m < todayMonth; m = addMonths(m, 1)) months.push(m);
  const open = months.filter((m) => recorded[m] === undefined);
  if (!open.length) return recorded;
  const left = Math.max(0, total - months.reduce((a, m) => a + (recorded[m] ?? 0), 0));
  return { ...recorded, ...Object.fromEntries(open.map((m) => [m, left / open.length])) };
}

/** The scenario fed to the engine, with UI-only answers applied. */
export function effectiveScenario(st: AppState): Scenario {
  const s = st.scenario;
  return {
    ...s,
    employers: s.employers.map((e0, i) => {
      const e = e0.tdsManual ? { ...e0, tdsKnown: { ...e0.tdsKnown, ...e0.tdsManual } } : e0;
      return i === s.employers.length - 1 ? e : { ...e, tdsKnown: spreadTdsSoFar(e, s, st.tdsSoFar[e.id]) };
    }),
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
    const st = raw ? migrate(JSON.parse(raw)) : null;
    if (!st) return null;
    // "Today" moves on between visits: past vs upcoming depends on it.
    const today = todayISO();
    const last = st.scenario.employers[st.scenario.employers.length - 1];
    return { ...st, scenario: { ...st.scenario, today, fy: fyFor(today, last?.start ?? today) } };
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

const V2_STEPS: Record<string, StepId> = { 'offer-upload': 'upload', 'offer-review': 'story', jobs: 'story', 'job-edit': 'job-edit', extras: 'extras', results: 'results' };

/** Saved state from older versions: v1 (one current job + offer), v2 (up to 3 jobs). */
export function migrate(x: any): AppState | null {
  if (!x || typeof x !== 'object') return null;
  if (x.v === 3) return { needs: {}, aside: [], ...x } as AppState;
  if (x.v === 2) return { ...x, v: 3, step: V2_STEPS[x.step] ?? 'story', notes: {}, inbox: [], aside: [] } as AppState;
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
    fnf: fnf ? { ...fnf } : undefined,
  });
  const employers: Employment[] = [];
  if (x.status === 'current' && s.current) employers.push(up(s.current, s.fnf));
  if (x.status === 'prior' && s.prior) employers.push({ ...emptyEmployment('Earlier job', fyStart(s.fy)), totalsOnly: s.prior });
  const next = up(s.next);
  if (s.fnf?.buyoutByNew) next.buyout = { mode: 'actuals', includesClawback: true };
  employers.push(next);
  const st = initialState();
  const prevId = employers.length > 1 ? employers[0].id : null;
  return {
    ...st,
    step: x.step === 'results' ? 'results' : 'story',
    scenario: { fy: s.fy, today: st.scenario.today, employers, settings: { thirtyDayMonth: !!s.settings?.thirtyDayMonth, nextFyHike: s.settings?.nextFyHike ?? 0.1 } },
    tdsSoFar: prevId ? { [prevId]: x.tdsSoFar ?? null } : {},
  };
}
