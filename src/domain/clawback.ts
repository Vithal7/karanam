/**
 * Joining and retention bonuses are often repayable if you leave early. The letter states the
 * terms (all of it within 12 months, pro-rata for the unserved period, or a share by years of
 * service); this works out whether they apply at your last working day and how much you repay.
 */
import { addMonths, monthLong, monthOf } from './fy';
import type { ClawbackTerms, Employment, OneTime } from './types';

export interface ClawbackLine {
  label: string;
  /** The bonus paid. */
  amount: number;
  /** What you repay. */
  repaid: number;
  /** How it was worked out, in words. */
  why: string;
}

const MONTH_DAYS = 365.25 / 12;

/** Months served from the first day to the last, inclusive, as a fraction. */
export function monthsServed(from: string, to: string): number {
  if (!from || !to || to < from) return 0;
  return ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1) / MONTH_DAYS;
}

/** The bonus's repayment terms, or null when it has none. */
export function termsOf(o: OneTime): ClawbackTerms | null {
  const tiers = o.clawbackTiers?.filter((t) => t.months > 0) ?? [];
  if (o.clawbackBasis === 'tiered' && tiers.length) return { months: Math.max(...tiers.map((t) => t.months)), basis: 'tiered', tiers, from: o.clawbackFrom };
  if (!o.clawbackMonths) return null;
  return { months: o.clawbackMonths, basis: o.clawbackBasis === 'prorata' ? 'prorata' : 'full', from: o.clawbackFrom };
}

/** Share of the bonus repaid after `served` months (0 = nothing, 1 = all of it). */
export function shareRepaid(t: ClawbackTerms, served: number): number {
  if (t.basis === 'tiered' && t.tiers?.length) return [...t.tiers].sort((a, b) => a.months - b.months).find((x) => served < x.months)?.share ?? 0;
  if (served >= t.months) return 0;
  return t.basis === 'prorata' ? (t.months - served) / t.months : 1;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const yrs = (m: number) => (m % 12 === 0 && m >= 12 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} months`);

/** The terms in words: "all of it if you leave within 12 months". */
export function describeTerms(t: ClawbackTerms): string {
  const since = t.from === 'payment' ? ' of it being paid' : '';
  if (t.basis === 'tiered' && t.tiers?.length)
    return [...t.tiers]
      .sort((a, b) => a.months - b.months)
      .map((x) => `${pct(x.share)} if you leave within ${yrs(x.months)}${since}`)
      .join(', ');
  return t.basis === 'prorata'
    ? `the unserved share if you leave within ${yrs(t.months)}${since}`
    : `all of it if you leave within ${yrs(t.months)}${since}`;
}

/** For the story: "Repayable if you leave before Nov 2027." */
export function repayableText(o: OneTime, joined: string): string {
  const t = termsOf(o);
  if (!t) return '';
  if (t.basis === 'tiered') return `Repayable by time served: ${describeTerms(t)}.`;
  const until = monthLong(addMonths(t.from === 'payment' ? o.month : monthOf(joined), t.months));
  return t.basis === 'prorata' ? `Repayable pro-rata for the unserved months if you leave before ${until}.` : `Repayable if you leave before ${until}.`;
}

/** Bonuses of this job that come with repayment terms. */
export const bonusesWithTerms = (emp: Employment) => emp.oneTimes.filter((o) => o.amount > 0 && termsOf(o));

/**
 * What you repay when you leave `emp` on its last working day. A bonus is repaid only if it was
 * paid before you leave, and only while you're inside its clawback period.
 */
export function clawbackFor(emp: Employment): { amount: number; lines: ClawbackLine[] } {
  const lines: ClawbackLine[] = [];
  if (!emp.end) return { amount: 0, lines };
  for (const o of emp.oneTimes) {
    const t = termsOf(o);
    if (!t || !o.amount) continue;
    if (o.month > monthOf(emp.end)) {
      lines.push({ label: o.label, amount: o.amount, repaid: 0, why: `Not paid yet when you leave (due ${monthLong(o.month)}), so nothing to repay.` });
      continue;
    }
    const from = t.from === 'payment' ? `${o.month}-01` : emp.start;
    const served = monthsServed(from, emp.end);
    const share = shareRepaid(t, served);
    const repaid = Math.round(o.amount * share);
    const stay = `${served.toFixed(1)} months${t.from === 'payment' ? ' after it was paid' : ' of service'}`;
    const why = !share
      ? `You leave after ${stay}, past the clawback period (${describeTerms(t)}). Nothing to repay.`
      : t.basis === 'prorata'
        ? `You leave after ${stay}: ${(t.months - served).toFixed(1)} of ${t.months} months unserved, so ${pct(share)} of ${inr(o.amount)} is repaid.`
        : `You leave after ${stay}. The letter says ${describeTerms(t)}: ${pct(share)} of ${inr(o.amount)}.`;
    lines.push({ label: o.label, amount: o.amount, repaid, why });
  }
  return { amount: lines.reduce((a, l) => a + l.repaid, 0), lines };
}
