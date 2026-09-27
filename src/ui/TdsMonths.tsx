import { addMonths, fyEnd, fyStart, maxDate, monthName, minDate, monthOf } from '../domain/fy';
import type { Employment, Scenario } from '../domain/types';
import { Money } from './controls';

/** Tax actually deducted in each past month: read from files, or typed in from payslips. */
export function TdsMonths(props: { emp: Employment; s: Scenario; onChange: (e: Employment) => void }) {
  const { emp: e, s } = props;
  const todayMonth = monthOf(s.today);
  const from = monthOf(maxDate(e.start || fyStart(s.fy), fyStart(s.fy)));
  const to = monthOf(minDate(e.end || fyEnd(s.fy), fyEnd(s.fy)));
  const months: string[] = [];
  for (let m = from; m <= to && m < todayMonth; m = addMonths(m, 1)) months.push(m);
  if (!months.length) return null;
  const manual = e.tdsManual ?? {};
  const set = (m: string, v: number | null) => {
    const next = { ...manual };
    if (v === null) delete next[m];
    else next[m] = v;
    props.onChange({ ...e, tdsManual: next });
  };
  return (
    <div class="tds-months">
      <span class="field-label">Tax (TDS) deducted each month</span>
      <p class="muted small">From your payslips. Months read from your files are filled in; change any that are wrong. Empty months are estimated.</p>
      <div class="tds-grid">
        {months.map((m) => {
          const own = manual[m];
          const file = e.tdsKnown?.[m];
          return (
            <label class="tds-cell">
              <span class="small">
                {monthName(m, false)}
                {own !== undefined ? (
                  <button type="button" class="btn link tiny" onClick={() => set(m, null)} aria-label={`Undo ${monthName(m, false)} TDS`}>
                    {file !== undefined ? 'use file' : 'clear'}
                  </button>
                ) : file !== undefined ? (
                  <span class="muted tiny"> · file</span>
                ) : null}
              </span>
              <Money value={own ?? file ?? 0} onChange={(v) => set(m, v)} ariaLabel={`TDS ${monthName(m, false)}`} />
            </label>
          );
        })}
      </div>
    </div>
  );
}
