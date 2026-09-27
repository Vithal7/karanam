import { useState } from 'preact/hooks';
import { fnfItems } from '../domain/compute';
import { noticeShortfall } from '../domain/schedule';
import type { Employment } from '../domain/types';
import { rs } from '../format';
import { Choices, DateInput, Field, Num } from './controls';
import { OverlapFix } from './OverlapFix';

const long = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/**
 * We never assume when you leave: ask for the resignation date, last working day and notice
 * period, show the shortfall they imply, and only then use them.
 */
export function ExitQuestion(props: {
  emp: Employment;
  next: Employment;
  fy: number;
  thirty: boolean;
  onConfirm: (e: Employment) => void;
  onChangeNext: (e: Employment) => void;
}) {
  const e = props.emp;
  const [resigned, setResigned] = useState<'yes' | 'no' | null>(e.resignedOn ? 'yes' : null);
  const [resignedOn, setResignedOn] = useState(e.resignedOn ?? '');
  const [end, setEnd] = useState(e.end);
  const [notice, setNotice] = useState(e.noticeDays ?? 0);
  const draft: Employment = { ...e, resignedOn: resignedOn || undefined, end, noticeDays: notice || undefined };
  const shortfall = noticeShortfall(draft);
  const f = fnfItems({ ...draft, fnf: { leaveDays: 0, clawback: 0, ...(e.fnf ?? {}), noticeDaysRecovered: shortfall ?? 0 } }, props.fy, props.thirty);
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>When do you leave {e.name}?</strong> We need your dates to work out your last salary, notice recovery and tax. Until you confirm, we're using{' '}
        {long(e.end)}, the day before {props.next.name || 'your new job'} starts.
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
          <OverlapFix end={end} emp={e} next={props.next} onEnd={setEnd} onNextStart={(v) => props.onChangeNext({ ...props.next, start: v, startSource: 'user' })} />
          {shortfall !== undefined && (
            <p class="note">
              {shortfall > 0
                ? `You serve ${notice - shortfall} of ${notice} days. Shortfall: ${shortfall} days${f ? `, about ${rs(f.noticePerDay * shortfall)} recovered (${f.noticeRateLabel} a day)` : ''}. ${props.next.name || 'Your new employer'} may reimburse this as a notice buyout.`
                : `You serve your full notice. No recovery.`}
            </p>
          )}
          <button
            type="button"
            class="btn primary"
            disabled={!end || (!!props.next.start && end >= props.next.start)}
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
