/**
 * Questions for the company you're joining: employer NPS (carry it over from your last job or
 * not), notice buyout, and relocation support. Offer letters often leave these out.
 */
import { useState } from 'preact/hooks';
import { fnfItems } from '../domain/compute';
import { fyStart, maxDate, monthOf, addMonths } from '../domain/fy';
import type { Buyout, Employment, Scenario, Structure } from '../domain/types';
import { rs } from '../format';
import { isNote } from '../extract/note';
import { rulesFor, type Rules } from '../rules';
import { Choices, Field, Money, MonthInput, Percent, Segmented, Toggle } from './controls';

/** The job you're joining: the last one, when it's a switch or it starts this year. */
export const isJoining = (s: Scenario, k: number) => {
  const e = s.employers[k];
  return !!e && !e.totalsOnly && k === s.employers.length - 1 && (k > 0 || e.start >= fyStart(s.fy));
};

/** The salary a job ends on (its latest hike, else its joining salary). */
const latest = (e: Employment): Structure => (e.revisions.length ? [...e.revisions].sort((a, b) => a.from.localeCompare(b.from))[e.revisions.length - 1].structure : e.structure);

/** The last earlier job that paid employer NPS, if any. */
export function prevNps(s: Scenario, k: number): { emp: Employment; st: Structure } | null {
  for (let i = k - 1; i >= 0; i--) {
    const e = s.employers[i];
    if (e.totalsOnly) continue;
    const st = latest(e);
    if (st.npsPct > 0) return { emp: e, st };
  }
  return null;
}

export const needsNps = (s: Scenario, k: number) => {
  const e = s.employers[k];
  return isJoining(s, k) && !e.asked?.nps && !e.docs.some((d) => d.fields.nps !== undefined);
};
export const needsBuyout = (s: Scenario, k: number) => {
  const e = s.employers[k];
  // Asked even when the letter or your note states it: you confirm what was read.
  return isJoining(s, k) && k > 0 && !s.employers[k - 1].totalsOnly && !e.asked?.buyout;
};
export const needsRelocation = (s: Scenario, k: number) => isJoining(s, k) && !s.employers[k].asked?.relocation;

/** Set employer NPS on the joining salary and every hike after it. */
const withNps = (e: Employment, pct: number, inGross: boolean): Employment => ({
  ...e,
  structure: { ...e.structure, npsPct: pct, npsInGross: inGross },
  revisions: e.revisions.map((r) => ({ ...r, structure: { ...r.structure, npsPct: pct, npsInGross: inGross } })),
  asked: { ...e.asked, nps: true },
});

