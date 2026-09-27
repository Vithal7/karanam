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
import { isNote, parseNote } from './note';
import { parseMonthTable, sheetFy } from './months';
import { parseForm16 } from './form16';
import { fyEnd, fyOf, maxDate, minDate } from '../domain/fy';

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
  if (!x.employer && d.employer) d.employerWeak = true;
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
  // What already happened, month by month. Only months before the sheet's date are actuals.
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (k === 'taxsheet') {
    const f16 = parseForm16(text);
    if (f16) d.facts.form16 = f16;
    if (f16?.tan) d.facts.tan = f16.tan;
    d.fy = sheetFy(text) ?? (d.docDate ? fyOf(d.docDate) : undefined);
    const cutoff = d.docDate ? minDate(d.docDate.slice(0, 7), thisMonth) : thisMonth;
    const monthly = parseMonthTable(text, d.fy ?? fyOf(d.docDate ?? `${thisMonth}-01`), cutoff);
    if (Object.keys(monthly).length) d.facts.monthly = monthly;
    const tdsMonths = Object.values(monthly).filter((m) => m.tds !== undefined);
    if (d.ytdTds === undefined && tdsMonths.length) d.ytdTds = tdsMonths.reduce((a, m) => a + (m.tds ?? 0), 0);
  }
  if (k === 'payslip' && d.docDate) {
    const c = x.components;
    // On a payslip a bonus row is the amount paid that month (read as a one-off, i.e. the "annual" figure).
    const items = [
      ...[c.variable, c.retention, c.leaveEnc].filter(Boolean).map((v) => ({ label: v!.key === 'leaveEnc' ? 'Leave encashment (in service, taxable)' : v!.label, amount: Math.round(v!.annual), kind: 'bonus' as const })),
      ...(c.arrears ? [{ label: 'Arrears', amount: Math.round(c.arrears.annual), kind: 'arrears' as const }] : []),
      ...(c.perquisite ? [{ label: c.perquisite.label, amount: Math.round(c.perquisite.annual), kind: 'perquisite' as const }] : []),
    ].filter((x) => x.amount > 0);
    const month = d.docDate.slice(0, 7);
    d.facts.monthly = { [month]: { tds: c.tds ? Math.round(c.tds.monthly) : undefined, items: items.length ? items : undefined } };
    // A payslip's bonus row is what was paid that month, not an annual target.
    delete d.fields.variable;
    delete d.fields.retention;
  }
  if (k !== 'offer') delete d.doj;
  if (k === 'other') d.fields = {};
  return d;
}

/**
 * One file's records. A note you typed ("got an offer from BP... resigned on 3rd Sept, LWD 11
 * Nov") becomes the new offer and the exit from your current job; anything else is one record.
 */
export function docsFromText(text: string, name: string): { docs: DocRecord[]; alternatives: DocRecord[]; warnings?: string[] } {
  if (isNote(text)) {
    const n = parseNote(text, name);
    const docs = [n.offer, n.exit].filter((d): d is DocRecord => !!d).map(withinLimits);
    if (docs.length) return { docs, alternatives: n.alternatives.map(withinLimits), warnings: n.warnings };
  }
  return { docs: [docFromText(text, name)], alternatives: [] };
}

/** Drop figures too big to be salary (a misread), as for any file. */
function withinLimits(d: DocRecord): DocRecord {
  const fields = Object.fromEntries(Object.entries(d.fields).filter(([f, v]) => v <= (FIELD_MAX[f] ?? (f.startsWith('other:') ? 1_000_000 : Infinity))));
  return { ...d, fields };
}

const DEFAULT_NAME = /^(new job|current job|job \d)$/i;

export const jobKeys = (e: Employment) =>
  new Set([companyKey(e.name), ...e.docs.map((d) => companyKey(d.employer))].filter(Boolean));

const compact = (k: string) => k.replace(/\s+/g, '');
const initials = (k: string) => k.split(' ').map((w) => w[0]).join('');
/** Same company: "acme" and "acme software", "acmesoftware" (an email domain) and "acme software". */
const matches = (a: string, keys: Set<string>) =>
  [...keys].some((k) => k === a || k.startsWith(`${a} `) || a.startsWith(`${k} `) || compact(k) === compact(a) || prefixOf(compact(k), compact(a)));
/** One name runs on from the other ("acme" -> "acmesoftware"): only for names long enough to mean something. */
const prefixOf = (x: string, y: string) => Math.min(x.length, y.length) >= 5 && (x.startsWith(y) || y.startsWith(x));
/** A company guessed from an email domain: also "tcs" for Tata Consultancy Services. */
const matchesWeak = (a: string, keys: Set<string>) => matches(a, keys) || [...keys].some((k) => k.includes(' ') && initials(k) === compact(a));

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

/** Distinctive words in a file name ("Priya Acme Appointment Letter (1).pdf" -> priya, acme). */
export const fileTokens = (name: string) =>
  name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !FILE_STOP.has(w) && !MONTH_WORDS.has(w));
const MONTH_WORDS = new Set('jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november december'.split(' '));

