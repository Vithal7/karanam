/**
 * "Drop all your documents": work out what each file is, which company it belongs to, and
 * build the year's jobs in date order with the newest job last.
 */
import { MAX_EMPLOYERS } from '../domain/compute';
import { fyStart } from '../domain/fy';
import type { DocRecord, Employment } from '../domain/types';
import { uid } from '../format';
import { classifyDoc, companyFromEmail, companyKey, extractFacts } from './facts';
import { docFromExtract } from './merge';
import { parseText } from './parse';

/** Limits for figures read from a file; anything beyond is a misread, not a salary. */
const FIELD_MAX: Record<string, number> = { basic: 2_000_000, hra: 1_500_000, special: 2_000_000, epf: 100_000, pt: 2_500, nps: 500_000, ctc: 200_000_000, joining: 50_000_000, variable: 100_000_000, retention: 50_000_000 };

/** Read one file's text into a document record. `kind` overrides the automatic type. */
export function docFromText(text: string, name: string, id = uid(), kind?: DocRecord['kind']): DocRecord {
  const x = parseText(text);
  const k = kind ?? classifyDoc(text);
  const d = docFromExtract(x, id, name);
  d.kind = k;
  d.facts = extractFacts(text, k);
  d.employer = x.employer ?? companyFromEmail(text);
  d.text = text.slice(0, 60_000);
  // Only offer letters, appraisals and payslips describe a salary breakup. Tax sheets list
  // annual and projected totals; resignation and F&F papers list settlement amounts.
  if (k !== 'offer' && k !== 'appraisal' && k !== 'payslip') d.fields = {};
  for (const [f, v] of Object.entries(d.fields)) {
    const max = FIELD_MAX[f] ?? (f.startsWith('other:') ? 1_000_000 : Infinity);
    if (v > max) delete d.fields[f];
  }
  if (d.fields.epf && d.fields.basic && d.fields.epf > d.fields.basic) delete d.fields.epf;
  if (k === 'taxsheet' && d.facts.tdsToDate !== undefined) d.ytdTds = d.facts.tdsToDate;
  if (k !== 'offer') delete d.doj;
  if (k === 'other') d.fields = {};
  return d;
}

const DEFAULT_NAME = /^(new job|current job|job \d)$/i;

export const jobKeys = (e: Employment) =>
  new Set([companyKey(e.name), ...e.docs.map((d) => companyKey(d.employer))].filter(Boolean));

const matches = (a: string, keys: Set<string>) => [...keys].some((k) => k === a || k.startsWith(`${a} `) || a.startsWith(`${k} `));

const isBlank = (e: Employment) => !e.docs.length && !e.structure.basic && !e.totalsOnly && DEFAULT_NAME.test(e.name);

export function blankJob(name: string, start: string): Employment {
  return {
    id: uid(),
    name,
    start,
    end: '',
    structure: { basic: 0, hra: 0, special: 0, others: [], epfMode: 'statutory', epf: 0, pt: 200, npsPct: 0, npsInGross: false },
    revisions: [],
    oneTimes: [],
    recoveries: [],
    ctc: 0,
    tdsKnown: {},
    form12B: 'second',
    docs: [],
    startSource: 'default',
  };
}

const FILE_STOP = new Set(
  'letter offer appointment appraisal salary revision revised increment hike payslip pay slip final settlement fnf full and resignation acceptance accepted relieving experience copy scan scanned doc docx pdf jpg jpeg png image img the for new old signed version annexure compensation ctc employee email mail from dated latest updated month statement'.split(' '),
);

/** Distinctive words in a file name ("Vithal Suzlon Appointment Letter (1).pdf" -> vithal, suzlon). */
export const fileTokens = (name: string) =>
  name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !FILE_STOP.has(w) && !MONTH_WORDS.has(w));
const MONTH_WORDS = new Set('jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november december'.split(' '));

