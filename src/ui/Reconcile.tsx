import { reconcile } from '../domain/reconcile';
import type { Employment, Structure } from '../domain/types';
import { rs } from '../format';
import { useRules } from './rulesContext';

/**
 * CTC minus what never reaches the payslip (employer PF, gratuity, insurance, variable) should
 * equal 12 × fixed gross. A gap is almost always an allowance we didn't read.
 */
export function ReconcileCard(props: { emp: Employment; structure: Structure; month: string; onAddAllowance: (monthly: number) => void }) {
  const rules = useRules();
  const r = reconcile(props.emp, props.structure, props.month, rules);
  if (!r) return null;
  return (
    <div class={`card reconcile ${r.ok ? 'ok' : 'off'}`}>
      <h3>{r.ok ? 'Your breakup adds up to your CTC' : "Your breakup doesn't add up to your CTC"}</h3>
      <dl class="kv">
        <dt>CTC ÷ 12</dt>
        <dd class="num">{rs(r.ctc / 12)}</dd>
        <dt>− Employer PF{r.employerPfFromLetter ? '' : ' (12% of basic up to the ceiling)'}</dt>
        <dd class="num">{rs(r.employerPf)}</dd>
        {r.gratuity > 0 && (
          <>
            <dt>− Gratuity{r.gratuityFromLetter ? '' : ' (4.81% of basic)'}</dt>
            <dd class="num">{rs(r.gratuity)}</dd>
          </>
        )}
        {r.insurance > 0 && (
          <>
            <dt>− Insurance</dt>
            <dd class="num">{rs(r.insurance)}</dd>
          </>
        )}
        {r.npsOnTop > 0 && (
          <>
            <dt>− Employer NPS</dt>
            <dd class="num">{rs(r.npsOnTop)}</dd>
          </>
        )}
        {r.variable > 0 && (
          <>
            <dt>− Variable pay ÷ 12</dt>
            <dd class="num">{rs(r.variable)}</dd>
          </>
        )}
        <dt class="strong">Should be paid monthly</dt>
        <dd class="num strong">{rs(r.impliedMonthly)}</dd>
        <dt>Your breakup (fixed gross)</dt>
        <dd class="num">{rs(r.fixedMonthly)}</dd>
        {!r.ok && (
          <>
            <dt class="strong">{r.gap > 0 ? 'Missing each month' : 'Extra each month'}</dt>
            <dd class="num strong bad">{rs(Math.abs(r.gap))}</dd>
          </>
        )}
      </dl>
      {!r.ok && r.gap > 0 && (
        <>
          <p class="note">
            Likely an allowance we didn't read: miscellaneous, fixed, dearness, or one named after the company. Check the letter and add it above, or add the gap as one
            allowance.
          </p>
          <button type="button" class="btn small" onClick={() => props.onAddAllowance(Math.round(r.gap))}>
            Add {rs(r.gap)} a month as "Other allowance"
          </button>
        </>
      )}
      {!r.ok && r.gap < 0 && (
        <p class="note">
          The breakup is more than the CTC allows. A yearly figure may have been read as monthly, a row counted twice, or the CTC may not include gratuity or PF. Check
          each amount against the letter.
        </p>
      )}
    </div>
  );
}
