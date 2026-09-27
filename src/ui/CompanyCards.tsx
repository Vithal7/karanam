import type { ComponentChildren } from 'preact';
import type { Result } from '../domain/compute';
import { fyEnd, fyStart, maxDate, minDate, monthName, monthOf } from '../domain/fy';
import type { Scenario } from '../domain/types';
import { rs } from '../format';
import { seriesClass } from './Chart';

const short = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '…');

/** One card per company: dates in this FY and the money it puts in your bank, received vs to come. */
export function CompanyCards(props: { s: Scenario; r: Result; children?: (index: number) => ComponentChildren; badges?: boolean; money?: boolean }) {
  const { s, r } = props;
  const n = s.employers.length;
  const todayMonth = monthOf(s.today);
  return (
    <div class="companies">
      {s.employers.map((e, k) => {
        const lines = r.employers[k]?.lines ?? [];
        const total = lines.reduce((a, l) => a + l.inHand, 0);
        const got = lines.filter((l) => l.month < todayMonth).reduce((a, l) => a + l.inHand, 0);
        const tds = lines.reduce((a, l) => a + l.tds, 0);
        const from = maxDate(e.start || fyStart(s.fy), fyStart(s.fy));
        const to = minDate(e.end || fyEnd(s.fy), fyEnd(s.fy));
        const upcoming = e.start > s.today;
        return (
          <div class={`card company ${seriesClass(k, n)}`}>
            <div class="company-head">
              <span class={`sw ${seriesClass(k, n)}`} aria-hidden="true" />
              <strong>{e.name || `Job ${k + 1}`}</strong>
              {props.badges && <span class={`badge ${k === n - 1 ? 'new' : ''}`}>{k === n - 1 ? (n > 1 ? (upcoming ? 'Joining' : 'Current') : 'Your job') : e.end && e.end < s.today ? 'Left' : 'Leaving'}</span>}
            </div>
            <div class="muted small">
              {e.startSource === 'default'
                ? 'Joining date not found'
                : e.startSource === 'approx'
                  ? `Joined around ${short(e.start)}`
                  : `${upcoming ? 'Joins' : 'Joined'} ${short(e.start)}`}
              {e.end && ` · ${e.end < s.today ? 'left' : 'last day'} ${short(e.end)}`}
              {(from !== e.start || to !== e.end) && ` · counted ${short(from)} – ${short(to)}`}
            </div>
            {props.money === false ? null : Math.abs(total) > 500_000_000 || Math.abs(tds) > 500_000_000 ? (
              <p class="callout warn small">These numbers look wrong: a file was probably misread. Open "Check the numbers" and check each file's type and what we read from it.</p>
            ) : e.totalsOnly ? (
              <div class="company-money">
                <div>
                  <span class="stat-label">Earned this year</span>
                  <span class="num strong">{rs(e.totalsOnly.gross)}</span>
                </div>
                <div>
                  <span class="stat-label">Tax deducted</span>
                  <span class="num">{rs(e.totalsOnly.tds)}</span>
                </div>
              </div>
            ) : (
              (() => {
                const sum = (f: (l: (typeof lines)[number]) => number) => lines.reduce((a, l) => a + f(l), 0);
                const gross = sum((l) => l.gross);
                const epf = sum((l) => l.epf);
                const pt = sum((l) => l.pt);
                const nps = sum((l) => l.nps);
                const rec = sum((l) => l.recoveries);
                // Anything else payroll takes, so the statement always adds up to in-hand.
                const other = gross - epf - pt - nps - rec - tds - total;
                const row = (label: string, v: number, cls = '') =>
                  Math.round(v) !== 0 || cls ? (
                    <div class={`stmt-row ${cls}`}>
                      <span>{label}</span>
                      <span class="num">{cls === 'minus' ? `− ${rs(v)}` : rs(v)}</span>
                    </div>
                  ) : null;
                return (
                  <>
                    <div class="stmt" aria-label={`${e.name} this year`}>
                      {row('Gross pay', gross, 'gross')}
                      {row('Income tax (TDS)', tds, 'minus')}
                      {Math.round(epf) !== 0 && row('Provident fund (EPF)', epf, 'minus')}
                      {Math.round(pt) !== 0 && row('Professional tax', pt, 'minus')}
                      {Math.round(nps) !== 0 && row('NPS', nps, 'minus')}
                      {Math.round(rec) !== 0 && row('Recoveries (notice, clawback)', rec, 'minus')}
                      {Math.abs(other) >= 1 && row('Other deductions', other, 'minus')}
                      {row('In hand', total, 'total')}
                    </div>
                    <p class="muted small stmt-foot">
                      {upcoming ? 'Nothing received yet' : `${rs(got)} received so far`} · {rs(total - got)} still to come
                    </p>
                  </>
                );
              })()
            )}
            {props.money !== false && (() => {
              const past = lines.filter((l) => l.month < todayMonth && l.factor > 0);
              if (!past.length || e.totalsOnly) return null;
              const est = past.filter((l) => l.tdsEstimated);
              return (
                <p class={`small ${est.length ? 'callout warn' : 'muted'}`}>
                  {est.length
                    ? `TDS for ${est.map((l) => monthName(l.month, false)).join(', ')} is an estimate. Add payslips or a tax computation sheet to record what was actually deducted.`
                    : `TDS for past months is recorded from your files.`}
                </p>
              );
            })()}
            {props.money !== false && k < n - 1 && !e.totalsOnly && e.end > s.today && e.variable?.annual ? (
              <p class="muted small">This year's variable pay is usually forfeited if you leave before it's paid, so it isn't counted.</p>
            ) : null}
            {props.money !== false && k < n - 1 && !e.totalsOnly && e.end > s.today && (
              <p class="muted small">
                {e.resignedOn
                  ? `Payroll knows you're leaving, so tax is spread over your last months.`
                  : `Until you resign, payroll deducts tax as if you'll stay till March. Add your resignation email or date and the months after it adjust; any extra tax comes back as a refund.`}
              </p>
            )}
            {props.children?.(k)}
          </div>
        );
      })}
    </div>
  );
}