/** First word of each known company ("suzlon" for Suzlon Energy Limited). */
function companyWords(names: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of names) {
    const w = companyKey(n).split(' ')[0];
    if (w && w.length >= 3 && !m.has(w)) m.set(w, n);
  }
  return m;
}

/** When a file's text doesn't name its company: try its file name, then company names mentioned in it. */
export function inferCompany(d: DocRecord, text: string | undefined, known: string[]): string | undefined {
  const words = companyWords(known);
  for (const t of fileTokens(d.name)) if (words.has(t)) return words.get(t);
  if (text) {
    const hits = [...words.entries()].filter(([w]) => new RegExp(`\\b${w}`, 'i').test(text));
    if (hits.length === 1) return hits[0][1];
  }
  return undefined;
}

/** The date a document is "about": joining date, hike effective date, last day, payslip month. */
export function docWhen(d: DocRecord): string | undefined {
  if (d.kind === 'offer') return d.doj ?? d.docDate;
  if (d.kind === 'appraisal') return d.facts?.effectiveFrom ?? d.docDate;
  if (d.kind === 'resignation' || d.kind === 'fnf') return d.facts?.lastWorkingDay ?? d.facts?.resignationDate ?? d.docDate;
  return d.docDate;
}

/**
 * Puts each file in the job it belongs to. The time axis comes first:
 *  1. by company name (from the text, else the file name, else a company the text mentions);
 *  2. an offer letter with its own joining date starts its own job;
 *  3. appraisals and payslips go to the job you were in on their date;
 *  4. resignation and F&F papers go to the job that ends before a later job starts.
 * Anything still unclear goes to `unassigned`, and the user picks.
 */
export function assignDocs(
  employers: Employment[],
  docs: DocRecord[],
  fy: number,
  texts: Record<string, string> = {},
): { employers: Employment[]; unassigned: DocRecord[]; changed: Set<string> } {
  let jobs = employers.map((e) => ({ ...e, docs: [...e.docs] }));
  const unassigned: DocRecord[] = [];
  const changed = new Set<string>();
  const known = () => [...new Set([...jobs.flatMap((e) => [e.name, ...e.docs.map((d) => d.employer ?? '')]), ...docs.map((d) => d.employer ?? '')].filter((n) => n && !DEFAULT_NAME.test(n)))];

  // Company from the file name or the text, when the letterhead didn't give it.
  for (const d of docs) if (!d.employer) d.employer = inferCompany(d, texts[d.id], known());

  const place = (d: DocRecord, target: Employment) => {
    target.docs.push(d);
    changed.add(target.id);
  };
  const newJob = (name: string, start: string) => {
    const blank = jobs.find(isBlank);
    if (blank) {
      blank.name = name;
      blank.start = start;
      return blank;
    }
    if (jobs.length >= MAX_EMPLOYERS) return undefined;
    const j = blankJob(name, start);
    jobs.push(j);
    return j;
  };

  // Offers first: they lay out the timeline.
  const ordered = [...docs].sort((a, b) => (a.kind === 'offer' ? 0 : 1) - (b.kind === 'offer' ? 0 : 1) || (docWhen(a) ?? '').localeCompare(docWhen(b) ?? ''));
  for (const d of ordered) {
    const key = companyKey(d.employer);
    let target = key ? jobs.find((e) => matches(key, jobKeys(e))) : undefined;
    if (!target && d.kind === 'offer') {
      // Same joining date as a job without a name yet: same job. Otherwise a new job.
      const when = docWhen(d);
      target = !key && when ? jobs.find((e) => !isBlank(e) && Math.abs(daysApart(jobStart(e), when)) < 45) : undefined;
      target ??= newJob(d.employer || siblingName(d, [...docs, ...jobs.flatMap((e) => e.docs)]) || `Job ${jobs.filter((e) => !isBlank(e)).length + 1}`, d.doj ?? fyStart(fy));
    }
    if (!target && key) target = newJob(d.employer!, fyStart(fy));
    if (!target && !key) target = bySiblingFile(jobs, d, [...docs, ...jobs.flatMap((e) => e.docs)]);
    if (!target && !key) target = byDate(jobs, d);
    if (!target && !key && d.kind !== 'offer') {
      // Dated before every job we know: it's from an earlier job.
      const when = docWhen(d);
      const real = jobs.filter((e) => !isBlank(e));
      if (when && real.length && real.every((e) => jobStart(e) > when)) {
        target = newJob(siblingName(d, [...docs, ...jobs.flatMap((e) => e.docs)]) ?? 'Earlier job', when < fyStart(fy) ? when : fyStart(fy));
      }
    }
    if (!target) {
      unassigned.push(d);
      continue;
    }
    place(d, target);
  }
  jobs = orderJobs(jobs.filter((e) => !isBlank(e) || jobs.length === 1));
  return { employers: jobs, unassigned, changed };
}

