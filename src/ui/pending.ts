import { validateEmployers } from '../domain/compute';
import { fyStart } from '../domain/fy';
import { reconcile } from '../domain/reconcile';
import type { Employment, Scenario } from '../domain/types';
import type { Rules } from '../rules';
import type { AppState } from '../state';
import { needsPrevVariable } from './PrevVariable';
import { exitQuestionFor } from './ExitQuestion';
import { pfCeilingRiseIn, ptRuleFor } from '../domain/schedule';
import { monthLong } from '../domain/fy';
import { needsExGratia, needsNotice, staleSalary } from './Questions';
import { needsBuyout, needsNps, needsRelocation, prevNps } from './JoiningQuestions';

export interface Pending {
  /** The job it's about, if any. */
  job?: string;
  text: string;
  /** Worth a look, but doesn't hold you up. */
  soft?: boolean;
}

/** Everything we still need you to answer before the numbers can be trusted. */
export function pendingItems(st: AppState, s: Scenario, rules: Rules, openConflicts: (e: Employment) => number): Pending[] {
  const out: Pending[] = [];
  const n = s.employers.length;
  for (const d of st.inbox.filter((x) => x.similarTo && s.employers.some((e) => e.id === x.similarTo)))
    out.push({ text: `Is ${d.employer} the same employer as ${s.employers.find((e) => e.id === d.similarTo)!.name}?` });
  const plain = st.inbox.filter((x) => !x.similarTo || !s.employers.some((e) => e.id === x.similarTo)).length;
  if (plain) out.push({ text: `Which job ${plain === 1 ? 'a file is' : `${plain} files are`} for` });
  for (const x of validateEmployers(s)) out.push({ text: x });
  const first = s.employers[0];
  if (first && !first.totalsOnly && first.start > fyStart(s.fy) && first.startSource !== 'default' && !s.settings.noEarlierIncome)
    out.push({ text: `Any salary earlier this year, before you joined ${first.name || 'your first job'}?` });
  s.employers.forEach((e, k) => {
    const name = e.name || `Job ${k + 1}`;
    if (e.totalsOnly) return;
    if (needsExGratia(e, k < n - 1 || !!e.end)) out.push({ job: e.id, text: `${name}: is ex gratia paid when you leave (under 5 years)?` });
    if (staleSalary(e, s.fy, s.today)) out.push({ job: e.id, text: `${name}: has your pay changed since your latest letter or payslip?` });
    if (e.splitGuessed && !e.asked?.split) out.push({ job: e.id, text: `${name}: check the salary split (the letter gave only a CTC)` });
    if (needsNotice(e)) out.push({ job: e.id, text: `${name}: your notice period (for the notice shortfall)` });
    if (needsNps(s, k)) out.push({ job: e.id, text: prevNps(s, k) ? `${name}: will you continue employer NPS there?` : `${name}: will it pay employer NPS for you?` });
    if (needsBuyout(s, k)) out.push({ job: e.id, text: `${name}: will it pay a notice buyout?` });
    if (needsRelocation(s, k)) out.push({ job: e.id, text: `${name}: any relocation support?` });
    if (k > 0 && !e.form12BConfirmed) out.push({ job: e.id, text: `${name}: will you give it Form 12B (your earlier salary and TDS)?` });
    const rise = pfCeilingRiseIn(e, s.fy, rules);
    if (rise && !e.pfRise) out.push({ job: e.id, text: `${name}: when PF goes up in ${monthLong(rise)}, who pays the employer's extra share?` });
    if (e.fnf && !e.leaveConfirmed && !e.fnf.leaveDays && e.fnf.leaveAmount === undefined && (k < n - 1 || e.end))
      out.push({ job: e.id, text: `${name}: leave balance at exit (we've used 0 days)`, soft: true });
    for (const r of e.revisions.filter((x) => x.dateGuessed)) out.push({ job: e.id, text: `${name}: the hike letter has no effective date; we used ${monthLong(r.from)}`, soft: true });
    const c = openConflicts(e);
    if (c) out.push({ job: e.id, text: `${name}: ${c} figure${c === 1 ? '' : 's'} differ between your files` });
    for (const need of st.needs[e.id] ?? []) out.push({ job: e.id, text: need.askMonth ? `${name}: which month the pay in ${need.docName} applies from` : `${name}: how big the hike in ${need.docName} was` });
    for (const d of e.docs.filter((x) => x.facts?.yearGuess)) out.push({ job: e.id, text: `${name}: which year the date in ${d.name} is` });
    const exitQ = exitQuestionFor(e, k, n);
    if (exitQ) out.push({ job: e.id, text: exitQ });
    if (e.startSource === 'default') out.push({ job: e.id, text: `${name}: your joining date` });
    else if (e.startSource === 'approx') out.push({ job: e.id, text: `${name}: confirm your joining date (we used the letter's date)` });
    if (e.revisions.some((r) => r.source === 'doc:files disagree'))
      out.push({ job: e.id, text: `${name}: check the month your salary changed (we used the earliest file showing the new pay)`, soft: true });
    if (e.structure.npsPct && e.docs.some((d) => d.kind === 'payslip' && d.fields.nps !== undefined))
      out.push({ job: e.id, text: `${name}: the NPS on your payslip is taken as your employer's (80CCD(2)); your own NPS isn't deductible under the new regime`, soft: true });
    if (!e.structure.basic) out.push({ job: e.id, text: `${name}: your salary (at least Basic)` });
    if (!e.location?.state || e.location.source === 'guess') out.push({ job: e.id, text: `Where you work at ${name} (professional tax depends on the state)` });
    else if (ptRuleFor(e, rules) === undefined) out.push({ job: e.id, text: `${name}: check the professional tax on your payslip`, soft: true });
    if (needsPrevVariable(e, s.fy)) out.push({ job: e.id, text: `${name}: last year's variable pay` });
    const rc = e.structure.basic ? reconcile(e, e.structure, e.start > fyStart(s.fy) ? e.start.slice(0, 7) : `${s.fy}-04`, rules) : null;
    if (rc && !rc.ok) out.push({ job: e.id, text: `${name}: the salary breakup doesn't add up to the CTC`, soft: true });
  });
  return out;
}
