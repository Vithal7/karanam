import type { Result } from '../domain/compute';
import { fyLabel } from '../domain/fy';
import { itrSummary } from '../domain/itr';
import { rs } from '../format';

/** Refund or payable, the ITR salary schedule per employer, and what to do before filing. */
export function ItrSection({ r }: { r: Result }) {
  const t = itrSummary(r);
  const refund = t.balance < 0;
  const multi = t.employers.length > 1;
  return (
    <section class="card itr" aria-labelledby="itr-h">
      <h2 id="itr-h">Your ITR for {fyLabel(r.fy)}</h2>
      <div class={`itr-headline ${refund ? 'good' : t.balance > 1000 ? 'bad' : ''}`}>
        <span class="stat-label">{refund ? 'Refund you should get' : t.balance > 0 ? 'Tax to pay before filing' : 'Nothing to pay or claim'}</span>
        <span class="stat-value num">{rs(Math.abs(t.balance))}</span>
        <span class="stat-sub">
          {t.form} · AY {t.assessmentYear} · new regime · file by {t.dueDate}
        </span>
      </div>

      <table class="itr-table">
        <tbody>
          <Row label="Gross salary u/s 17(1)" v={t.grossSalary} />
          <Row label="Less: leave encashment u/s 10(10AA)" v={t.employers.reduce((a, e) => a + e.leaveExempt, 0)} />
          <Row label="Less: gratuity u/s 10(10)" v={t.employers.reduce((a, e) => a + e.gratuityExempt, 0)} />
          <Row label="Less: other exempt receipts" v={t.employers.reduce((a, e) => a + e.otherExempt, 0)} />
          <Row label="Net salary" v={t.netSalary} strong />
          <Row label="Less: standard deduction u/s 16(ia)" v={t.standardDeduction} />
          <Row label="Income from salary" v={t.incomeFromSalary} strong />
          <Row label="Less: employer NPS u/s 80CCD(2)" v={t.npsDeduction} />
          <Row label="Total income (rounded)" v={t.totalIncome} strong />
          <Row label="Tax on slabs" v={t.taxBeforeRebate} />
          <Row label="Less: rebate u/s 87A" v={t.rebate} />
          <Row label="Add: surcharge" v={t.surcharge} />
          <Row label="Add: cess 4%" v={t.cess} />
          <Row label="Tax for the year" v={t.totalTax} strong />
          <Row label="Less: TDS by employers" v={t.tds} />
          <Row label={refund ? 'Refund' : 'Payable'} v={Math.abs(t.balance)} strong />
        </tbody>
      </table>

      <h3 class="mt">{multi ? 'Check against each Form 16' : 'Check against your Form 16'}</h3>
      <div class="table-scroll">
        <table class="itr-table per-employer">
          <thead>
            <tr>
              <th scope="col">Employer</th>
              <th scope="col" class="r">
                Gross salary
              </th>
              <th scope="col" class="r">
                TDS
              </th>
            </tr>
          </thead>
          <tbody>
            {t.employers.map((e) => (
              <tr>
                <th scope="row">{e.name}</th>
                <td class="num r">{rs(e.gross)}</td>
                <td class="num r">{rs(e.tds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="muted small">TDS here is our estimate of what payroll deducts. Your Form 16 and AIS show the real figures; use those when you file.</p>

      <h3 class="mt">Before you file</h3>
      <ol class="checklist">
        {t.checklist.map((c) => (
          <li>{c}</li>
        ))}
      </ol>
      <p class="muted small">
        This covers salary only. Add interest, rent, capital gains or other income in the ITR yourself; they can change the form and the tax.
      </p>
    </section>
  );
}

function Row(props: { label: string; v: number; strong?: boolean }) {
  if (!props.v && !props.strong) return null;
  return (
    <tr class={props.strong ? 'strong' : ''}>
      <th scope="row">{props.label}</th>
      <td class="num r">{rs(props.v)}</td>
    </tr>
  );
}
