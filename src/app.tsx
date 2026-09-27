import { useEffect, useMemo, useState } from 'preact/hooks';
import { compute } from './domain/compute';
import { fyLabel, fyStart, maxDate, monthOf } from './domain/fy';
import { buildStory } from './domain/story';
import type { DocRecord, Employment } from './domain/types';
import { applyEvents } from './extract/events';
import { assignDocs, blankJob, docFromText, orderJobs } from './extract/intake';
import { applyDocs, mergeDocs, baseDocs } from './extract/merge';
import { type Rules } from './rules';
import { activeRules, watchRules } from './rules/update';
import {
  clearSaved,
  dayBefore,
  effectiveScenario,
  fyFor,
  initialState,
  load,
  save,
  type AppState,
  type StepId,
} from './state';
import { Toggle } from './ui/controls';
import { Continue } from './ui/Continue';
import { OneTimeEditor } from './ui/Editors';
import { Results, downloadCsv } from './ui/Results';
import { RulesContext } from './ui/rulesContext';
import { JobEditStep } from './ui/steps/JobEdit';
import { StoryStep } from './ui/steps/Story';
import { Uploader, type ReadFile } from './ui/Uploader';

const TITLES: Record<StepId, string> = {
  upload: 'Your documents',
  story: 'Your year so far',
  'job-edit': 'Check the numbers',
  extras: 'Anything else?',
  results: 'Your money, month by month',
};

