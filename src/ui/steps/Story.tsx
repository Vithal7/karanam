import { useState } from 'preact/hooks';
import { MAX_EMPLOYERS, validateEmployers, type Result } from '../../domain/compute';
import { fyLabel, monthLong } from '../../domain/fy';
import type { TimelineEvent } from '../../domain/story';
import type { DocRecord, Facts, Scenario } from '../../domain/types';
import { CompanyCards } from '../CompanyCards';
import { DOC_KIND_SHORT } from '../docKinds';
import type { AsideDoc } from '../../extract/intake';
import { Continue } from '../Continue';
import { reconcile } from '../../domain/reconcile';
import { rs } from '../../format';
import { useRules } from '../rulesContext';
import { ExitQuestion, exitQuestionFor } from '../ExitQuestion';
import { OverlapFix } from '../OverlapFix';
import { PrevVariableQuestion, needsPrevVariable } from '../PrevVariable';
import { Money, MonthInput, Percent } from '../controls';
import { Timeline } from '../Timeline';
import { Uploader, type ReadFile } from '../Uploader';
import { docHints } from '../docHints';
import { Glossary } from '../Glossary';
import type { Pending } from '../pending';
import { LocationQuestion } from '../Location';
import { BuyoutQuestion, NpsQuestion, RelocationQuestion, needsBuyout, needsNps, needsRelocation } from '../JoiningQuestions';
import { EarlierIncomeQuestion, ExGratiaQuestion, Form12BQuestion, JoinDateQuestion, LeaveQuestion, NoticeQuestion, PayChangedQuestion, PfRiseQuestion, SplitQuestion, needsExGratia, needsNotice, staleSalary } from '../Questions';
import { pfCeilingRiseIn } from '../../domain/schedule';
import { fyStart } from '../../domain/fy';


export interface HikeNeed {
  docId: string;
  docName: string;
  month: string;
  /** The hike's date wasn't given: ask which month it applies from. */
  askMonth?: boolean;
}

/** Asks for the size of a hike the letter didn't state clearly. */
function HikeQuestion(props: { need: HikeNeed; onAnswer: (f: Partial<Facts>) => void }) {
  const [ctc, setCtc] = useState(0);
  const [pct, setPct] = useState(0);
  const [month, setMonth] = useState('');
  if (props.need.askMonth)
    return (
      <div class="callout warn ask">
        <p>
          <strong>{props.need.docName}</strong>: from which month does this pay apply? A hike changes every month after it, and any months before it was paid come as arrears.
        </p>
        <div class="grid2">
          <div>
            <span class="field-label">Applies from</span>
            <MonthInput value={month} onChange={setMonth} ariaLabel="Hike applies from" />
          </div>
          <div class="q-action">
            <button type="button" class="btn small primary" disabled={!month} onClick={() => props.onAnswer({ effectiveFrom: `${month}-01` })}>
              Use this month
            </button>
          </div>
        </div>
      </div>
    );
  return (
    <div class="callout warn ask">
      <p>
        <strong>{props.need.docName}</strong>: how big was the hike from {monthLong(props.need.month)}? Enter either one.
      </p>
      <div class="grid2">
        <div>
          <span class="field-label">New CTC per year</span>
          <Money value={ctc} onChange={setCtc} ariaLabel="New CTC per year" />
        </div>
        <div>
          <span class="field-label">Or hike %</span>
          <Percent value={pct} onChange={setPct} ariaLabel="Hike percent" />
        </div>
      </div>
      <button type="button" class="btn small primary" disabled={!ctc && !pct} onClick={() => props.onAnswer(ctc ? { revisedCtc: ctc } : { incrementPct: pct })}>
        Use this
      </button>
    </div>
  );
}

const FIELD_WORDS: Record<NonNullable<Facts['yearGuess']>['field'], string> = {
  lastWorkingDay: 'last working day',
  doj: 'joining date',
  resignationDate: 'resignation date',
  effectiveFrom: 'hike date',
};
const longDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

