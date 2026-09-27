import { useState } from 'preact/hooks';
import { fyLabel, fyMonths, fyStart, monthOf } from '../domain/fy';
import type { Employment } from '../domain/types';
import { rs } from '../format';
import { Field, Money, MonthInput } from './controls';

/** Was a variable pay or bonus already recorded for this FY (from files or by you)? */
export const variablePaidThisYear = (e: Employment, fy: number) => {
  const months = new Set(fyMonths(fy));
  return e.oneTimes.some((o) => months.has(o.month) && (o.kind === 'variable' || /bonus|variable|incentive|pli|performance/i.test(o.label)) && o.kind !== 'joining');
};

/** Last year's variable pay is usually paid this year: ask for it, don't assume or ignore it. */
export function needsPrevVariable(e: Employment, fy: number) {
  return !e.totalsOnly && !e.prevVariable && !!e.start && e.start < fyStart(fy) && !variablePaidThisYear(e, fy);
}

export function PrevVariableQuestion(props: { emp: Employment; fy: number; onChange: (e: Employment) => void }) {
  const e = props.emp;
  const target = e.variable?.annual ?? 0;
  const [amount, setAmount] = useState(target);
  const [month, setMonth] = useState(`${props.fy}-07`);
  const last = fyLabel(props.fy - 1);
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>Was your {last} variable pay or bonus paid this year?</strong> Last year's bonus is usually paid in June or July, based on your rating
        {target ? `. Your letter's target is ${rs(target)} a year.` : '.'}
      </p>
      <div class="grid2">
        <Field label="Amount paid (or expected)">
          <Money value={amount} onChange={setAmount} ariaLabel="Last year's variable pay amount" />
        </Field>
        <Field label="Paid in">
          <MonthInput value={month} onChange={setMonth} ariaLabel="Last year's variable pay month" />
        </Field>
      </div>
      <div class="overlap-actions">
        <button
          type="button"
          class="btn small primary"
          disabled={!amount || !month}
          onClick={() =>
            props.onChange({
              ...e,
              prevVariable: 'paid',
              oneTimes: [
                ...e.oneTimes.filter((o) => o.id !== 'prev-variable'),
                { id: 'prev-variable', label: `Variable pay ${last}`, kind: 'bonus', amount, month: monthOf(`${month}-01`), taxable: true },
              ],
            })
          }
        >
          Add this payment
        </button>
        <button type="button" class="btn small ghost" onClick={() => props.onChange({ ...e, prevVariable: 'no' })}>
          No bonus this year
        </button>
      </div>
    </div>
  );
}
