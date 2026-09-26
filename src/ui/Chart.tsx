import { useState } from 'preact/hooks';
import type { MonthSummary } from '../domain/compute';
import { monthName } from '../domain/fy';
import { rs, rsShort } from '../format';

const W = 360;
const H = 200;
const PAD = { l: 40, r: 8, t: 12, b: 24 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Stacked monthly in-hand bars, one colour per employer, with a tap/hover tooltip. */
export function CashflowChart(props: { months: MonthSummary[]; currentName?: string; nextName: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ms = props.months;
  const byEmp = ms.map((m) => ({
    cur: m.lines.filter((l) => l.employer === 'current').reduce((a, l) => a + Math.max(0, l.inHand), 0),
    nxt: m.lines.filter((l) => l.employer === 'next').reduce((a, l) => a + Math.max(0, l.inHand), 0),
  }));
  const max = niceMax(Math.max(...byEmp.map((b) => b.cur + b.nxt)));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const slot = iw / 12;
  const bw = Math.min(22, slot - 6);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const hasCur = byEmp.some((b) => b.cur > 0);

  // Bar with only the top corners rounded (4px), anchored to the baseline.
  const bar = (x: number, y0: number, y1: number, roundTop: boolean) => {
    const h = y0 - y1;
    if (h <= 0.5) return '';
    const r = roundTop ? Math.min(4, h, bw / 2) : 0;
    return `M${x},${y0}V${y1 + r}${r ? `Q${x},${y1} ${x + r},${y1}` : ''}H${x + bw - r}${r ? `Q${x + bw},${y1} ${x + bw},${y1 + r}` : ''}V${y0}Z`;
  };

  const tip = hover !== null ? ms[hover] : null;
  return (
    <figure class="chart">
      <figcaption class="chart-head">
        <span class="chart-title">Money reaching your bank each month</span>
        <span class="legend">
          {hasCur && (
            <span>
              <i class="sw s2" />
              {props.currentName || 'Current job'}
            </span>
          )}
          <span>
            <i class="sw s1" />
            {props.nextName || 'New job'}
          </span>
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
          {ms.map((m, i) => {
            const x = PAD.l + i * slot + (slot - bw) / 2;
            const b = byEmp[i];
            const base = y(0);
            const yc = y(b.cur);
            const yt = y(b.cur + b.nxt);
            const gap = b.cur > 0 && b.nxt > 0 ? 2 : 0;
            return (
              <g class={`col ${m.past ? 'past' : ''} ${hover === i ? 'hover' : ''}`}>
                <path d={bar(x, base, yc, b.nxt === 0)} class="s2" />
                <path d={bar(x, yc - gap, yt, true)} class="s1" />
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
                <i class={`sw ${l.employer === 'current' ? 's2' : 's1'}`} />
                <span>{l.employerName}</span>
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
