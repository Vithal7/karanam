/**
 * Turns dated documents into a job's history: appraisal letters become hikes (with arrears when
 * paid late), payslips pin the actual breakup after a hike, resignation and F&F papers set the
 * exit, and new-offer terms set the buyout and joining-bonus clawback.
 */
import { addMonths, monthLong, monthOf } from '../domain/fy';
import { fixedMonthly, noticeShortfall } from '../domain/schedule';
import type { Employment, FnF, MonthActual, OneTime, Revision, Structure } from '../domain/types';
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
  /** Appraisal letters whose hike size we couldn't read: ask the user. */
  needs: { docId: string; docName: string; month: string }[];
}

export function applyEvents(emp: Employment, rules: Rules, fyStartMonth: string): EventsResult {
  const docs = orderDocs(emp.docs);
  const notes: string[] = [];
  const needs: EventsResult['needs'] = [];
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
    let revisedCtc: number | undefined = f.revisedCtc ?? d.fields.ctc;
    if (given) {
      structure = given;
      k = fixedMonthly(prev) ? fixedMonthly(given) / fixedMonthly(prev) : undefined;
    } else {
      const oldCtc = f.oldCtc ?? prevCtc;
      revisedCtc ??= f.incrementAmount && oldCtc ? oldCtc + f.incrementAmount : undefined;
      if (f.incrementPct) k = 1 + f.incrementPct;
      else if (revisedCtc && oldCtc) k = revisedCtc / oldCtc;
      else if (revisedCtc && fixedMonthly(prev)) {
        k = revisedCtc / estimateCtc(prev, from, rules);
        notes.push(`${d.name}: your CTC before this hike wasn't in the letters, so it was estimated from your salary breakup. Check the new salary.`);
      }
      if (!k) {
        needs.push({ docId: d.id, docName: d.name, month: from });
        continue;
      }
      structure = scale(prev, k);
      scaled = true;
    }
    const ctc = revisedCtc ?? (prevCtc && k ? Math.round(prevCtc * k) : undefined);
    const payoutMonth = f.payoutMonth && f.payoutMonth > from ? f.payoutMonth : undefined;
    hikes.push({ from, payoutMonth, structure, ctc, pct: k ? k - 1 : undefined, source: `doc:appraisal:${d.name}`, scaled, gratuity: d.fields.gratuity || undefined, dateGuessed: !f.effectiveFrom || undefined });
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

  // --- What already happened: payslips and tax sheets, newest file wins per month ---
  const actual: Record<string, MonthActual & { from: string }> = {};
  for (const d of docs) {
    for (const [m, a] of Object.entries(d.facts?.monthly ?? {})) {
      const cur = (actual[m] ??= { from: d.name });
      if (a.tds !== undefined) cur.tds = a.tds;
      if (a.gross !== undefined) cur.gross = a.gross;
      if (a.items?.length) cur.items = a.items;
      cur.from = d.name;
    }
  }
  out.grossKnown = Object.fromEntries(Object.entries(actual).filter(([, a]) => a.gross !== undefined).map(([m, a]) => [m, a.gross!]));
  out.tdsKnown = Object.fromEntries(Object.entries(actual).filter(([, a]) => a.tds !== undefined).map(([m, a]) => [m, a.tds!]));
  out.oneTimes = [
    ...out.oneTimes.filter((o) => !o.id.startsWith('actual-')),
    ...Object.entries(actual).flatMap(([m, a]) =>
      (a.items ?? []).map((it, i) => ({
        id: `actual-${m}-${i}`,
        label: it.kind === 'arrears' && !/^arrears?$/i.test(it.label.trim()) ? `Arrears (${it.label})` : it.label,
        kind: (it.kind === 'perquisite' ? 'other' : it.kind === 'arrears' ? 'bonus' : /variable|performance|pli|incentive/i.test(it.label) ? 'variable' : 'bonus') as OneTime['kind'],
        amount: it.amount,
        month: m,
        taxable: true,
        ...(it.kind === 'perquisite' ? { cash: false } : {}),
      })),
    ),
  ];
  // A bonus you entered by hand is already inside a month your files record: count it once.
  const pv = out.oneTimes.find((o) => o.id === 'prev-variable');
  if (pv && actual[pv.month]?.items?.some((it) => it.kind === 'bonus')) {
    out.oneTimes = out.oneTimes.filter((o) => o !== pv);
    notes.push(`The ${pv.label} you entered for ${monthLong(pv.month)} is already in your files' payments for that month, so it's counted once.`);
  }
  const tdsMonths = Object.keys(out.tdsKnown).sort();
  if (tdsMonths.length)
    notes.push(
      `Recorded from your files: TDS for ${monthLong(tdsMonths[0])}${tdsMonths.length > 1 ? ` to ${monthLong(tdsMonths[tdsMonths.length - 1])}` : ''} (₹${Math.round(Object.values(out.tdsKnown).reduce((x, y) => x + y, 0)).toLocaleString('en-IN')})${Object.values(actual).some((a) => a.items?.length) ? ', and ' + Object.entries(actual).flatMap(([m, a]) => (a.items ?? []).map((it) => `${it.label} ₹${Math.round(it.amount).toLocaleString('en-IN')} in ${monthLong(m)}`)).join(', ') : ''}.`,
    );

  // --- Old letters: say how they were used ---
  const base = docs.find((d) => d.kind === 'offer');
  if (base?.docDate && monthOf(base.docDate) < addMonths(fyStartMonth, -12) && !hikes.length && !docs.some((d) => d.kind === 'payslip' && d.docDate && monthOf(d.docDate) >= fyStartMonth)) {
    notes.push(
      `${base.name} is from ${monthLong(monthOf(base.docDate))}. It's used as your salary at ${emp.name || 'this job'}; if you've had a hike since, add the appraisal letter or a recent payslip.`,
    );
  }

  // --- Notice period: appointment letter, or the resignation acceptance ---
  const noticeDoc = [...docs].reverse().find((d) => d.facts?.noticeDays);
  if (noticeDoc && !out.noticeDays) {
    out.noticeDays = noticeDoc.facts!.noticeDays;
    out.noticeMonths = noticeDoc.facts!.noticeMonths;
  }

  // --- Exit: resignation letter, then F&F slip (the slip's amounts win) ---
  const exits = docs.filter((d) => d.kind === 'resignation' || d.kind === 'fnf');
  if (exits.length) {
    const fnf: FnF = { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0, ...(out.fnf ?? {}) };
    for (const d of exits.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'fnf' ? 1 : -1))) {
      const f = d.facts ?? {};
      if (f.lastWorkingDay) {
        out.end = f.lastWorkingDay;
        out.endSource = 'doc';
      }
      // Only a stated resignation date counts. A relieving or acceptance letter's own date is
      // later than the day you resigned; using it would overstate the notice shortfall.
      if (f.resignationDate) out.resignedOn = f.resignationDate;
      if (f.shortfallDays !== undefined) fnf.noticeDaysRecovered = f.shortfallDays;
      if (f.leaveDays !== undefined) fnf.leaveDays = f.leaveDays;
      if (f.leaveAmount !== undefined) fnf.leaveAmount = f.leaveAmount;
      if (f.noticeRecoveryAmount !== undefined) fnf.noticeAmount = f.noticeRecoveryAmount;
      if (f.clawback !== undefined) fnf.clawback = f.clawback;
      if (f.penalty !== undefined) fnf.penalty = f.penalty;
      if (f.gratuity !== undefined) fnf.gratuity = f.gratuity;
      if (f.fnfPayMonth) fnf.payMonth = f.fnfPayMonth;
    }
    // No shortfall stated: work it out from the notice period and your dates.
    const computed = noticeShortfall(out);
    if (!fnf.noticeDaysRecovered && fnf.noticeAmount === undefined && computed) fnf.noticeDaysRecovered = computed;
    out.fnf = fnf;
  }

  // --- Work location (for professional tax): a labelled location beats a guess; newest file wins ---
  if (out.location?.source !== 'user') {
    const locs = docs.map((d) => d.facts?.location).filter((l): l is NonNullable<typeof l> => !!l);
    const pick = [...locs].reverse().find((l) => l.source === 'doc') ?? locs[locs.length - 1];
    out.location = pick ? { ...pick } : undefined;
  }

  // --- New-offer terms ---
  const offerFacts = docs.filter((d) => d.kind === 'offer').map((d) => d.facts ?? {});
  const bo = offerFacts.find((f) => f.buyout)?.buyout;
  if (bo) out.buyout = { ...(out.buyout ?? {}), mode: bo.mode, cap: bo.cap };
  // A joining bonus with no stated pay month is usually paid once probation is over: with the
  // salary of the month after it (3 months' probation from November -> February).
  const probation = offerFacts.find((f) => f.probationMonths)?.probationMonths;
  const statedMonth = docs.some((d) => d.kind === 'offer' && d.fields.joiningOffset !== undefined);
  if (probation && !statedMonth && out.start) {
    const month = addMonths(monthOf(out.start), probation);
    out.oneTimes = out.oneTimes.map((o) => (o.kind === 'joining' && o.id === 'joining' ? { ...o, month } : o));
    if (out.oneTimes.some((o) => o.kind === 'joining'))
      notes.push(`Your letter has ${probation} months' probation and doesn't say when the joining bonus is paid, so it's taken as paid after probation, with the ${monthLong(month)} salary. Change it under "Check the numbers" if your letter says otherwise.`);
  }
  const claw = offerFacts.find((f) => f.joiningClawbackMonths)?.joiningClawbackMonths;
  if (claw) out.oneTimes = out.oneTimes.map((o) => (o.kind === 'joining' ? { ...o, clawbackMonths: claw } : o));

  return { emp: out, notes, needs };
}

