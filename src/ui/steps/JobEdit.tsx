import { fyStart, maxDate, monthOf } from '../../domain/fy';
import type { DocKind, Employment, OneTime, Scenario } from '../../domain/types';
import type { Choices } from '../../extract/merge';
import { rs } from '../../format';
import type { FieldMarks } from '../../state';
import { DateInput, Field, Money, MonthInput, Segmented, Warnings } from '../controls';
import { Continue } from '../Continue';
import { DocsPanel } from '../Docs';
import { OneTimeEditor, StructureEditor } from '../Editors';
import { ExitEditor, HikesEditor, JoiningEditor, VariableEditor } from '../JobSections';
import { ReconcileCard } from '../Reconcile';
import { TdsMonths } from '../TdsMonths';
import type { ReadFile } from '../Uploader';

/** Everything about one job: its files, salary and hikes, and how you joined or left it. */
export function JobEditStep(props: {
  s: Scenario;
  index: number;
  choices: Choices;
  marks: FieldMarks;
  sources: Record<string, string>;
  warnings: string[];
  notes: string[];
  tdsSoFar: number | null;
  ytdHint?: number;
  onChange: (e: Employment) => void;
  onTdsSoFar: (v: number | null) => void;
  onAddFiles: (f: ReadFile[]) => void;
  onRemoveDoc: (id: string) => void;
  onChoose: (field: string, choice: string) => void;
  onReclassify: (docId: string, kind: DocKind) => void;
  onDone: () => void;
}) {
  const { s, index } = props;
  const e = s.employers[index];
  const prev = s.employers[index - 1];
  const isNew = index === s.employers.length - 1;
  const thirty = s.settings.thirtyDayMonth;
  const set = (patch: Partial<Employment>) => props.onChange({ ...e, ...patch });
  const joining = e.oneTimes.find((o) => o.kind === 'joining');
  const setJoining = (patch: Partial<OneTime> | null) => {
    const rest = e.oneTimes.filter((o) => o.kind !== 'joining');
    if (patch === null) return set({ oneTimes: rest });
    const base: OneTime = joining ?? { id: 'joining', label: 'Joining bonus', kind: 'joining', amount: 0, month: monthOf(e.start || s.today), taxable: true };
    set({ oneTimes: [...rest, { ...base, ...patch }] });
  };

  return (
    <>
      <div class="card">
        <Field label="Company">
          <input id={`name-${e.id}`} class="text" value={e.name} onInput={(ev) => set({ name: (ev.target as HTMLInputElement).value })} />
        </Field>
        <Field
          label={isNew && e.start >= fyStart(s.fy) ? 'Date of joining' : 'Joined on'}
          mark={e.startSource === 'default' ? 'missing' : e.startSource === 'approx' ? 'guessed' : props.marks.start}
          hint={
            e.startSource === 'default'
              ? 'Not found in your letters. Enter your joining date.'
              : e.startSource === 'approx'
                ? "Taken from the letter's date; the joining date wasn't in it. Correct it if needed."
                : !isNew
                  ? 'An old date is fine: only this financial year is counted.'
                  : undefined
          }
        >
          <DateInput value={e.start} onChange={(v) => set({ start: v, startSource: 'user' })} ariaLabel="Joined on" />
        </Field>
        {!isNew && (
          <Segmented
            ariaLabel="How much do you know about this job"
            value={e.totalsOnly ? 'totals' : 'detail'}
            onChange={(v) => set({ totalsOnly: v === 'totals' ? e.totalsOnly ?? { gross: 0, tds: 0 } : undefined })}
            options={[
              { value: 'detail', label: 'I have letters or payslips' },
              { value: 'totals', label: 'I only know the totals' },
            ]}
          />
        )}
      </div>

      {props.notes.length > 0 && <Warnings items={props.notes} />}

      {e.totalsOnly ? (
        <div class="card">
          <Field label="Last working day">
            <DateInput value={e.end} onChange={(v) => set({ end: v })} ariaLabel="Last working day" />
          </Field>
          <Field label="Total gross salary from this job this FY" hint="Before deductions. Form 16 or the last payslip's year-to-date column has it.">
            <Money value={e.totalsOnly.gross} onChange={(v) => set({ totalsOnly: { ...e.totalsOnly!, gross: v } })} ariaLabel="Total gross salary" />
          </Field>
          <Field label="Total income tax (TDS) deducted">
            <Money value={e.totalsOnly.tds} onChange={(v) => set({ totalsOnly: { ...e.totalsOnly!, tds: v } })} ariaLabel="Total TDS" />
          </Field>
        </div>
      ) : (
        <>
          <DocsPanel emp={e} choices={props.choices} onAdd={props.onAddFiles} onRemove={props.onRemoveDoc} onChoose={props.onChoose} onReclassify={props.onReclassify} />
          <Warnings items={props.warnings} />
          <h2 class="section">Salary {e.revisions.length ? 'when you joined' : ''}</h2>
          <StructureEditor value={e.structure} marks={props.marks} sources={props.sources} month={monthOf(maxDate(e.start || fyStart(s.fy), fyStart(s.fy)))} onChange={(x) => set({ structure: x })} />
          <div class="card">
            <Field label="CTC (per year)" mark={props.marks.ctc} hint="From the letter. Used to size hikes given as a new CTC, and for the CTC vs in-hand comparison.">
              <Money value={e.ctc} onChange={(v) => set({ ctc: v })} ariaLabel="CTC per year" />
            </Field>
          </div>
          <ReconcileCard
            emp={e}
            structure={e.structure}
            month={monthOf(maxDate(e.start || fyStart(s.fy), fyStart(s.fy)))}
            onAddAllowance={(m) => set({ structure: { ...e.structure, others: [...e.structure.others, { name: 'Other allowance', amount: m }] } })}
          />
          <HikesEditor emp={e} fy={s.fy} thirty={thirty} onChange={props.onChange} today={s.today} />

          {(isNew || index > 0) && (
            <div class="card">
              <h3>Bonuses</h3>
              <div class="grid2">
                <Field label="Joining bonus">
                  <Money value={joining?.amount ?? 0} onChange={(x) => (x ? setJoining({ amount: x }) : setJoining(null))} ariaLabel="Joining bonus" />
                </Field>
                <Field label="Paid in">
                  <MonthInput value={joining?.month ?? monthOf(e.start || s.today)} onChange={(x) => setJoining({ month: x })} ariaLabel="Joining bonus month" />
                </Field>
              </div>
              {isNew && <VariableEditor emp={e} onChange={props.onChange} />}
              {isNew && <TdsMonths emp={e} s={s} onChange={props.onChange} />}
            </div>
          )}

          {!isNew && (
            <>
              <div class="card">
                <h3>Bonuses and tax this year</h3>
                <OneTimeEditor items={e.oneTimes.filter((o) => o.kind !== 'joining')} defaultMonth={monthOf(e.end || s.today)} onChange={(o) => set({ oneTimes: [...e.oneTimes.filter((x) => x.kind === 'joining'), ...o] })} addLabel="+ Add a bonus or incentive" />
                <Field
                  label="Income tax deducted here this year (optional)"
                  hint={props.ytdHint !== undefined ? `Your latest payslip shows ${rs(props.ytdHint)} year-to-date.` : "Year-to-date TDS from your last payslip. Leave empty and we'll estimate what payroll deducted."}
                >
                  <Money value={props.tdsSoFar ?? 0} onChange={(v) => props.onTdsSoFar(v || null)} ariaLabel="TDS so far" />
                </Field>
                <TdsMonths emp={e} s={s} onChange={props.onChange} />
              </div>
              <ExitEditor emp={e} fy={s.fy} thirty={thirty} onChange={props.onChange} />
            </>
          )}
        </>
      )}

      {prev && <JoiningEditor emp={e} prev={prev} fy={s.fy} thirty={thirty} onChange={props.onChange} />}

      <Continue label="Done" onClick={props.onDone} disabled={!e.totalsOnly && !e.structure.basic} why="Enter at least Basic, or switch to totals." />
    </>
  );
}
