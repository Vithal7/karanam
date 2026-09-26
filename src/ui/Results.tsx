import { useState } from 'preact/hooks';
import type { Result } from '../domain/compute';
import { fyLabel, monthName } from '../domain/fy';
import type { MonthLine, Scenario } from '../domain/types';
import { pct, rs } from '../format';
import { CashflowChart } from './Chart';
import { Field, Percent, Toggle } from './controls';

function Stat(props: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div class={`stat ${props.tone ?? ''}`}>
      <span class="stat-label">{props.label}</span>
      <span class="stat-value num">{props.value}</span>
      {props.sub && <span class="stat-sub">{props.sub}</span>}
    </div>
  );
}

function LineDetail({ l }: { l: MonthLine }) {
  const rows: [string, number][] = [
    ['Basic', l.basic],
    ['HRA', l.hra],
    ['Special allowance', l.special],
    ['Other allowances', l.others],
    ...l.oneTimes.map((o) => [o.label, o.amount] as [string, number]),
  ];
  const ded: [string, number][] = [
    ['PF', l.epf],
    ['Professional tax', l.pt],
    ['NPS', l.nps],
    ['Recoveries', l.recoveries],
    [l.tdsEstimated ? 'Income tax (TDS, estimated)' : 'Income tax (TDS)', l.tds],
  ];
  return (
    <div class="detail">
      <div class="detail-head">
        {l.employerName}
        {l.factor < 1 && l.factor > 0 && <span class="muted"> · {Math.round(l.factor * 100)}% of the month</span>}
      </div>
      <dl>
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <>
              <dt>{k}</dt>
              <dd class="num">{rs(v)}</dd>
            </>
          ))}
        <dt class="strong">Gross</dt>
        <dd class="num strong">{rs(l.gross)}</dd>
        {ded
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <>
              <dt>− {k}</dt>
              <dd class="num">{rs(v)}</dd>
            </>
          ))}
        <dt class="strong">In hand</dt>
        <dd class="num strong">{rs(l.inHand)}</dd>
      </dl>
    </div>
  );
}