/** A date written without a year, where either year could be meant: which one? */
function YearQuestion(props: { doc: DocRecord; onAnswer: (patch: Partial<DocRecord>) => void }) {
  const g = props.doc.facts!.yearGuess!;
  const pick = (date: string) =>
    props.onAnswer(g.field === 'doj' ? { doj: date, facts: { ...props.doc.facts, yearGuess: undefined } } : { facts: { ...props.doc.facts, [g.field]: date, yearGuess: undefined } });
  return (
    <div class="callout ask exit-q">
      <p>
        <strong>Which year is the {FIELD_WORDS[g.field]} in {props.doc.name}?</strong> It's written without a year.
      </p>
      <div class="tl-actions">
        {[...g.options].sort().map((o) => (
          <button type="button" class="btn small" onClick={() => pick(o)}>
            {longDate(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Your jobs, the money each puts in your bank, and one timeline of what happens when. */
export function StoryStep(props: {
  /** clarify: only the questions; timeline: the cards, money and timeline. */
  mode: 'clarify' | 'timeline';
  pending: Pending[];
  onClarify: () => void;
  onNoEarlierIncome: () => void;
  onAddEarlier: (x: { name: string; gross: number; tds: number }) => void;
  s: Scenario;
  r: Result | null;
  events: TimelineEvent[];
  notes: Record<string, string[]>;
  needs: Record<string, HikeNeed[]>;
  inbox: DocRecord[];
  aside: AsideDoc[];
  onUseAside: (docId: string) => void;
  onDropAside: (docId: string) => void;
  onAssign: (docId: string, target: string) => void;
  onDiscard: (docId: string) => void;
  onAddFiles: (f: ReadFile[]) => void;
  /** Files for one job (from its "documents that would help" list). */
  onAddFilesTo: (jobId: string, f: ReadFile[]) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onAddJob: () => void;
  onAnswerHike: (jobId: string, docId: string, f: Partial<Facts>) => void;
  onPatchDoc: (jobId: string, docId: string, patch: Partial<DocRecord>) => void;
  onChangeJob: (e: import('../../domain/types').Employment) => void;
  onNext: () => void;
}) {
  const { s, r } = props;
  const rules = useRules();
  const errors = validateEmployers(s);
  const unconfirmed = s.employers.slice(0, -1).filter((e) => !e.totalsOnly && e.endSource !== 'doc' && e.endSource !== 'user');
  const n = s.employers.length;
  const clarify = props.mode === 'clarify';
  const hard = props.pending.filter((p) => !p.soft);
  return (
    <>
      {clarify ? (
        <>
          <p class="lead">
            {hard.length
              ? `${hard.length} thing${hard.length === 1 ? '' : 's'} to answer so the numbers are right. Nothing is assumed silently.`
              : 'Nothing left to answer. Check the list below, then verify the timeline.'}
          </p>
          {props.pending.length > 0 && (
            <ul class="pending-list">
              {props.pending.map((p) => (
                <li class={p.soft ? 'soft' : ''}>{p.text}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <p class="lead">Here's {fyLabel(s.fy)} as your documents tell it: when each job starts and ends, what each pays, and what happens when. Check it, then see the money month by month.</p>
          {hard.length > 0 && (
            <div class="callout warn">
              <p>
                {hard.length} thing{hard.length === 1 ? '' : 's'} still need{hard.length === 1 ? 's' : ''} an answer.{' '}
                <button type="button" class="btn link inline" onClick={props.onClarify}>
                  Answer now
                </button>
              </p>
            </div>
          )}
        </>
      )}

      {clarify && s.employers[0] && !s.employers[0].totalsOnly && s.employers[0].start > fyStart(s.fy) && s.employers[0].startSource !== 'default' && !s.settings.noEarlierIncome && (
        <EarlierIncomeQuestion first={s.employers[0]} fyLabel={fyLabel(s.fy)} onNone={props.onNoEarlierIncome} onAdd={props.onAddEarlier} />
      )}

      {clarify &&
        props.inbox
          .filter((d) => d.similarTo && s.employers.some((e) => e.id === d.similarTo))
          .map((d) => {
            const job = s.employers.find((e) => e.id === d.similarTo)!;
            return (
              <div class="callout ask exit-q">
                <p>
                  <strong>
                    Is {d.employer} the same employer as {job.name}?
                  </strong>{' '}
                  {d.name} names {d.employer}. It could be the same job after a merger, a rename or an internal transfer, or a different job.
                </p>
                <div class="tl-actions">
                  <button type="button" class="btn small primary" onClick={() => props.onAssign(d.id, job.id)}>
                    Same employer
                  </button>
                  {n < MAX_EMPLOYERS && (
                    <button type="button" class="btn small" onClick={() => props.onAssign(d.id, 'new')}>
                      A different job
                    </button>
                  )}
                </div>
              </div>
            );
          })}

      {clarify && props.inbox.some((d) => !d.similarTo || !s.employers.some((e) => e.id === d.similarTo)) && (
        <div class="card conflicts">
          <h3>Which job are these files for?</h3>
          {props.inbox.filter((d) => !d.similarTo || !s.employers.some((e) => e.id === d.similarTo)).map((d) => (
            <div class="inbox-row">
              <span class="file-kind">{DOC_KIND_SHORT[d.kind]}</span>
              <span class="file-name">{d.name}</span>
              <select
                class="text"
                aria-label={`Job for ${d.name}`}
                value=""
                onChange={(ev) => {
                  const v = (ev.target as HTMLSelectElement).value;
                  if (v === 'discard') props.onDiscard(d.id);
                  else if (v) props.onAssign(d.id, v);
                }}
              >
                <option value="">Choose…</option>
                {s.employers.map((e) => (
                  <option value={e.id}>{e.name || 'Unnamed job'}</option>
                ))}
                {n < MAX_EMPLOYERS && <option value="new">Another job</option>}
                <option value="discard">Not needed, remove</option>
              </select>
            </div>
          ))}
        </div>
      )}

      {clarify && props.aside.length > 0 && (
        <details class="card aside-docs">
          <summary>
            <strong>
              {props.aside.length} file{props.aside.length === 1 ? '' : 's'} not used: not from {fyLabel(s.fy)}
            </strong>
            <span class="muted small"> · show</span>
          </summary>
          <p class="muted small">Old letters, payslips and tax sheets from other years don't change this year's money. Use one anyway if we got it wrong.</p>
          {props.aside.map((a) => (
            <div class="aside-row">
              <div>
                <span class="file-kind">{DOC_KIND_SHORT[a.doc.kind]}</span> <span class="file-name">{a.doc.name}</span>
                <p class="muted small">{a.reason}</p>
              </div>
              <div class="tl-actions">
                <button type="button" class="btn small" onClick={() => props.onUseAside(a.doc.id)}>
                  Use it anyway
                </button>
                <button type="button" class="btn small ghost" onClick={() => props.onDropAside(a.doc.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </details>
      )}

      {r && (
        <CompanyCards s={s} r={r} badges money={!clarify}>
          {(k) => {
            const e = s.employers[k];
            return (
              <>
                {clarify && exitQuestionFor(e, k, n) && (
                  <ExitQuestion emp={e} next={s.employers[k + 1]} fy={s.fy} thirty={s.settings.thirtyDayMonth} onConfirm={props.onChangeJob} onChangeNext={props.onChangeJob} />
                )}
                {clarify && k < n - 1 && (e.endSource === 'doc' || e.endSource === 'user') && (
                  <OverlapFix
                    end={e.end}
                    emp={e}
                    next={s.employers[k + 1]}
                    onEnd={(v) => props.onChangeJob({ ...e, end: v, endSource: 'user' })}
                    onNextStart={(v) => props.onChangeJob({ ...s.employers[k + 1], start: v, startSource: 'user' })}
                  />
                )}
                {clarify && props.pending.some((p) => p.job === e.id && /differ between/.test(p.text)) && (
                  <p class="callout warn small">
                    Your files give different figures for some fields.{' '}
                    <button type="button" class="btn link inline" onClick={() => props.onEdit(e.id)}>
                      Choose which is right
                    </button>
                  </p>
                )}
                {clarify && !e.totalsOnly && e.startSource === 'approx' && <JoinDateQuestion emp={e} onChange={props.onChangeJob} />}
                {clarify && k > 0 && !e.totalsOnly && !e.form12BConfirmed && <Form12BQuestion emp={e} prevName={s.employers.slice(0, k).map((x) => x.name).join(' and ')} onChange={props.onChangeJob} />}
                {clarify && e.splitGuessed && !e.asked?.split && <SplitQuestion emp={e} onChange={props.onChangeJob} onEdit={() => props.onEdit(e.id)} />}
                {clarify && staleSalary(e, s.fy, s.today) && (
                  <PayChangedQuestion emp={e} since={staleSalary(e, s.fy, s.today)!} onChange={props.onChangeJob} onAddFiles={(f) => props.onAddFilesTo(e.id, f)} onEdit={() => props.onEdit(e.id)} />
                )}
                {clarify && needsExGratia(e, k < n - 1 || !!e.end) && <ExGratiaQuestion emp={e} fy={s.fy} thirty={s.settings.thirtyDayMonth} onChange={props.onChangeJob} />}
                {clarify && !exitQuestionFor(e, k, n) && needsNotice(e) && <NoticeQuestion emp={e} fy={s.fy} thirty={s.settings.thirtyDayMonth} onChange={props.onChangeJob} />}
                {clarify && needsBuyout(s, k) && <BuyoutQuestion s={s} k={k} onChange={props.onChangeJob} />}
                {clarify && needsNps(s, k) && <NpsQuestion s={s} k={k} rules={rules} onChange={props.onChangeJob} />}
                {clarify && needsRelocation(s, k) && <RelocationQuestion s={s} k={k} onChange={props.onChangeJob} />}
                {clarify && !e.totalsOnly && !e.pfRise && pfCeilingRiseIn(e, s.fy, rules) && <PfRiseQuestion emp={e} month={pfCeilingRiseIn(e, s.fy, rules)!} onChange={props.onChangeJob} />}
                {clarify && e.fnf && !e.leaveConfirmed && !e.fnf.leaveDays && e.fnf.leaveAmount === undefined && (k < n - 1 || !!e.end) && <LeaveQuestion emp={e} onChange={props.onChangeJob} />}
                {clarify && !e.totalsOnly && (!e.location?.state || e.location.source === 'guess') && <LocationQuestion emp={e} rules={rules} onChange={props.onChangeJob} />}
                {clarify && needsPrevVariable(e, s.fy) && <PrevVariableQuestion emp={e} fy={s.fy} onChange={props.onChangeJob} />}
                {clarify && e.docs.filter((d) => d.facts?.yearGuess).map((d) => <YearQuestion doc={d} onAnswer={(p) => props.onPatchDoc(e.id, d.id, p)} />)}
                {clarify && (props.needs[e.id] ?? []).map((need) => (
                  <HikeQuestion need={need} onAnswer={(f) => props.onAnswerHike(e.id, need.docId, f)} />
                ))}
                {clarify && (() => {
                  const rc = reconcile(e, e.structure, e.start > `${s.fy}-04-01` ? e.start.slice(0, 7) : `${s.fy}-04`, rules);
                  return rc && !rc.ok ? (
                    <p class="callout warn small">
                      The salary breakup {rc.gap > 0 ? `is ${rs(rc.gap)} a month short of` : `is ${rs(-rc.gap)} a month more than`} what the CTC implies. Open "Check the
                      numbers" to fix it.
                    </p>
                  ) : null;
                })()}
                {(() => {
                  const hints = docHints(s, k);
                  return hints.length ? (
                    <div class="doc-hints">
                      <p class="small">
                        <strong>Documents that would help</strong>
                      </p>
                      <ul class="small">
                        {hints.map((h) => (
                          <li>
                            <strong>{h.what}.</strong> <span class="muted">{h.why}</span>
                          </li>
                        ))}
                      </ul>
                      <Uploader compact buttonLabel={`+ Add to ${e.name || 'this job'}`} onFiles={(f) => props.onAddFilesTo(e.id, f)} />
                    </div>
                  ) : null;
                })()}
                {!clarify && (props.notes[e.id] ?? []).map((t) => (
                  <p class="callout warn small">{t}</p>
                ))}
                <div class="tl-actions">
                  <button type="button" class="btn small" onClick={() => props.onEdit(e.id)}>
                    Check the numbers
                  </button>
                  {n > 1 && (
                    <button type="button" class="btn small ghost" onClick={() => confirm(`Remove ${e.name || 'this job'} and its ${e.docs.length} file${e.docs.length === 1 ? '' : 's'}?`) && props.onRemove(e.id)}>
                      Remove
                    </button>
                  )}
                  <span class="muted small">
                    {e.docs.length} file{e.docs.length === 1 ? '' : 's'}
                  </span>
                </div>
              </>
            );
          }}
        </CompanyCards>
      )}

      {!clarify && (
      <div class="card">
        <h3>What happens when</h3>
        <Timeline events={props.events} today={s.today} jobs={n} />
      </div>
      )}

      {clarify && <Glossary />}

      <div class="card">
        <h3>Missing something?</h3>
        <p class="muted small">Add another appraisal letter, payslip, resignation email or F&F slip. It goes to the right job by company and date.</p>
        <Uploader compact buttonLabel="+ Add more documents" onFiles={props.onAddFiles} />
        {n < MAX_EMPLOYERS && (
          <button type="button" class="btn link" onClick={props.onAddJob}>
            + Add a job without documents
          </button>
        )}
      </div>

      {errors.length > 0 && (
        <div class="callout warn" role="status">
          {errors.map((x) => (
            <p>{x}</p>
          ))}
        </div>
      )}
      <Continue
        label={clarify ? 'Continue to the timeline' : 'Timeline looks right'}
        disabled={clarify ? hard.length > 0 : errors.length > 0 || props.inbox.length > 0 || unconfirmed.length > 0}
        why={
          clarify && hard.length
            ? 'Answer the questions above first.'
            : props.inbox.length
            ? 'Tell us which job each file is for.'
            : unconfirmed.length
              ? `Confirm when you leave ${unconfirmed.map((e) => e.name).join(' and ')}.`
              : 'Fix the dates above first.'
        }
        onClick={props.onNext}
      />
    </>
  );
}
