import { fnfItems } from '../../domain/compute';
import { fyStart, maxDate, monthOf } from '../../domain/fy';
import type { Employment, FnF, Form12B, Scenario } from '../../domain/types';
import type { Choices } from '../../extract/merge';
import { rs } from '../../format';
import type { FieldMarks } from '../../state';
import { Choices as ChoiceButtons, DateInput, Field, Money, Num, Segmented, Toggle, Warnings } from '../controls';
import { Continue } from '../Continue';
import { DocsPanel } from '../Docs';
import { OneTimeEditor, StructureEditor } from '../Editors';
import type { ReadFile } from '../Uploader';

const NO_FNF: FnF = { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0, buyoutByNext: false };

/** Everything about one earlier job: files or totals, dates, tax so far, F&F and Form 12B. */
export function JobEditStep(props: {
  s: Scenario;
  emp: Employment;
  next: Employment;
  choices: Choices;
  marks: FieldMarks;
  sources: Record<string, string>;
  warnings: string[];
  tdsSoFar: number | null;
  ytdHint?: number;
  onChange: (e: Employment) => void;
  onNextChange: (e: Employment) => void;
  onTdsSoFar: (v: number | null) => void;
  onAddFiles: (f: ReadFile[]) => void;
  onRemoveDoc: (id: string) => void;
  onChoose: (field: string, choice: string) => void;
  onDone: () => void;
}) {
  const { s, emp: e, next } = props;
  const set = (patch: Partial<Employment>) => props.onChange({ ...e, ...patch });
  const fnf = e.fnf ?? NO_FNF;
  const setF = (patch: Partial<FnF>) => set({ fnf: { ...fnf, ...patch } });
  const items = fnfItems({ ...e, fnf }, s.fy);
  const mode = e.totalsOnly ? 'totals' : 'detail';
  return (
    <>
      <div class="card">
        <Field label="Company">
          <input id={`name-${e.id}`} class="text" value={e.name} onInput={(ev) => set({ name: (ev.target as HTMLInputElement).value })} />
        </Field>
        <div class="grid2">
          <Field label="Worked there from" hint={`Only dates from ${fyStart(s.fy)} matter.`}>
            <DateInput value={e.start} onChange={(v) => set({ start: v })} ariaLabel="Worked there from" />
          </Field>
          <Field label="Last working day">
            <DateInput value={e.end} onChange={(v) => set({ end: v })} ariaLabel="Last working day" />
          </Field>
        </div>
        <Segmented
          ariaLabel="How much do you know about this job"
          value={mode}
          onChange={(v) => set({ totalsOnly: v === 'totals' ? e.totalsOnly ?? { gross: 0, tds: 0 } : undefined })}
          options={[
            { value: 'detail', label: 'I have letters or payslips' },
            { value: 'totals', label: 'I only know the totals' },
          ]}
        />
      </div>

      {e.totalsOnly ? (
        <div class="card">
          <Field label="Total gross salary from this job this FY" hint="Before deductions. Form 16 or the last payslip's year-to-date column has it.">
            <Money value={e.totalsOnly.gross} onChange={(v) => set({ totalsOnly: { ...e.totalsOnly!, gross: v } })} ariaLabel="Total gross salary" />
          </Field>
          <Field label="Total income tax (TDS) deducted">
            <Money value={e.totalsOnly.tds} onChange={(v) => set({ totalsOnly: { ...e.totalsOnly!, tds: v } })} ariaLabel="Total TDS" />
          </Field>
        </div>
      ) : (
        <>
          <DocsPanel emp={e} choices={props.choices} onAdd={props.onAddFiles} onRemove={props.onRemoveDoc} onChoose={props.onChoose} />
          <Warnings items={props.warnings} />
          <StructureEditor value={e.structure} marks={props.marks} sources={props.sources} month={monthOf(maxDate(e.start || fyStart(s.fy), fyStart(s.fy)))} onChange={(x) => set({ structure: x })} />
          {e.revisions.map((rv, i) => (
            <>
              <div class="card">
                <div class="card-head">
                  <h3>Salary change</h3>
                  <button type="button" class="btn small ghost" onClick={() => set({ revisions: e.revisions.filter((_, j) => j !== i) })}>
                    Remove
                  </button>
                </div>
                <Field label="New salary from (month)">
                  <input
                    type="month"
                    class="text"
                    value={rv.from}
                    onInput={(ev) => set({ revisions: e.revisions.map((x, j) => (j === i ? { ...x, from: (ev.target as HTMLInputElement).value } : x)) })}
                  />
                </Field>
              </div>
              <StructureEditor value={rv.structure} month={rv.from} onChange={(x) => set({ revisions: e.revisions.map((y, j) => (j === i ? { ...y, structure: x } : y)) })} />
            </>
          ))}
          <button
            type="button"
            class="btn link"
            onClick={() => set({ revisions: [...e.revisions, { from: monthOf(maxDate(s.today, e.start || fyStart(s.fy))), structure: { ...e.structure } }] })}
          >
            + My salary changed during this job
          </button>
          <div class="card">
            <h3>Bonuses paid this year</h3>
            <OneTimeEditor items={e.oneTimes} defaultMonth={monthOf(e.end || s.today)} onChange={(o) => set({ oneTimes: o })} addLabel="+ Add a bonus" />
          </div>
          <div class="card">
            <Field
              label="Income tax deducted at this job this year (optional)"
              hint={props.ytdHint !== undefined ? `Your latest payslip shows ${rs(props.ytdHint)} year-to-date.` : "Year-to-date TDS from your last payslip. Leave it empty and we'll estimate what payroll deducted."}
            >
              <Money value={props.tdsSoFar ?? 0} onChange={(v) => props.onTdsSoFar(v || null)} ariaLabel="TDS so far" />
            </Field>
          </div>
          <div class="card">
            <h3>Full & final settlement</h3>
            <Field label="Unused leave paid out (days)" hint="Tax-free up to ₹25 lakh when you resign, but payroll still deducts TDS on it. You get that back when you file.">
              <Num value={fnf.leaveDays} onChange={(v) => setF({ leaveDays: v })} suffix="days" ariaLabel="Leave days" />
            </Field>
            <Field label="Notice period shortfall recovered (days)">
              <Num value={fnf.noticeDaysRecovered} onChange={(v) => setF({ noticeDaysRecovered: v })} suffix="days" ariaLabel="Notice days recovered" />
            </Field>
            <Field label="Amount paid back (joining bonus, relocation etc.)">
              <Money value={fnf.clawback} onChange={(v) => setF({ clawback: v })} ariaLabel="Clawback amount" />
            </Field>
            {items && items.noticeRecovery + items.clawback > 0 && (
              <Toggle checked={fnf.buyoutByNext} onChange={(v) => setF({ buyoutByNext: v })} label={`${next.name || 'The next job'} reimburses this (notice buyout)`} />
            )}
            {items && (items.leaveEncashment > 0 || items.noticeRecovery > 0) && (
              <p class="note">
                One day's basic = {rs(items.perDay)}. Leave encashment {rs(items.leaveEncashment)}
                {items.noticeRecovery > 0 && <>, notice recovery {rs(items.noticeRecovery)}</>}.
              </p>
            )}
          </div>
        </>
      )}

      <div class="card">
        <Field
          label={`When does ${next.name || 'your next job'} get Form 12B?`}
          hint="Form 12B tells the next employer what you earned and paid in tax earlier this year, so it deducts the right TDS."
        >
          <ChoiceButtons<Form12B>
            value={next.form12B}
            onChange={(v) => props.onNextChange({ ...next, form12B: v })}
            options={[
              { value: 'first', label: 'Before the first salary' },
              { value: 'second', label: 'Before the second salary' },
              { value: 'never', label: "I won't submit it" },
            ]}
          />
        </Field>
      </div>
      <Continue label="Save this job" onClick={props.onDone} disabled={!e.totalsOnly && !e.structure.basic} why="Enter at least Basic, or switch to totals." />
    </>
  );
}
