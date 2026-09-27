import type { ComponentChildren } from 'preact';
import type { Result } from '../domain/compute';
import { fyEnd, fyStart, maxDate, minDate, monthOf } from '../domain/fy';
import type { Scenario } from '../domain/types';
import { rs } from '../format';
import { seriesClass } from './Chart';

const short = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '…');

/** One card per company: dates in this FY and the money it puts in your bank, received vs to come. */
export function CompanyCards(props: { s: Scenario; r: Result; children?: (index: number) => ComponentChildren; badges?: boolean }) {
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
            {Math.abs(total) > 500_000_000 || Math.abs(tds) > 500_000_000 ? (
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
              <div class="company-money">
                <div>
                  <span class="stat-label">In hand this year</span>
                  <span class="num strong">{rs(total)}</span>
                </div>
                <div>
                  <span class="stat-label">{upcoming ? 'Received' : 'Received so far'}</span>
                  <span class="num">{rs(got)}</span>
                </div>
                <div>
                  <span class="stat-label">Still to come</span>
                  <span class="num">{rs(total - got)}</span>
                </div>
                <div>
                  <span class="stat-label">Tax (TDS)</span>
                  <span class="num">{rs(tds)}</span>
                </div>
              </div>
            )}
            {k < n - 1 && !e.totalsOnly && e.end > s.today && (
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
