import { validateEmployers } from '../domain/compute';
import { fyStart } from '../domain/fy';
import { reconcile } from '../domain/reconcile';
import type { Employment, Scenario } from '../domain/types';
import type { Rules } from '../rules';
import type { AppState } from '../state';
import { needsPrevVariable } from './PrevVariable';

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
  if (st.inbox.length) out.push({ text: `Which job ${st.inbox.length === 1 ? 'a file is' : `${st.inbox.length} files are`} for` });
  for (const x of validateEmployers(s)) out.push({ text: x });
  s.employers.forEach((e, k) => {
    const name = e.name || `Job ${k + 1}`;
    if (e.totalsOnly) return;
    const c = openConflicts(e);
    if (c) out.push({ job: e.id, text: `${name}: ${c} figure${c === 1 ? '' : 's'} differ between your files` });
    for (const need of st.needs[e.id] ?? []) out.push({ job: e.id, text: `${name}: how big the hike in ${need.docName} was` });
    if (k < n - 1 && e.endSource !== 'doc' && e.endSource !== 'user') out.push({ job: e.id, text: `When you leave ${name}` });
    if (e.startSource === 'default') out.push({ job: e.id, text: `${name}: your joining date` });
    if (!e.structure.basic) out.push({ job: e.id, text: `${name}: your salary (at least Basic)` });
    if (needsPrevVariable(e, s.fy)) out.push({ job: e.id, text: `${name}: last year's variable pay` });
    const rc = e.structure.basic ? reconcile(e, e.structure, e.start > fyStart(s.fy) ? e.start.slice(0, 7) : `${s.fy}-04`, rules) : null;
    if (rc && !rc.ok) out.push({ job: e.id, text: `${name}: the salary breakup doesn't add up to the CTC`, soft: true });
  });
  return out;
}
