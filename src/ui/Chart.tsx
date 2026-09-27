import { useState } from 'preact/hooks';
import type { MonthSummary } from '../domain/compute';
import { monthName } from '../domain/fy';
import { rs, rsShort, shortCompany } from '../format';

const W = 360;
const H = 200;
const PAD = { l: 40, r: 8, t: 12, b: 24 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Colour slot per job: the offer is always slot 1 (blue); earlier jobs take 2 and 3 in order. */
export const seriesClass = (index: number, count: number) => (index === count - 1 ? 's1' : `s${index + 2}`);

/** Stacked monthly in-hand bars, one colour per job, with a tap/hover tooltip. */
export function CashflowChart(props: { months: MonthSummary[]; names: string[]; today?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ms = props.months;
  const n = props.names.length;
  const stacks = ms.map((m) => props.names.map((_, k) => m.lines.filter((l) => l.employer === k).reduce((a, l) => a + Math.max(0, l.inHand), 0)));
  const max = niceMax(Math.max(...stacks.map((st) => st.reduce((a, b) => a + b, 0))));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const slot = iw / 12;
  const bw = Math.min(22, slot - 6);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const present = props.names.map((_, k) => stacks.some((st) => st[k] > 0));

  // Bar with only the top corners rounded (4px), anchored to its base.
  const bar = (x: number, y0: number, y1: number, roundTop: boolean) => {
    const h = y0 - y1;
    if (h <= 0.5) return '';
    const r = roundTop ? Math.min(4, h, bw / 2) : 0;
    return `M${x},${y0}V${y1 + r}${r ? `Q${x},${y1} ${x + r},${y1}` : ''}H${x + bw - r}${r ? `Q${x + bw},${y1} ${x + bw},${y1 + r}` : ''}V${y0}Z`;
  };

  const tip = hover !== null ? ms[hover] : null;
  // Where today falls: inside its month's slot, by day of month.
  const ti = props.today ? ms.findIndex((m) => m.month === props.today!.slice(0, 7)) : -1;
  const todayX = ti >= 0 ? PAD.l + (ti + Math.min(1, Number(props.today!.slice(8, 10)) / 31)) * slot : null;
  return (
    <figure class="chart">
      <figcaption class="chart-head">
        <span class="chart-title">Money reaching your bank each month</span>
        <span class="legend">
          {props.names.map((name, k) =>
            present[k] ? (
              <span>
                <i class={`sw ${seriesClass(k, n)}`} />
                {shortCompany(name || `Job ${k + 1}`)}
              </span>
            ) : null,
          )}
        </span>
      </figcaption>
      <div class="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly in-hand salary bar chart. The table below lists the same figures." onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} class="grid" />
              <text x={PAD.l - 6} y={y(t) + 3} class="tick" text-anchor="end">
                {rsShort(t)}
              </text>
            </g>
          ))}
          {todayX !== null && (
            <g class="today-mark" aria-hidden="true">
              <line x1={todayX} x2={todayX} y1={PAD.t - 4} y2={PAD.t + ih} />
              <text x={todayX + 3} y={PAD.t + 4} class="tick">
                Today
              </text>
            </g>
          )}
          {ms.map((m, i) => {
            const x = PAD.l + i * slot + (slot - bw) / 2;
            const st = stacks[i];
            const topIndex = st.map((v, k) => (v > 0 ? k : -1)).reduce((a, b) => Math.max(a, b), -1);
            let acc = 0;
            return (
              <g class={`col ${m.past ? 'past' : ''} ${hover === i ? 'hover' : ''}`}>
                {st.map((v, k) => {
                  if (v <= 0) return null;
                  const base = y(acc) - (acc > 0 ? 2 : 0); // 2px surface gap between segments
                  acc += v;
                  return <path d={bar(x, base, y(acc), k === topIndex)} class={seriesClass(k, n)} />;
                })}
                <text x={x + bw / 2} y={H - 8} class="tick" text-anchor="middle">
                  {monthName(m.month, false).slice(0, 1)}
                  <title>{monthName(m.month)}</title>
                </text>
                <rect
                  x={PAD.l + i * slot}
                  y={PAD.t}
                  width={slot}
                  height={ih + PAD.b}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onClick={() => setHover(hover === i ? null : i)}
                />
              </g>
            );
          })}
        </svg>
        {tip && hover !== null && (
          <div class="tooltip" style={{ left: `${((PAD.l + (hover + 0.5) * slot) / W) * 100}%` }} role="status">
            <strong>{monthName(tip.month)}</strong>
            {tip.lines.length === 0 && <div class="muted">No salary</div>}
            {tip.lines.map((l) => (
              <div class="tt-row">
                <i class={`sw ${seriesClass(l.employer, n)}`} />
                <span>{shortCompany(l.employerName)}</span>
                <span class="num">{rs(l.inHand)}</span>
              </div>
            ))}
            {tip.tds > 0 && <div class="muted small">after {rs(tip.tds)} TDS</div>}
            {tip.past && <div class="muted small">already paid</div>}
          </div>
        )}
      </div>
    </figure>
  );
}
