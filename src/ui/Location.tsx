import { useState } from 'preact/hooks';
import { ptRuleFor, pfRiseMode } from '../domain/schedule';
import type { Employment } from '../domain/types';
import { STATES } from '../extract/location';
import { rs } from '../format';
import type { Rules } from '../rules';
import { Field, Segmented } from './controls';

const MONTH = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Professional tax in words for a job's state. */
export function ptSummary(emp: Employment, rules: Rules): string {
  const rule = ptRuleFor(emp, rules);
  const name = emp.location?.state ? STATES[emp.location.state] : '';
  if (!emp.location?.state) return 'Tell us the state to work out professional tax.';
  if (rule === 'none') return `${name} has no professional tax on salaries.`;
  if (!rule) return `${name}'s professional tax isn't in our tables yet: we use the amount on your payslip (${rs(emp.structure.pt)} a month). Change it under Salary if needed.`;
  const top = rule.slabs[rule.slabs.length - 1].amount;
  const base =
    rule.basis === 'monthly'
      ? `${rs(top)} a month${rule.special ? `, ${rs(rule.special.amount)} in ${MONTH[rule.special.month]}` : ''} at your salary`
      : rule.basis === 'annual'
        ? `${rs(top)} a year at your salary, taken monthly`
        : `up to ${rs(top)} each half-year, taken in ${rule.collectMonths!.map((m) => MONTH[m]).join(' and ')}`;
  return `${rule.name}: ${base}.${rule.note ? ` ${rule.note}` : ''}`;
}

function StateSelect(props: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select class="text" aria-label={props.label} value={props.value} onChange={(e) => props.onChange((e.target as HTMLSelectElement).value)}>
      <option value="">Choose a state…</option>
      {Object.entries(STATES)
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([code, name]) => (
          <option value={code}>{name}</option>
        ))}
    </select>
  );
}

/** Clarification: where is this job? Pre-filled with a guess from the letters, never assumed. */
export function LocationQuestion(props: { emp: Employment; rules: Rules; onChange: (e: Employment) => void }) {
  const e = props.emp;
  const [state, setState] = useState(e.location?.state ?? '');
  const [city, setCity] = useState(e.location?.city ?? '');
  const guess = e.location?.source === 'guess';
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>Where do you work at {e.name || 'this job'}?</strong> Professional tax depends on the state
        {guess ? `. Your letter mentions ${e.location!.city ?? STATES[e.location!.state!]}; is that where you work?` : '.'}
      </p>
      <div class="grid2">
        <Field label="State">
          <StateSelect value={state} onChange={setState} label={`State for ${e.name}`} />
        </Field>
        <Field label="City (optional)">
          <input class="text" value={city} onInput={(ev) => setCity((ev.target as HTMLInputElement).value)} aria-label={`City for ${e.name}`} />
        </Field>
      </div>
      {state && <p class="muted small">{ptSummary({ ...e, location: { state, source: 'user' } }, props.rules)}</p>}
      <button type="button" class="btn small primary" disabled={!state} onClick={() => props.onChange({ ...e, location: { state, city: city || undefined, source: 'user' } })}>
        {guess && state === e.location?.state ? 'Yes, that’s right' : 'Use this'}
      </button>
    </div>
  );
}

/** On the job screen: work location (PT) and how a mid-year PF rise is paid for. */
export function LocationCard(props: { emp: Employment; rules: Rules; onChange: (e: Employment) => void }) {
  const e = props.emp;
  return (
    <div class="card">
      <h3>Where you work</h3>
      <div class="grid2">
        <Field label="State" hint={ptSummary(e, props.rules)}>
          <StateSelect value={e.location?.state ?? ''} onChange={(v) => props.onChange({ ...e, location: v ? { ...(e.location ?? {}), state: v, source: 'user' } : undefined })} label="Work state" />
        </Field>
        <Field label="City">
          <input
            class="text"
            value={e.location?.city ?? ''}
            aria-label="Work city"
            onInput={(ev) => props.onChange({ ...e, location: { ...(e.location ?? { source: 'user' }), city: (ev.target as HTMLInputElement).value || undefined, source: 'user' } })}
          />
        </Field>
      </div>
      {e.structure.epfMode === 'statutory' && (
        <Field label="When the PF wage ceiling goes up" hint="Your PF rises with it. If PF is part of your CTC, most employers keep the CTC the same and pay their extra PF out of your special or miscellaneous allowance.">
          <Segmented
            ariaLabel="Employer's extra PF"
            value={pfRiseMode(e)}
            onChange={(v) => props.onChange({ ...e, pfRise: v as 'allowance' | 'employer' })}
            options={[
              { value: 'allowance', label: 'Comes out of my allowance' },
              { value: 'employer', label: 'Employer pays it on top' },
            ]}
          />
        </Field>
      )}
    </div>
  );
}
