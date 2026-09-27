import { dayBefore } from '../state';
import type { Employment } from '../domain/types';

const long = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dayAfter = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** You can't be on two payrolls at once: when the dates overlap, say so and offer both fixes. */
export function OverlapFix(props: { end: string; emp: Employment; next: Employment; onEnd: (end: string) => void; onNextStart: (start: string) => void }) {
  const { end, emp, next } = props;
  if (!end || !next.start || end < next.start) return null;
  return (
    <div class="callout err overlap" role="alert">
      <p>
        <strong>These dates clash.</strong> Your last day at {emp.name || 'this job'} ({long(end)}) is on or after the day you join {next.name || 'the next job'} (
        {long(next.start)}). Which is right?
      </p>
      <div class="overlap-actions">
        <button type="button" class="btn small" onClick={() => props.onEnd(dayBefore(next.start))}>
          Last day is {long(dayBefore(next.start))}
        </button>
        <button type="button" class="btn small" onClick={() => props.onNextStart(dayAfter(end))}>
          I join on {long(dayAfter(end))}
        </button>
      </div>
    </div>
  );
}
