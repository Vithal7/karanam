import { useState } from 'preact/hooks';
import { fnfItems } from '../domain/compute';
import { noticeShortfall } from '../domain/schedule';
import type { Employment } from '../domain/types';
import { rs } from '../format';
import { Choices, DateInput, Field, Num } from './controls';
import { OverlapFix } from './OverlapFix';

/** Last day of a notice period: N calendar months, else N days, from the resignation. */
function addNotice(from: string, months: number, days: number): string {
  const [y, m, d] = from.split('-').map(Number);
  const t = months ? new Date(Date.UTC(y, m - 1 + months, d)) : new Date(Date.UTC(y, m - 1, d + days - 1));
  return t.toISOString().slice(0, 10);
}

const long = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Why we need to ask about leaving a job, or null when its dates are settled. */
export function exitQuestionFor(e: Employment, k: number, n: number): string | null {
  if (e.totalsOnly) return null;
  if (k < n - 1 && e.endSource !== 'doc' && e.endSource !== 'user') return `When you leave ${e.name}`;
  if (e.endSource === 'user') return null;
  // A last day from a letter, but no stated resignation date: the notice shortfall needs it.
  if (e.end && !e.resignedOn && e.noticeDays && e.fnf?.noticeAmount === undefined && !e.docs.some((d) => d.facts?.shortfallDays !== undefined))
    return `When you resigned from ${e.name} (for the notice shortfall)`;
  // Resigned from the current job, but no last day yet.
  if (e.resignedOn && !e.end) return `Your last working day at ${e.name}`;
  return null;
}

/**
 * We never assume when you leave: ask for the resignation date, last working day and notice
 * period, show the shortfall they imply, and only then use them.
 */
export function ExitQuestion(props: {
  emp: Employment;
  next?: Employment;
  fy: number;
  thirty: boolean;
  onConfirm: (e: Employment) => void;
  onChangeNext: (e: Employment) => void;
}) {
  const e = props.emp;
  const next = props.next;
  const [resigned, setResigned] = useState<'yes' | 'no' | null>(e.resignedOn || e.endSource === 'doc' ? 'yes' : null);
  const [resignedOn, setResignedOn] = useState(e.resignedOn ?? '');
  const [end, setEnd] = useState(e.end);
  const [notice, setNotice] = useState(e.noticeDays ?? 0);
  const draft: Employment = { ...e, resignedOn: resignedOn || undefined, end, noticeDays: notice || undefined, noticeMonths: notice === e.noticeDays ? e.noticeMonths : undefined };
  const shortfall = noticeShortfall(draft);
  const f = fnfItems({ ...draft, fnf: { leaveDays: 0, clawback: 0, ...(e.fnf ?? {}), noticeDaysRecovered: shortfall ?? 0 } }, props.fy, props.thirty);
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>When do you leave {e.name}?</strong> We need your dates to work out your last salary, notice recovery and tax.{' '}
        {e.endSource === 'doc'
          ? `Your letter gives the last day as ${long(e.end)} but not the date you resigned.`
          : next && e.end
            ? `Until you confirm, we're using ${long(e.end)}, the day before ${next.name || 'your new job'} starts.`
            : ''}
      </p>
      <Choices<'yes' | 'no'>
        value={resigned}
        onChange={setResigned}
        options={[
          { value: 'yes', label: "I've resigned" },
          { value: 'no', label: "Not yet, I'll resign soon" },
        ]}
      />
      {resigned && (
        <>
          <div class="grid2">
            <Field label={resigned === 'yes' ? 'Resigned on' : 'Planning to resign on'} hint={resigned === 'no' ? 'Leave empty if unsure.' : undefined}>
              <DateInput value={resignedOn} onChange={setResignedOn} ariaLabel="Resignation date" />
            </Field>
            <Field label="Last working day">
              <DateInput value={end} onChange={setEnd} ariaLabel="Last working day" />
            </Field>
          </div>
          <Field label="Notice period" hint={e.noticeDays ? 'From your appointment letter.' : 'Check your appointment letter or HR policy.'}>
            <Num value={notice} onChange={setNotice} suffix="days" ariaLabel="Notice period in days" />
          </Field>
          {next && <OverlapFix end={end} emp={e} next={next} onEnd={setEnd} onNextStart={(v) => props.onChangeNext({ ...next, start: v, startSource: 'user' })} />}
          {!end && resignedOn && notice > 0 && (
            <button type="button" class="btn link inline" onClick={() => setEnd(addNotice(resignedOn, e.noticeMonths && notice === e.noticeDays ? e.noticeMonths : 0, notice))}>
              Use the end of your notice period as the last day
            </button>
          )}
          {shortfall !== undefined && (
            <p class="note">
              {shortfall > 0
                ? `You serve ${notice - shortfall} of ${notice} days. Shortfall: ${shortfall} days${f ? `, about ${rs(f.noticePerDay * shortfall)} recovered (${f.noticeRateLabel} a day)` : ''}. ${next?.name || 'A new employer'} may reimburse this as a notice buyout.`
                : `You serve your full notice. No recovery.`}
            </p>
          )}
          <button
            type="button"
            class="btn primary"
            disabled={!end || (!!next?.start && end >= next.start)}
            onClick={() =>
              props.onConfirm({
                ...draft,
                endSource: 'user',
                fnf: { leaveDays: 0, clawback: 0, ...(e.fnf ?? {}), noticeDaysRecovered: shortfall ?? e.fnf?.noticeDaysRecovered ?? 0 },
              })
            }
          >
            Use these dates
          </button>
        </>
      )}
    </div>
  );
}