/** Rebuild the named jobs from their files, then keep the timeline consistent. */
function rebuild(x: AppState, ids: Iterable<string>, rules: Rules): AppState {
  const todo = new Set(ids);
  const marks = { ...x.marks };
  const sources = { ...x.sources };
  const notes = { ...x.notes };
  const tdsSoFar = { ...x.tdsSoFar };
  let employers = x.scenario.employers.map((e) => {
    if (!todo.has(e.id)) return e;
    const a = applyDocs(e, x.choices[e.id] ?? {}, rules);
    const ev = applyEvents(a.emp, rules, monthOf(fyStart(x.scenario.fy)));
    marks[e.id] = a.marks;
    sources[e.id] = a.sources;
    notes[e.id] = ev.notes;
    if (a.ytdTds && (tdsSoFar[e.id] === undefined || tdsSoFar[e.id] === null)) tdsSoFar[e.id] = a.ytdTds.amount;
    return ev.emp;
  });
  employers = orderJobs(employers);
  // Earlier jobs end the day before the next one starts unless a document says otherwise.
  employers = employers.map((e, k) => {
    const next = employers[k + 1];
    if (!next) return e;
    const out = { ...e };
    if (!out.end && !out.totalsOnly && next.start) out.end = dayBefore(next.start);
    if (!out.fnf && !out.totalsOnly) out.fnf = { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0 };
    return out;
  });
  const last = employers[employers.length - 1];
  // The offer's own tdsSoFar never applies (its TDS is projected).
  delete tdsSoFar[last.id];
  return { ...x, scenario: { ...x.scenario, employers, fy: fyFor(x.scenario.today, last.start) }, marks, sources, notes, tdsSoFar };
}

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
  const update = (patch: Partial<AppState>) => setSt((x) => ({ ...x, ...patch }));
  const go = (step: StepId, editing: string | null = null) => setSt((x) => ({ ...x, step, editing, history: [...x.history, x.step] }));
  const back = () => setSt((x) => (x.history.length ? { ...x, step: x.history[x.history.length - 1], history: x.history.slice(0, -1), editing: null } : x));

  const setJob = (e: Employment) =>
    setSt((x) => {
      const employers = x.scenario.employers.map((j) => (j.id === e.id ? e : j));
      const last = employers[employers.length - 1];
      return { ...x, scenario: { ...x.scenario, employers, fy: fyFor(x.scenario.today, last.start) } };
    });

  /** New files: read them, sort them into jobs, rebuild those jobs. */
  const ingest = (files: ReadFile[]) =>
    setSt((x) => {
      const docs = files.map((f) => docFromText(f.text, f.name));
      const { employers, unassigned, changed } = assignDocs(x.scenario.employers, docs, x.scenario.fy);
      const warnings = { ...x.warnings };
      for (const f of files) {
        const d = docs.find((dd) => dd.name === f.name);
        const job = employers.find((e) => e.docs.some((dd) => dd.id === d?.id));
        if (job && d?.kind === 'offer') warnings[job.id] = [...(warnings[job.id] ?? []), ...f.x.warnings.map((w) => `${f.name}: ${w}`)];
      }
      return rebuild({ ...x, scenario: { ...x.scenario, employers }, inbox: [...x.inbox, ...unassigned], warnings }, changed, rules);
    });

  const assign = (docId: string, target: string) =>
    setSt((x) => {
      const doc = x.inbox.find((d) => d.id === docId)!;
      let employers = x.scenario.employers;
      let id = target;
      if (target === 'new') {
        const j = blankJob(doc.employer || `Job ${employers.length + 1}`, fyStart(x.scenario.fy));
        employers = [j, ...employers];
        id = j.id;
      }
      employers = employers.map((e) => (e.id === id ? { ...e, docs: [...e.docs, doc] } : e));
      return rebuild({ ...x, inbox: x.inbox.filter((d) => d.id !== docId), scenario: { ...x.scenario, employers } }, [id], rules);
    });

  const removeDoc = (id: string, docId: string) =>
    setSt((x) => {
      const employers = x.scenario.employers.map((j) => (j.id === id ? { ...j, docs: j.docs.filter((d) => d.id !== docId) } : j));
      return rebuild({ ...x, scenario: { ...x.scenario, employers } }, [id], rules);
    });
  const choose = (id: string, field: string, choice: string) =>
    setSt((x) => rebuild({ ...x, choices: { ...x.choices, [id]: { ...(x.choices[id] ?? {}), [field]: choice } } }, [id], rules));
  const addFilesTo = (id: string, files: ReadFile[]) =>
    setSt((x) => {
      const docs: DocRecord[] = files.map((f) => docFromText(f.text, f.name));
      const employers = x.scenario.employers.map((j) => (j.id === id ? { ...j, docs: [...j.docs, ...docs] } : j));
      return rebuild({ ...x, scenario: { ...x.scenario, employers } }, [id], rules);
    });
  const addJob = () =>
    setSt((x) => {
      const first = x.scenario.employers[0];
      const j = blankJob(`Job ${x.scenario.employers.length + 1}`, fyStart(x.scenario.fy));
      if (first.start > fyStart(x.scenario.fy)) j.end = dayBefore(first.start);
      j.fnf = { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0 };
      return { ...x, scenario: { ...x.scenario, employers: [j, ...x.scenario.employers] }, step: 'job-edit', editing: j.id, history: [...x.history, x.step] };
    });
  const removeJob = (id: string) =>
    setSt((x) => {
      const employers = x.scenario.employers.filter((j) => j.id !== id);
      return employers.length ? rebuild({ ...x, scenario: { ...x.scenario, employers } }, [], rules) : x;
    });

  const effective = useMemo(() => effectiveScenario(st), [st]);
  const result = useMemo(() => (['story', 'results'].includes(st.step) && s.employers.length ? compute(effective, rules) : null), [effective, rules, st.step, s.employers.length]);
  const story = useMemo(() => (result ? buildStory(effective, result) : []), [effective, result]);

  const editIndex = st.step === 'job-edit' ? s.employers.findIndex((j) => j.id === st.editing) : -1;
  const editing = editIndex >= 0 ? s.employers[editIndex] : undefined;
  const openConflicts = (e: Employment) => mergeDocs(baseDocs(e.docs)).conflicts.filter((c) => !(st.choices[e.id] ?? {})[c.field]).length;
  const offer = s.employers[s.employers.length - 1];

  const steps: StepId[] = ['upload', 'story', 'extras', 'results'];
  const progress = (Math.max(0, steps.indexOf(st.step === 'job-edit' ? 'story' : st.step)) + 1) / steps.length;

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
              <div class="brand-sub">Your salary, bank account and ITR · {fyLabel(s.fy)}</div>
            </div>
          </div>
          {st.step !== 'upload' && (
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

          {st.step === 'upload' && (
            <>
              <p class="lead">
                A ₹30 lakh CTC doesn't mean ₹2.5 lakh a month. Add your documents and see what actually reaches your bank account each month, and what you'll pay or get
                back when you file your ITR.
              </p>
              <ul class="doc-list">
                <li>
                  <strong>New offer letter</strong> for the job you're joining
                </li>
                <li>
                  <strong>Current job:</strong> offer letter (even an old one), appraisal letters, recent payslip
                </li>
                <li>
                  <strong>Leaving?</strong> Resignation acceptance email, F&F slip
                </li>
              </ul>
              <Uploader
                onFiles={(f) => {
                  ingest(f);
                  go('story');
                }}
                onManual={() => go('job-edit', offer.id)}
              />
              <p class="muted small center">Works offline. Nothing you add leaves this device.</p>
            </>
          )}

          {st.step === 'story' && (
            <StoryStep
              s={s}
              story={story}
              notes={st.notes}
              inbox={st.inbox}
              onAssign={assign}
              onDiscard={(id) => update({ inbox: st.inbox.filter((d) => d.id !== id) })}
              onAddFiles={ingest}
              onEdit={(id) => go('job-edit', id)}
              onRemove={removeJob}
              onAddJob={addJob}
              onNext={() => go('extras')}
            />
          )}

          {st.step === 'job-edit' && editing && (
            <JobEditStep
              s={s}
              index={editIndex}
              choices={st.choices[editing.id] ?? {}}
              marks={st.marks[editing.id] ?? {}}
              sources={st.sources[editing.id] ?? {}}
              warnings={(st.warnings[editing.id] ?? []).filter((w) => editIndex === s.employers.length - 1 || !/date of joining/i.test(w))}
              notes={st.notes[editing.id] ?? []}
              tdsSoFar={st.tdsSoFar[editing.id] ?? null}
              ytdHint={[...editing.docs].reverse().find((d) => d.ytdTds !== undefined)?.ytdTds}
              onChange={setJob}
              onTdsSoFar={(v) => update({ tdsSoFar: { ...st.tdsSoFar, [editing.id]: v } })}
              onAddFiles={(f) => addFilesTo(editing.id, f)}
              onRemoveDoc={(d) => removeDoc(editing.id, d)}
              onChoose={(f, c) => choose(editing.id, f, c)}
              onDone={() => {
                if (openConflicts(editing)) return;
                setSt((x) => ({ ...x, scenario: { ...x.scenario, employers: orderJobs(x.scenario.employers) } }));
                if (st.history[st.history.length - 1] === 'upload') go('story');
                else back();
              }}
            />
          )}

          {st.step === 'extras' && (
            <>
              <p class="lead">Add any other payments you expect from {offer.name || 'your job'} before 31 March, such as a relocation allowance, retention bonus or referral bonus.</p>
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
                story={story}
                showNextFy={st.showNextFy}
                setShowNextFy={(v) => update({ showNextFy: v })}
                onHike={(v) => update({ scenario: { ...s, settings: { ...s.settings, nextFyHike: v } } })}
              />
              <div class="actions">
                <button type="button" class="btn" onClick={() => go('story')}>
                  Edit jobs and documents
                </button>
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