function MonthTable({ r }: { r: Result }) {
  return (
    <div class="card flush">
      <table class="months">
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col" class="r">
              Gross
            </th>
            <th scope="col" class="r">
              Tax
            </th>
            <th scope="col" class="r">
              In hand
            </th>
          </tr>
        </thead>
        {r.months.map((m) => (
          <tbody class={m.past ? 'past' : ''}>
            <tr>
              <td colSpan={4} class="p0">
                <details>
                  <summary>
                    <span class="c-month">
                      {monthName(m.month)}
                    </span>
                    <span class="num r">{m.lines.length ? rs(m.gross) : '—'}</span>
                    <span class="num r">{m.lines.length ? rs(m.tds) : '—'}</span>
                    <span class="num r strong">{m.lines.length ? rs(m.inHand) : '—'}</span>
                  </summary>
                  {m.lines.map((l) => (
                    <LineDetail l={l} />
                  ))}
                  {!m.lines.length && <p class="detail muted">No salary this month.</p>}
                </details>
              </td>
            </tr>
          </tbody>
        ))}
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td class="num r">{rs(r.totals.gross)}</td>
            <td class="num r">{rs(r.totals.tds)}</td>
            <td class="num r strong">{rs(r.totals.inHand)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function WhyLess({ s, r }: { s: Scenario; r: Result }) {
  const ctc = s.next.ctc;
  if (!ctc) return null;
  const st = r.steady;
  const notMonthly = ctc / 12 - st.gross;
  const items: [string, number, string?][] = [
    ['CTC ÷ 12', ctc / 12],
    ['Not paid monthly', -notMonthly, 'Employer PF, gratuity, insurance, variable pay and bonuses. Part of CTC, but not in your monthly salary.'],
    ['Your PF', -st.epf],
    ['Professional tax', -st.pt],
    ...(st.nps ? ([['NPS', -st.nps]] as [string, number][]) : []),
    ['Income tax', -st.tds, 'For a normal full year on this salary.'],
  ];
  const max = ctc / 12;
  return (
    <div class="card">
      <h3>Why your in-hand isn't CTC ÷ 12</h3>
      <ul class="waterfall">
        {items.map(([k, v, hint]) => (
          <li>
            <div class="wf-row">
              <span>{k}</span>
              <span class="num">{v < 0 ? `− ${rs(-v)}` : rs(v)}</span>
            </div>
            <div class="wf-bar" aria-hidden="true">
              <span class={v < 0 ? 'neg' : 'pos'} style={{ width: `${Math.min(100, (Math.abs(v) / max) * 100)}%` }} />
            </div>
            {hint && <div class="muted small">{hint}</div>}
          </li>
        ))}
        <li class="wf-total">
          <div class="wf-row">
            <span>In hand, a normal month</span>
            <span class="num">{rs(st.inHand)}</span>
          </div>
          <div class="muted small">{pct(st.inHand / (ctc / 12), 0)} of CTC ÷ 12</div>
        </li>
      </ul>
    </div>
  );
}

function TaxPosition({ r, s }: { r: Result; s: Scenario }) {
  const f = r.filing;
  const refund = f.balance < 0;
  const firstNext = r.nextStage.find((x) => !x.known);
  return (
    <div class="card">
      <h3>Your tax for {fyLabel(r.fy)}</h3>
      <dl class="kv">
        <dt>Total taxable salary</dt>
        <dd class="num">{rs(f.gross)}</dd>
        <dt>− Standard deduction</dt>
        <dd class="num">{rs(f.standardDeduction)}</dd>
        {f.npsDeduction > 0 && (
          <>
            <dt>− Employer NPS, 80CCD(2)</dt>
            <dd class="num">{rs(f.npsDeduction)}</dd>
          </>
        )}
        {f.leaveExemption > 0 && (
          <>
            <dt>− Leave encashment, 10(10AA)</dt>
            <dd class="num">{rs(f.leaveExemption)}</dd>
          </>
        )}
        <dt class="strong">Taxable income</dt>
        <dd class="num strong">{rs(f.taxable)}</dd>
        <dt>Tax on slabs</dt>
        <dd class="num">{rs(f.slabTax)}</dd>
        {f.rebate > 0 && (
          <>
            <dt>− Rebate u/s 87A</dt>
            <dd class="num">{rs(f.rebate)}</dd>
          </>
        )}
        {f.surcharge > 0 && (
          <>
            <dt>+ Surcharge</dt>
            <dd class="num">{rs(f.surcharge)}</dd>
          </>
        )}
        <dt>+ Cess 4%</dt>
        <dd class="num">{rs(f.cess)}</dd>
        <dt class="strong">Tax for the year</dt>
        <dd class="num strong">{rs(f.total)}</dd>
        <dt>− TDS by employers</dt>
        <dd class="num">{rs(f.tdsTotal)}</dd>
        <dt class="strong">{refund ? 'Refund when you file' : 'To pay when you file'}</dt>
        <dd class={`num strong ${refund ? 'good' : f.balance > 1000 ? 'bad' : ''}`}>{rs(Math.abs(f.balance))}</dd>
      </dl>
      {s.current && r.form12B && firstNext && (
        <p class="note">
          Give your new employer <strong>Form 12B</strong> (your earlier salary and TDS) so it can deduct tax correctly. We assumed they have it by{' '}
          {monthName(r.form12B)}.
        </p>
      )}
      {s.current && !r.form12B && f.balance > 1000 && (
        <p class="note">Without Form 12B your new employer taxes you as if you earned nothing earlier this year. That's why there is tax left to pay at filing.</p>
      )}
      {f.balance > 10000 && (
        <p class="note">
          If more than ₹10,000 is still due, advance tax applies. Pay it before 15 March, or ask your employer to deduct more TDS, to avoid interest under 234B/234C.
        </p>
      )}
    </div>
  );
}

function NextFy({ r, s, onHike }: { r: Result; s: Scenario; onHike: (v: number) => void }) {
  const n = r.nextFy;
  const monthly = n.lines.filter((l) => !l.oneTimes.length);
  const typical = monthly[0] ?? n.lines[0];
  return (
    <div class="card">
      <h3>{fyLabel(n.fy)} at {s.next.name || 'the new job'}</h3>
      <div class="grid2">
        <Field label="Expected hike">
          <Percent value={s.settings.nextFyHike} onChange={onHike} ariaLabel="Expected hike percent" />
        </Field>
        <div class="field">
          <span class="field-label">Effective hike</span>
          <span class="bigval num">{pct(n.effectiveHike, 2)}</span>
          <span class="field-hint">Prorated for {n.daysServed} days worked in the first year</span>
        </div>
      </div>
      <div class="stats">
        <Stat label="In hand, a normal month" value={typical ? rs(typical.inHand) : '—'} />
        <Stat label={`Total in hand, ${fyLabel(n.fy)}`} value={rs(n.inHand)} />
        <Stat label="Tax for the year" value={rs(n.tax)} sub={`${rs(n.tax / 12)} TDS a month`} />
      </div>
      {n.lines.some((l) => l.oneTimes.length) && (
        <p class="muted small">
          Includes{' '}
          {n.lines
            .flatMap((l) => l.oneTimes.map((o) => `${o.label} ${rs(o.amount)} in ${monthName(l.month)}`))
            .join(', ')}
          .
        </p>
      )}
    </div>
  );
}

export function downloadCsv(r: Result) {
  const head = ['Month', 'Employer', 'Basic', 'HRA', 'Special', 'Other allowances', 'One-time', 'Gross', 'PF', 'PT', 'NPS', 'Recoveries', 'TDS', 'In hand'];
  const rows = r.months.flatMap((m) =>
    m.lines.map((l) =>
      [
        monthName(m.month),
        l.employerName,
        l.basic,
        l.hra,
        l.special,
        l.others,
        l.oneTimes.reduce((a, o) => a + o.amount, 0),
        l.gross,
        l.epf,
        l.pt,
        l.nps,
        l.recoveries,
        l.tds,
        l.inHand,
      ].map((v) => (typeof v === 'number' ? Math.round(v) : `"${v.replace(/"/g, '""')}"`)),
    ),
  );
  const csv = [head, ...rows].map((r) => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `in-hand-${fyLabel(r.fy).replace(/\s/g, '')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function Results(props: {
  r: Result;
  s: Scenario;
  showNextFy: boolean;
  setShowNextFy: (v: boolean) => void;
  onHike: (v: number) => void;
}) {
  const { r, s } = props;
  const [showStage, setShowStage] = useState(false);
  const f = r.filing;
  const remainingFrom = r.months.find((m) => !m.past && m.lines.length)?.month;
  return (
    <div class="results">
      <div class="stats">
        {s.next.ctc > 0 && <Stat label="CTC in the letter" value={rs(s.next.ctc)} sub={`${rs(s.next.ctc / 12)} ÷ 12`} />}
        <Stat label="In hand at the new job, a normal month" value={rs(r.steady.inHand)} sub={`after ${rs(r.steady.tds)} tax`} />
        <Stat
          label={remainingFrom ? `Cash to you, ${monthName(remainingFrom, false)}–Mar` : 'Cash to you this year'}
          value={rs(remainingFrom ? r.totals.remainingInHand : r.totals.inHand)}
          sub={`${r.totals.remainingMonths} month${r.totals.remainingMonths === 1 ? '' : 's'}`}
        />
        <Stat
          label={f.balance < 0 ? 'Refund at filing' : 'Pay at filing'}
          value={rs(Math.abs(f.balance))}
          tone={f.balance < 0 ? 'good' : f.balance > 1000 ? 'bad' : undefined}
        />
      </div>

      <CashflowChart months={r.months} currentName={s.current?.name} nextName={s.next.name} />
      <MonthTable r={r} />
      <p class="muted small">Tap a month for the details. Faded months are already paid. Estimated TDS follows how payroll spreads tax over the months left in the year.</p>

      <WhyLess s={s} r={r} />
      <TaxPosition r={r} s={s} />

      {r.nextStage.length > 0 && (
        <div class="card">
          <button type="button" class="btn link" aria-expanded={showStage} onClick={() => setShowStage(!showStage)}>
            {showStage ? 'Hide' : 'Show'} how the new employer works out TDS
          </button>
          {showStage && (
            <table class="stage">
              <thead>
                <tr>
                  <th>Month</th>
                  <th class="r">Taxable they see</th>
                  <th class="r">Tax</th>
                  <th class="r">TDS</th>
                </tr>
              </thead>
              <tbody>
                {r.nextStage.map((x) => (
                  <tr>
                    <td>{monthName(x.month)}</td>
                    <td class="num r">{rs(x.taxable)}</td>
                    <td class="num r">{rs(x.tax)}</td>
                    <td class="num r">{rs(x.tds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div class="card">
        <Toggle checked={props.showNextFy} onChange={props.setShowNextFy} label={<strong>Show next year ({fyLabel(r.nextFy.fy)})</strong>} />
      </div>
      {props.showNextFy && <NextFy r={r} s={s} onHike={props.onHike} />}

      <p class="muted small disclaimer">
        A rough estimate under the new tax regime. It includes the standard deduction, employer NPS under 80CCD(2) and leave encashment exempt up to ₹25 lakh under 10(10AA). It leaves out
        other income, perquisites and the other 10(10AA) limits. Payroll rounding differs by employer.
      </p>
    </div>
  );
}
