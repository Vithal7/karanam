/**
 * The year in plain words, job by job: "Joined Acme on 1 Mar 2024 at ₹60,000 basic. Hike from
 * Apr 2026 ... Last working day ... Leave encashment 22 days × ₹2,736 ...".
 */
import { buyoutAmount, fnfItems, form12BMonth, type Result } from './compute';
import { addMonths, daysInMonth, fyStart, monthLong, monthName, monthOf, parseDate } from './fy';
import { arrearsFor, fixedMonthly } from './schedule';
import { shortCompany } from '../format';
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

const regular = (l: { basic: number; hra: number; special: number; others: number }) => l.basic + l.hra + l.special + l.others;
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
      if (f.gratuity)
        lines.push({
          text: f.gratuityKind === 'exgratia' ? `Ex gratia ${inr(f.gratuity)} in lieu of gratuity (${f.gratuityLabel}); taxable.` : `Gratuity ${inr(f.gratuity)} (${f.gratuityLabel}); tax-free up to ₹20 lakh.`,
          tone: 'good',
        });
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

/* ---------------- One timeline across all jobs ---------------- */

export interface TimelineEvent {
  /** YYYY-MM-DD; month-level events use the 1st. */
  date: string;
  /** Month-level events show "Jul 2026" rather than a day. */
  monthOnly?: boolean;
  /** Index into Scenario.employers, or -1 for tax events. */
  job: number;
  text: string;
  detail?: string;
  tone?: 'good' | 'warn' | 'info';
  /** Something you still need to do. */
  action?: boolean;
}

/**
 * Everything that happens to your money, in date order: joining, hikes, arrears, resignation,
 * last day, F&F, joining bonus, buyout, Form 12B, year end and the ITR deadline. Wording follows
 * the calendar: "Joined" before today, "Join" after.
 */
