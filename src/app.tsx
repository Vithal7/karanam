import { useEffect, useMemo, useState } from 'preact/hooks';
import { compute } from './domain/compute';
import { fyLabel, maxDate, monthOf } from './domain/fy';
import type { Employment, Scenario } from './domain/types';
import { applyDocs, docFromExtract, mergeDocs } from './extract/merge';
import { uid } from './format';
import { type Rules } from './rules';
import { activeRules, watchRules } from './rules/update';
import {
  clearSaved,
  dayBefore,
  earlierJobs,
  effectiveScenario,
  fyFor,
  initialState,
  joinsMidYear,
  load,
  newEarlierJob,
  offerOf,
  save,
  sortJobs,
  type AppState,
  type StepId,
} from './state';
import { DateInput, Field, Toggle, Warnings } from './ui/controls';
import { Continue } from './ui/Continue';
import { DocsPanel } from './ui/Docs';
import { OfferExtras, OneTimeEditor, StructureEditor } from './ui/Editors';
import { Results, downloadCsv } from './ui/Results';
import { RulesContext } from './ui/rulesContext';
import { JobEditStep } from './ui/steps/JobEdit';
import { JobsStep } from './ui/steps/Jobs';
import { Uploader, type ReadFile } from './ui/Uploader';

const TITLES: Record<StepId, string> = {
  'offer-upload': 'Your new offer letter',
  'offer-review': 'Check what we found',
  jobs: 'Jobs this financial year',
  'job-edit': 'An earlier job',
  extras: 'Anything else?',
  results: 'Your money, month by month',
};

