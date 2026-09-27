import { monthLong, monthOf } from '../domain/fy';
import type { TimelineEvent } from '../domain/story';
import { seriesClass } from './Chart';

const dateLabel = (e: TimelineEvent) =>
  e.monthOnly ? monthLong(monthOf(e.date)) : new Date(`${e.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Every dated event in order, with a "Today" line between what happened and what's coming. */
export function Timeline(props: { events: TimelineEvent[]; today: string; jobs: number; from?: string }) {
  const items = props.from ? props.events.filter((e) => e.date >= props.from!) : props.events;
  const todayAt = items.findIndex((e) => e.date > props.today);
  const rows: (TimelineEvent | 'today')[] = [...items];
  rows.splice(todayAt < 0 ? rows.length : todayAt, 0, 'today');
  return (
    <ol class="tline">
      {rows.map((e) =>
        e === 'today' ? (
          <li class="tline-today" aria-label="Today">
            <span>Today, {new Date(`${props.today}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </li>
        ) : (
          <li class={`tline-item ${e.date > props.today ? 'future' : 'past'} ${e.tone ?? ''}`}>
            <span class={`tline-dot ${e.job >= 0 ? seriesClass(e.job, props.jobs) : 'tax'}`} aria-hidden="true" />
            <div class="tline-body">
              <span class="tline-date">
                {dateLabel(e)}
                {e.action && e.date > props.today && <span class="badge todo">To do</span>}
              </span>
              <span class="tline-text">{e.text}</span>
              {e.detail && <span class="tline-detail">{e.detail}</span>}
            </div>
          </li>
        ),
      )}
    </ol>
  );
}
