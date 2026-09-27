import { useState } from 'preact/hooks';
import type { Result } from '../domain/compute';
import { itr1Guide, type ItrField } from '../domain/itr1';
import type { Scenario } from '../domain/types';
import { rs } from '../format';

function Value(props: { f: ItrField }) {
  const [copied, setCopied] = useState(false);
  const v = props.f.value;
  const text = typeof v === 'number' ? String(v) : v;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked: the value is on screen anyway */
    }
  };
  return typeof v === 'number' ? (
    <button type="button" class="itr-val num" onClick={copy} aria-label={`Copy ${props.f.label}: ${text}`}>
      {copied ? 'Copied' : rs(v)}
    </button>
  ) : (
    <span class="itr-val text">{v}</span>
  );
}

/** Filing: what to enter in ITR-1, in the portal's order, and what to reconcile before submitting. */
export function Filing(props: { r: Result; s: Scenario }) {
  const g = itr1Guide(props.r, props.s);
  const pay = g.balance >= 1;
  const nil = Math.abs(g.balance) < 1;
  return (
    <>
      <div class={`card filing-head ${pay ? 'bad' : 'good'}`}>
        <span class="stat-label">{pay ? 'Pay before you file' : nil ? 'Nothing to pay or claim' : 'Refund you should get'}</span>
        <span class="stat-value num">{rs(Math.abs(g.balance))}</span>
        <span class="stat-sub">
          {g.form} · {g.yearLabel} · new regime · file by {g.dueDate}
        </span>
        {(g.interest234B > 0 || g.interest234C > 0) && (
          <p class="small">Includes about {rs(g.interest234B + g.interest234C)} interest (234B/234C) because more than ₹10,000 was still due at year end.</p>
        )}
      </div>

      {g.newAct && (
        <p class="callout info small">
          This year falls under the Income-tax Act, 2025. The portal's form for it may word fields differently and use new section numbers; the amounts below stay the same.
        </p>
      )}

      <div class="card">
        <h3>Can you use {g.form}?</h3>
        <ul class="checks">
          {g.eligibility.checks.map((c) => (
            <li class={c.ok === false ? 'no' : c.ok ? 'yes' : ''}>{c.text}</li>
          ))}
        </ul>
        <p class="muted small">{g.eligibility.ok ? 'If all of these are true, file ITR-1. Otherwise use ITR-2: the salary figures are the same.' : 'Your income is over ₹50 lakh, so file ITR-2. The salary figures below are the same.'}</p>
      </div>

      <h2 class="section">What to enter, step by step</h2>
      <p class="muted small">Tap an amount to copy it. Grey rows are totals the portal works out itself: check they match.</p>
      {g.blocks.map((b, i) => (
        <section class="card itr-block">
          <div class="itr-step">Step {i + 1}</div>
          <h3>{b.title}</h3>
          <p class="itr-where">{b.where}</p>
          <dl class="itr-fields">
            {b.fields.map((f) => (
              <div class={`itr-field ${f.computed ? 'computed' : ''}`}>
                <dt>
                  {f.label}
                  {f.note && <span class="muted small">{f.note}</span>}
                </dt>
                <dd>
                  <Value f={f} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <h2 class="section">Reconcile before you submit</h2>
      <div class="card">
        <p class="muted small">Each employer's Form 16, your Form 26AS and your AIS should show these. Ask the employer to correct any difference before you file.</p>
        <div class="table-scroll">
          <table class="itr-table per-employer">
            <thead>
              <tr>
                <th scope="col">Employer</th>
                <th scope="col" class="r">Gross salary</th>
                <th scope="col" class="r">Exempt</th>
                <th scope="col" class="r">Chargeable</th>
                <th scope="col" class="r">TDS</th>
              </tr>
            </thead>
            <tbody>
              {g.recon.map((x) => (
                <tr>
                  <th scope="row">
                    {x.employer}
                    <span class="muted small">{x.tan ? ` · TAN ${x.tan}` : ''}</span>
                    {x.estimatedMonths > 0 && <span class="badge warn">TDS partly estimated</span>}
                  </th>
                  <td class="num r">{rs(x.gross)}</td>
                  <td class="num r">{rs(x.exempt)}</td>
                  <td class="num r">{rs(x.chargeable)}</td>
                  <td class="num r">{rs(x.tds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ol class="checklist">
          <li>Form 16 Part A: TDS deposited per quarter. It should add up to the TDS column.</li>
          <li>Form 16 Part B: gross salary and exemptions. It should match the first two columns.</li>
          <li>AIS / 26AS on the portal: the salary and TDS reported under each TAN. It should match both.</li>
          <li>If an employer's figures differ from ours, theirs are what the department has. Use them, or get them corrected.</li>
        </ol>
      </div>
      <p class="muted small">Salary only. Add interest, rent, capital gains or other income yourself: they change the form and the tax.</p>
    </>
  );
}
