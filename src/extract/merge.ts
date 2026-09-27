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
  for (const a of x.allowances ?? []) put(`other:${a.label}`, a.monthly);
  put('epf', (c.employeePf ?? c.employerPf)?.monthly);
  // Parts of CTC that never reach the payslip, for the "does it add up?" check.
  put('employerPf', c.employerPf?.monthly);
  put('gratuity', c.gratuity?.monthly);
  put('insurance', c.insurance?.monthly);
  put('pt', c.pt?.monthly);
  put('vpf', c.vpf?.monthly);
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
/** Fields that describe CTC, not pay: read for the reconciliation, never merged as salary. */
const CTC_ONLY = new Set(['employerPf', 'gratuity', 'insurance']);

export function baseDocs(docs: DocRecord[]): DocRecord[] {
  const hikes = docs.filter((d) => d.kind === 'appraisal').map((d) => (d.facts?.effectiveFrom ?? d.docDate ?? '').slice(0, 7)).filter(Boolean).sort();
  const first = hikes[0];
  return docs.filter((d) => d.kind === 'offer' || (d.kind === 'payslip' && (!first || !d.docDate || d.docDate.slice(0, 7) < first)));
}

export function mergeDocs(docs: DocRecord[]) {
  const ordered = orderDocs(docs);
  const fields = [...new Set(ordered.flatMap((d) => Object.keys(d.fields)))].filter((f) => f !== 'joiningOffset' && !CTC_ONLY.has(f));
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
      // The new value applies from the earliest file that shows it (it may be earlier still:
      // you're asked to confirm the month).
      const firstNew = [...c.options].reverse().find((o) => o.value === newest.value) ?? newest;
      const m = firstNew.docDate ? monthOf(firstNew.docDate) : undefined;
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
      // NPS shown as a deduction on a payslip is carved out of the pay above it.
      if (docs.some((d) => d.kind === 'payslip' && d.fields.nps !== undefined)) s.npsInGross = true;
    }
    if (vals.vpf !== undefined) s.vpf = vals.vpf;
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
  if (emp.startSource === 'user') {
    // A date you entered wins over the letters.
  } else if (doj) {
    out.start = doj;
    out.startSource = 'doc';
  } else {
    // No joining date in the letters: the appointment letter's own date is the best guess.
    const letter = ordered.find((d) => d.kind === 'offer' && d.docDate);
    if (letter) {
      out.start = letter.docDate!;
      out.startSource = 'approx';
    }
  }
  if (base.ctc) out.ctc = base.ctc;
  if (base.basic !== undefined) out.splitGuessed = false;
  // Only a CTC, no breakup: a typical split (basic half of the fixed pay, HRA half of basic, the
  // rest special allowance, after employer PF and gratuity), marked as a guess for you to check.
  const anyPay = ['basic', 'hra', 'special'].some((k) => base[k] !== undefined) || Object.keys(base).some((k) => k.startsWith('other:'));
  if (!out.structure.basic && base.ctc && !anyPay) {
    const fixed = base.fixed ?? base.ctc - (base.variable ?? 0);
    const month = monthOf(out.start || firstMonth + '-01');
    const basic = Math.round(fixed / 12 / 2);
    const employerPf = Math.round(rules.epf.rate * Math.min(basic, epfCeiling(rules, month)));
    const gratuity = Math.round(0.0481 * basic);
    const hra = Math.round(basic / 2);
    const special = Math.max(0, Math.round(fixed / 12) - basic - hra - employerPf - gratuity);
    out.structure = { ...out.structure, basic, hra, special, others: [], epfMode: 'statutory', epf: employerPf };
    out.ctcParts = { ...out.ctcParts, employerPf, gratuity };
    out.splitGuessed = true;
    for (const f of ['basic', 'hra', 'special']) marks[f] = 'guessed';
  }
  // CTC-only parts: newest file that lists each.
  const ctcParts: NonNullable<Employment['ctcParts']> = { ...(emp.ctcParts ?? {}) };
  for (const k of ['employerPf', 'gratuity', 'insurance'] as const) {
    // Only letters describe the CTC; a payslip's "Provident Fund" row is your own deduction.
    const d = [...docs].reverse().find((x) => x.fields[k] !== undefined && (x.kind === 'offer' || x.kind === 'appraisal'));
    if (d) ctcParts[k] = d.fields[k];
  }
  out.ctcParts = ctcParts;
  if (base.joining) {
    const month = addMonths(monthOf(out.start), docs.find((d) => d.fields.joiningOffset !== undefined)?.fields.joiningOffset ?? 0);
    const rest = out.oneTimes.filter((o) => o.kind !== 'joining');
    const was = out.oneTimes.find((o) => o.kind === 'joining');
    // Repayment terms you entered survive re-reading the files.
    const kept = was?.clawbackEdited ? { clawbackMonths: was.clawbackMonths, clawbackBasis: was.clawbackBasis, clawbackTiers: was.clawbackTiers, clawbackFrom: was.clawbackFrom, clawbackEdited: true } : {};
    out.oneTimes = [...rest, { id: 'joining', label: 'Joining bonus', kind: 'joining', amount: base.joining, month, taxable: true, ...kept }];
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
  // ₹1,800 (12% of ₹15,000) is the legal cap under any ceiling, even in a letter dated after a change:
  // treat it as "as per law" so it follows the ceiling (₹3,000 from Sep 2026).
  if (basic && rules.epf.wageCeiling.some((w) => basic >= w.amount && Math.abs(epf - rules.epf.rate * w.amount) < 2)) return { mode: 'statutory', amount: epf };
  if (basic && Math.abs(epf - rules.epf.rate * basic) < 2) return { mode: 'fullBasic', amount: epf };
  return { mode: 'fixed', amount: epf };
}
