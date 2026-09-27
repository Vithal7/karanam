/** Small clarification cards: each asks one thing we'd otherwise have to assume. */
import { useState } from 'preact/hooks';
import { addMonths, monthLong, monthOf } from '../domain/fy';
import type { Employment } from '../domain/types';
import { Choices, DateInput, Field, Money, MonthInput, Num } from './controls';
import { daysBetween } from '../domain/fy';
import { noticeShortfall } from '../domain/schedule';
import { rs } from '../format';
import { fnfItems } from '../domain/compute';

const long = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Joining after 1 April: was there salary earlier in the year? It changes the tax on everything. */
export function EarlierIncomeQuestion(props: { first: Employment; fyLabel: string; onNone: () => void; onAdd: (x: { name: string; gross: number; tds: number }) => void }) {
  const [ans, setAns] = useState<'no' | 'yes' | null>(null);
  const [name, setName] = useState('');
  const [gross, setGross] = useState(0);
  const [tds, setTds] = useState(0);
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>
          Did you earn a salary in {props.fyLabel} before joining {props.first.name || 'this job'} on {long(props.first.start)}?
        </strong>{' '}
        Earlier income this year is taxed together with this job's.
      </p>
      <Choices<'no' | 'yes'>
        value={ans}
        onChange={(v) => {
          setAns(v);
          if (v === 'no') props.onNone();
        }}
        options={[
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' },
        ]}
      />
      {ans === 'yes' && (
        <>
          <p class="muted small">Add that job's letters and payslips with "+ Add more documents" below, or just enter the totals from its Form 16 or last payslip.</p>
          <Field label="Employer">
            <input class="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label="Earlier employer" />
          </Field>
          <div class="grid2">
            <Field label="Gross salary there this year">
              <Money value={gross} onChange={setGross} ariaLabel="Earlier gross salary" />
            </Field>
            <Field label="TDS deducted there">
              <Money value={tds} onChange={setTds} ariaLabel="Earlier TDS" />
            </Field>
          </div>
          <button type="button" class="btn small primary" disabled={!gross} onClick={() => props.onAdd({ name: name || 'Earlier job', gross, tds })}>
            Add this income
          </button>
        </>
      )}
    </div>
  );
}

/** Form 12B tells the new employer your earlier salary and TDS; without it, it taxes you as if it were your only job. */
export function Form12BQuestion(props: { emp: Employment; prevName: string; onChange: (e: Employment) => void }) {
  const e = props.emp;
  const join = monthOf(e.start);
  const [ans, setAns] = useState<'yes' | 'no' | null>(null);
  const [month, setMonth] = useState(/^\d{4}-\d{2}$/.test(e.form12B) ? e.form12B : addMonths(join, e.form12B === 'first' ? 0 : 1));
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>Will you give {e.name || 'your new employer'} Form 12B?</strong> It tells them what you earned and paid in tax at {props.prevName} this year, so they deduct the right TDS.
        Without it, you may owe tax when you file.
      </p>
      <Choices<'yes' | 'no'>
        value={ans}
        onChange={(v) => {
          setAns(v);
          if (v === 'no') props.onChange({ ...e, form12B: 'never', form12BConfirmed: true });
        }}
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: "No / don't know" },
        ]}
      />
      {ans === 'yes' && (
        <div class="grid2">
          <Field label="Payroll month it's used from" hint={`Usually your first or second salary (${monthLong(join)} or ${monthLong(addMonths(join, 1))}).`}>
            <MonthInput value={month} onChange={setMonth} ariaLabel="Form 12B month" />
          </Field>
          <div class="q-action">
            <button type="button" class="btn small primary" disabled={!month} onClick={() => props.onChange({ ...e, form12B: month, form12BConfirmed: true })}>
              Use this month
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** EPF ceiling rise inside a fixed CTC: does the employer take its extra share out of your allowance? */
export function PfRiseQuestion(props: { emp: Employment; month: string; onChange: (e: Employment) => void }) {
  const e = props.emp;
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>PF goes up at {e.name || 'this job'} from {monthLong(props.month)}.</strong> The EPF wage ceiling rises, so both your PF and your employer's rise. Where does your employer's
        extra share come from?
      </p>
      <Choices<'allowance' | 'employer'>
        value={e.pfRise ?? null}
        onChange={(v) => props.onChange({ ...e, pfRise: v })}
        options={[
          { value: 'allowance', label: 'Out of my allowance (CTC stays the same)' },
          { value: 'employer', label: 'Employer pays it on top' },
        ]}
      />
      <p class="muted small">Most employers whose CTC includes employer PF take it out of the special or miscellaneous allowance. Your payslip after the change shows which.</p>
    </div>
  );
}

/** The letter's date was used as the joining date: confirm the real one. */
export function JoinDateQuestion(props: { emp: Employment; onChange: (e: Employment) => void }) {
  const [d, setD] = useState(props.emp.start);
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>When did you join {props.emp.name}?</strong> The letter doesn't say, so we used its date ({long(props.emp.start)}). Your first salary depends on the exact day.
      </p>
      <div class="grid2">
        <Field label="Joining date">
          <DateInput value={d} onChange={setD} ariaLabel="Joining date" />
        </Field>
        <div class="q-action">
          <button type="button" class="btn small primary" disabled={!d} onClick={() => props.onChange({ ...props.emp, start: d, startSource: 'user' })}>
            Use this date
          </button>
        </div>
      </div>
    </div>
  );
}

