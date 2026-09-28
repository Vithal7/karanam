/**
 * Offers side by side. Other offers aren't part of your timeline (they haven't happened). Each is
 * worked out as the year it would give you:
 *  - you're joining a job that hasn't started: the other offer takes its place;
 *  - you're staying where you are: "stay" against "leave, then join the offer".
 * The job you leave ends the day before the offer starts, and its notice recovery follows.
 */
import { useMemo, useState } from 'preact/hooks';
import { compute } from '../domain/compute';
import { addMonths } from '../domain/fy';
import { noticeShortfall } from '../domain/schedule';
import type { Employment, Scenario } from '../domain/types';
import { rs } from '../format';
import type { Rules } from '../rules';
import { dayBefore } from '../state';
import { Uploader, type ReadFile } from './Uploader';

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const long = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Replace the job you're joining (it hasn't started), or add the offer after the job you have. */
export const compareMode = (s: Scenario): 'replace' | 'add' => {
  const last = s.employers[s.employers.length - 1];
  return last.start > s.today ? 'replace' : 'add';
};

/** When you'd join an offer with no date: after your notice period, or in two months. */
function assumedStart(s: Scenario, prev: Employment): string {
  const notice = prev.noticeDays ?? 60;
  const d = addDays(s.today, notice);
  // Joining is usually on the 1st of a month.
  return `${addMonths(d.slice(0, 7), 1)}-01`;
}

/** Your year with `alt` taken: in place of the job you're joining, or after the one you have. */
export function withOffer(s: Scenario, alt: Employment): { s: Scenario; note?: string } {
  const mode = compareMode(s);
  const kept = mode === 'replace' ? s.employers.slice(0, -1) : s.employers;
  const cur = s.employers[s.employers.length - 1];
  const prev = kept[kept.length - 1];
  const dated = alt.startSource !== 'default' && !!alt.start;
  const start = dated ? alt.start : mode === 'replace' ? cur.start : assumedStart(s, prev);
  const notes: string[] = [];
  if (!dated) notes.push(`${alt.name || 'The offer'} has no joining date, so ${long(start)} is assumed.`);
  const job: Employment = {
    ...alt,
    start,
    startSource: dated ? alt.startSource : 'user',
    // Your own choices carry over; the other employer's terms (buyout) don't.
    form12B: mode === 'replace' ? cur.form12B : 'second',
    form12BConfirmed: true,
    location: alt.location ?? (mode === 'replace' ? cur.location : prev?.location),
    buyout: alt.buyout ?? { mode: 'none' },
    asked: { ...alt.asked, nps: true, buyout: true, relocation: true },
  };
  // The job you leave ends the day before; with your resignation date, its notice shortfall follows.
  const employers = kept.map((e, i) => {
    if (i !== kept.length - 1 || e.totalsOnly) return e;
    // A last day from your papers or you stays; an assumed one (the day before the job in your
    // timeline) moves to the day before this offer.
    if (e.end && e.end < start && e.endSource !== 'assumed') return e;
    // Not resigned yet: you'd resign today, so any notice you can't serve before joining is recovered.
    const out: Employment = { ...e, end: dayBefore(start), endSource: 'assumed', resignedOn: e.resignedOn ?? (s.today < start ? s.today : undefined), fnf: e.fnf ?? { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0 } };
    const short = noticeShortfall(out);
    if (short !== undefined) out.fnf = { ...out.fnf!, noticeDaysRecovered: short, noticeAmount: undefined };
    if (e.end !== out.end) notes.push(`Assumes your last day at ${e.name || 'your job'} is ${long(out.end)}.`);
    return out;
  });
  return { s: { ...s, employers: [...employers, job] }, note: notes.join(' ') || undefined };
}

interface Col {
  label: string;
  sub: string;
  e: Employment;
  r: ReturnType<typeof compute>;
  current: boolean;
  note?: string;
}

interface Row {
  label: string;
  hint?: string;
  /** Higher is better: the best column is marked. Rows without it are facts, not scores. */
  better?: boolean;
  value: (c: Col) => number;
}

