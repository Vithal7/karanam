import { useState } from 'preact/hooks';
import { monthName } from '../domain/fy';
import { epfFor, fixedMonthly, monthlyPt, ptRuleFor } from '../domain/schedule';
import { ptSummary } from './Location';
import type { EpfMode, Employment, OneTime, OneTimeKind, Structure } from '../domain/types';
import { rulesFor } from '../rules';
import { rs, uid } from '../format';
import type { FieldMarks } from '../state';
import { useRules } from './rulesContext';
import { Field, Money, MonthInput, Percent, Segmented, Toggle } from './controls';

type Period = 'm' | 'y';

export function StructureEditor(props: { value: Structure; onChange: (s: Structure) => void; marks?: FieldMarks; sources?: Record<string, string>; month?: string; /** The job: its state decides professional tax. */ emp?: Employment }) {
  const [period, setPeriod] = useState<Period>('m');
  const rules = useRules();
  const src = props.sources ?? {};
  const s = props.value;
  const m = props.marks ?? {};
  const set = (patch: Partial<Structure>) => props.onChange({ ...s, ...patch });
  const scale = period === 'y' ? 12 : 1;
  const per = period === 'y' ? 'a year' : 'a month';
  const total = fixedMonthly(s);
  return (
    <div class="card">
      <div class="card-head">
        <h3>Fixed salary</h3>
        <Segmented
          ariaLabel="Enter amounts per"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'm', label: 'Monthly' },
            { value: 'y', label: 'Yearly' },
          ]}
        />
      </div>
      <Field label="Basic" mark={m.basic} hint={src.basic && `From ${src.basic}`}>
        <Money value={s.basic} scale={scale} onChange={(v) => set({ basic: v })} ariaLabel={`Basic ${per}`} />
      </Field>
      <Field label="HRA" mark={m.hra} hint={src.hra && `From ${src.hra}`}>
        <Money value={s.hra} scale={scale} onChange={(v) => set({ hra: v })} ariaLabel={`HRA ${per}`} />
      </Field>
      <Field label="Special / flexi allowance" mark={m.special} hint={src.special ? `From ${src.special}` : 'Whatever balances the fixed pay: special, flexi, misc or personal allowance.'}>
        <Money value={s.special} scale={scale} onChange={(v) => set({ special: v })} ariaLabel={`Special allowance ${per}`} />
      </Field>
      {s.others.map((o, i) => (
        <div class="row-edit">
          <input
            class="text"
            aria-label="Allowance name"
            value={o.name}
            onInput={(e) => set({ others: s.others.map((x, j) => (j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x)) })}
          />
          <Money value={o.amount} scale={scale} onChange={(v) => set({ others: s.others.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} ariaLabel={`${o.name} ${per}`} />
          <button type="button" class="btn icon" aria-label={`Remove ${o.name}`} onClick={() => set({ others: s.others.filter((_, j) => j !== i) })}>
            ×
          </button>
        </div>
      ))}
      <button type="button" class="btn link" onClick={() => set({ others: [...s.others, { name: 'Other allowance', amount: 0 }] })}>
        + Add another allowance
      </button>
      <div class="subtotal">
        <span>Fixed gross pay</span>
        <span class="num">
          {rs(total)}/mo · {rs(total * 12)}/yr
        </span>
      </div>

      <h3 class="mt">Taken out of your pay</h3>
      <Field label="Your PF contribution" mark={m.epf} hint={epfHint(s, rules)}>
        <Segmented<EpfMode>
          ariaLabel="How PF is worked out"
          value={s.epfMode}
          onChange={(v) => set({ epfMode: v, epf: v === 'fixed' && !s.epf ? Math.round(epfFor(s, props.month ?? '', rules)) : s.epf })}
          options={[
            { value: 'statutory', label: 'As per law' },
            { value: 'fullBasic', label: '12% of basic' },
            { value: 'fixed', label: 'Fixed' },
          ]}
        />
        {s.epfMode === 'fixed' && <Money value={s.epf} onChange={(v) => set({ epf: v })} ariaLabel="Employee PF per month" />}
      </Field>
      {props.emp && ptRuleFor(props.emp, rules) !== undefined ? (
        <Field label="Professional tax" hint="Set by the state you work in. Change the state under “Where you work”.">
          <p class="note">
            {rs(monthlyPt(props.emp, s, rules))} a month on average. {ptSummary(props.emp, rules)}
          </p>
        </Field>
      ) : (
        <Field label="Professional tax (per month)" mark={m.pt} hint="Set your state under “Where you work” and it's worked out for you. ₹200 in most states; ₹0 in Delhi, Haryana, UP.">
          <Money value={s.pt} onChange={(v) => set({ pt: v })} ariaLabel="Professional tax per month" />
        </Field>
      )}
      <Field label="Employer NPS (% of basic)" mark={m.nps} hint={`Saves tax under 80CCD(2), up to ${Math.round(rulesFor(rules, 9999).npsCapPctOfBasic * 100)}% of basic.`}>
        <Percent value={s.npsPct} onChange={(v) => set({ npsPct: v })} ariaLabel="Employer NPS percent of basic" />
      </Field>
      {s.npsPct > 0 && (
        <Toggle
          checked={s.npsInGross}
          onChange={(v) => set({ npsInGross: v })}
          label={
            <>
              NPS is taken out of the salary above <span class="muted">(you opted to move part of your allowance into NPS)</span>
            </>
          }
        />
      )}
    </div>
  );
}

