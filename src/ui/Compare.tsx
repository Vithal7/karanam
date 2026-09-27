/**
 * Offers side by side. Other offers aren't part of your timeline (they haven't happened): each is
 * worked out as if you took it instead of the job you're joining, with everything else the same.
 */
import { useMemo, useState } from 'preact/hooks';
import { compute } from '../domain/compute';
import type { Employment, Scenario } from '../domain/types';
import { rs } from '../format';
import type { Rules } from '../rules';
import { Uploader, type ReadFile } from './Uploader';

/** Your scenario with `alt` in place of the job you're joining; your answers about that move carry over. */
export function withOffer(s: Scenario, alt: Employment): Scenario {
  const cur = s.employers[s.employers.length - 1];
  const job: Employment = {
    ...alt,
    start: alt.startSource === 'default' ? cur.start : alt.start,
    form12B: cur.form12B,
    form12BConfirmed: cur.form12BConfirmed,
    location: alt.location ?? cur.location,
    buyout: alt.buyout ?? cur.buyout,
    asked: { ...cur.asked, ...alt.asked },
  };
  return { ...s, employers: [...s.employers.slice(0, -1), job] };
}

interface Row {
  label: string;
  hint?: string;
  value: (x: { s: Scenario; e: Employment; r: ReturnType<typeof compute> }) => number;
}

const ROWS: Row[] = [
  { label: 'CTC', value: ({ e }) => e.ctc },
  { label: 'Normal month in hand', hint: 'A full month after PF, PT and income tax, with no bonuses.', value: ({ r }) => r.steady.inHand },
  { label: 'In hand from this job till 31 March', value: ({ r }) => r.employers[r.employers.length - 1]?.lines.reduce((a, l) => a + l.inHand, 0) ?? 0 },
  { label: 'Joining bonus', value: ({ e }) => e.oneTimes.filter((o) => o.kind === 'joining').reduce((a, o) => a + o.amount, 0) },
  { label: 'Variable pay (yearly target)', value: ({ e }) => (e.variable?.annual ?? 0) * (e.variable?.payoutPct ?? 1) },
  { label: 'Tax for the year', value: ({ r }) => r.filing.total },
  { label: 'In hand next year', hint: 'The next financial year on this salary.', value: ({ r }) => r.nextFy.inHand },
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
  const cur = props.s.employers[props.s.employers.length - 1];
  const cols = useMemo(
    () => [
      { e: cur, s: props.s, r: compute(props.s, props.rules), current: true },
      ...props.alternatives.map((a) => {
        const s = withOffer(props.s, a);
        return { e: s.employers[s.employers.length - 1], s, r: compute(s, props.rules), current: false };
      }),
    ],
    [props.s, props.alternatives, props.rules],
  );
  return (
    <div class="card">
      <h3>Compare offers</h3>
      {props.alternatives.length === 0 ? (
        <p class="muted small">Weighing another offer? Add its letter, or describe it ("Offer from Beta, 28 LPA, joining 1 Jan"), to see it next to {cur.name || 'this one'}. It stays out of your timeline.</p>
      ) : (
        <div class="table-wrap">
          <table class="compare">
            <thead>
              <tr>
                <th />
                {cols.map((c) => (
                  <th>
                    {c.e.name || 'Offer'}
                    {c.current && <span class="muted small"> · in your timeline</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const vals = cols.map((c) => row.value(c));
                const best = row.label === 'Tax for the year' ? Math.min(...vals) : Math.max(...vals);
                return (
                  <tr>
                    <th scope="row" title={row.hint}>
                      {row.label}
                    </th>
                    {vals.map((v) => (
                      <td class={`num ${v === best && vals.some((x) => x !== v) ? 'best' : ''}`}>{v ? rs(v) : '—'}</td>
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
                        Take this one
                      </button>{' '}
                      <button type="button" class="btn small ghost" onClick={() => confirm(`Remove the ${c.e.name || 'other'} offer?`) && props.onRemove(c.e.id)}>
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
      {cols.slice(1).some((c) => !c.e.structure.basic) && <p class="note">Offers with only a CTC use a typical split (basic half of fixed pay). Add the letter for exact figures.</p>}
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
