import { useEffect, useMemo, useState } from 'preact/hooks';
import { compute, fnfItems } from './domain/compute';
import { addMonths, fyLabel, fyOf, fyStart, maxDate, monthOf } from './domain/fy';
import type { Employment, FnF, Scenario } from './domain/types';
import type { Extracted } from './extract/parse';
import { rs, uid } from './format';
import {
  clearSaved,
  effectiveScenario,
  emptyEmployment,
  employmentFromExtract,
  initialState,
  joinsMidYear,
  load,
  save,
  type AppState,
  type StepId,
} from './state';
import { Choices, DateInput, Field, Money, Num, Toggle, Warnings } from './ui/controls';
import { OfferExtras, OneTimeEditor, StructureEditor } from './ui/Editors';
import { Results, downloadCsv } from './ui/Results';
import { Uploader } from './ui/Uploader';

const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const TITLES: Record<StepId, string> = {
  'upload-next': 'Your new offer letter',
  'review-next': 'Check what we found',
  'current-q': 'Before this job',
  'upload-current': 'Your current job',
  'review-current': 'Your current salary',
  exit: 'Leaving your current job',
  prior: 'Earlier this year',
  extras: 'Anything else?',
  results: 'Your money, month by month',
};

export function App() {
  const [st, setSt] = useState<AppState>(() => load() ?? initialState());
  useEffect(() => save(st), [st]);
  useEffect(() => window.scrollTo({ top: 0 }), [st.step]);

  const s = st.scenario;
  const update = (patch: Partial<AppState>) => setSt((x) => ({ ...x, ...patch }));
  const setScenario = (fn: (s: Scenario) => Scenario) => setSt((x) => ({ ...x, scenario: fn(x.scenario) }));
  const setNext = (e: Employment) =>
    setScenario((sc) => ({ ...sc, next: e, fy: fyOf(maxDate(sc.today, e.start || sc.today)) }));
  const setCurrent = (e: Employment) => setScenario((sc) => ({ ...sc, current: e }));
  const go = (step: StepId) => setSt((x) => ({ ...x, step, history: [...x.history, x.step] }));
  const back = () =>
    setSt((x) => (x.history.length ? { ...x, step: x.history[x.history.length - 1], history: x.history.slice(0, -1) } : x));

  const result = useMemo(() => (st.step === 'results' ? compute(effectiveScenario(st)) : null), [st]);

  const afterNext = () => go(joinsMidYear(s) ? 'current-q' : 'extras');

  function onNextExtracted(x: Extracted) {
    const { emp, marks } = employmentFromExtract(x, 'New job', s.today);
    setSt((st0) => ({
      ...st0,
      scenario: { ...st0.scenario, next: emp, fy: fyOf(maxDate(st0.scenario.today, emp.start)) },
      marksNext: marks,
      warningsNext: x.warnings,
      step: 'review-next',
      history: [...st0.history, st0.step],
    }));
  }

  function onCurrentExtracted(x: Extracted | null) {
    let emp: Employment;
    let marks = {};
    let warnings: string[] = [];
    if (x) {
      ({ emp, marks } = employmentFromExtract(x, 'Current job', fyStart(s.fy)));
      warnings = x.warnings.filter((w) => !/date of joining/.test(w));
      // An old joining date just means "here since before this FY".
      emp.start = emp.start > fyStart(s.fy) && emp.start < s.next.start ? emp.start : fyStart(s.fy);
      emp.oneTimes = emp.oneTimes.filter((o) => o.kind !== 'joining' || o.month >= monthOf(fyStart(s.fy)));
      emp.variable = undefined;
      const tds = x.components.tds?.monthly;
      if (tds && st.tdsSoFar === null) {
        const done = Math.max(0, monthsBetween(monthOf(emp.start), monthOf(s.today)));
        update({ tdsSoFar: Math.round(tds * done) });
      }
    } else emp = emptyEmployment('Current job', fyStart(s.fy));
    emp.end = dayBefore(s.next.start);
    setSt((st0) => ({
      ...st0,
      scenario: { ...st0.scenario, current: emp, fnf: st0.scenario.fnf ?? { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0, buyoutByNew: false } },
      marksCurrent: marks,
      warningsCurrent: warnings,
      step: 'review-current',
      history: [...st0.history, st0.step],
    }));
  }

  const stepIndex = ['upload-next', 'review-next', 'current-q', 'extras', 'results'];
  const progress =
    st.step === 'results'
      ? 1
      : (Math.max(0, stepIndex.indexOf(st.step)) + (['upload-current', 'review-current', 'exit', 'prior'].includes(st.step) ? 2.5 : 0)) / 4.5;

  return (
    <div class="app">
      <header class="top">
        <div class="brand">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="logo">
            <rect x="2" y="5" width="20" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8" />
            <path d="M8 9h8M8 12h8M10.5 9c2 0 2 6-1.5 6l4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
          <div>
            <div class="brand-name">In-hand</div>
            <div class="brand-sub">What your offer really pays · {fyLabel(s.fy)}</div>
          </div>
        </div>
        {st.step !== 'upload-next' && (
          <button
            type="button"
            class="btn ghost small"
            onClick={() => {
              if (confirm('Start over? Everything you entered will be cleared.')) {
                clearSaved();
                setSt(initialState());
              }
            }}
          >
            Start over
          </button>
        )}
      </header>
      <div class="progressbar" aria-hidden="true">
        <span style={{ width: `${progress * 100}%` }} />
      </div>

      <main class="main">
        {st.history.length > 0 && (
          <button type="button" class="btn back" onClick={back}>
            ← Back
          </button>
        )}
        <h1>{TITLES[st.step]}</h1>

        {st.step === 'upload-next' && (
          <>
            <p class="lead">
              A ₹30 lakh CTC doesn't mean ₹2.5 lakh a month. Upload your offer letter and see what actually reaches your bank account each month until March, after PF,
              tax and everything else.
            </p>
            <Uploader onExtracted={onNextExtracted} onManual={() => go('review-next')} />
            <p class="muted small center">Works offline. Nothing you enter leaves this device.</p>
          </>
        )}

        {st.step === 'review-next' && (
          <>
            <p class="lead">Fix anything that looks off. Fields marked “check this” were our best guess.</p>
            <Warnings items={st.warningsNext} />
            <div class="card">
              <Field label="Company">
                <input class="text" value={s.next.name} onInput={(e) => setNext({ ...s.next, name: (e.target as HTMLInputElement).value })} />
              </Field>
              <Field label="Date of joining" mark={st.marksNext.start}>
                <DateInput value={s.next.start} onChange={(v) => setNext({ ...s.next, start: v })} ariaLabel="Date of joining" />
              </Field>
            </div>
            <StructureEditor value={s.next.structure} marks={st.marksNext} onChange={(x) => setNext({ ...s.next, structure: x })} />
            <OfferExtras emp={s.next} marks={st.marksNext} onChange={setNext} />
            <Continue disabled={!s.next.structure.basic || !s.next.start} onClick={afterNext} why="Enter at least Basic and the joining date." />
          </>
        )}

        {st.step === 'current-q' && (
          <>
            <p class="lead">
              You join on {new Date(s.next.start).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}. Salary from earlier in{' '}
              {fyLabel(s.fy)} is taxed together with the new one, so tell us about it.
            </p>
            <Choices
              value={st.status}
              onChange={(v) => {
                update({ status: v });
                if (v === 'current') go('upload-current');
                else if (v === 'prior') {
                  setScenario((sc) => ({ ...sc, prior: sc.prior ?? { gross: 0, tds: 0 } }));
                  go('prior');
                } else go('extras');
              }}
              options={[
                { value: 'current', label: 'Yes, I work somewhere now', sub: "We'll work out your last salary, full and final settlement and tax" },
                { value: 'prior', label: 'I worked earlier this year, not now', sub: 'Just the totals from your old payslips' },
                { value: 'none', label: 'No income this year', sub: 'First job, or on a break since April' },
              ]}
            />
          </>
        )}

        {st.step === 'upload-current' && (
          <>
            <p class="lead">Upload your current offer letter, revision letter or latest payslip. A recent payslip works best.</p>
            <Uploader onExtracted={(x) => onCurrentExtracted(x)} onManual={() => onCurrentExtracted(null)} />
          </>
        )}

        {st.step === 'review-current' && s.current && (
          <>
            <Warnings items={st.warningsCurrent} />
            <div class="card">
              <Field label="Company">
                <input class="text" value={s.current.name} onInput={(e) => setCurrent({ ...s.current!, name: (e.target as HTMLInputElement).value })} />
              </Field>
              <Field label="Working there since" hint={`Anything before ${fyStart(s.fy)} doesn't matter for this year.`}>
                <DateInput value={s.current.start} onChange={(v) => setCurrent({ ...s.current!, start: v })} ariaLabel="Working there since" />
              </Field>
            </div>
            <StructureEditor value={s.current.structure} marks={st.marksCurrent} onChange={(x) => setCurrent({ ...s.current!, structure: x })} />
            <div class="card">
              <h3>Has your salary changed since then?</h3>
              <p class="muted small">For example a hike or restructure after the letter or payslip you uploaded.</p>
              <Choices
                value={st.salaryChanged === null ? null : st.salaryChanged ? 'y' : 'n'}
                onChange={(v) => {
                  update({ salaryChanged: v === 'y' });
                  const c = s.current!;
                  if (v === 'y' && !c.revisions.length)
                    setCurrent({ ...c, revisions: [{ from: monthOf(maxDate(s.today, fyStart(s.fy))), structure: { ...c.structure } }] });
                  if (v === 'n') setCurrent({ ...c, revisions: [] });
                }}
                options={[
                  { value: 'n', label: 'No, this is still my salary' },
                  { value: 'y', label: 'Yes, it changed' },
                ]}
              />
            </div>
            {s.current.revisions.map((rv, i) => (
              <>
                <div class="card">
                  <Field label="New salary applies from (month)">
                    <input
                      type="month"
                      class="text"
                      value={rv.from}
                      onInput={(e) =>
                        setCurrent({ ...s.current!, revisions: s.current!.revisions.map((x, j) => (j === i ? { ...x, from: (e.target as HTMLInputElement).value } : x)) })
                      }
                    />
                  </Field>
                </div>
                <StructureEditor
                  value={rv.structure}
                  onChange={(x) => setCurrent({ ...s.current!, revisions: s.current!.revisions.map((y, j) => (j === i ? { ...y, structure: x } : y)) })}
                />
              </>
            ))}
            <div class="card">
              <h3>Bonuses paid this year</h3>
              <p class="muted small">Annual bonus, incentives or arrears paid (or due) at this job since April.</p>
              <OneTimeEditor
                items={s.current.oneTimes}
                defaultMonth={monthOf(maxDate(s.today, fyStart(s.fy)))}
                onChange={(o) => setCurrent({ ...s.current!, oneTimes: o })}
                addLabel="+ Add a bonus"
              />
            </div>
            <Continue disabled={!s.current.structure.basic} onClick={() => go('exit')} why="Enter at least Basic." />
          </>
        )}

        {st.step === 'exit' && s.current && s.fnf && (
          <ExitStep st={st} s={s} update={update} setCurrent={setCurrent} setFnf={(f) => setScenario((sc) => ({ ...sc, fnf: f }))} onNext={() => go('extras')} />
        )}

        {st.step === 'prior' && s.prior && (
          <>
            <p class="lead">Add up the payslips from earlier this year. The totals are enough.</p>
            <div class="card">
              <Field label="Total gross salary earned this FY" hint="Before deductions. Form 16 or the last payslip's year-to-date column has it.">
                <Money value={s.prior.gross} onChange={(v) => setScenario((sc) => ({ ...sc, prior: { ...sc.prior!, gross: v } }))} ariaLabel="Prior gross salary" />
              </Field>
              <Field label="Total income tax (TDS) already deducted">
                <Money value={s.prior.tds} onChange={(v) => setScenario((sc) => ({ ...sc, prior: { ...sc.prior!, tds: v } }))} ariaLabel="Prior TDS" />
              </Field>
            </div>
            <Continue onClick={() => go('extras')} />
          </>
        )}

        {st.step === 'extras' && (
          <>
            <p class="lead">Add any other payments you expect before March 31, such as a relocation allowance, retention bonus or referral bonus.</p>
            <div class="card">
              <OneTimeEditor
                items={s.next.oneTimes.filter((o) => o.kind !== 'joining')}
                defaultMonth={monthOf(maxDate(s.today, s.next.start))}
                onChange={(o) => setNext({ ...s.next, oneTimes: [...s.next.oneTimes.filter((x) => x.kind === 'joining'), ...o.map((x) => ({ ...x, id: x.id || uid() }))] })}
              />
            </div>
            <details class="card advanced">
              <summary>Advanced</summary>
              {(st.status === 'current' || st.status === 'prior') && (
                <Field label="When will your new employer get Form 12B?" hint="It tells them your earlier salary and TDS so they deduct the right tax. Many people hand it in after the first payroll has already run.">
                  <Choices
                    value={s.settings.form12B}
                    onChange={(v) => setScenario((sc) => ({ ...sc, settings: { ...sc.settings, form12B: v } }))}
                    options={[
                      { value: 'first', label: 'Before the first salary' },
                      { value: 'second', label: 'Before the second salary' },
                      { value: 'never', label: "I won't submit it" },
                    ]}
                  />
                </Field>
              )}
              <Toggle
                checked={s.settings.thirtyDayMonth}
                onChange={(v) => setScenario((sc) => ({ ...sc, settings: { ...sc.settings, thirtyDayMonth: v } }))}
                label="Payroll prorates on a 30-day month (instead of calendar days)"
              />
            </details>
            <Continue label="Show my money" onClick={() => go('results')} />
          </>
        )}

        {st.step === 'results' && result && (
          <>
            <Results
              r={result}
              s={effectiveScenario(st)}
              showNextFy={st.showNextFy}
              setShowNextFy={(v) => update({ showNextFy: v })}
              onHike={(v) => setScenario((sc) => ({ ...sc, settings: { ...sc.settings, nextFyHike: v } }))}
            />
            <div class="actions">
              <button type="button" class="btn" onClick={() => go('review-next')}>
                Edit new offer
              </button>
              {st.status === 'current' && (
                <button type="button" class="btn" onClick={() => go('review-current')}>
                  Edit current job
                </button>
              )}
              <button type="button" class="btn" onClick={() => downloadCsv(result)}>
                Download CSV
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function monthsBetween(a: string, b: string) {
  let n = 0;
  for (let m = a; m < b; m = addMonths(m, 1)) n++;
  return n;
}

function Continue(props: { onClick: () => void; disabled?: boolean; why?: string; label?: string }) {
  return (
    <div class="continue">
      {props.disabled && props.why && <p class="muted small">{props.why}</p>}
      <button type="button" class="btn primary wide" disabled={props.disabled} onClick={props.onClick}>
        {props.label ?? 'Continue'}
      </button>
    </div>
  );
}

function ExitStep(props: {
  st: AppState;
  s: Scenario;
  update: (p: Partial<AppState>) => void;
  setCurrent: (e: Employment) => void;
  setFnf: (f: FnF) => void;
  onNext: () => void;
}) {
  const { s, st } = props;
  const cur = s.current!;
  const fnf = s.fnf!;
  const items = fnfItems({ ...s, current: cur, fnf });
  const setF = (patch: Partial<FnF>) => props.setFnf({ ...fnf, ...patch });
  return (
    <>
      <div class="card">
        <Field label="Last working day" hint="Usually the day before you join the new job.">
          <DateInput value={cur.end} onChange={(v) => props.setCurrent({ ...cur, end: v })} ariaLabel="Last working day" />
        </Field>
        <Field
          label="Income tax deducted so far this year (optional)"
          hint="Year-to-date TDS from your latest payslip. Leave it empty and we'll estimate what payroll would have deducted."
        >
          <Money value={st.tdsSoFar ?? 0} onChange={(v) => props.update({ tdsSoFar: v || null })} ariaLabel="TDS so far" />
        </Field>
      </div>
      <div class="card">
        <h3>Full & final settlement</h3>
        <Field label="Unused leave you'll be paid for (days)" hint="Leave encashment on resignation is tax-free up to ₹25 lakh, but payroll still deducts TDS on it. You get that back when you file.">
          <Num value={fnf.leaveDays} onChange={(v) => setF({ leaveDays: v })} suffix="days" ariaLabel="Leave days" />
        </Field>
        <Field label="Notice period shortfall recovered (days)" hint="Days of notice you won't serve, which the employer deducts.">
          <Num value={fnf.noticeDaysRecovered} onChange={(v) => setF({ noticeDaysRecovered: v })} suffix="days" ariaLabel="Notice days recovered" />
        </Field>
        <Field label="Amount to pay back (joining bonus, relocation etc.)">
          <Money value={fnf.clawback} onChange={(v) => setF({ clawback: v })} ariaLabel="Clawback amount" />
        </Field>
        {items && items.noticeRecovery + items.clawback > 0 && (
          <Toggle checked={fnf.buyoutByNew} onChange={(v) => setF({ buyoutByNew: v })} label="My new employer will reimburse this (notice buyout)" />
        )}
        {items && (items.leaveEncashment > 0 || items.noticeRecovery > 0) && (
          <p class="note">
            One day's basic = {rs(items.perDay)}. Leave encashment {rs(items.leaveEncashment)}
            {items.noticeRecovery > 0 && <>, notice recovery {rs(items.noticeRecovery)}</>}.
          </p>
        )}
      </div>
      <Continue disabled={!cur.end} onClick={props.onNext} />
    </>
  );
}