export function buildTimeline(s: Scenario, r: Result): TimelineEvent[] {
  const today = s.today;
  const thirty = s.settings.thirtyDayMonth;
  const ev: TimelineEvent[] = [];
  const past = (d: string) => d <= today;
  const m1 = (m: string) => `${m}-01`;
  /** Salary-day events (bonuses, arrears, F&F, buyout) happen at the end of their month. */
  const payday = (m: string) => `${m}-28`;
  const n = s.employers.length;

  const nm = (e?: Employment) => shortCompany(e?.name || 'the next job');
  s.employers.forEach((e, k) => {
    const name = shortCompany(e.name || `Job ${k + 1}`);
    const isNew = k === n - 1;
    if (e.totalsOnly) {
      if (e.end) ev.push({ date: e.end, job: k, text: `${name}: ${inr(e.totalsOnly.gross)} earned, ${inr(e.totalsOnly.tds)} tax deducted this year` });
      return;
    }
    const st = e.structure;
    const pay = `${inr(st.basic)} basic a month, ${inr(fixedMonthly(st))} fixed gross${e.ctc ? `, CTC ${inr(e.ctc)}` : ''}`;
    if (e.startSource === 'default')
      ev.push({ date: fyStart(s.fy), job: k, text: `Working at ${name}`, detail: `${pay}. Your joining date wasn't in the files; add it under "Check the numbers".`, tone: 'info' });
    else if (e.startSource === 'approx')
      ev.push({ date: e.start, monthOnly: true, job: k, text: `Joined ${name} (around this date)`, detail: `${pay}. Date taken from the appointment letter.` });
    else if (e.start) ev.push({ date: e.start, job: k, text: `${past(e.start) ? 'Joined' : 'Join'} ${name}`, detail: pay });

    // PF going up without a hike: the EPF wage ceiling rose. Say what it does to pay.
    const ls = r.employers[k]?.lines ?? [];
    for (let i = 1; i < ls.length; i++) {
      const a = ls[i - 1];
      const b = ls[i];
      if (a.factor < 1 || b.factor < 1 || b.epf <= a.epf + 1 || regular(a) === 0) continue;
      const hiked = e.revisions.some((h) => (h.payoutMonth && h.payoutMonth > h.from ? h.payoutMonth : h.from) === b.month);
      if (hiked) continue;
      const cut = Math.round(a.special - b.special);
      ev.push({
        date: m1(b.month),
        monthOnly: true,
        job: k,
        text: `PF at ${name} goes up: ${inr(a.epf)} → ${inr(b.epf)} a month`,
        detail:
          cut > 0
            ? `The EPF wage ceiling rose. Your employer's PF rises by the same amount and comes out of your CTC, so your allowance drops by ${inr(cut)}: ${inr(b.epf - a.epf + cut)} less in hand each month. If your employer pays it on top instead, change it under "Check the numbers".`
            : `The EPF wage ceiling rose, so ${inr(b.epf - a.epf)} more goes to your PF each month. If your employer takes its extra share from your allowance, change it under "Check the numbers".`,
        tone: 'info',
      });
      break;
    }

    // Hikes and arrears.
    const arrears = arrearsFor(e, thirty);
    let before = e.structure;
    let beforeCtc = e.ctc || undefined;
    for (const h of [...e.revisions].sort((a, b) => a.from.localeCompare(b.from))) {
      const p = h.pct ?? (fixedMonthly(before) ? fixedMonthly(h.structure) / fixedMonthly(before) - 1 : 0);
      const what = h.ctc && beforeCtc ? `CTC ${inr(beforeCtc)} → ${inr(h.ctc)}` : `fixed gross ${inr(fixedMonthly(before))} → ${inr(fixedMonthly(h.structure))} a month`;
      ev.push({
        date: m1(h.from),
        monthOnly: true,
        job: k,
        text: `Hike at ${name}: ${what} (${p >= 0 ? '+' : ''}${pct(p)})`,
        detail: `Basic ${inr(before.basic)} → ${inr(h.structure.basic)}.${h.scaled ? ' The letter gave only the total, so every component was raised by the same %.' : ''}`,
        tone: 'good',
      });
      if (h.payoutMonth) {
        const a = arrears.find((x) => x.month === h.payoutMonth);
        ev.push({
          date: payday(h.payoutMonth),
          monthOnly: true,
          job: k,
          text: `${past(payday(h.payoutMonth)) ? 'New salary first paid' : 'New salary starts'}${a ? ` with ${inr(a.amount)} arrears` : ''}`,
          detail: a ? `For ${monthName(h.from, false)}–${monthName(addMonths(h.payoutMonth, -1), false)}, when the hike applied but wasn't paid yet.` : undefined,
          tone: 'good',
        });
      }
      before = h.structure;
      beforeCtc = h.ctc ?? beforeCtc;
    }

    // Leaving.
    if (!isNew && e.end) {
      const exitDocs = e.docs.some((d) => d.kind === 'resignation' || d.kind === 'fnf');
      const confirmed = exitDocs || e.endSource === 'doc' || e.endSource === 'user';
      if (e.resignedOn) ev.push({ date: e.resignedOn, job: k, text: `${past(e.resignedOn) ? 'Resigned from' : 'Resign from'} ${name}` });
      const f = fnfItems(e, s.fy, thirty);
      const last = r.employers[k]?.lines.find((l) => l.month === monthOf(e.end));
      let prorata: string | undefined;
      if (f && last && f.lastMonthFactor > 0 && f.lastMonthFactor < 1) {
        const { y, m } = parseDate(f.lastMonth);
        const of = thirty ? 30 : daysInMonth(y, m);
        prorata = `${monthName(f.lastMonth, false)} salary for ${Math.round(f.lastMonthFactor * of)} of ${of} days: ${inr(last.basic + last.hra + last.special + last.others)} gross.`;
      }
      ev.push({
        date: e.end,
        job: k,
        text: `Last day at ${name}${confirmed || past(e.end) ? '' : ' (assumed)'}`,
        detail: [prorata, confirmed ? undefined : `Taken as the day before ${nm(s.employers[k + 1])} starts. Add your resignation email when you have it.`].filter(Boolean).join(' '),
        tone: confirmed ? undefined : 'info',
      });
      if (f && (f.leaveEncashment || f.noticeRecovery || f.clawback || f.penalty || f.gratuity)) {
        const parts = [
          f.leaveEncashment ? `+${inr(f.leaveEncashment)} leave encashment${f.leaveFromSlip ? '' : ` (${e.fnf!.leaveDays} days × ${inr(f.perDay)}, ${f.leaveRateLabel})`}` : '',
          f.gratuity ? `+${inr(f.gratuity)} ${f.gratuityKind === 'exgratia' ? 'ex gratia (in lieu of gratuity, taxable)' : 'gratuity (tax-free)'}` : '',
          f.noticeRecovery ? `−${inr(f.noticeRecovery)} notice recovery${f.noticeFromSlip ? '' : ` (${e.fnf!.noticeDaysRecovered} days × ${inr(f.noticePerDay)})`}` : '',
          f.clawback ? `−${inr(f.clawback)} bonus clawback` : '',
          f.penalty ? `−${inr(f.penalty)} penalty` : '',
        ].filter(Boolean);
        ev.push({ date: payday(f.month), monthOnly: true, job: k, text: `F&F from ${name}`, detail: parts.join(' · '), tone: f.noticeRecovery + f.clawback + f.penalty > f.leaveEncashment + f.gratuity ? 'warn' : 'good' });
      }
    }

    // Joining terms at a later job.
    if (k > 0) {
      const prev = s.employers[k - 1];
      const pf = fnfItems(prev, s.fy, thirty);
      const f12 = form12BMonth(s, k);
      if (f12) ev.push({ date: m1(addMonths(f12, 0)), monthOnly: true, job: k, text: `Submit Form 12B to ${name}`, detail: `So TDS here counts what you earned at ${nm(prev)}.`, action: !past(m1(f12)) });
      else ev.push({ date: e.start, job: k, text: `No Form 12B for ${name}`, detail: `It will deduct too little tax; the difference is due when you file.`, tone: 'warn' });
      if (pf) {
        const { amount, claimed } = buyoutAmount(pf, e, prev);
        const mode = e.buyout?.mode ?? (prev.fnf?.buyoutByNext ? 'actuals' : 'none');
        const paid = r.employers[k]?.lines.flatMap((l) => l.oneTimes.map((o) => ({ o, month: l.month }))).find((x) => x.o.kind === 'buyout');
        if (mode !== 'none' && amount > 0 && paid)
          ev.push({ date: payday(paid.month), monthOnly: true, job: k, text: `${name} reimburses your notice buyout: ${inr(amount)}`, detail: amount < claimed ? `Capped: ${inr(claimed - amount)} of the ${inr(claimed)} you paid isn't covered.` : undefined, tone: amount < claimed ? 'warn' : 'good' });
        else if (mode === 'none' && pf.noticeRecovery + pf.clawback > 0) ev.push({ date: e.start, job: k, text: `No notice buyout from ${name}`, detail: `You bear the ${inr(pf.noticeRecovery + pf.clawback)} recovered by ${nm(prev)}.`, tone: 'warn' });
      }
    }
    for (const o of e.oneTimes) {
      if (o.kind === 'joining') {
        const until = o.clawbackMonths ? addMonths(monthOf(e.start), o.clawbackMonths) : undefined;
        ev.push({
          date: payday(o.month),
          monthOnly: true,
          job: k,
          text: `Joining bonus from ${name}: ${inr(o.amount)}`,
          detail: until ? `Repayable if you leave before ${monthLong(until)}.` : undefined,
          tone: 'good',
        });
      } else if (o.amount) ev.push({ date: payday(o.month), monthOnly: true, job: k, text: `${o.label} from ${name}: ${inr(o.amount)}`, tone: 'good' });
    }
    if (isNew && e.variable?.annual && e.variable.month) {
      const v = r.nextFy.lines.flatMap((l) => l.oneTimes).find((o) => o.kind === 'variable') ?? r.employers[k]?.lines.flatMap((l) => l.oneTimes).find((o) => o.kind === 'variable');
      if (v) ev.push({ date: payday(e.variable.month), monthOnly: true, job: k, text: `Variable pay from ${name}: about ${inr(v.amount)}`, detail: `${pct(e.variable.payoutPct)} payout${e.variable.prorate ? ', prorated for your first year' : ''}.`, tone: 'good' });
    }
  });

  // Year end and ITR.
  const fyEndDate = `${s.fy + 1}-03-31`;
  const bal = r.filing.balance;
  ev.push({
    date: fyEndDate,
    job: -1,
    text: `Financial year ends. Tax for the year: ${inr(r.filing.total)}`,
    detail: bal < 0 ? `Your employers will have deducted ${inr(-bal)} more than needed.` : bal > 0 ? `${inr(bal)} more than your employers deduct is still due.` : undefined,
  });
  ev.push({
    date: `${s.fy + 1}-07-31`,
    job: -1,
    text: `File your ITR by 31 Jul ${s.fy + 1}: ${bal < 0 ? `${inr(-bal)} refund` : bal > 0 ? `pay ${inr(bal)} first` : 'nothing to pay'}`,
    tone: bal < 0 ? 'good' : bal > 0 ? 'warn' : undefined,
    action: true,
  });

  return ev.sort((a, b) => a.date.localeCompare(b.date) || a.job - b.job);
}