const pctLabel = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** Employer NPS at the new job: continue what you had at the last one, change it, or stop. */
export function NpsQuestion(props: { s: Scenario; k: number; rules: Rules; onChange: (e: Employment) => void }) {
  const e = props.s.employers[props.k];
  const prev = prevNps(props.s, props.k);
  const cap = rulesFor(props.rules, props.s.fy).npsCapPctOfBasic;
  const [ans, setAns] = useState<'same' | 'yes' | 'no' | null>(null);
  const [pct, setPct] = useState(prev?.st.npsPct ?? Math.min(0.1, cap));
  const [inGross, setInGross] = useState(prev?.st.npsInGross ?? true);
  const name = e.name || 'your new job';
  return (
    <div class="callout ask exit-q">
      <p>
        {prev ? (
          <>
            <strong>
              You have employer NPS at {prev.emp.name || 'your last job'} ({pctLabel(prev.st.npsPct)} of basic). Will you continue it at {name}?
            </strong>{' '}
          </>
        ) : (
          <>
            <strong>Will {name} put employer NPS in your pay?</strong> Many companies let you move part of your allowance into NPS after you join, even if the offer letter doesn't
            mention it.{' '}
          </>
        )}
        Employer NPS up to {pctLabel(cap)} of basic is tax-free under 80CCD(2) in the new regime.
      </p>
      <Choices<'same' | 'yes' | 'no'>
        value={ans}
        onChange={(v) => {
          setAns(v);
          if (v === 'no') props.onChange(withNps(e, 0, false));
          if (v === 'same' && prev) props.onChange(withNps(e, prev.st.npsPct, prev.st.npsInGross));
        }}
        options={
          prev
            ? [
                { value: 'same', label: `Yes, same ${pctLabel(prev.st.npsPct)}` },
                { value: 'yes', label: 'Yes, a different %' },
                { value: 'no', label: 'No, stop NPS' },
              ]
            : [
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: "No / don't know" },
              ]
        }
      />
      {ans === 'yes' && (
        <>
          <Field label="Employer NPS (% of basic)" hint={pct > cap ? `Only ${pctLabel(cap)} of basic is tax-free; the rest is taxed.` : undefined}>
            <Percent value={pct} onChange={setPct} ariaLabel="Employer NPS percent of basic" />
          </Field>
          <Field label="Where it comes from">
            <Segmented<'gross' | 'top'>
              ariaLabel="Where NPS comes from"
              value={inGross ? 'gross' : 'top'}
              onChange={(v) => setInGross(v === 'gross')}
              options={[
                { value: 'gross', label: 'Out of my salary (CTC same)' },
                { value: 'top', label: 'Employer pays on top' },
              ]}
            />
          </Field>
          <button type="button" class="btn small primary" disabled={!pct} onClick={() => props.onChange(withNps(e, pct, inGross))}>
            Use this
          </button>
        </>
      )}
    </div>
  );
}

