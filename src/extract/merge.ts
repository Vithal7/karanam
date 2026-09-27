/**
 * Combines numbers from several files for one job (offer letter, revision letter, payslips).
 * Agreeing values merge silently; disagreements become questions for the user.
 */
import { addMonths, fyOf, monthName, monthOf } from '../domain/fy';
import type { DocRecord, EpfMode, Employment, Revision, Structure } from '../domain/types';
import { epfCeiling, type Rules } from '../rules';
import type { Extracted } from './parse';

export const FIELD_LABELS: Record<string, string> = {
  basic: 'Basic',
  hra: 'HRA',
  special: 'Special allowance',
  epf: 'Your PF',
  pt: 'Professional tax',
  nps: 'Employer NPS',
  ctc: 'CTC',
  joining: 'Joining bonus',
  variable: 'Variable pay',
  retention: 'Retention bonus',
};
export const fieldLabel = (f: string) => FIELD_LABELS[f] ?? f.replace(/^other:/, '');

/** Monthly salary fields: a later, different value can mean the salary was revised. */
export const isSalaryField = (f: string) => ['basic', 'hra', 'special', 'epf', 'pt', 'nps'].includes(f) || f.startsWith('other:');

export function docFromExtract(x: Extracted, id: string, name: string): DocRecord {
  const c = x.components;
  const fields: Record<string, number> = {};
  const put = (k: string, v: number | undefined) => {
    if (v !== undefined && Number.isFinite(v) && v > 0) fields[k] = Math.round(v);
  };
  put('basic', c.basic?.monthly);
  put('hra', c.hra?.monthly);
  put('special', c.special?.monthly);
  for (const k of ['lta', 'conveyance', 'otherAllowance'] as const) if (c[k]) put(`other:${c[k]!.label}`, c[k]!.monthly);
  put('epf', (c.employeePf ?? c.employerPf)?.monthly);
  put('pt', c.pt?.monthly);
  if (c.nps) put('nps', c.nps.pct && c.basic ? c.nps.pct * c.basic.monthly : c.nps.monthly);
  put('ctc', c.ctc?.annual);
  put('joining', c.joining?.annual);
  if (c.joining?.monthOffset !== undefined) fields.joiningOffset = c.joining.monthOffset;
  put('variable', c.variable?.annual);
  put('retention', c.retention?.annual);
  return { id, name, kind: x.kind, docDate: x.docDate, fields, doj: x.doj?.date, employer: x.employer, ytdTds: x.ytdTds };
}

export interface ConflictOption {
  value: number;
  docId: string;
  docName: string;
  docDate?: string;
}

export interface Conflict {
  field: string;
  /** Newest first. */
  options: ConflictOption[];
  /** Offer "my salary changed" when the differing values come from different dates. */
  canBeRevision: boolean;
}

/** User's answer per conflicting field: a doc id, or 'changed' (salary was revised). */
export type Choices = Record<string, string>;

const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, 0.005 * Math.max(a, b));

/** Oldest first; undated files keep upload order after dated ones of the same kind. */
export function orderDocs(docs: DocRecord[]) {
  return docs
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (a.d.docDate ?? '9999').localeCompare(b.d.docDate ?? '9999') || a.i - b.i)
    .map((x) => x.d);
}

/**
 * Files that describe the starting salary: offer letters, and payslips from before the first
 * appraisal. Later payslips and appraisal letters become dated hikes instead (see events.ts).
 */
export function baseDocs(docs: DocRecord[]): DocRecord[] {
  const hikes = docs.filter((d) => d.kind === 'appraisal').map((d) => (d.facts?.effectiveFrom ?? d.docDate ?? '').slice(0, 7)).filter(Boolean).sort();
  const first = hikes[0];
  return docs.filter((d) => d.kind === 'offer' || (d.kind === 'payslip' && (!first || !d.docDate || d.docDate.slice(0, 7) < first)));
}

