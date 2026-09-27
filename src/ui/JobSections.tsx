import { fnfItems } from '../domain/compute';
import { fyStart, maxDate, monthLong, monthOf } from '../domain/fy';
import { arrearsFor, fixedMonthly, noticeShortfall } from '../domain/schedule';
import type { Buyout, Employment, FnF, Form12B, LeaveBasis, OneTime, Revision } from '../domain/types';
import { rs } from '../format';
import { Choices, DateInput, Field, Money, MonthInput, Num, Percent, Segmented, Toggle } from './controls';
import { StructureEditor } from './Editors';

/** Hikes during a job: when each applied, when it was first paid, and the new salary. */
export function HikesEditor(props: { emp: Employment; fy: number; thirty: boolean; onChange: (e: Employment) => void; today: string }) {
  const e = props.emp;
  const set = (i: number, patch: Partial<Revision>) => props.onChange({ ...e, revisions: e.revisions.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const arrears = arrearsFor(e, props.thirty);
  const sorted = e.revisions.map((r, i) => ({ r, i })).sort((a, b) => a.r.from.localeCompare(b.r.from));
  return (
    <div class="card">
      <h3>Hikes</h3>
      {!e.revisions.length && <p class="muted small">No hikes found in your files. Add one if your salary changed after you joined.</p>}
      {sorted.map(({ r, i }, n) => {
        const prev = n === 0 ? e.structure : sorted[n - 1].r.structure;
        const pct = fixedMonthly(prev) ? fixedMonthly(r.structure) / fixedMonthly(prev) - 1 : 0;
        const a = arrears.find((x) => x.month === r.payoutMonth);
        return (
          <details class="hike" open={n === sorted.length - 1}>
            <summary>
              <strong>From {r.from ? monthLong(r.from) : '…'}</strong>
              <span class="muted small">
                {' '}
                {rs(fixedMonthly(prev))} → {rs(fixedMonthly(r.structure))} a month ({pct >= 0 ? '+' : ''}
                {(pct * 100).toFixed(1)}%){r.source?.startsWith('doc:appraisal:') && ` · from ${r.source.slice(14)}`}
              </span>
            </summary>
            <div class="grid2">
              <Field label="Applies from" hint="The effective date in the letter.">
                <MonthInput value={r.from} onChange={(v) => set(i, { from: v })} ariaLabel="Hike applies from" />
              </Field>
              <Field label="First paid in" hint={a ? `${rs(a.amount)} arrears paid then.` : 'Leave as is if paid from the same month.'}>
                <MonthInput value={r.payoutMonth ?? r.from} onChange={(v) => set(i, { payoutMonth: v > r.from ? v : undefined })} ariaLabel="Hike first paid in" />
              </Field>
            </div>
            <Field label="New CTC (per year, optional)">
              <Money value={r.ctc ?? 0} onChange={(v) => set(i, { ctc: v || undefined })} ariaLabel="New CTC" />
            </Field>
            {r.scaled && <p class="note">The letter gave only the total, so every component was raised by the same %. Fix the breakup below if your payslip shows otherwise.</p>}
            <StructureEditor value={r.structure} month={r.payoutMonth ?? r.from} onChange={(x) => set(i, { structure: x, scaled: false })} />
            <button type="button" class="btn small ghost" onClick={() => props.onChange({ ...e, revisions: e.revisions.filter((_, j) => j !== i) })}>
              Remove this hike
            </button>
          </details>
        );
      })}
      <button
        type="button"
        class="btn link"
        onClick={() => {
          const last = sorted.length ? sorted[sorted.length - 1].r.structure : e.structure;
          props.onChange({ ...e, revisions: [...e.revisions, { from: monthOf(maxDate(props.today, e.start || fyStart(props.fy))), structure: { ...last } }] });
        }}
      >
        + Add a hike
      </button>
    </div>
  );
}

const LEAVE_BASES: { value: LeaveBasis; label: string }[] = [
  { value: 'basic30', label: 'Basic ÷ 30' },
  { value: 'basic26', label: 'Basic ÷ 26' },
  { value: 'gross30', label: 'Gross ÷ 30' },
  { value: 'custom', label: 'My rate' },
];

/** Resignation, last working day and the full & final settlement. */
export function ExitEditor(props: { emp: Employment; fy: number; thirty: boolean; onChange: (e: Employment) => void }) {
  const e = props.emp;
  const f: FnF = e.fnf ?? { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0 };
  const setF = (patch: Partial<FnF>) => props.onChange({ ...e, fnf: { ...f, ...patch } });
  const items = fnfItems({ ...e, fnf: f }, props.fy, props.thirty);
  const shortfall = noticeShortfall(e);
  return (
    <div class="card">
      <h3>Leaving {e.name || 'this job'}</h3>
      <div class="grid2">
        <Field label="Resigned on">
          <DateInput value={e.resignedOn ?? ''} onChange={(v) => props.onChange({ ...e, resignedOn: v, endSource: 'user' })} ariaLabel="Resigned on" />
        </Field>
        <Field label="Last working day">
          <DateInput value={e.end} onChange={(v) => props.onChange({ ...e, end: v, endSource: 'user' })} ariaLabel="Last working day" />
        </Field>
      </div>
      {e.endSource === 'assumed' && <p class="callout warn small">This last day is an assumption (the day before your next job). Enter your real dates.</p>}
      {items && items.lastMonthFactor > 0 && items.lastMonthFactor < 1 && (
        <p class="note">
          {monthLong(items.lastMonth)} salary is paid pro-rata: {Math.round(items.lastMonthFactor * 100)}% of the month.
        </p>
      )}

      <h3 class="mt">Leave encashment</h3>
      <div class="grid2">
        <Field label="Leave days paid out">
          <Num value={f.leaveDays} onChange={(v) => setF({ leaveDays: v })} suffix="days" ariaLabel="Leave days" />
        </Field>
        <Field label="Amount on F&F slip" hint="Leave empty to calculate.">
          <Money value={f.leaveAmount ?? 0} onChange={(v) => setF({ leaveAmount: v || undefined })} ariaLabel="Leave encashment on slip" />
        </Field>
      </div>
      <Field label="Rate per day">
        <Segmented<LeaveBasis> ariaLabel="Leave encashment rate" value={f.leaveBasis ?? 'basic30'} onChange={(v) => setF({ leaveBasis: v })} options={LEAVE_BASES} />
        {f.leaveBasis === 'custom' && <Money value={f.leaveRate ?? 0} onChange={(v) => setF({ leaveRate: v })} ariaLabel="Leave rate per day" />}
      </Field>
      {items && f.leaveDays > 0 && (
        <p class="note">
          {items.leaveFromSlip
            ? `Using ${rs(items.leaveEncashment)} from your F&F slip. At ${rs(items.perDay)} a day (${items.leaveRateLabel}) it would be ${rs(items.perDay * f.leaveDays)}.`
            : `${f.leaveDays} days × ${rs(items.perDay)} a day (${items.leaveRateLabel}) = ${rs(items.leaveEncashment)}. Tax-free up to ₹25 lakh; payroll deducts TDS on it anyway, and you claim it back in your ITR.`}
        </p>
      )}

      <h3 class="mt">Notice period</h3>
      <Field label="Notice period" hint={e.docs.some((d) => d.facts?.noticeDays) ? 'From your appointment letter.' : 'From your appointment letter or HR policy.'}>
        <Num value={e.noticeDays ?? 0} onChange={(v) => props.onChange({ ...e, noticeDays: v || undefined })} suffix="days" ariaLabel="Notice period in days" />
      </Field>
      {shortfall !== undefined && shortfall !== f.noticeDaysRecovered && (
        <p class="note">
          Resigning on {e.resignedOn} with a last day of {e.end}, you're {shortfall} days short.{' '}
          <button type="button" class="btn link inline" onClick={() => setF({ noticeDaysRecovered: shortfall })}>
            Use {shortfall} days
          </button>
        </p>
      )}
      <div class="grid2">
        <Field label="Shortfall recovered" hint="Notice days you won't serve.">
          <Num value={f.noticeDaysRecovered} onChange={(v) => setF({ noticeDaysRecovered: v })} suffix="days" ariaLabel="Notice days recovered" />
        </Field>
        <Field label="Amount on F&F slip" hint="Leave empty to calculate.">
          <Money value={f.noticeAmount ?? 0} onChange={(v) => setF({ noticeAmount: v || undefined })} ariaLabel="Notice recovery on slip" />
        </Field>
      </div>
      <Field label="Recovered at">
        <Segmented<'basic' | 'gross'>
          ariaLabel="Notice recovery rate"
          value={f.noticeBasis ?? 'basic'}
          onChange={(v) => setF({ noticeBasis: v })}
          options={[
            { value: 'basic', label: 'Basic ÷ 30' },
            { value: 'gross', label: 'Gross ÷ 30' },
          ]}
        />
      </Field>
      {items && f.noticeDaysRecovered > 0 && !items.noticeFromSlip && (
        <p class="note">
          {f.noticeDaysRecovered} days × {rs(items.noticePerDay)} ({items.noticeRateLabel}) = {rs(items.noticeRecovery)} recovered.
        </p>
      )}

      <h3 class="mt">Other settlement items</h3>
      <div class="grid2">
        <Field label="Bonus clawback" hint="Joining/relocation bonus you repay.">
          <Money value={f.clawback} onChange={(v) => setF({ clawback: v })} ariaLabel="Clawback amount" />
        </Field>
        <Field label="Penalty / bond" hint="Contract-breach recovery.">
          <Money value={f.penalty ?? 0} onChange={(v) => setF({ penalty: v })} ariaLabel="Penalty amount" />
        </Field>
      </div>
      <div class="grid2">
        <Field label="Gratuity" hint="After 5 years of service. Tax-free up to ₹20 lakh.">
          <Money value={f.gratuity ?? 0} onChange={(v) => setF({ gratuity: v })} ariaLabel="Gratuity" />
        </Field>
        <Field label="F&F paid in" hint="Often 30–60 days after you leave.">
          <MonthInput value={f.payMonth || (e.end ? monthOf(e.end) : '')} onChange={(v) => setF({ payMonth: v })} ariaLabel="F&F paid in" />
        </Field>
      </div>
    </div>
  );
}

/** At a later job: joining bonus terms, notice buyout support and Form 12B. */
export function JoiningEditor(props: { emp: Employment; prev: Employment; fy: number; thirty: boolean; onChange: (e: Employment) => void }) {
  const e = props.emp;
  const prevF = fnfItems(props.prev, props.fy, props.thirty);
  const owed = prevF ? prevF.noticeRecovery + prevF.clawback : 0;
  const bo: Buyout = e.buyout ?? { mode: 'none' };
  const setBo = (patch: Partial<Buyout>) => props.onChange({ ...e, buyout: { ...bo, ...patch } });
  const jb = e.oneTimes.find((o) => o.kind === 'joining');
  const setJb = (patch: Partial<OneTime>) => props.onChange({ ...e, oneTimes: e.oneTimes.map((o) => (o.kind === 'joining' ? { ...o, ...patch } : o)) });
  return (
    <div class="card">
      <h3>Moving from {props.prev.name || 'your previous job'}</h3>
      <Field label="Notice buyout" hint={owed ? `${props.prev.name || 'Your previous employer'} recovers ${rs(owed)}.` : 'What the new employer pays towards your notice recovery.'}>
        <Segmented<Buyout['mode']>
          ariaLabel="Notice buyout support"
          value={bo.mode}
          onChange={(v) => setBo({ mode: v })}
          options={[
            { value: 'none', label: 'Not offered' },
            { value: 'actuals', label: 'On actuals' },
            { value: 'cap', label: 'Up to a limit' },
          ]}
        />
      </Field>
      {bo.mode === 'cap' && (
        <Field label="Limit">
          <Money value={bo.cap ?? 0} onChange={(v) => setBo({ cap: v })} ariaLabel="Buyout limit" />
        </Field>
      )}
      {bo.mode !== 'none' && (
        <>
          <Toggle checked={!!bo.includesClawback} onChange={(v) => setBo({ includesClawback: v })} label="Also covers the bonus you repay to your old employer" />
          <Field label="Reimbursed in" hint="Leave as is to use your first salary (or the Form 12B month).">
            <MonthInput value={bo.month ?? ''} onChange={(v) => setBo({ month: v })} ariaLabel="Buyout paid in" />
          </Field>
        </>
      )}
      {jb && (
        <Field label="Joining bonus repayable if you leave within" hint={`${rs(jb.amount)} paid in ${monthLong(jb.month)}.`}>
          <Num value={jb.clawbackMonths ?? 0} onChange={(v) => setJb({ clawbackMonths: v || undefined })} suffix="months" ariaLabel="Joining bonus clawback months" />
        </Field>
      )}
      <Field label="Form 12B" hint="Tells the new employer your earlier salary and TDS this year, so it deducts the right tax.">
        <Choices<Form12B>
          value={e.form12B}
          onChange={(v) => props.onChange({ ...e, form12B: v })}
          options={[
            { value: 'first', label: 'Submitted before the first salary' },
            { value: 'second', label: 'Submitted before the second salary' },
            { value: 'never', label: "Won't submit it" },
          ]}
        />
      </Field>
    </div>
  );
}

/** Variable pay target for the new job, with the expected payout %. */
export function VariableEditor(props: { emp: Employment; onChange: (e: Employment) => void }) {
  const e = props.emp;
  const v = e.variable ?? { annual: 0, payoutPct: 1, prorate: true, month: '' };
  const setV = (patch: Partial<typeof v>) => props.onChange({ ...e, variable: { ...v, ...patch } });
  return (
    <>
      <div class="grid2">
        <Field label="Variable pay / PLI (full-year target)">
          <Money value={v.annual} onChange={(x) => setV({ annual: x })} ariaLabel="Variable pay per year" />
        </Field>
        <Field label="Expected payout">
          <Percent value={v.payoutPct} onChange={(x) => setV({ payoutPct: x })} ariaLabel="Expected variable payout percent" />
        </Field>
      </div>
      {v.annual > 0 && (
        <>
          <Field label="First payout month" hint="Often after the year ends (April–June). If it's after March, it counts next year.">
            <MonthInput value={v.month} onChange={(x) => setV({ month: x })} ariaLabel="Variable pay month" />
          </Field>
          <Toggle checked={v.prorate} onChange={(x) => setV({ prorate: x })} label="Prorated for the part of the first year you worked" />
        </>
      )}
    </>
  );
}