const KIND_LABEL: Record<OneTimeKind, string> = {
  joining: 'Joining bonus',
  variable: 'Variable pay',
  bonus: 'Bonus',
  leaveEncashment: 'Leave encashment',
  buyout: 'Notice buyout',
  other: 'Other payment',
};

export function OneTimeEditor(props: { items: OneTime[]; onChange: (o: OneTime[]) => void; defaultMonth: string; addLabel?: string }) {
  const set = (i: number, patch: Partial<OneTime>) => props.onChange(props.items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div>
      {props.items.map((o, i) => (
        <div class="onetime">
          <div class="row-edit">
            <input class="text" aria-label="What is it" value={o.label} onInput={(e) => set(i, { label: (e.target as HTMLInputElement).value })} />
            <button type="button" class="btn icon" aria-label={`Remove ${o.label}`} onClick={() => props.onChange(props.items.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
          <div class="grid2">
            <Field label="Amount">
              <Money value={o.amount} onChange={(v) => set(i, { amount: v })} ariaLabel={`${o.label} amount`} />
            </Field>
            <Field label="Paid in">
              <MonthInput value={o.month} onChange={(v) => set(i, { month: v })} ariaLabel={`${o.label} month`} />
            </Field>
          </div>
          <Toggle checked={!o.taxable} onChange={(v) => set(i, { taxable: !v })} label="Tax-free (e.g. a reimbursement)" />
        </div>
      ))}
      <button
        type="button"
        class="btn link"
        onClick={() => props.onChange([...props.items, { id: uid(), label: 'Other payment', kind: 'other', amount: 0, month: props.defaultMonth, taxable: true }])}
      >
        {props.addLabel ?? '+ Add a one-time payment'}
      </button>
    </div>
  );
}

/** Offer-level extras: CTC, joining bonus, variable pay. */
export function OfferExtras(props: { emp: Employment; onChange: (e: Employment) => void; marks?: FieldMarks }) {
  const e = props.emp;
  const m = props.marks ?? {};
  const joining = e.oneTimes.find((o) => o.kind === 'joining');
  const setJoining = (patch: Partial<OneTime> | null) => {
    const rest = e.oneTimes.filter((o) => o.kind !== 'joining');
    if (patch === null) return props.onChange({ ...e, oneTimes: rest });
    const base: OneTime = joining ?? { id: 'joining', label: KIND_LABEL.joining, kind: 'joining', amount: 0, month: e.start.slice(0, 7), taxable: true };
    props.onChange({ ...e, oneTimes: [...rest, { ...base, ...patch }] });
  };
  const v = e.variable ?? { annual: 0, payoutPct: 1, prorate: true, month: '' };
  const setV = (patch: Partial<typeof v>) => props.onChange({ ...e, variable: { ...v, ...patch } });
  return (
    <div class="card">
      <h3>Bonuses and the headline number</h3>
      <Field label="CTC in the letter (per year)" mark={m.ctc} hint="Used only to compare against what you actually get.">
        <Money value={e.ctc} onChange={(x) => props.onChange({ ...e, ctc: x })} ariaLabel="CTC per year" />
      </Field>
      <div class="grid2">
        <Field label="Joining bonus">
          <Money value={joining?.amount ?? 0} onChange={(x) => (x ? setJoining({ amount: x }) : setJoining(null))} ariaLabel="Joining bonus" />
        </Field>
        <Field label="Paid in">
          <MonthInput value={joining?.month ?? e.start.slice(0, 7)} onChange={(x) => setJoining({ month: x })} ariaLabel="Joining bonus month" />
        </Field>
      </div>
      <div class="grid2">
        <Field label="Variable pay / PLI (full year target)" mark={m.variable}>
          <Money value={v.annual} onChange={(x) => setV({ annual: x })} ariaLabel="Variable pay per year" />
        </Field>
        <Field label="Expected payout">
          <Percent value={v.payoutPct} onChange={(x) => setV({ payoutPct: x })} ariaLabel="Expected variable payout percent" />
        </Field>
      </div>
      {v.annual > 0 && (
        <>
          <Field label="First variable payout month" hint="Many companies pay it after the year ends, e.g. April-June. If it falls after March it moves to next year.">
            <MonthInput value={v.month} onChange={(x) => setV({ month: x })} ariaLabel="Variable pay month" />
          </Field>
          <Toggle checked={v.prorate} onChange={(x) => setV({ prorate: x })} label="First payout is prorated for the part of the year you worked" />
        </>
      )}
    </div>
  );
}

/** "12% of basic up to ₹15,000 (₹1,800) until Aug 26, then up to ₹25,000 (₹3,000)". */
function epfHint(s: Structure, rules: ReturnType<typeof useRules>) {
  if (s.epfMode === 'fullBasic') return `₹${Math.round(rules.epf.rate * s.basic).toLocaleString('en-IN')} a month, 12% of full basic with no cap.`;
  if (s.epfMode === 'fixed') return 'The amount on your payslip.';
  const steps = [...rules.epf.wageCeiling].sort((a, b) => a.from.localeCompare(b.from)).slice(-2);
  const txt = steps
    .map((w) => {
      const amt = Math.round(rules.epf.rate * Math.min(s.basic, w.amount));
      return `₹${amt.toLocaleString('en-IN')} from ${monthName(w.from.slice(0, 7))} (wage ceiling ₹${w.amount.toLocaleString('en-IN')})`;
    })
    .join(', ');
  return `12% of basic, capped at the EPF wage ceiling: ${txt}.`;
}