const daysApart = (a: string, b: string) => (a && b ? (Date.parse(a) - Date.parse(b)) / 86_400_000 : Infinity);

/** The job you were in on the document's date. Nothing can belong to a job before it started. */
function byDate(jobs: Employment[], d: DocRecord): Employment | undefined {
  const when = docWhen(d);
  const real = orderJobs(jobs.filter((e) => !isBlank(e)));
  if (!real.length || d.kind === 'offer') return undefined;
  if (!when) return real.length === 1 ? real[0] : undefined;
  const starts = real.map(jobStart);
  let pick: Employment | undefined;
  real.forEach((e, k) => {
    if (starts[k] && starts[k] <= when) pick = e;
  });
  return pick;
}

/** Words shared by several file names but not by every company's files (your own name). */
function distinctive(d: DocRecord, all: DocRecord[]): string[] {
  const mine = new Set(fileTokens(d.name));
  const others = all.filter((x) => x.id !== d.id);
  const myKey = companyKey(d.employer);
  return [...mine]
    .map((t) => ({ t, withT: others.filter((x) => fileTokens(x.name).includes(t)) }))
    .filter(({ withT }) => {
      if (!withT.length || withT.length >= others.length) return false;
      // A word also in another company's file names is yours (your name), not the company's.
      return !withT.some((x) => x.employer && companyKey(x.employer) !== myKey);
    })
    .sort((a, b) => b.withT.length - a.withT.length)
    .map(({ t }) => t);
}

/** A file with no company name goes where other files sharing a distinctive file-name word went. */
function bySiblingFile(jobs: Employment[], d: DocRecord, all: DocRecord[]): Employment | undefined {
  const words = distinctive(d, all);
  if (!words.length) return undefined;
  return jobs.find((e) => !isBlank(e) && e.docs.some((x) => x.id !== d.id && fileTokens(x.name).some((t) => words.includes(t))));
}

/** "suzlon" shared by two file names -> "Suzlon", a better job name than "Earlier job". */
function siblingName(d: DocRecord, all: DocRecord[]): string | undefined {
  const w = distinctive(d, all)[0];
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : undefined;
}

/** Earliest known date for a job: its joining date, else its oldest file. */
export function jobStart(e: Employment): string {
  const doj = e.docs.filter((d) => d.kind === 'offer' && d.doj).map((d) => d.doj!).sort()[0];
  if (doj) return doj;
  if (e.startSource === 'user') return e.start;
  if (e.start && !isBlank(e)) return e.start;
  return e.docs.map((d) => d.docDate).filter(Boolean).sort()[0] ?? e.start ?? '';
}

/** Jobs in date order; a job you're leaving never comes last if another job starts after it. */
export function orderJobs(jobs: Employment[]): Employment[] {
  const exited = (e: Employment) => e.docs.some((d) => d.kind === 'resignation' || d.kind === 'fnf');
  return [...jobs].sort((a, b) => {
    const ea = exited(a);
    const eb = exited(b);
    if (ea !== eb) return ea ? -1 : 1;
    return jobStart(a).localeCompare(jobStart(b));
  });
}