export function mergeDocs(docs: DocRecord[]) {
  const ordered = orderDocs(docs);
  const fields = [...new Set(ordered.flatMap((d) => Object.keys(d.fields)))].filter((f) => f !== 'joiningOffset');
  const agreed: Record<string, ConflictOption> = {};
  const conflicts: Conflict[] = [];
  for (const f of fields) {
    const has = ordered.filter((d) => d.fields[f] !== undefined);
    const opts: ConflictOption[] = [];
    for (const d of [...has].reverse()) {
      const v = d.fields[f];
      if (!opts.some((o) => same(o.value, v))) opts.push({ value: v, docId: d.id, docName: d.name, docDate: d.docDate });
    }
    if (opts.length === 1) agreed[f] = opts[0];
    else {
      const dates = new Set(opts.map((o) => o.docDate?.slice(0, 7)).filter(Boolean));
      conflicts.push({ field: f, options: opts, canBeRevision: isSalaryField(f) && dates.size > 1 });
    }
  }
  return { agreed, conflicts };
}

export const unanswered = (conflicts: Conflict[], choices: Choices) => conflicts.filter((c) => !choices[c.field]);

export type Mark = 'found' | 'guessed' | 'missing';

/**
 * Rebuilds the job's structure from its files and the user's answers. Fields no file mentions
 * keep what the user already typed. Returns which file each value came from, for the review UI.
 */