/** First word of each known company ("acme" for Acme Energy Limited). */
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
): { employers: Employment[]; unassigned: DocRecord[]; changed: Set<string>; aside: AsideDoc[] } {
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
    // Room for old jobs' files while sorting; the timeline check below sets them aside.
    if (jobs.length >= MAX_EMPLOYERS + 3) return undefined;
    const j = blankJob(name, start);
    jobs.push(j);
    return j;
  };

  // Offers first: they lay out the timeline.
  const ordered = [...docs].sort((a, b) => (a.kind === 'offer' ? 0 : 1) - (b.kind === 'offer' ? 0 : 1) || (docWhen(a) ?? '').localeCompare(docWhen(b) ?? ''));
  for (const d of ordered) {
    let key = companyKey(d.employer);
    let target = key ? jobs.find((e) => (d.employerWeak ? matchesWeak : matches)(key, jobKeys(e))) : undefined;
    // A company guessed from an email domain that matches no job: place it by date instead.
    if (!target && d.employerWeak) key = '';
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
  const t = checkTimeline(jobs, fy);
  for (const e of t.employers) if (e.docs.length !== jobs.find((j) => j.id === e.id)?.docs.length) changed.add(e.id);
  return { employers: t.employers, unassigned, changed, aside: t.aside };
}

/** A file that isn't about this financial year, and why. */
export interface AsideDoc {
  doc: DocRecord;
  reason: string;
}

const lastDayFromDocs = (e: Employment) =>
  e.docs
    .filter((d) => d.kind === 'resignation' || d.kind === 'fnf')
    .map((d) => d.facts?.lastWorkingDay)
    .filter((x): x is string => !!x)
    .sort()
    .pop();

const long = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fyName = (y: number) => `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;

/**
 * The time axis decides what counts. People drop in whatever they have: letters from jobs they
 * left years ago, last year's tax sheet, a stack of old payslips. Set those aside, and say why:
 *  - a tax sheet or Form 16 for another financial year;
 *  - payslips from before this year, when a newer one gives the same job's salary;
 *  - a job that ended before this year began: its exit papers say so, or you had already joined a
 *    later job by 1 April;
 *  - more than 3 jobs in the year: the oldest ones.
 */
export function checkTimeline(jobs: Employment[], fy: number): { employers: Employment[]; aside: AsideDoc[] } {
  const aside: AsideDoc[] = [];
  const real = jobs.filter((e) => !isBlank(e));
  const newest = real.map(jobStart).filter(Boolean).sort().pop();
  const year = newest && newest > fyEnd(fy) ? fyOf(newest) : fy;
  const from = fyStart(year);
  const inYear = (iso?: string) => !!iso && iso >= from && iso <= fyEnd(year);

  let out = jobs.map((e) => {
    const keep: DocRecord[] = [];
    const oldSlips = e.docs.filter((d) => d.kind === 'payslip' && d.docDate && d.docDate < from).sort((a, b) => (a.docDate ?? '').localeCompare(b.docDate ?? ''));
    const hasNewSlip = e.docs.some((d) => d.kind === 'payslip' && inYear(d.docDate));
    for (const d of e.docs) {
      if (d.keep) keep.push(d);
      else if (d.kind === 'taxsheet' && d.fy !== undefined && d.fy !== year) {
        aside.push({ doc: d, reason: `It's for ${fyName(d.fy)}; this is ${fyName(year)}.` });
      } else if (d.kind === 'payslip' && oldSlips.includes(d) && (hasNewSlip || d !== oldSlips[oldSlips.length - 1])) {
        aside.push({ doc: d, reason: `A ${d.docDate!.slice(0, 7)} payslip; a newer one gives your salary.` });
      } else keep.push(d);
    }
    return keep.length === e.docs.length ? e : { ...e, docs: keep };
  });

  // Jobs that ended before the year began.
  const starts = new Map(out.map((e) => [e.id, jobStart(e)]));
  out = out.filter((e) => {
    if (isBlank(e) || !e.docs.length) return true;
    const start = starts.get(e.id) ?? '';
    const left = lastDayFromDocs(e);
    const activeInYear = e.docs.some((d) => (d.kind === 'payslip' && inYear(d.docDate)) || (d.kind === 'taxsheet' && d.fy === year));
    let reason: string | undefined;
    if (left && left < from) reason = `You left ${e.name} on ${long(left)}, before ${fyName(year)} began.`;
    else if (!left && !activeInYear) {
      // Only a later job with its own salary papers can push this one out: never set aside a
      // job's salary for a job that exists only through an email or a resignation.
      const salaried = (o: Employment) => o.docs.some((d) => d.kind === 'offer' || d.kind === 'appraisal' || d.kind === 'payslip');
      const later = out.find((o) => o !== e && !isBlank(o) && salaried(o) && companyKey(o.name) !== companyKey(e.name) && (starts.get(o.id) ?? '') > start && (starts.get(o.id) ?? '') <= from);
      if (later) reason = `You joined ${later.name} on ${long(starts.get(later.id)!)}, before ${fyName(year)} began, so this is from an earlier job.`;
    }
    if (!reason || e.docs.some((d) => d.keep)) return true;
    for (const d of e.docs) aside.push({ doc: d, reason });
    return false;
  });

  // At most 3 jobs a year: the newest ones.
  while (out.length > MAX_EMPLOYERS) {
    const [old] = out.splice(0, 1);
    for (const d of old.docs) aside.push({ doc: d, reason: `Only ${MAX_EMPLOYERS} jobs a year are supported; ${old.name || 'this job'} is the oldest.` });
  }
  if (!out.length) out = [blankJob('New job', maxDate(from, jobs[0]?.start ?? from))];
  return { employers: out, aside };
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

/** "acme" shared by two file names -> "Acme", a better job name than "Earlier job". */
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