export function App() {
  const [st, setSt] = useState<AppState>(() => load() ?? initialState());
  const [rules, setRules] = useState<Rules>(() => activeRules());
  const [rulesBanner, setRulesBanner] = useState(false);
  useEffect(() => save(st), [st]);
  useEffect(() => window.scrollTo({ top: 0 }), [st.step, st.editing]);
  useEffect(
    () =>
      watchRules((r) => {
        setRules(r);
        setRulesBanner(true);
      }),
    [],
  );

  const s = st.scenario;
  const offer = offerOf(s);
  const update = (patch: Partial<AppState>) => setSt((x) => ({ ...x, ...patch }));
  const go = (step: StepId, editing: string | null = null) => setSt((x) => ({ ...x, step, editing, history: [...x.history, x.step] }));
  const back = () =>
    setSt((x) => (x.history.length ? { ...x, step: x.history[x.history.length - 1], history: x.history.slice(0, -1), editing: x.step === 'job-edit' ? null : x.editing } : x));

  /** Replace one job; the offer's joining date decides which FY we're looking at. */
  const setJob = (e: Employment) =>
    setSt((x) => {
      const employers = x.scenario.employers.map((j) => (j.id === e.id ? e : j));
      const isOffer = employers[employers.length - 1].id === e.id;
      const scenario: Scenario = { ...x.scenario, employers, fy: isOffer ? fyFor(x.scenario.today, e.start) : x.scenario.fy };
      return { ...x, scenario };
    });

  /** Re-merge a job's files after files or answers change. */
  const remerge = (x: AppState, id: string, docsChanged: boolean): AppState => {
    const emp = x.scenario.employers.find((j) => j.id === id)!;
    const r = applyDocs(emp, x.choices[id] ?? {}, rules);
    const employers = x.scenario.employers.map((j) => (j.id === id ? r.emp : j));
    const isOffer = employers[employers.length - 1].id === id;
    // An earlier job's letter can carry an old joining date: clamp it, and keep a sensible last day.
    if (!isOffer) {
      const e = employers.find((j) => j.id === id)!;
      const offerStart = employers[employers.length - 1].start;
      if (!e.end && offerStart) e.end = dayBefore(offerStart);
    }
    const tdsSoFar = { ...x.tdsSoFar };
    if (!isOffer && docsChanged && r.ytdTds && (tdsSoFar[id] === undefined || tdsSoFar[id] === null)) tdsSoFar[id] = r.ytdTds.amount;
    return {
      ...x,
      scenario: { ...x.scenario, employers, fy: isOffer ? fyFor(x.scenario.today, r.emp.start) : x.scenario.fy },
      marks: { ...x.marks, [id]: r.marks },
      sources: { ...x.sources, [id]: r.sources },
      tdsSoFar,
    };
  };

  const addFiles = (id: string, files: ReadFile[]) =>
    setSt((x) => {
      const employers = x.scenario.employers.map((j) =>
        j.id === id ? { ...j, docs: [...j.docs, ...files.map((f) => docFromExtract(f.x, uid(), f.name))] } : j,
      );
      const warnings = files.flatMap((f) => f.x.warnings.map((w) => (files.length > 1 ? `${f.name}: ${w}` : w)));
      return remerge({ ...x, scenario: { ...x.scenario, employers }, warnings: { ...x.warnings, [id]: warnings } }, id, true);
    });
  const removeDoc = (id: string, docId: string) =>
    setSt((x) => {
      const employers = x.scenario.employers.map((j) => (j.id === id ? { ...j, docs: j.docs.filter((d) => d.id !== docId) } : j));
      return remerge({ ...x, scenario: { ...x.scenario, employers } }, id, true);
    });
  const choose = (id: string, field: string, choice: string) =>
    setSt((x) => remerge({ ...x, choices: { ...x.choices, [id]: { ...(x.choices[id] ?? {}), [field]: choice } } }, id, false));

  const addJob = () =>
    setSt((x) => {
      const e = newEarlierJob(x.scenario);
      const employers = sortJobs([e, ...x.scenario.employers]);
      return { ...x, scenario: { ...x.scenario, employers }, step: 'job-edit', editing: e.id, history: [...x.history, x.step] };
    });
  const removeJob = (id: string) => setSt((x) => ({ ...x, scenario: { ...x.scenario, employers: x.scenario.employers.filter((j) => j.id !== id) } }));

  const effective = useMemo(() => effectiveScenario(st), [st]);
  const result = useMemo(() => (st.step === 'results' ? compute(effective, rules) : null), [effective, rules, st.step]);

  const editing = st.step === 'job-edit' ? s.employers.find((j) => j.id === st.editing) : undefined;
  const editingNext = editing ? s.employers[s.employers.indexOf(editing) + 1] : undefined;
  const conflictsOpen = (id: string, e: Employment) => mergeDocs(e.docs).conflicts.some((c) => !(st.choices[id] ?? {})[c.field]);

  const steps: StepId[] = ['offer-upload', 'offer-review', 'jobs', 'extras', 'results'];
  const progress = (Math.max(0, steps.indexOf(st.step === 'job-edit' ? 'jobs' : st.step)) + 1) / steps.length;

  return (
    <RulesContext.Provider value={rules}>
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
          {st.step !== 'offer-upload' && (
            <StartOver
              onConfirm={() => {
                clearSaved();
                setSt(initialState());
              }}
            />
          )}
        </header>
        <div class="progressbar" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </div>

        <main class="main">
          {rulesBanner && (
            <div class="callout info" role="status">
              <p>
                Tax rules updated ({rules.version}). Your figures have been recalculated.{' '}
                <button type="button" class="btn link inline" onClick={() => setRulesBanner(false)}>
                  OK
                </button>
              </p>
            </div>
          )}
          {st.history.length > 0 && (
            <button type="button" class="btn back" onClick={back}>
              ← Back
            </button>
          )}
          <h1>{editing ? editing.name || TITLES['job-edit'] : TITLES[st.step]}</h1>

          {st.step === 'offer-upload' && (
            <>
              <p class="lead">
                A ₹30 lakh CTC doesn't mean ₹2.5 lakh a month. Upload your offer letter and see what actually reaches your bank account each month until March, after PF,
                tax and everything else.
              </p>
              <Uploader
                onFiles={(f) => {
                  addFiles(offer.id, f);
                  go('offer-review');
                }}
                onManual={() => go('offer-review')}
              />
              <p class="muted small center">Works offline. Nothing you enter leaves this device.</p>
            </>
          )}

          {st.step === 'offer-review' && (
            <>
              <p class="lead">Fix anything that looks off. Fields marked “check this” were our best guess.</p>
              <DocsPanel emp={offer} choices={st.choices[offer.id] ?? {}} onAdd={(f) => addFiles(offer.id, f)} onRemove={(d) => removeDoc(offer.id, d)} onChoose={(f, c) => choose(offer.id, f, c)} />
              <Warnings items={st.warnings[offer.id] ?? []} />
              <div class="card">
                <Field label="Company">
                  <input id="offer-name" class="text" value={offer.name} onInput={(e) => setJob({ ...offer, name: (e.target as HTMLInputElement).value })} />
                </Field>
                <Field label="Date of joining" mark={st.marks[offer.id]?.start}>
                  <DateInput value={offer.start} onChange={(v) => setJob({ ...offer, start: v })} ariaLabel="Date of joining" />
                </Field>
              </div>
              <StructureEditor value={offer.structure} marks={st.marks[offer.id]} sources={st.sources[offer.id]} month={monthOf(offer.start || s.today)} onChange={(x) => setJob({ ...offer, structure: x })} />
              <OfferExtras emp={offer} marks={st.marks[offer.id]} onChange={setJob} />
              <Continue
                disabled={!offer.structure.basic || !offer.start || conflictsOpen(offer.id, offer)}
                why={conflictsOpen(offer.id, offer) ? 'Answer the questions about the files that disagree.' : 'Enter at least Basic and the joining date.'}
                onClick={() => go(joinsMidYear(s) || earlierJobs(s).length ? 'jobs' : 'extras')}
              />
            </>
          )}

          {st.step === 'jobs' && (
            <JobsStep s={s} onAdd={addJob} onEdit={(id) => go('job-edit', id)} onRemove={removeJob} onEditOffer={() => go('offer-review')} onNext={() => go('extras')} />
          )}

          {st.step === 'job-edit' && editing && editingNext && (
            <JobEditStep
              s={s}
              emp={editing}
              next={editingNext}
              choices={st.choices[editing.id] ?? {}}
              marks={st.marks[editing.id] ?? {}}
              sources={st.sources[editing.id] ?? {}}
              warnings={(st.warnings[editing.id] ?? []).filter((w) => !/date of joining/i.test(w))}
              tdsSoFar={st.tdsSoFar[editing.id] ?? null}
              ytdHint={[...editing.docs].reverse().find((d) => d.ytdTds !== undefined)?.ytdTds}
              onChange={setJob}
              onNextChange={setJob}
              onTdsSoFar={(v) => update({ tdsSoFar: { ...st.tdsSoFar, [editing.id]: v } })}
              onAddFiles={(f) => addFiles(editing.id, f)}
              onRemoveDoc={(d) => removeDoc(editing.id, d)}
              onChoose={(f, c) => choose(editing.id, f, c)}
              onDone={() => {
                setSt((x) => ({ ...x, scenario: { ...x.scenario, employers: sortJobs(x.scenario.employers) } }));
                back();
              }}
            />
          )}

          {st.step === 'extras' && (
            <>
              <p class="lead">Add any other payments you expect from {offer.name || 'the new job'} before March 31, such as a relocation allowance, retention bonus or referral bonus.</p>
              <div class="card">
                <OneTimeEditor
                  items={offer.oneTimes.filter((o) => o.kind !== 'joining')}
                  defaultMonth={monthOf(maxDate(s.today, offer.start))}
                  onChange={(o) => setJob({ ...offer, oneTimes: [...offer.oneTimes.filter((x) => x.kind === 'joining'), ...o] })}
                />
              </div>
              <details class="card advanced">
                <summary>Advanced</summary>
                <Toggle
                  checked={s.settings.thirtyDayMonth}
                  onChange={(v) => update({ scenario: { ...s, settings: { ...s.settings, thirtyDayMonth: v } } })}
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
                s={effective}
                showNextFy={st.showNextFy}
                setShowNextFy={(v) => update({ showNextFy: v })}
                onHike={(v) => update({ scenario: { ...s, settings: { ...s.settings, nextFyHike: v } } })}
              />
              <div class="actions">
                <button type="button" class="btn" onClick={() => go('offer-review')}>
                  Edit offer
                </button>
                {earlierJobs(s).length > 0 && (
                  <button type="button" class="btn" onClick={() => go('jobs')}>
                    Edit earlier jobs
                  </button>
                )}
                <button type="button" class="btn" onClick={() => downloadCsv(result)}>
                  Download CSV
                </button>
              </div>
            </>
          )}

          <RulesFooter rules={rules} />
        </main>
      </div>
    </RulesContext.Provider>
  );
}

function RulesFooter({ rules }: { rules: Rules }) {
  const d = new Date(`${rules.updated}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <details class="rules-foot">
      <summary>
        Tax rules updated {d} · v{rules.version}
      </summary>
      <p class="muted small">Checked automatically whenever you're online. Without internet, the app uses the last rules it downloaded.</p>
      <ul class="small">
        {rules.sources.map((x) => (
          <li>
            <a href={x.url} target="_blank" rel="noopener">
              {x.title}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Two-tap reset (no browser confirm dialog, which embedded views block). */
function StartOver({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" class={`btn small ${armed ? 'danger' : 'ghost'}`} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? 'Tap again to clear' : 'Start over'}
    </button>
  );
}
