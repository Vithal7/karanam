/**
 * Which documents would make a job's timeline trustworthy, worked out from its own dates and
 * files: a salary basis from this year, TDS actually deducted, and papers for leaving it. Generic
 * for any job, not a fixed checklist: each hint says what it would fix.
 */
import { fyLabel, fyOf, fyStart } from '../domain/fy';
import type { DocKind, Employment, Scenario } from '../domain/types';

export interface DocHint {
  kind: DocKind;
  /** What to add, in the user's words. */
  what: string;
  /** What it fixes. */
  why: string;
}

const SALARY_KINDS: DocKind[] = ['offer', 'appraisal', 'payslip'];

/** Date a file speaks for: its own date, or the joining date of an offer letter. */
const dated = (d: Employment['docs'][number]) => d.docDate ?? d.doj ?? '';

export function docHints(s: Scenario, k: number): DocHint[] {
  const e = s.employers[k];
  if (!e || e.totalsOnly) return [];
  const out: DocHint[] = [];
  const n = s.employers.length;
  const from = fyStart(s.fy);
  const has = (kind: DocKind) => e.docs.some((d) => d.kind === kind);
  const leaving = k < n - 1 || !!e.end;
  const started = !!e.start && e.start <= s.today;
  const workedThisYear = started && (!e.end || e.end >= from);

  // Salary: the newest file with a breakup is from before this financial year.
  const salaryDocs = e.docs.filter((d) => SALARY_KINDS.includes(d.kind) && dated(d));
  const newest = salaryDocs.map(dated).sort().pop();
  const userHike = e.revisions.some((r) => !r.source?.startsWith('doc:'));
  if (workedThisYear && newest && newest < from && !userHike && !e.asked?.payChanged) {
    out.push({
      kind: 'appraisal',
      what: `Your latest increment or appraisal letter from ${e.name || 'this job'}`,
      why: `Your salary is taken from a ${fyOf(newest) === fyOf(from) - 1 ? 'last year' : fyLabel(fyOf(newest))} letter. Any hike since then changes every month's pay and tax.`,
    });
  }
  // What was actually paid and deducted this year.
  const slipThisYear = e.docs.some((d) => (d.kind === 'payslip' || d.kind === 'taxsheet') && dated(d) >= from);
  if (workedThisYear && !slipThisYear && s.today > from) {
    out.push({
      kind: 'payslip',
      what: `A recent payslip from ${e.name || 'this job'} (${fyLabel(s.fy)})`,
      why: 'It shows your current salary, PF, professional tax and the income tax deducted so far, instead of estimates.',
    });
  }
  // Leaving: when, and how it was settled.
  if (leaving && k < n - 1 && !has('resignation') && !has('fnf') && e.endSource !== 'user') {
    out.push({
      kind: 'resignation',
      what: 'Your resignation acceptance or relieving email',
      why: 'It gives your last working day and notice period, which decide your last salary and any notice recovery.',
    });
  }
  // Your only job: if you've resigned, the email gives the dates.
  if (n === 1 && started && !has('resignation') && !has('fnf') && !e.end) {
    out.push({
      kind: 'resignation',
      what: `If you've resigned from ${e.name || 'this job'}: your resignation acceptance email`,
      why: 'Your last day, notice and full & final settlement are then worked out too. Or use "I\'m leaving this job" under "Check the numbers".',
    });
  }
  if (leaving && e.end && e.end < s.today && !has('fnf')) {
    out.push({
      kind: 'fnf',
      what: 'Your full & final (F&F) settlement slip',
      why: 'Its leave encashment, notice recovery, bonus clawback and gratuity amounts replace our calculation.',
    });
  }
  // The job you're joining: its terms come from the offer letter.
  if (k === n - 1 && n > 1 && !has('offer')) {
    out.push({
      kind: 'offer',
      what: `The offer letter from ${e.name || 'your new employer'}`,
      why: 'Its salary breakup, joining bonus, buyout and relocation terms are used as they are written.',
    });
  }
  return out;
}
