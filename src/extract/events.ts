/**
 * Turns dated documents into a job's history: appraisal letters become hikes (with arrears when
 * paid late), payslips pin the actual breakup after a hike, resignation and F&F papers set the
 * exit, and new-offer terms set the buyout and joining-bonus clawback.
 */
import { addMonths, monthName, monthOf } from '../domain/fy';
import { fixedMonthly } from '../domain/schedule';
import type { Employment, FnF, Revision, Structure } from '../domain/types';
import { epfCeiling, type Rules } from '../rules';
import { orderDocs } from './merge';

const scale = (s: Structure, k: number): Structure => ({
  ...s,
  basic: Math.round(s.basic * k),
  hra: Math.round(s.hra * k),
  special: Math.round(s.special * k),
  others: s.others.map((o) => ({ ...o, amount: Math.round(o.amount * k) })),
});

/** Rough CTC of a monthly structure: fixed pay + employer PF + gratuity (4.81% of basic). */
export function estimateCtc(s: Structure, month: string, rules: Rules): number {
  const pf = s.epfMode === 'fixed' ? s.epf : rules.epf.rate * (s.epfMode === 'fullBasic' ? s.basic : Math.min(s.basic, epfCeiling(rules, month)));
  return Math.round((fixedMonthly(s) + pf + 0.0481 * s.basic) * 12);
}

const withComponents = (prev: Structure, f: Record<string, number>): Structure | null => {
  if (!f.basic) return null;
  const others = Object.keys(f).filter((k) => k.startsWith('other:'));
  return {
    ...prev,
    basic: f.basic,
    hra: f.hra ?? prev.hra,
    special: f.special ?? prev.special,
    others: others.length ? others.map((k) => ({ name: k.slice(6), amount: f[k] })) : prev.others,
  };
};

export interface EventsResult {
  emp: Employment;
  /** Plain-language notes for the story view (assumptions, stale letters). */
  notes: string[];
}

export function applyEvents(emp: Employment, rules: Rules, fyStartMonth: string): EventsResult {
  const docs = orderDocs(emp.docs);
  const notes: string[] = [];
  const out: Employment = { ...emp, revisions: emp.revisions.filter((r) => r.source !== 'doc:appraisal' && !r.source?.startsWith('doc:appraisal')) };

  // --- Hikes from appraisal letters, oldest first ---
  const appraisals = docs
    .filter((d) => d.kind === 'appraisal')
    .map((d) => ({ d, from: monthOf(d.facts?.effectiveFrom ?? d.docDate ?? '') }))
    .filter((x) => x.from)
    .sort((a, b) => a.from.localeCompare(b.from));
  let prev = out.structure;
  let prevCtc = out.ctc || undefined;
  const hikes: Revision[] = [];
  for (const { d, from } of appraisals) {
    const f = d.facts ?? {};
    const given = withComponents(prev, d.fields);
    let structure: Structure;
    let k: number | undefined;
    let scaled = false;
    if (given) {
      structure = given;
      k = fixedMonthly(prev) ? fixedMonthly(given) / fixedMonthly(prev) : undefined;
    } else {
      const oldCtc = f.oldCtc ?? prevCtc;
      if (f.incrementPct) k = 1 + f.incrementPct;
      else if (f.revisedCtc && oldCtc) k = f.revisedCtc / oldCtc;
      else if (f.revisedCtc && fixedMonthly(prev)) {
        k = f.revisedCtc / estimateCtc(prev, from, rules);
        notes.push(`${d.name}: your CTC before this hike wasn't in the letters, so it was estimated from your salary breakup. Check the new salary.`);
      }
      if (!k) {
        notes.push(`${d.name}: couldn't tell how big the hike is. Enter the new salary for ${monthName(from)} under this job.`);
        continue;
      }
      structure = scale(prev, k);
      scaled = true;
    }
    const ctc = f.revisedCtc ?? (prevCtc && k ? Math.round(prevCtc * k) : undefined);
    const payoutMonth = f.payoutMonth && f.payoutMonth > from ? f.payoutMonth : undefined;
    hikes.push({ from, payoutMonth, structure, ctc, pct: k ? k - 1 : undefined, source: `doc:appraisal:${d.name}`, scaled });
    prev = structure;
    prevCtc = ctc ?? prevCtc;
  }

  // --- Payslips after a hike show the real breakup: pin it on that hike ---
  for (const d of docs.filter((x) => x.kind === 'payslip' && x.docDate)) {
    const m = monthOf(d.docDate!);
    const h = [...hikes].reverse().find((x) => (x.payoutMonth ?? x.from) <= m);
    const given = h && withComponents(h.structure, d.fields);
    if (h && given) {
      h.structure = given;
      h.scaled = false;
    }
  }
  out.revisions = [...out.revisions, ...hikes].sort((a, b) => a.from.localeCompare(b.from));

  // --- Old letters: say how they were used ---
  const base = docs.find((d) => d.kind === 'offer');
  if (base?.docDate && monthOf(base.docDate) < addMonths(fyStartMonth, -12) && !hikes.length && !docs.some((d) => d.kind === 'payslip' && d.docDate && monthOf(d.docDate) >= fyStartMonth)) {
    notes.push(
      `${base.name} is from ${monthName(monthOf(base.docDate))}. It's used as your salary at ${emp.name || 'this job'}; if you've had a hike since, add the appraisal letter or a recent payslip.`,
    );
  }

  // --- Exit: resignation letter, then F&F slip (the slip's amounts win) ---
  const exits = docs.filter((d) => d.kind === 'resignation' || d.kind === 'fnf');
  if (exits.length) {
    const fnf: FnF = { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0, ...(out.fnf ?? {}) };
    for (const d of exits.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'fnf' ? 1 : -1))) {
      const f = d.facts ?? {};
      if (f.lastWorkingDay) out.end = f.lastWorkingDay;
      if (f.resignationDate) out.resignedOn = f.resignationDate;
      else if (d.kind === 'resignation' && d.docDate && !out.resignedOn) out.resignedOn = d.docDate;
      if (f.shortfallDays !== undefined) fnf.noticeDaysRecovered = f.shortfallDays;
      if (f.leaveDays !== undefined) fnf.leaveDays = f.leaveDays;
      if (f.leaveAmount !== undefined) fnf.leaveAmount = f.leaveAmount;
      if (f.noticeRecoveryAmount !== undefined) fnf.noticeAmount = f.noticeRecoveryAmount;
      if (f.clawback !== undefined) fnf.clawback = f.clawback;
      if (f.penalty !== undefined) fnf.penalty = f.penalty;
      if (f.gratuity !== undefined) fnf.gratuity = f.gratuity;
      if (f.fnfPayMonth) fnf.payMonth = f.fnfPayMonth;
    }
    out.fnf = fnf;
  }

  // --- New-offer terms ---
  const offerFacts = docs.filter((d) => d.kind === 'offer').map((d) => d.facts ?? {});
  const bo = offerFacts.find((f) => f.buyout)?.buyout;
  if (bo) out.buyout = { ...(out.buyout ?? {}), mode: bo.mode, cap: bo.cap };
  const claw = offerFacts.find((f) => f.joiningClawbackMonths)?.joiningClawbackMonths;
  if (claw) out.oneTimes = out.oneTimes.map((o) => (o.kind === 'joining' ? { ...o, clawbackMonths: claw } : o));

  return { emp: out, notes };
}

