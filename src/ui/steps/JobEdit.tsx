import { useState } from 'preact/hooks';
import { addMonths, fyLabel, fyStart, maxDate, monthLong, monthOf } from '../../domain/fy';
import { salaryNow } from '../../domain/reconcile';
import { fixedMonthly } from '../../domain/schedule';
import type { DocKind, Employment, OneTime, Revision, Scenario } from '../../domain/types';
import type { Choices } from '../../extract/merge';
import { rs } from '../../format';
import type { FieldMarks } from '../../state';
import { DateInput, Field, Money, MonthInput, Segmented, Warnings } from '../controls';
import { Continue } from '../Continue';
import { DocsPanel } from '../Docs';
import { OneTimeEditor, StructureEditor } from '../Editors';
import { ClawbackTermsEditor, ExitEditor, HikesEditor, JoiningEditor, LopEditor, VariableEditor } from '../JobSections';
import { ReconcileCard } from '../Reconcile';
import { TdsMonths } from '../TdsMonths';
import { LocationCard } from '../Location';
import { useRules } from '../rulesContext';
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
  onEditText: (docId: string, text: string) => void;
  onDone: () => void;
  /** Set for a job you just added without documents: drop it and go back. */
  onCancel?: () => void;
}) {
  const { s, index } = props;
  const rules = useRules();
  const e = s.employers[index];
  const prev = s.employers[index - 1];
  const isNew = index === s.employers.length - 1;
  const thirty = s.settings.thirtyDayMonth;
  const set = (patch: Partial<Employment>) => props.onChange({ ...e, ...patch });
  const [leaving, setLeaving] = useState(false);
  const joining = e.oneTimes.find((o) => o.kind === 'joining');
  const setJoining = (patch: Partial<OneTime> | null) => {
    const rest = e.oneTimes.filter((o) => o.kind !== 'joining');
    if (patch === null) return set({ oneTimes: rest });
    const base: OneTime = joining ?? { id: 'joining', label: 'Joining bonus', kind: 'joining', amount: 0, month: monthOf(e.start || s.today), taxable: true };
    set({ oneTimes: [...rest, { ...base, ...patch }] });
  };

  // The salary you joined on: the whole story for a job without hikes, history for one with them.
  const joiningSalary = (
    <>
      <StructureEditor emp={e} value={e.structure} marks={props.marks} sources={props.sources} month={monthOf(maxDate(e.start || fyStart(s.fy), fyStart(s.fy)))} onChange={(x) => set({ structure: x })} />
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
    </>
  );
  const now = isNew && e.start > s.today ? { index: -1, emp: e, structure: e.structure, month: '' } : salaryNow(e, s.today);
  const cur = now.index >= 0 ? e.revisions[now.index] : undefined;
  const setNow = (patch: Partial<Revision>) => set({ revisions: e.revisions.map((r, i) => (i === now.index ? { ...r, ...patch } : r)) });
  const hikeFile = cur?.source?.match(/^doc:(?:appraisal|sheet):(.+)$/)?.[1];
  // Which months of this year the joining salary still pays.
  const firstHike = e.revisions.map((r) => r.from).filter(Boolean).sort()[0];
  const fromMonth = monthOf(maxDate(e.start || fyStart(s.fy), fyStart(s.fy)));
  const earlierMonths =
    !firstHike || firstHike <= fromMonth ? '' : firstHike === addMonths(fromMonth, 1) ? monthLong(fromMonth) : `${monthLong(fromMonth)} to ${monthLong(addMonths(firstHike, -1))}`;
  const earlierUse = earlierMonths ? `Your earlier salary is used for ${earlierMonths}.` : `Your earlier salary doesn't affect ${fyLabel(s.fy)}.`;

  return (
    <>
      {props.onCancel && (
        <p class="callout info small">
          Adding a job without documents. Changed your mind?{' '}
          <button type="button" class="btn link inline" onClick={props.onCancel}>
            Cancel and go back
          </button>
        </p>
      )}
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
          <DocsPanel emp={e} choices={props.choices} onAdd={props.onAddFiles} onRemove={props.onRemoveDoc} onChoose={props.onChoose} onReclassify={props.onReclassify} onEditText={props.onEditText} />
          <Warnings items={props.warnings} />
          {now.index >= 0 ? (
            <>
              {/* On a hike already: today's pay is what you check. The joining salary only covers the months before it. */}
              <h2 class="section">{e.end && e.end < s.today ? 'Your last salary' : 'Your salary now'}</h2>
              <p class="muted small">
                From {monthLong(cur!.from)}
                {hikeFile ? `, from ${hikeFile}` : ''}. {earlierUse}
              </p>
              <StructureEditor emp={e} value={cur!.structure} month={now.month} onChange={(x) => setNow({ structure: x, scaled: false })} />
              <div class="card">
                <Field label="CTC now (per year)" hint="From your latest increment letter. Used for the CTC vs in-hand comparison.">
                  <Money value={cur!.ctc ?? 0} onChange={(v) => setNow({ ctc: v || undefined })} ariaLabel="CTC now per year" />
                </Field>
              </div>
              <ReconcileCard
                emp={now.emp}
                structure={cur!.structure}
                month={now.month}
                onAddAllowance={(m) => setNow({ structure: { ...cur!.structure, others: [...cur!.structure.others, { name: 'Other allowance', amount: m }] } })}
              />
              <LocationCard emp={e} rules={rules} onChange={props.onChange} />
              <HikesEditor emp={e} fy={s.fy} thirty={thirty} onChange={props.onChange} today={s.today} editedAbove={now.index} />
              <details class="card earlier-pay">
                <summary>
                  Earlier salary <span class="muted small">· {rs(fixedMonthly(e.structure))} a month · {earlierMonths ? `paid ${earlierMonths}` : `not in ${fyLabel(s.fy)}`}</span>
                </summary>
                {joiningSalary}
              </details>
            </>
          ) : (
            <>
              <h2 class="section">Salary</h2>
              {joiningSalary}
              <LocationCard emp={e} rules={rules} onChange={props.onChange} />
              <HikesEditor emp={e} fy={s.fy} thirty={thirty} onChange={props.onChange} today={s.today} />
            </>
          )}
          <LopEditor emp={e} fy={s.fy} thirty={thirty} onChange={props.onChange} />

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
              {joining && joining.amount > 0 && <ClawbackTermsEditor bonus={joining} onChange={(patch) => setJoining(patch)} />}
              {isNew && <VariableEditor emp={e} onChange={props.onChange} />}
              {isNew && e.start && e.start <= s.today && (
                <Field
                  label="Income tax deducted here this year (optional)"
                  hint={props.ytdHint !== undefined ? `Your latest payslip shows ${rs(props.ytdHint)} year-to-date.` : "Year-to-date TDS from your last payslip. Leave empty and we'll estimate what payroll deducted."}
                >
                  <Money value={props.tdsSoFar ?? 0} onChange={(v) => props.onTdsSoFar(v || null)} ariaLabel="TDS so far" />
                </Field>
              )}
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
              <ExitEditor emp={e} fy={s.fy} thirty={thirty} onChange={props.onChange} showJoiningBonus={index === 0} />
            </>
          )}
        </>
      )}

      {isNew && !e.totalsOnly && e.start && e.start <= s.today && (
        <>
          {!e.end && !e.resignedOn && !leaving ? (
            <div class="card">
              <h3>Leaving {e.name || 'this job'}?</h3>
              <p class="muted small">Resigned, or planning to, without a new job lined up? Add your dates for the last salary, notice recovery and F&F.</p>
              <button type="button" class="btn small" onClick={() => setLeaving(true)}>
                I'm leaving this job
              </button>
            </div>
          ) : (
            <ExitEditor emp={e} fy={s.fy} thirty={thirty} onChange={props.onChange} showJoiningBonus={false} />
          )}
        </>
      )}

      {prev && <JoiningEditor emp={e} prev={prev} fy={s.fy} thirty={thirty} onChange={props.onChange} />}

      <Continue label="Done" onClick={props.onDone} disabled={!e.totalsOnly && !e.structure.basic} why="Enter at least Basic, or switch to totals." />
      {props.onCancel && (
        <p class="center">
          <button type="button" class="btn ghost" onClick={props.onCancel}>
            Cancel, don't add this job
          </button>
        </p>
      )}
    </>
  );
}