export function applyDocs(
  emp: Employment,
  choices: Choices,
  rules: Rules,
): { emp: Employment; marks: Record<string, Mark>; sources: Record<string, string>; ytdTds?: { amount: number; asOf?: string } } {
  const docs = baseDocs(emp.docs);
  const { agreed, conflicts } = mergeDocs(docs);
  const base: Record<string, number> = {};
  const revised: Record<string, number> = {};
  const sources: Record<string, string> = {};
  /** Month of the file each base value came from (PF rules depend on the date). */
  const fieldMonth: Record<string, string | undefined> = {};
  let revisionMonth: string | undefined;
  const label = (o: ConflictOption) => (o.docDate ? `${o.docName}, ${monthName(monthOf(o.docDate))}` : o.docName);

  for (const [f, o] of Object.entries(agreed)) {
    base[f] = o.value;
    sources[f] = label(o);
    fieldMonth[f] = o.docDate && monthOf(o.docDate);
  }
  for (const c of conflicts) {
    const ch = choices[c.field];
    if (!ch) {
      base[c.field] = c.options[0].value; // provisional until answered
      sources[c.field] = label(c.options[0]);
      fieldMonth[c.field] = c.options[0].docDate && monthOf(c.options[0].docDate);
    } else if (ch === 'changed' && c.canBeRevision) {
      const newest = c.options[0];
      const oldest = c.options[c.options.length - 1];
      base[c.field] = oldest.value;
      revised[c.field] = newest.value;
      fieldMonth[c.field] = oldest.docDate && monthOf(oldest.docDate);
      sources[c.field] = `${label(oldest)} → ${label(newest)}`;
      const m = newest.docDate ? monthOf(newest.docDate) : undefined;
      if (m && (!revisionMonth || m > revisionMonth)) revisionMonth = m;
    } else {
      const o = c.options.find((x) => x.docId === ch) ?? c.options[0];
      base[c.field] = o.value;
      sources[c.field] = label(o);
      fieldMonth[c.field] = o.docDate && monthOf(o.docDate);
    }
  }

  const ordered = orderDocs(docs);
  const newestDate = [...ordered].reverse().find((d) => d.docDate)?.docDate;
  const doj = ordered.find((d) => d.kind === 'offer' && d.doj)?.doj;
  const name = ordered.find((d) => d.employer)?.employer;
  const marks: Record<string, Mark> = {};

  const buildStructure = (vals: Record<string, number>, prev: Structure, month: string): Structure => {
    const s: Structure = { ...prev, others: [...prev.others] };
    for (const k of ['basic', 'hra', 'special', 'pt'] as const) if (vals[k] !== undefined) s[k] = vals[k];
    const others = Object.keys(vals).filter((k) => k.startsWith('other:'));
    if (others.length) s.others = others.map((k) => ({ name: k.slice(6), amount: vals[k] }));
    if (vals.nps !== undefined && s.basic) {
      s.npsPct = Math.round((vals.nps / s.basic) * 1000) / 1000;
    }
    if (vals.epf !== undefined) {
      const { mode, amount } = epfModeFor(vals.epf, s.basic, vals === base ? fieldMonth.epf ?? month : month, rules);
      s.epfMode = mode;
      s.epf = amount;
    }
    return s;
  };

  const firstMonth = monthOf(ordered[0]?.docDate ?? doj ?? emp.start);
  const structure = buildStructure(base, emp.structure, firstMonth);
  // Revisions the user typed stay; ones derived from files are rebuilt each time.
  const manual = emp.revisions.filter((r) => !r.source?.startsWith('doc:'));
  const revisions: Revision[] =
    Object.keys(revised).length && revisionMonth
      ? [...manual, { from: revisionMonth, structure: buildStructure({ ...base, ...revised }, structure, revisionMonth), source: 'doc:files disagree' }]
      : manual;

  const out: Employment = { ...emp, structure, revisions };
  if (name && (!emp.name || /^(new job|current job|job \d)$/i.test(emp.name))) out.name = name;
  if (doj) out.start = doj;
  if (base.ctc) out.ctc = base.ctc;
  if (base.joining) {
    const month = addMonths(monthOf(out.start), docs.find((d) => d.fields.joiningOffset !== undefined)?.fields.joiningOffset ?? 0);
    const rest = out.oneTimes.filter((o) => o.kind !== 'joining');
    out.oneTimes = [...rest, { id: 'joining', label: 'Joining bonus', kind: 'joining', amount: base.joining, month, taxable: true }];
  }
  if (base.retention && !out.oneTimes.some((o) => o.id === 'retention'))
    out.oneTimes = [...out.oneTimes, { id: 'retention', label: 'Retention bonus', kind: 'bonus', amount: base.retention, month: addMonths(monthOf(out.start), 12), taxable: true }];
  if (base.variable)
    out.variable = { annual: base.variable, payoutPct: out.variable?.payoutPct ?? 1, prorate: out.variable?.prorate ?? true, month: out.variable?.month || `${fyOf(out.start) + 1}-04` };
  const ytd = orderDocs(emp.docs)
    .reverse()
    .find((d) => d.ytdTds !== undefined);

  for (const f of ['basic', 'hra', 'special', 'ctc']) marks[f] = base[f] !== undefined ? 'found' : 'missing';
  for (const f of ['epf', 'pt']) marks[f] = base[f] !== undefined ? 'found' : 'guessed';
  for (const f of ['nps', 'variable']) if (base[f] !== undefined) marks[f] = 'found';
  marks.start = doj ? 'found' : 'missing';
  for (const c of conflicts) if (!choices[c.field]) marks[c.field] = 'guessed';

  return { emp: out, marks, sources, ytdTds: ytd?.ytdTds !== undefined ? { amount: ytd.ytdTds, asOf: ytd.docDate ?? newestDate } : undefined };
}

/** Decide whether a PF figure is the statutory amount, 12% of full basic, or a fixed number. */
export function epfModeFor(epf: number, basic: number, month: string, rules: Rules): { mode: EpfMode; amount: number } {
  const statutory = rules.epf.rate * Math.min(basic, epfCeiling(rules, month));
  if (basic && Math.abs(epf - statutory) < 2) return { mode: 'statutory', amount: epf };
  if (basic && Math.abs(epf - rules.epf.rate * basic) < 2) return { mode: 'fullBasic', amount: epf };
  return { mode: 'fixed', amount: epf };
}