/** Leave balance paid out at exit (soft: 0 is possible). */
export function LeaveQuestion(props: { emp: Employment; onChange: (e: Employment) => void }) {
  const e = props.emp;
  const [days, setDays] = useState(e.fnf?.leaveDays ?? 0);
  return (
    <div class="callout exit-q">
      <p>
        <strong>Leave balance when you leave {e.name}?</strong> Unused earned leave is usually paid out in the F&F, and part of it can be tax-free.
      </p>
      <div class="grid2">
        <Field label="Leave days paid out">
          <Num value={days} onChange={setDays} suffix="days" ariaLabel="Leave days at exit" />
        </Field>
        <div class="q-action">
          <button type="button" class="btn small primary" onClick={() => props.onChange({ ...e, leaveConfirmed: true, fnf: { noticeDaysRecovered: 0, clawback: 0, ...(e.fnf ?? {}), leaveDays: days } })}>
            {days ? 'Use this' : 'None'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * You've resigned and know your last day, but not your notice period: without it there's no
 * notice shortfall, so no recovery and nothing for a buyout to cover.
 */
export const needsNotice = (e: Employment) =>
  !e.totalsOnly &&
  !!e.resignedOn &&
  !!e.end &&
  !e.noticeDays &&
  !e.asked?.notice &&
  e.fnf?.noticeAmount === undefined &&
  !e.fnf?.noticeDaysRecovered &&
  !e.docs.some((d) => d.facts?.shortfallDays !== undefined);

export function NoticeQuestion(props: { emp: Employment; fy: number; thirty: boolean; onChange: (e: Employment) => void }) {
  const e = props.emp;
  const [days, setDays] = useState(0);
  const served = daysBetween(e.resignedOn!, e.end) - 1;
  const draft: Employment = { ...e, noticeDays: days || undefined, noticeMonths: undefined };
  const short = noticeShortfall(draft) ?? 0;
  const f = fnfItems({ ...draft, fnf: { leaveDays: 0, clawback: 0, ...(e.fnf ?? {}), noticeDaysRecovered: short } }, props.fy, props.thirty);
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>What's your notice period at {e.name}?</strong> You resigned on {long(e.resignedOn!)} and leave on {long(e.end)}, so you serve {served} days. Any days short are recovered in
        your F&F, and a new employer's notice buyout pays them back.
      </p>
      <div class="grid2">
        <Field label="Notice period">
          <Num value={days} onChange={setDays} suffix="days" ariaLabel="Notice period in days" />
        </Field>
        <div class="q-action">
          <button
            type="button"
            class="btn small primary"
            disabled={!days}
            onClick={() => props.onChange({ ...draft, asked: { ...e.asked, notice: true }, fnf: { leaveDays: 0, clawback: 0, ...(e.fnf ?? {}), noticeDaysRecovered: short } })}
          >
            Use this
          </button>
        </div>
      </div>
      {days > 0 && (
        <p class="note">
          {short > 0 ? `${short} days short: about ${rs(f ? f.noticePerDay * short : 0)} recovered (${f?.noticeRateLabel ?? 'basic ÷ 30'} a day).` : 'You serve your full notice. No recovery.'}
        </p>
      )}
      <button type="button" class="btn link inline" onClick={() => props.onChange({ ...e, asked: { ...e.asked, notice: true } })}>
        I serve my full notice
      </button>
    </div>
  );
}
