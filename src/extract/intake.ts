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

/** Read one file's text into a document record. */
export function docFromText(text: string, name: string, id = uid()): DocRecord {
  const x = parseText(text);
  const kind = classifyDoc(text);
  const d = docFromExtract(x, id, name);
  d.kind = kind;
  d.facts = extractFacts(text, kind);
  d.employer = x.employer ?? companyFromEmail(text);
  // Resignation emails and F&F slips mention amounts that aren't salary components.
  if (kind === 'resignation' || kind === 'fnf') d.fields = {};
  if (kind !== 'offer') delete d.doj;
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
  };
}

/**
 * Adds documents to the jobs they belong to (by company name), creating jobs as needed.
 * Files with no recognisable company go to `unassigned` unless there is only one job.
 */
export function assignDocs(employers: Employment[], docs: DocRecord[], fy: number): { employers: Employment[]; unassigned: DocRecord[]; changed: Set<string> } {
  let jobs = employers.map((e) => ({ ...e, docs: [...e.docs] }));
  const unassigned: DocRecord[] = [];
  const changed = new Set<string>();
  for (const d of docs) {
    const key = companyKey(d.employer);
    let target = key ? jobs.find((e) => matches(key, jobKeys(e))) : undefined;
    if (!target && key) {
      const blank = jobs.find(isBlank);
      if (blank) {
        target = blank;
        target.name = d.employer!;
      } else if (jobs.length < MAX_EMPLOYERS) {
        target = blankJob(d.employer!, fyStart(fy));
        jobs.push(target);
      }
    }
    if (!target && !key && jobs.length === 1) target = jobs[0];
    if (!target) {
      unassigned.push(d);
      continue;
    }
    target.docs.push(d);
    changed.add(target.id);
  }
  jobs = orderJobs(jobs);
  return { employers: jobs, unassigned, changed };
}

/** Earliest known date for a job: its joining date, else its oldest file. */
export function jobStart(e: Employment): string {
  const doj = e.docs.filter((d) => d.kind === 'offer' && d.doj).map((d) => d.doj!).sort()[0];
  if (doj) return doj;
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