/** Does the new employer pay back what the old one recovers for the notice you don't serve? */
export function BuyoutQuestion(props: { s: Scenario; k: number; onChange: (e: Employment) => void }) {
  const e = props.s.employers[props.k];
  const prev = props.s.employers[props.k - 1];
  const pf = fnfItems(prev, props.s.fy, props.s.settings.thirtyDayMonth);
  const owed = pf ? pf.noticeRecovery : 0;
  const claw = pf ? pf.clawback : 0;
  const fromDoc = e.docs.some((d) => d.facts?.buyout) ? e.buyout : undefined;
  const [mode, setMode] = useState<Buyout['mode'] | null>(fromDoc?.mode ?? null);
  const [cap, setCap] = useState(fromDoc?.cap ?? 0);
  const [incl, setIncl] = useState(!!fromDoc?.includesClawback);
  const save = (b: Buyout) => props.onChange({ ...e, buyout: { ...e.buyout, ...b }, asked: { ...e.asked, buyout: true } });
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>Will {e.name || 'your new employer'} pay a notice buyout?</strong>{' '}
        {owed || claw
          ? `${prev.name || 'Your current employer'} recovers ${rs(owed)} for the notice you don't serve${claw ? ` and ${rs(claw)} of bonus clawback` : ''}.`
          : 'If you leave before your notice ends, the new employer may pay back what your old one recovers.'}
        {fromDoc && fromDoc.mode !== 'none' && (
          <>
            {' '}
            <strong>
              Your {e.docs.some((d) => d.facts?.buyout && isNote(d.text ?? '')) ? 'note' : 'offer'} says: {fromDoc.mode === 'cap' && fromDoc.cap ? `up to ${rs(fromDoc.cap)}` : 'in full'}
              {fromDoc.includesClawback ? ', including the bonus you repay' : ''}.
            </strong>{' '}
            Confirm or change it.
          </>
        )}
      </p>
      <Choices<Buyout['mode']>
        value={mode}
        onChange={(v) => {
          setMode(v);
          if (v === 'none') save({ mode: v });
        }}
        options={[
          { value: 'none', label: 'No' },
          { value: 'actuals', label: 'Yes, in full' },
          { value: 'cap', label: 'Yes, up to a limit' },
        ]}
      />
      {mode && mode !== 'none' && <Toggle checked={incl} onChange={setIncl} label={`It also covers the joining bonus you repay${claw ? ` (${rs(claw)})` : ''}`} />}
      {mode === 'actuals' && (
        <button type="button" class="btn small primary" onClick={() => save({ mode: 'actuals', includesClawback: incl })}>
          Use this
        </button>
      )}
      {mode === 'cap' && (
        <div class="grid2">
          <Field label="Limit">
            <Money value={cap} onChange={setCap} ariaLabel="Buyout limit" />
          </Field>
          <div class="q-action">
            <button type="button" class="btn small primary" disabled={!cap} onClick={() => save({ mode: 'cap', cap, includesClawback: incl })}>
              Use this
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Relocation support: a reimbursement of moving costs is tax-free; a fixed allowance is salary. */
export function RelocationQuestion(props: { s: Scenario; k: number; onChange: (e: Employment) => void }) {
  const e = props.s.employers[props.k];
  const found = [...e.docs].reverse().find((d) => d.facts?.relocation)?.facts?.relocation;
  const existing = e.oneTimes.find((o) => o.id === 'relocation');
  const [ans, setAns] = useState<'no' | 'reimb' | 'lump' | null>(existing ? (existing.taxable ? 'lump' : 'reimb') : found?.amount ? (found.reimbursement ? 'reimb' : 'lump') : null);
  const [amount, setAmount] = useState(existing?.amount ?? found?.amount ?? 0);
  const [month, setMonth] = useState(existing?.month ?? addMonths(monthOf(maxDate(e.start || props.s.today, props.s.today)), 1));
  const save = (kind: 'no' | 'reimb' | 'lump') => {
    const rest = e.oneTimes.filter((o) => o.id !== 'relocation');
    const add =
      kind === 'no'
        ? []
        : [
            kind === 'reimb'
              ? { id: 'relocation', label: 'Relocation reimbursement', kind: 'other' as const, amount, month, taxable: false }
              : { id: 'relocation', label: 'Relocation allowance', kind: 'bonus' as const, amount, month, taxable: true },
          ];
    props.onChange({ ...e, oneTimes: [...rest, ...add], asked: { ...e.asked, relocation: true } });
  };
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>Does {e.name || 'your new employer'} give relocation support?</strong>{' '}
        {found ? `Your ${e.docs.some((d) => d.facts?.relocation && isNote(d.text ?? '')) ? 'note' : 'offer letter'} mentions relocation${found.amount ? ` (${rs(found.amount)})` : ''}${found.reimbursement ? ', reimbursed against bills' : ''}. ` : ''}
        Moving costs reimbursed against bills (travel, packing, transport) are tax-free; a fixed relocation allowance or bonus is taxed like salary.
      </p>
      <Choices<'no' | 'reimb' | 'lump'>
        value={ans}
        onChange={(v) => {
          setAns(v);
          if (v === 'no') save('no');
        }}
        options={[
          { value: 'no', label: 'No' },
          { value: 'reimb', label: 'Yes, reimbursed against bills', sub: 'Tax-free' },
          { value: 'lump', label: 'Yes, a fixed amount', sub: 'Taxable' },
        ]}
      />
      {ans && ans !== 'no' && (
        <>
          <div class="grid2">
            <Field label={ans === 'reimb' ? 'Amount you expect to claim' : 'Amount'}>
              <Money value={amount} onChange={setAmount} ariaLabel="Relocation amount" />
            </Field>
            <Field label="Paid in">
              <MonthInput value={month} onChange={setMonth} ariaLabel="Relocation paid in" />
            </Field>
          </div>
          {ans === 'lump' && <p class="muted small">If the letter says it's repayable when you leave early, set that under "Check the numbers" when you leave.</p>}
          <button type="button" class="btn small primary" disabled={!amount || !month} onClick={() => save(ans)}>
            Use this
          </button>
        </>
      )}
    </div>
  );
}
