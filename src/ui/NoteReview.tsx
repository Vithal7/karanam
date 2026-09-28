/**
 * "Here's what I read": every record taken from text you typed or pasted, shown with the figures
 * read from it, each editable. Nothing from your own words is used silently: you check it once.
 */
import { useState } from 'preact/hooks';
import type { Buyout, DocRecord, Facts } from '../domain/types';
import { rs } from '../format';
import { DateInput, Field, Money, MonthInput, Num, Percent, Segmented, Toggle } from './controls';

const ROLE_TITLE: Record<string, string> = {
  offer: 'The offer',
  alternative: 'Another offer',
  current: 'Your job now',
  exit: 'Leaving your job',
  hike: 'A hike',
};

const long = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** A record from your note that you haven't checked yet. */
export const needsReview = (d: DocRecord) => !!d.typed && !!d.noteRole && !d.confirmed;

export function NoteReview(props: { doc: DocRecord; jobName: string; onSave: (patch: Partial<DocRecord>) => void }) {
  const d0 = props.doc;
  const [d, setD] = useState<DocRecord>(d0);
  const f = d.fields;
  const x: Facts = d.facts ?? {};
  const setF = (k: string, v: number) => setD({ ...d, fields: v ? { ...f, [k]: v } : Object.fromEntries(Object.entries(f).filter(([kk]) => kk !== k)) });
  const setX = (patch: Partial<Facts>) => setD({ ...d, facts: { ...x, ...patch } });
  const role = d.noteRole ?? 'offer';
  const guess = x.yearGuess;
  const isPay = d.kind === 'offer';
  const others = Object.entries(f).filter(([k]) => k.startsWith('other:'));
  // A date written without a year: the choices sit next to the field.
  const yearPick = (field: NonNullable<Facts['yearGuess']>['field']) =>
    guess?.field === field && (
      <span class="year-pick small">
        Which year?{' '}
        {[...guess.options].sort().map((o) => (
          <button type="button" class="btn link inline" onClick={() => setD(field === 'doj' ? { ...d, doj: o, facts: { ...x, yearGuess: undefined } } : { ...d, facts: { ...x, [field]: o, yearGuess: undefined } })}>
            {long(o)}
          </button>
        ))}
      </span>
    );
  return (
    <div class="callout ask exit-q note-review">
      <p>
        <strong>
          Here's what I read from your note: {ROLE_TITLE[role] ?? 'A record'}
          {d.employer ? ` (${d.employer})` : props.jobName ? ` (${props.jobName})` : ''}
        </strong>
        . Correct anything that's wrong, and fill in what's missing if you know it.
      </p>
      <div class="grid2">
        <Field label="Company">
          <input class="text" value={d.employer ?? ''} placeholder={props.jobName} onInput={(ev) => setD({ ...d, employer: (ev.target as HTMLInputElement).value || undefined })} aria-label="Company" />
        </Field>
        {isPay && (
          <Field label={role === 'current' ? 'Joined on' : 'Joining date'}>
            <DateInput value={d.doj ?? ''} onChange={(v) => setD({ ...d, doj: v || undefined, facts: { ...x, yearGuess: guess?.field === 'doj' ? undefined : guess } })} ariaLabel="Joining date" />
            {yearPick('doj')}
          </Field>
        )}
      </div>

      {isPay && (
        <>
          <div class="grid2">
            <Field label="CTC (a year)">
              <Money value={f.ctc ?? 0} onChange={(v) => setF('ctc', v)} ariaLabel="CTC per year" />
            </Field>
            <Field label="Fixed pay (a year)" hint="CTC without variable pay, if you gave it.">
              <Money value={f.fixed ?? 0} onChange={(v) => setF('fixed', v)} ariaLabel="Fixed pay per year" />
            </Field>
          </div>
          <div class="grid2">
            <Field label="Basic (a month)">
              <Money value={f.basic ?? 0} onChange={(v) => setF('basic', v)} ariaLabel="Basic per month" />
            </Field>
            <Field label="HRA (a month)">
              <Money value={f.hra ?? 0} onChange={(v) => setF('hra', v)} ariaLabel="HRA per month" />
            </Field>
          </div>
          <div class="grid2">
            <Field label="Special allowance (a month)">
              <Money value={f.special ?? 0} onChange={(v) => setF('special', v)} ariaLabel="Special allowance per month" />
            </Field>
            <Field label="Variable pay (a year)">
              <Money value={f.variable ?? 0} onChange={(v) => setF('variable', v)} ariaLabel="Variable pay per year" />
            </Field>
          </div>
          {others.map(([k, v]) => (
            <Field label={`${k.slice(6)} (a month)`}>
              <Money value={v} onChange={(nv) => setF(k, nv)} ariaLabel={k.slice(6)} />
            </Field>
          ))}
          {role !== 'current' && (
            <>
              <div class="grid2">
                <Field label="Joining bonus">
                  <Money value={f.joining ?? 0} onChange={(v) => setF('joining', v)} ariaLabel="Joining bonus" />
                </Field>
                <Field label="Paid with salary no." hint="1 = the first month's salary.">
                  <Num value={f.joiningOffset !== undefined ? f.joiningOffset + 1 : 0} onChange={(v) => setD({ ...d, fields: v ? { ...f, joiningOffset: v - 1 } : Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'joiningOffset')) })} ariaLabel="Joining bonus paid with salary number" />
                </Field>
              </div>
              <div class="grid2">
                <Field label="Relocation">
                  <Money value={x.relocation?.amount ?? 0} onChange={(v) => setX({ relocation: v ? { amount: v, reimbursement: x.relocation?.reimbursement ?? false } : undefined })} ariaLabel="Relocation amount" />
                </Field>
                {x.relocation?.amount ? (
                  <Toggle checked={x.relocation.reimbursement} onChange={(v) => setX({ relocation: { ...x.relocation!, reimbursement: v } })} label="Reimbursed against bills (tax-free)" />
                ) : (
                  <span />
                )}
              </div>
              <Field label="Notice buyout by this employer">
                <Segmented<Buyout['mode']>
                  ariaLabel="Notice buyout"
                  value={x.buyout?.mode ?? 'none'}
                  onChange={(v) => setX({ buyout: v === 'none' ? undefined : { ...(x.buyout ?? {}), mode: v } })}
                  options={[
                    { value: 'none', label: 'Not said' },
                    { value: 'actuals', label: 'In full' },
                    { value: 'cap', label: 'Up to a limit' },
                  ]}
                />
                {x.buyout?.mode === 'cap' && <Money value={x.buyout.cap ?? 0} onChange={(v) => setX({ buyout: { ...x.buyout!, cap: v } })} ariaLabel="Buyout limit" />}
              </Field>
              {x.buyout && <Toggle checked={!!x.buyout.includesClawback} onChange={(v) => setX({ buyout: { ...x.buyout!, includesClawback: v } })} label="It also covers the joining bonus you repay" />}
            </>
          )}
        </>
      )}

      {role === 'exit' && (
        <>
          <div class="grid2">
            <Field label="Resigned on">
              <DateInput value={x.resignationDate ?? ''} onChange={(v) => setX({ resignationDate: v || undefined })} ariaLabel="Resigned on" />
            </Field>
            <Field label="Last working day">
              <DateInput value={x.lastWorkingDay ?? ''} onChange={(v) => setX({ lastWorkingDay: v || undefined, yearGuess: guess?.field === 'lastWorkingDay' ? undefined : guess })} ariaLabel="Last working day" />
              {yearPick('lastWorkingDay')}
            </Field>
          </div>
          <div class="grid2">
            <Field label="Leave balance">
              <Num value={x.leaveDays ?? 0} onChange={(v) => setX({ leaveDays: v || undefined })} suffix="days" ariaLabel="Leave days" />
            </Field>
            <Field label="Notice period">
              <Num value={x.noticeDays ?? 0} onChange={(v) => setX({ noticeDays: v || undefined, noticeMonths: undefined })} suffix="days" ariaLabel="Notice period" />
            </Field>
          </div>
        </>
      )}

      {d.kind === 'appraisal' && (
        <>
          <div class="grid2">
            <Field label={x.currentCtc ? 'Your CTC now (a year)' : 'New CTC (a year)'}>
              <Money value={x.revisedCtc ?? 0} onChange={(v) => setX({ revisedCtc: v || undefined })} ariaLabel="New CTC" />
            </Field>
            <Field label="Applies from" hint={x.currentCtc ? 'The month this pay started, if it changed.' : undefined}>
              <MonthInput value={(x.effectiveFrom ?? '').slice(0, 7)} onChange={(v) => setX({ effectiveFrom: v ? `${v}-01` : undefined })} ariaLabel="Applies from" />
            </Field>
          </div>
          {!x.currentCtc && (
            <div class="grid2">
              <Field label="Or hike %">
                <Percent value={x.incrementPct ?? 0} onChange={(v) => setX({ incrementPct: v || undefined })} ariaLabel="Hike percent" />
              </Field>
              <Field label="Or amount added (a year)">
                <Money value={x.incrementAmount ?? 0} onChange={(v) => setX({ incrementAmount: v || undefined })} ariaLabel="Hike amount" />
              </Field>
            </div>
          )}
        </>
      )}

      {isPay && !f.basic && f.ctc ? <p class="muted small">No breakup given: a typical split of {rs(f.fixed ?? f.ctc)} is used until you add basic.</p> : null}
      <div class="tl-actions">
        <button type="button" class="btn small primary" onClick={() => props.onSave({ ...d, confirmed: true })}>
          Looks right
        </button>
      </div>
    </div>
  );
}
