import { useEffect, useMemo, useState } from 'preact/hooks';
import { compute } from './domain/compute';
import { fyLabel, fyStart, maxDate, monthOf } from './domain/fy';
import { fixedMonthly } from './domain/schedule';
import { buildStory, buildTimeline } from './domain/story';
import type { DocRecord, Employment, Facts } from './domain/types';
import { applyEvents } from './extract/events';
import { companyKey } from './extract/facts';
import { assignDocs, blankJob, docFromText, docsFromText, orderJobs } from './extract/intake';
import { applyDocs, mergeDocs, baseDocs } from './extract/merge';
import { isNote } from './extract/note';
import { type Rules } from './rules';
import { activeRules, watchRules } from './rules/update';
import {
  clearSaved,
  dayBefore,
  emptyEmployment,
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
import { Results } from './ui/Results';
import { CompareOffers, compareMode, withOffer } from './ui/Compare';
import { DownloadMenu } from './ui/Download';
import { pendingItems } from './ui/pending';
import { Stages } from './ui/Stages';
import { Filing } from './ui/Filing';
import { Drawer, Sidebar } from './ui/Drawer';
import { RulesContext } from './ui/rulesContext';
import { JobEditStep } from './ui/steps/JobEdit';
import { StoryStep } from './ui/steps/Story';
import { Uploader, type ReadFile } from './ui/Uploader';

const TITLES: Record<StepId, string> = {
  upload: 'Your documents',
  clarify: 'A few questions',
  story: 'Check your timeline',
  'job-edit': 'Check the numbers',
  extras: 'Anything else?',
  results: 'Your money, month by month',
};

/** Rebuild the named jobs from their files, then keep the timeline consistent. */
function rebuild(x0: AppState, ids: Iterable<string>, rules: Rules): AppState {
  // A job made only to hold files goes when its last file does (an edited note, a removed file).
  const gone = x0.scenario.employers.filter((e) => e.fromFiles && !e.docs.length && !e.totalsOnly);
  const kept = x0.scenario.employers.filter((e) => !gone.includes(e));
  const x = gone.length && kept.length ? { ...x0, scenario: { ...x0.scenario, employers: kept } } : x0;
  const todo = new Set(ids);
  const marks = { ...x.marks };
  const sources = { ...x.sources };
  const notes = { ...x.notes };
  const needs = { ...x.needs };
  const tdsSoFar = { ...x.tdsSoFar };
  const tdsAsOf = { ...(x.tdsAsOf ?? {}) };
  let employers = x.scenario.employers.map((e) => {
    if (!todo.has(e.id)) return e;
    const a = applyDocs(e, x.choices[e.id] ?? {}, rules);
    const ev = applyEvents(a.emp, rules, monthOf(fyStart(x.scenario.fy)));
    marks[e.id] = a.marks;
    sources[e.id] = a.sources;
    notes[e.id] = ev.notes;
    needs[e.id] = ev.needs;
    if (a.ytdTds && (tdsSoFar[e.id] === undefined || tdsSoFar[e.id] === null)) {
      // A misread (a gross or taxable figure) must never become "tax already paid".
      const since = maxDate(ev.emp.start || fyStart(x.scenario.fy), fyStart(x.scenario.fy));
      const upto = a.ytdTds.asOf && a.ytdTds.asOf > since ? a.ytdTds.asOf : x.scenario.today;
      const months = Math.max(1, (Date.parse(upto) - Date.parse(since)) / (30.4 * 86_400_000) + 1);
      const earned = fixedMonthly(ev.emp.revisions.length ? ev.emp.revisions[ev.emp.revisions.length - 1].structure : ev.emp.structure) * months;
      if (a.ytdTds.amount <= 0.4 * earned) {
        tdsSoFar[e.id] = a.ytdTds.amount;
        if (a.ytdTds.asOf) tdsAsOf[e.id] = a.ytdTds.asOf;
      }
      else notes[e.id] = [...notes[e.id], `The tax sheet's "tax deducted so far" read as ₹${Math.round(a.ytdTds.amount).toLocaleString('en-IN')}, which is too high for your salary, so it wasn't used. Enter the right figure under "Check the numbers".`];
    }
    return ev.emp;
  });
  employers = orderJobs(employers);
  // Earlier jobs end the day before the next one starts unless a document says otherwise.
  employers = employers.map((e, k) => {
    const next = employers[k + 1];
    if (!next) return e;
    const out = { ...e };
    if ((!out.end || out.endSource === 'assumed') && !out.totalsOnly && next.start) {
      out.end = dayBefore(next.start);
      out.endSource = 'assumed';
    }
    if (!out.fnf && !out.totalsOnly) out.fnf = { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0 };
    return out;
  });
  const last = employers[employers.length - 1];
  // A job that hasn't started yet has no TDS so far; one you're in does (your current job).
  if (!last.start || last.start > x.scenario.today) delete tdsSoFar[last.id];
  const out = { ...x, scenario: { ...x.scenario, employers, fy: fyFor(x.scenario.today, employers) }, marks, sources, notes, needs, tdsSoFar, tdsAsOf };
  // The job on screen is gone: step back.
  if (out.step === 'job-edit' && out.editing && !employers.some((e) => e.id === out.editing))
    return { ...out, step: out.history[out.history.length - 1] ?? 'story', history: out.history.slice(0, -1), editing: null };
  return out;
}

export function App() {
  const [st, setSt] = useState<AppState>(() => load() ?? initialState());
  const [rules, setRules] = useState<Rules>(() => activeRules());
  const [rulesBanner, setRulesBanner] = useState(false);
  // Desktop: the menu is a sidebar you can collapse; remembered on this device.
  const desktop = useMedia('(min-width: 960px)');
  const [navOpen, setNavOpen] = useState(() => {
    try {
      return localStorage.getItem('karanam:nav') !== 'closed';
    } catch {
      return true;
    }
  });
  const toggleNav = () =>
    setNavOpen((o) => {
      try {
        localStorage.setItem('karanam:nav', o ? 'closed' : 'open');
      } catch {
        /* private mode */
      }
      return !o;
    });
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
  const back = () => {
    // Back out of a job you just added without documents: it's dropped, not left half-filled.
    const draft = st.step === 'job-edit' && st.draftJob && st.editing === st.draftJob ? s.employers.find((j) => j.id === st.draftJob) : undefined;
    if (draft && !draft.docs.length && !draft.structure.basic && !draft.totalsOnly) return cancelDraft();
    setSt((x) => (x.history.length ? { ...x, step: x.history[x.history.length - 1], history: x.history.slice(0, -1), editing: null, draftJob: undefined } : x));
  };

  const setJob = (e: Employment) =>
    setSt((x) => {
      // Once you've worked on a job (typed figures, answered its questions) it's yours: it no longer
      // goes away with its files.
      const employers = x.scenario.employers.map((j) => (j.id === e.id ? { ...e, fromFiles: undefined } : j));
      return { ...x, scenario: { ...x.scenario, employers, fy: fyFor(x.scenario.today, employers) } };
    });

  /** New files: read them, sort them into jobs by company and date, rebuild those jobs. */
  const ingest = (files: ReadFile[]) => setSt((x) => ingestInto(x, files));
  /** New files into a state: read them, sort them into jobs by company and date, rebuild those jobs. */
  const ingestInto = (x: AppState, files: ReadFile[]): AppState => {
    {
      // A typed note can describe two jobs (the offer and the job you're leaving): one record each.
      const read = files.map((f) => ({ f, ...docsFromText(f.text, f.name, f.typed) }));
      const docs = read.flatMap((r) => r.docs);
      const texts = Object.fromEntries(read.flatMap((r) => r.docs.map((d) => [d.id, r.f.text])));
      const alts = read.flatMap((r) => r.alternatives).map((d) => offerJob(d, x.scenario.fy));
      const { employers, unassigned, changed, aside } = assignDocs(x.scenario.employers, docs, x.scenario.fy, texts);
      const warnings = { ...x.warnings };
      for (const r of read) {
        for (const d of r.docs.filter((dd) => dd.kind === 'offer')) {
          const job = employers.find((e) => e.docs.some((dd) => dd.id === d.id));
          if (job) warnings[job.id] = [...new Set([...(warnings[job.id] ?? []).filter((w) => !w.startsWith(`${r.f.name}: `)), ...(r.warnings ?? r.f.x.warnings).map((w) => `${r.f.name}: ${w}`)])];
        }
      }
      return rebuild({ ...x, scenario: { ...x.scenario, employers }, inbox: [...x.inbox, ...unassigned], aside: [...x.aside, ...aside], warnings, timelineOk: false, alternatives: [...(x.alternatives ?? []), ...alts] }, changed, rules);
    }
  };

  /** An offer you're weighing, built like a job from its letter or note, but kept off the timeline. */
  const offerJob = (d: DocRecord, fy: number): Employment => {
    const j: Employment = { ...blankJob(d.employer || 'Other offer', d.doj ?? fyStart(fy)), docs: [d] };
    return applyEvents(applyDocs(j, {}, rules).emp, rules, monthOf(fyStart(fy))).emp;
  };
  const addAlternatives = (files: ReadFile[]) =>
    setSt((x) => {
      const offers = files.flatMap((f) => {
        const r = docsFromText(f.text, f.name, f.typed);
        return [...r.docs.filter((d) => d.kind === 'offer'), ...r.alternatives];
      });
      return { ...x, alternatives: [...(x.alternatives ?? []), ...offers.map((d) => offerJob(d, x.scenario.fy))] };
    });
  /** Swap: the other offer goes into your timeline; the one there becomes the alternative. */
  const takeAlternative = (id: string) =>
    setSt((x) => {
      const alt = x.alternatives?.find((a) => a.id === id);
      if (!alt) return x;
      const cur = x.scenario.employers[x.scenario.employers.length - 1];
      // Joining another offer instead: the one you had becomes the alternative. Staying was the
      // other option: the offer is added after your job.
      const replacing = compareMode(x.scenario) === 'replace';
      const next = withOffer(x.scenario, { ...alt, asked: {} }).s.employers.map((e) => (e.id === alt.id ? { ...e, form12BConfirmed: false } : e));
      const out = { ...x, alternatives: [...(x.alternatives ?? []).filter((a) => a.id !== id), ...(replacing ? [cur] : [])], scenario: { ...x.scenario, employers: next }, timelineOk: false };
      return rebuild(out, [alt.id], rules);
    });

  const assign = (docId: string, target: string) =>
    setSt((x) => {
      const doc = { ...x.inbox.find((d) => d.id === docId)!, similarTo: undefined };
      let employers = x.scenario.employers;
      let id = target;
      if (target === 'new') {
        const j = { ...blankJob(doc.employer || `Job ${employers.length + 1}`, fyStart(x.scenario.fy)), fromFiles: true };
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
  /**
   * Files added on one job's page belong to that job: a hike, an exit, its payslips. Only an offer
   * from another company (or starting on another date) in a typed note is sorted like a new file.
   */
  const addFilesTo = (id: string, files: ReadFile[]) =>
    setSt((x) => {
      const job = x.scenario.employers.find((j) => j.id === id);
      const read = files.map((f) => ({ f, ...(f.typed || isNote(f.text) ? docsFromText(f.text, f.name, f.typed) : { docs: [docFromText(f.text, f.name)], alternatives: [] as DocRecord[] }) }));
      const elsewhere = (d: DocRecord) =>
        d.kind === 'offer' &&
        (d.typed || isNote(d.text ?? '')) &&
        !!job &&
        ((!!d.employer && companyKey(d.employer) !== companyKey(job.name) && !companyKey(job.name).startsWith(companyKey(d.employer))) || (!!d.doj && !!job.start && Math.abs(Date.parse(d.doj) - Date.parse(job.start)) > 45 * 86_400_000));
      const mine = read.flatMap((r) => r.docs.filter((d) => !elsewhere(d)));
      const others = read.flatMap((r) => r.docs.filter(elsewhere));
      let employers = x.scenario.employers.map((j) => (j.id === id ? { ...j, docs: [...j.docs, ...mine] } : j));
      const changed = new Set([id]);
      let inbox = x.inbox;
      if (others.length) {
        const a = assignDocs(employers, others, x.scenario.fy);
        employers = a.employers;
        inbox = [...inbox, ...a.unassigned];
        for (const c of a.changed) changed.add(c);
      }
      const alts = read.flatMap((r) => r.alternatives).map((d) => offerJob(d, x.scenario.fy));
      return rebuild({ ...x, inbox, scenario: { ...x.scenario, employers }, alternatives: [...(x.alternatives ?? []), ...alts] }, changed, rules);
    });
  /** The user corrects a file's type: re-read its text as that type and rebuild the job. */
  const reclassify = (jobId: string, docId: string, kind: DocRecord['kind']) =>
    setSt((x) => {
      const employers = x.scenario.employers.map((j) =>
        j.id === jobId ? { ...j, docs: j.docs.map((d) => (d.id !== docId ? d : d.text ? docFromText(d.text, d.name, d.id, kind) : { ...d, kind })) } : j,
      );
      return rebuild({ ...x, scenario: { ...x.scenario, employers } }, [jobId], rules);
    });
  /** You corrected a file's text: read it again. A note may speak for two jobs, so it's re-sorted. */
  const editText = (jobId: string, docId: string, text: string) => {
    const doc = st.scenario.employers.find((j) => j.id === jobId)?.docs.find((d) => d.id === docId);
    if (!doc) return;
    if (doc.typed || isNote(text) || isNote(doc.text ?? '')) {
      const old = doc.text;
      const name = doc.name.replace(/\s*\(.*\)$/, '');
      const x = st;
      // Where the note's records were: each new record of the same kind goes back to that job.
      const home = new Map<string, string>();
      for (const j of x.scenario.employers) for (const d of j.docs) if (d.id === docId || (old && d.text === old)) home.set(d.kind, j.id);
      const employers = x.scenario.employers.map((j) => ({ ...j, docs: j.docs.filter((d) => d.id !== docId && !(old && d.text === old)) }));
      const r = docsFromText(text, name, doc.typed);
      const stay = r.docs.filter((d) => home.has(d.kind) && (!d.employer || companyKey(d.employer) === companyKey(x.scenario.employers.find((j) => j.id === home.get(d.kind))!.name) || !x.scenario.employers.some((j) => companyKey(j.name) === companyKey(d.employer))));
      const move = r.docs.filter((d) => !stay.includes(d));
      // A company renamed in the note ("BP" -> "Shell India") renames its job; your answers stay.
      let next = employers.map((j) => {
        const mine = stay.filter((d) => home.get(d.kind) === j.id);
        const renamed = mine.find((d) => d.employer && companyKey(d.employer) !== companyKey(j.name))?.employer;
        return { ...j, ...(renamed ? { name: renamed } : {}), docs: [...j.docs, ...mine] };
      });
      let inbox = x.inbox;
      if (move.length) {
        const a = assignDocs(next, move, x.scenario.fy);
        next = a.employers;
        inbox = [...inbox, ...a.unassigned];
      }
      // A job the note no longer mentions: ask before it goes.
      const emptied = x.scenario.employers.filter((j) => j.docs.length && next.find((n) => n.id === j.id)?.docs.length === 0);
      if (emptied.length) {
        const names = emptied.map((j) => j.name || 'a job').join(' and ');
        const drop = confirm(`Your edited text no longer mentions ${names}. Remove ${emptied.length === 1 ? 'it' : 'them'} from your timeline? Cancel keeps ${emptied.length === 1 ? 'it' : 'them'} with what you've entered.`);
        next = next.map((j) => (emptied.some((e) => e.id === j.id) ? { ...j, fromFiles: drop ? true : undefined } : j));
      }
      const alts = r.alternatives.map((d) => offerJob(d, x.scenario.fy));
      const cleared = { ...x, inbox, scenario: { ...x.scenario, employers: next }, alternatives: [...(x.alternatives ?? []).filter((a) => !a.docs.some((d) => old && d.text === old)), ...alts] };
      setSt(rebuild(cleared, next.map((j) => j.id), rules));
      return;
    }
    setSt((x) => {
      const employers = x.scenario.employers.map((j) => (j.id === jobId ? { ...j, docs: j.docs.map((d) => (d.id === docId ? docFromText(text, d.name, d.id) : d)) } : j));
      return rebuild({ ...x, scenario: { ...x.scenario, employers } }, [jobId], rules);
    });
  };
  const patchDoc = (jobId: string, docId: string, patch: Partial<DocRecord>) =>
    setSt((x) => {
      const employers = x.scenario.employers.map((j) => (j.id === jobId ? { ...j, docs: j.docs.map((d) => (d.id === docId ? { ...d, ...patch } : d)) } : j));
      return rebuild({ ...x, scenario: { ...x.scenario, employers } }, [jobId], rules);
    });
  const answerHike = (jobId: string, docId: string, facts: Partial<Facts>) =>
    setSt((x) => {
      const employers = x.scenario.employers.map((j) =>
        j.id === jobId ? { ...j, docs: j.docs.map((d) => (d.id === docId ? { ...d, facts: { ...(d.facts ?? {}), ...facts } } : d)) } : j,
      );
      return rebuild({ ...x, scenario: { ...x.scenario, employers } }, [jobId], rules);
    });
  const addJob = () =>
    setSt((x) => {
      const first = x.scenario.employers[0];
      const j = blankJob(`Job ${x.scenario.employers.length + 1}`, fyStart(x.scenario.fy));
      if (first.start > fyStart(x.scenario.fy)) j.end = dayBefore(first.start);
      j.fnf = { leaveDays: 0, noticeDaysRecovered: 0, clawback: 0 };
      return { ...x, scenario: { ...x.scenario, employers: [j, ...x.scenario.employers] }, step: 'job-edit', editing: j.id, draftJob: j.id, history: [...x.history, x.step] };
    });
  /** Leave a job you just added without documents: nothing of it is kept. */
  const cancelDraft = () =>
    setSt((x) => {
      const id = x.draftJob;
      const employers = x.scenario.employers.filter((j) => j.id !== id);
      const prev = x.history[x.history.length - 1] ?? 'story';
      const out: AppState = { ...x, draftJob: undefined, step: prev, history: x.history.slice(0, -1), editing: null };
      return employers.length && id ? rebuild({ ...out, scenario: { ...x.scenario, employers } }, [], rules) : out;
    });
  const removeJob = (id: string) =>
    setSt((x) => {
      const employers = x.scenario.employers.filter((j) => j.id !== id);
      return employers.length ? rebuild({ ...x, scenario: { ...x.scenario, employers } }, [], rules) : x;
    });

  const effective = useMemo(() => effectiveScenario(st), [st]);
  const filing = st.view === 'filing';
  const result = useMemo(() => ((filing || ['clarify', 'story', 'results'].includes(st.step)) && s.employers.length ? compute(effective, rules) : null), [effective, rules, st.step, s.employers.length, filing]);
  const story = useMemo(() => (result ? buildStory(effective, result) : []), [effective, result]);
  const events = useMemo(() => (result ? buildTimeline(effective, result) : []), [effective, result]);

  const editIndex = st.step === 'job-edit' ? s.employers.findIndex((j) => j.id === st.editing) : -1;
  const editing = editIndex >= 0 ? s.employers[editIndex] : undefined;
  const openConflicts = (e: Employment) => mergeDocs(baseDocs(e.docs)).conflicts.filter((c) => !(st.choices[e.id] ?? {})[c.field]).length;
  const offer = s.employers[s.employers.length - 1];

  const pending = useMemo(() => pendingItems(st, effective, rules, openConflicts), [st, effective, rules]);
  const hasDocs = s.employers.some((e) => e.docs.length || e.structure.basic || e.totalsOnly);
  const stageDone = [hasDocs, hasDocs && !pending.some((p) => !p.soft), !!st.timelineOk, !!st.seenResults];
  const stageOf = (step: StepId): number =>
    step === 'upload' ? 0 : step === 'clarify' ? 1 : step === 'story' || step === 'extras' ? 2 : step === 'results' ? 3 : stageOf(st.history[st.history.length - 1] ?? 'clarify');
  const STAGE_STEP: StepId[] = ['upload', 'clarify', 'story', 'results'];
  const goStage = (i: number) => setSt((x) => ({ ...x, step: STAGE_STEP[i], editing: null, history: [...x.history, x.step], seenResults: x.seenResults || i === 3 }));

  const goView = (v: 'projection' | 'filing') => setSt((x) => ({ ...x, view: v }));
  const startOver = () => {
    clearSaved();
    setSt(initialState());
  };
  return (
    <RulesContext.Provider value={rules}>
      <div class={`shell ${desktop ? (navOpen ? 'with-nav' : 'with-rail') : ''}`}>
      {desktop && <Sidebar collapsed={!navOpen} view={st.view ?? 'projection'} stage={stageOf(st.step)} onView={goView} onStartOver={startOver} canStartOver={st.step !== 'upload' || !!st.view} />}
      <div class="app">
        <header class="top">
          <Drawer
            view={st.view ?? 'projection'}
            stage={stageOf(st.step)}
            onView={goView}
            onStartOver={startOver}
            canStartOver={st.step !== 'upload' || !!st.view}
            desktop={desktop}
            sidebarOpen={navOpen}
            onToggleSidebar={toggleNav}
          />
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
        </header>
        {!filing && <Stages current={stageOf(st.step)} done={stageDone} onGo={goStage} />}

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
          {filing && (
            <>
              <h1>File your ITR</h1>
              {result && hasDocs ? (
                <Filing r={result} s={effective} onAddFiles={ingest} />
              ) : (
                <div class="card">
                  <p>
                    <strong>Add Form 16 from each employer you had this year.</strong> It's the employer's own record of your salary and TDS, so the return is built from actuals. Part A
                    and Part B can be separate files.
                  </p>
                  <Uploader buttonLabel="Add Form 16" onFiles={ingest} />
                  <p class="muted small">No Form 16 yet? Build a projection from your letters and payslips under Projection in the menu.</p>
                </div>
              )}
            </>
          )}
          {!filing && st.history.length > 0 && (
            <button type="button" class="btn back" onClick={back}>
              ← Back
            </button>
          )}
          {!filing && (
            <>
          <h1>{editing ? editing.name || TITLES['job-edit'] : TITLES[st.step]}</h1>

          {st.step === 'upload' && (
            <>
              <p class="lead">
                A ₹30 lakh CTC doesn't mean ₹2.5 lakh a month. Add your documents and see what actually reaches your bank account each month, and what you'll pay or get
                back when you file your ITR.
              </p>
              <ul class="doc-list">
                <li>
                  <strong>Your job:</strong> appointment letter (even an old one), your latest increment letter, a payslip from this year
                </li>
                <li>
                  <strong>Changing jobs?</strong> The new offer letter
                </li>
                <li>
                  <strong>Leaving?</strong> Your resignation acceptance email, and the full & final settlement (F&F) slip once you have it
                </li>
                <li>
                  <strong>No documents?</strong> Paste or type what you know, like "CTC 18 LPA, joined June 2024"
                </li>
              </ul>
              <Uploader
                onFiles={(f) => {
                  ingest(f);
                  go('clarify');
                }}
                onManual={() => go('job-edit', offer.id)}
              />
              <p class="muted small center">Works offline. Nothing you add leaves this device.</p>
            </>
          )}

          {(st.step === 'story' || st.step === 'clarify') && (
            <StoryStep
              mode={st.step === 'clarify' ? 'clarify' : 'timeline'}
              pending={pending}
              onClarify={() => go('clarify')}
              onNoEarlierIncome={() => setSt((x) => ({ ...x, scenario: { ...x.scenario, settings: { ...x.scenario.settings, noEarlierIncome: true } } }))}
              onAddEarlier={({ name, gross, tds }) =>
                setSt((x) => {
                  const first = x.scenario.employers[0];
                  const j = emptyEmployment(name, fyStart(x.scenario.fy));
                  const earlier: Employment = { ...j, startSource: 'user', end: dayBefore(first.start), endSource: 'user', totalsOnly: { gross, tds } };
                  return { ...x, scenario: { ...x.scenario, employers: [earlier, ...x.scenario.employers], settings: { ...x.scenario.settings, noEarlierIncome: true } } };
                })
              }
              s={effective}
              r={result}
              events={events}
              notes={st.notes}
              needs={st.needs}
              onAnswerHike={answerHike}
              onPatchDoc={patchDoc}
              onChangeJob={setJob}
              inbox={st.inbox}
              onAssign={assign}
              onDiscard={(id) => update({ inbox: st.inbox.filter((d) => d.id !== id) })}
              aside={st.aside}
              onUseAside={(id) =>
                setSt((x) => {
                  const a = x.aside.find((y) => y.doc.id === id);
                  return a ? { ...x, aside: x.aside.filter((y) => y !== a), inbox: [...x.inbox, { ...a.doc, keep: true }] } : x;
                })
              }
              onDropAside={(id) => update({ aside: st.aside.filter((y) => y.doc.id !== id) })}
              onAddFiles={ingest}
              onAddFilesTo={addFilesTo}
              onEdit={(id) => go('job-edit', id)}
              onRemove={removeJob}
              onAddJob={addJob}
              onNext={() => (st.step === 'clarify' ? go('story') : setSt((x) => ({ ...x, timelineOk: true, step: 'extras', editing: null, history: [...x.history, x.step] })))}
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
              onReclassify={(d, k) => reclassify(editing.id, d, k)}
              onEditText={(d, t) => editText(editing.id, d, t)}
              onCancel={st.draftJob === editing.id ? cancelDraft : undefined}
              onDone={() => {
                if (openConflicts(editing)) return;
                setSt((x) => ({ ...x, draftJob: undefined, scenario: { ...x.scenario, employers: orderJobs(x.scenario.employers) } }));
                if (st.history[st.history.length - 1] === 'upload') go('clarify');
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
              <Continue label="Show my money" onClick={() => goStage(3)} />
            </>
          )}

          {st.step === 'results' && result && (
            <>
              <Results
                r={result}
                s={effective}
                story={story}
                events={events}
                showNextFy={st.showNextFy}
                setShowNextFy={(v) => update({ showNextFy: v })}
                onHike={(v) => update({ scenario: { ...s, settings: { ...s.settings, nextFyHike: v } } })}
              />
              <CompareOffers
                s={effective}
                rules={rules}
                alternatives={st.alternatives ?? []}
                onAdd={addAlternatives}
                onRemove={(id) => update({ alternatives: (st.alternatives ?? []).filter((a) => a.id !== id) })}
                onTake={takeAlternative}
              />
              <div class="actions">
                <button type="button" class="btn" onClick={() => go('story')}>
                  Edit jobs and documents
                </button>
                <DownloadMenu r={result} s={effective} rules={rules} />
              </div>
            </>
          )}

            </>
          )}

          <RulesFooter rules={rules} />
        </main>
      </div>
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

/** Whether a media query matches, kept up to date. */
function useMedia(q: string): boolean {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}
