/** Small clarification cards: each asks one thing we'd otherwise have to assume. */
import { useState } from 'preact/hooks';
import { addMonths, monthLong, monthOf } from '../domain/fy';
import type { Employment } from '../domain/types';
import { Choices, DateInput, Field, Money, MonthInput, Num } from './controls';
import { fyStart } from '../domain/fy';
import { Uploader, type ReadFile } from './Uploader';
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
        <strong>Leave balance when you leave {e.name}?</strong> Unused earned leave is usually paid out in your full & final settlement (F&F: the last payout when you leave), and part of it can be tax-free.
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
        <strong>What's your notice period at {e.name}?</strong> You resigned on {long(e.resignedOn!)} and leave on {long(e.end)}, so you serve {served} days. Any days short are recovered from
        your full & final settlement (F&F), and a new employer's notice buyout pays them back.
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

const serviceYears = (e: Employment) => (e.start && e.end ? (Date.parse(e.end) - Date.parse(e.start)) / (365.25 * 86_400_000) : 0);

/** Leaving before 5 years with a gratuity rate in the CTC: is ex gratia paid in its place? */
export const needsExGratia = (e: Employment, leaving: boolean) =>
  leaving &&
  // Years of service need a real joining date: ask for it first.
  e.startSource !== 'default' &&
  e.startSource !== 'approx' &&
  !e.totalsOnly &&
  !!e.fnf &&
  e.fnf.gratuity === undefined &&
  e.fnf.gratuityMode !== 'none' &&
  e.fnf.exGratia === undefined &&
  serviceYears(e) > 0 &&
  serviceYears(e) < 4 + 240 / 365 &&
  !!(e.ctcParts?.gratuity || e.revisions.some((r) => r.gratuity));

export function ExGratiaQuestion(props: { emp: Employment; fy: number; thirty: boolean; onChange: (e: Employment) => void }) {
  const e = props.emp;
  const f = fnfItems({ ...e, fnf: { ...e.fnf!, exGratia: true } }, props.fy, props.thirty);
  const set = (v: boolean) => props.onChange({ ...e, fnf: { ...e.fnf!, exGratia: v }, asked: { ...e.asked, exGratia: true } });
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>Does {e.name} pay ex gratia when you leave?</strong> You'll have served {serviceYears(e).toFixed(1)} years, under the 5 needed for gratuity. Some employers pay the gratuity
        built into your CTC anyway, as "ex gratia" (taxed as salary); most don't.
      </p>
      <Choices<'yes' | 'no'>
        value={e.fnf?.exGratia === undefined ? null : e.fnf.exGratia ? 'yes' : 'no'}
        onChange={(v) => set(v === 'yes')}
        options={[
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes, it’s paid', sub: f?.gratuity ? `About ${rs(f.gratuity)}` : undefined },
        ]}
      />
    </div>
  );
}

/** The newest file with your salary at this job is from an earlier financial year. */
export function staleSalary(e: Employment, fy: number, today: string): string | undefined {
  if (e.totalsOnly || e.asked?.payChanged || !e.start || e.start > today || e.startSource === 'default') return undefined;
  if (e.end && e.end < fyStart(fy)) return undefined;
  // The latest thing we know about your pay: a letter, a payslip, your joining, or a hike.
  const known = [
    ...e.docs.filter((d) => d.kind === 'offer' || d.kind === 'appraisal' || d.kind === 'payslip').map((d) => d.docDate ?? d.doj ?? ''),
    e.start,
    ...e.revisions.map((r) => (r.from ? `${r.from}-01` : '')),
  ].filter(Boolean);
  if (!e.docs.length) return undefined;
  const newest = known.sort().pop();
  return newest && newest < fyStart(fy) ? newest : undefined;
}

/** Salary from an old letter: has it changed since? A hike changes every month after it. */
export function PayChangedQuestion(props: { emp: Employment; since: string; onChange: (e: Employment) => void; onAddFiles: (f: ReadFile[]) => void; onEdit: () => void }) {
  const e = props.emp;
  const [ans, setAns] = useState<'yes' | null>(null);
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>Has your pay at {e.name} changed since {new Date(`${props.since}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}?</strong> Your salary is taken from a
        file of that date. A hike since then changes every month's pay and tax.
      </p>
      <Choices<'no' | 'yes'>
        value={ans}
        onChange={(v) => (v === 'no' ? props.onChange({ ...e, asked: { ...e.asked, payChanged: true } }) : setAns('yes'))}
        options={[
          { value: 'no', label: 'No, same pay' },
          { value: 'yes', label: 'Yes, I’ve had a hike' },
        ]}
      />
      {ans === 'yes' && (
        <>
          <p class="muted small">Add your latest increment letter or a recent payslip, or enter the new salary yourself.</p>
          <Uploader compact buttonLabel="+ Add the letter or payslip" onFiles={props.onAddFiles} />
          <button type="button" class="btn link inline" onClick={props.onEdit}>
            Enter the new salary instead
          </button>
        </>
      )}
    </div>
  );
}

/** Only a CTC in the letter: show the typical split we used and ask you to check it. */
export function SplitQuestion(props: { emp: Employment; onChange: (e: Employment) => void; onEdit: () => void }) {
  const e = props.emp;
  const st = e.structure;
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>Check the salary split at {e.name || 'this job'}.</strong> Your {e.ctc ? `${rs(e.ctc)} CTC` : 'letter'} had no breakup, so we used a typical one: basic {rs(st.basic)}, HRA{' '}
        {rs(st.hra)} and special allowance {rs(st.special)} a month, after employer PF and gratuity. Your payslip or the letter's annexure has the real one.
      </p>
      <div class="tl-actions">
        <button type="button" class="btn small primary" onClick={() => props.onChange({ ...e, asked: { ...e.asked, split: true } })}>
          Looks right
        </button>
        <button type="button" class="btn small" onClick={props.onEdit}>
          Change it
        </button>
      </div>
    </div>
  );
}