const ROWS: Row[] = [
  { label: 'CTC', value: (c) => c.e.ctc },
  { label: 'Normal month in hand', hint: 'A full month after PF, PT and income tax, with no bonuses.', better: true, value: (c) => c.r.steady.inHand },
  { label: 'In hand this financial year', hint: 'Everything that reaches your bank from 1 April to 31 March, from every job, including any gap between jobs.', better: true, value: (c) => c.r.totals.inHand },
  { label: 'Joining bonus', value: (c) => c.e.oneTimes.filter((o) => o.kind === 'joining').reduce((a, o) => a + o.amount, 0) },
  { label: 'Variable pay (yearly target)', value: (c) => (c.e.variable?.annual ?? 0) * (c.e.variable?.payoutPct ?? 1) },
  { label: 'Tax for the year', value: (c) => c.r.filing.total },
  { label: 'In hand next year', hint: 'The next financial year on this salary.', better: true, value: (c) => c.r.nextFy.inHand },
];

export function CompareOffers(props: {
  s: Scenario;
  rules: Rules;
  alternatives: Employment[];
  onAdd: (files: ReadFile[]) => void;
  onRemove: (id: string) => void;
  onTake: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const mode = compareMode(props.s);
  const cur = props.s.employers[props.s.employers.length - 1];
  const cols: Col[] = useMemo(
    () => [
      { label: cur.name || 'Your job', sub: mode === 'replace' ? 'in your timeline' : 'if you stay', e: cur, r: compute(props.s, props.rules), current: true },
      ...props.alternatives.map((a) => {
        const w = withOffer(props.s, a);
        const e = w.s.employers[w.s.employers.length - 1];
        return { label: e.name || 'Offer', sub: `joining ${long(e.start)}`, e, r: compute(w.s, props.rules), current: false, note: w.note };
      }),
    ],
    [props.s, props.alternatives, props.rules],
  );
  return (
    <div class="card">
      <h3>Compare offers</h3>
      {props.alternatives.length === 0 ? (
        <p class="muted small">
          Weighing {mode === 'replace' ? 'another offer' : 'an offer'}? Add its letter, or describe it ("Offer from Beta, 28 LPA, joining 1 Jan"), to see it next to{' '}
          {mode === 'replace' ? cur.name || 'this one' : `staying at ${cur.name || 'your job'}`}. It stays out of your timeline.
        </p>
      ) : (
        <div class="table-wrap">
          <table class="compare">
            <thead>
              <tr>
                <th />
                {cols.map((c) => (
                  <th>
                    {c.label}
                    <span class="muted small"> · {c.sub}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const vals = cols.map((c) => row.value(c));
                const best = Math.max(...vals);
                return (
                  <tr>
                    <th scope="row" title={row.hint}>
                      {row.label}
                    </th>
                    {vals.map((v) => (
                      <td class={`num ${row.better && v === best && vals.some((x) => x !== v) ? 'best' : ''}`}>{v ? rs(v) : '—'}</td>
                    ))}
                  </tr>
                );
              })}
              <tr>
                <th />
                {cols.map((c) =>
                  c.current ? (
                    <td />
                  ) : (
                    <td>
                      <button type="button" class="btn small" onClick={() => props.onTake(c.e.id)}>
                        {mode === 'replace' ? 'Take this one' : 'I’m taking it'}
                      </button>{' '}
                      <button type="button" class="btn small ghost" onClick={() => confirm(`Remove the ${c.label} offer?`) && props.onRemove(c.e.id)}>
                        Remove
                      </button>
                    </td>
                  ),
                )}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {cols
        .filter((c) => c.note)
        .map((c) => (
          <p class="note">{c.note}</p>
        ))}
      {cols.slice(1).some((c) => c.e.splitGuessed) && <p class="note">Offers with only a CTC use a typical split (basic half of fixed pay). Add the letter for exact figures.</p>}
      {cols.length > 1 && <p class="muted small">A notice buyout is counted for another offer only when its letter or your note says so.</p>}
      {adding ? (
        <Uploader
          compact
          buttonLabel="Add the other offer"
          onFiles={(f) => {
            props.onAdd(f);
            setAdding(false);
          }}
        />
      ) : (
        <button type="button" class="btn link" onClick={() => setAdding(true)}>
          + Add an offer to compare
        </button>
      )}
    </div>
  );
}
