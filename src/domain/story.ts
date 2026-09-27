/**
 * The year in plain words, job by job: "Joined Sigma on 1 Mar 2024 at ₹67,500 basic. Hike from
 * Apr 2026 ... Last working day ... Leave encashment 22 days × ₹2,736 ...".
 */
import { buyoutAmount, fnfItems, form12BMonth, type Result } from './compute';
import { addMonths, daysInMonth, fyStart, monthLong, monthName, monthOf, parseDate } from './fy';
import { arrearsFor, fixedMonthly } from './schedule';
import type { Employment, Scenario } from './types';

export interface StoryLine {
  text: string;
  tone?: 'good' | 'warn' | 'info';
}

export interface StoryJob {
  id: string;
  name: string;
  isNew: boolean;
  lines: StoryLine[];
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
export const longDate = (d: string) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const pct = (x: number) => `${(x * 100).toFixed(1).replace(/\.0$/, '')}%`;

function joined(e: Employment, isNew: boolean, s: Scenario): StoryLine {
  const st = e.structure;
  const pay = `${inr(st.basic)} basic a month (${inr(fixedMonthly(st))} fixed gross${e.ctc ? `, CTC ${inr(e.ctc)}` : ''})`;
  if (isNew && e.start >= fyStart(s.fy)) return { text: `Joining on ${longDate(e.start)} at ${pay}.` };
  if (e.start && e.start < fyStart(s.fy) && e.docs.some((d) => d.kind === 'offer' && d.doj)) return { text: `Joined on ${longDate(e.start)} at ${pay}.` };
  return { text: `Working here from ${longDate(e.start || fyStart(s.fy))} at ${pay}.` };
}

export function buildStory(s: Scenario, r: Result): StoryJob[] {
  const thirty = s.settings.thirtyDayMonth;
  return s.employers.map((e, k) => {
    const isNew = k === s.employers.length - 1;
    const lines: StoryLine[] = [];
    if (e.totalsOnly) {
      lines.push({ text: `Totals only: ${inr(e.totalsOnly.gross)} earned and ${inr(e.totalsOnly.tds)} tax deducted this year.` });
      return { id: e.id, name: e.name, isNew, lines };
    }
    lines.push(joined(e, isNew, s));

    // Hikes, oldest first.
    const arrears = arrearsFor(e, thirty);
    let before = e.structure;
    let beforeCtc = e.ctc || undefined;
    for (const h of [...e.revisions].sort((a, b) => a.from.localeCompare(b.from))) {
      const ctcPart = h.ctc && beforeCtc ? `CTC ${inr(beforeCtc)} → ${inr(h.ctc)}` : `fixed gross ${inr(fixedMonthly(before))} → ${inr(fixedMonthly(h.structure))} a month`;
      const p = h.pct ?? (fixedMonthly(before) ? fixedMonthly(h.structure) / fixedMonthly(before) - 1 : 0);
      lines.push({ text: `Hike from ${monthLong(h.from)}: ${ctcPart} (${p >= 0 ? '+' : ''}${pct(p)}). Basic now ${inr(h.structure.basic)}.`, tone: 'good' });
      if (h.payoutMonth) {
        const a = arrears.find((x) => x.month === h.payoutMonth);
        lines.push({
          text: `First paid in ${monthLong(h.payoutMonth)}${a ? `, with ${inr(a.amount)} arrears for ${monthName(h.from, false)}–${monthName(addMonths(h.payoutMonth, -1), false)}` : ''}.`,
        });
      }
      if (h.scaled) lines.push({ text: 'The letter gave only the total, so every component was raised by the same %. Edit the breakup if your payslip differs.', tone: 'info' });
      before = h.structure;
      beforeCtc = h.ctc ?? beforeCtc;
    }

    // Leaving.
    const f = fnfItems(e, s.fy, thirty);
    if (e.end && !isNew) {
      if (e.resignedOn) lines.push({ text: `Resigned on ${longDate(e.resignedOn)}.` });
      const last = r.employers[k]?.lines.find((l) => l.month === monthOf(e.end));
      const partial = f && f.lastMonthFactor > 0 && f.lastMonthFactor < 1;
      let prorata = '';
      if (partial && last) {
        const { y, m } = parseDate(f.lastMonth);
        const of = thirty ? 30 : daysInMonth(y, m);
        prorata = ` ${monthLong(f.lastMonth)} salary is pro-rata for ${Math.round(f.lastMonthFactor * of)} of ${of} days: ${inr(last.basic + last.hra + last.special + last.others)} gross.`;
      }
      lines.push({ text: `Last working day ${longDate(e.end)}.${prorata}` });
    }
    if (f && !isNew) {
      if (f.leaveEncashment)
        lines.push({
          text: f.leaveFromSlip
            ? `Leave encashment ${inr(f.leaveEncashment)} as per your F&F slip${e.fnf?.leaveDays ? ` (${e.fnf.leaveDays} days)` : ''}. Tax-free up to ₹25 lakh; claim it in your ITR.`
            : `Leave encashment: ${e.fnf!.leaveDays} days × ${inr(f.perDay)} a day (${f.leaveRateLabel}) = ${inr(f.leaveEncashment)}. Tax-free up to ₹25 lakh; claim it in your ITR.`,
          tone: 'good',
        });
      if (f.noticeRecovery)
        lines.push({
          text: f.noticeFromSlip
            ? `Notice shortfall recovery ${inr(f.noticeRecovery)} as per your F&F slip.`
            : `Notice shortfall: ${e.fnf!.noticeDaysRecovered} days × ${inr(f.noticePerDay)} (${f.noticeRateLabel}) = ${inr(f.noticeRecovery)} recovered.`,
          tone: 'warn',
        });
      if (f.clawback) lines.push({ text: `Bonus clawback: ${inr(f.clawback)} deducted.`, tone: 'warn' });
      if (f.penalty) lines.push({ text: `Penalty / bond recovery: ${inr(f.penalty)} deducted.`, tone: 'warn' });
      if (f.gratuity) lines.push({ text: `Gratuity ${inr(f.gratuity)} (tax-free up to ₹20 lakh).`, tone: 'good' });
      if (f.leaveEncashment || f.noticeRecovery || f.clawback || f.penalty || f.gratuity)
        lines.push({ text: `F&F settled in ${monthLong(f.month)}.` });
    }

    // Joining terms at a later job.
    if (k > 0 || isNew) {
      const jb = e.oneTimes.find((o) => o.kind === 'joining');
      if (jb) {
        const until = jb.clawbackMonths ? addMonths(monthOf(e.start), jb.clawbackMonths) : undefined;
        lines.push({ text: `Joining bonus ${inr(jb.amount)}, paid in ${monthLong(jb.month)}.${until ? ` Repayable if you leave before ${monthLong(until)}.` : ''}`, tone: 'good' });
      }
      const prev = s.employers[k - 1];
      const pf = prev ? fnfItems(prev, s.fy, thirty) : null;
      if (prev && pf) {
        const owed = pf.noticeRecovery + pf.clawback;
        const { amount, claimed } = buyoutAmount(pf, e, prev);
        const mode = e.buyout?.mode ?? (prev.fnf?.buyoutByNext ? 'actuals' : 'none');
        if (owed > 0 && mode === 'none') lines.push({ text: `No notice buyout support: you bear the ${inr(owed)} recovered by ${prev.name}.`, tone: 'warn' });
        else if (mode !== 'none' && claimed > 0)
          lines.push({
            text: `Notice buyout ${mode === 'cap' && e.buyout?.cap ? `reimbursed up to ${inr(e.buyout.cap)}` : 'reimbursed on actuals'}: ${inr(amount)} of ${inr(claimed)} comes back to you.`,
            tone: amount >= claimed ? 'good' : 'warn',
          });
        const f12 = form12BMonth(s, k);
        lines.push(
          f12
            ? { text: `Form 12B given before the ${monthLong(f12)} salary, so TDS here accounts for what you earned at ${prev.name}.` }
            : { text: `No Form 12B: this payroll won't know about your earlier salary and will deduct too little tax. The difference is due when you file.`, tone: 'warn' },
        );
      }
    }
    return { id: e.id, name: e.name, isNew, lines };
  });
}
