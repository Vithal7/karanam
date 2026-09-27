import { useState } from 'preact/hooks';
import { MAX_EMPLOYERS, validateEmployers, type Result } from '../../domain/compute';
import { fyLabel, monthLong } from '../../domain/fy';
import type { TimelineEvent } from '../../domain/story';
import type { DocRecord, Facts, Scenario } from '../../domain/types';
import { CompanyCards } from '../CompanyCards';
import { DOC_KIND_SHORT } from '../docKinds';
import { Continue } from '../Continue';
import { reconcile } from '../../domain/reconcile';
import { rs } from '../../format';
import { useRules } from '../rulesContext';
import { ExitQuestion } from '../ExitQuestion';
import { Money, Percent } from '../controls';
import { Timeline } from '../Timeline';
import { Uploader, type ReadFile } from '../Uploader';


export interface HikeNeed {
  docId: string;
  docName: string;
  month: string;
}

/** Asks for the size of a hike the letter didn't state clearly. */
function HikeQuestion(props: { need: HikeNeed; onAnswer: (f: Partial<Facts>) => void }) {
  const [ctc, setCtc] = useState(0);
  const [pct, setPct] = useState(0);
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

/** Your jobs, the money each puts in your bank, and one timeline of what happens when. */
export function StoryStep(props: {
  s: Scenario;
  r: Result | null;
  events: TimelineEvent[];
  notes: Record<string, string[]>;
  needs: Record<string, HikeNeed[]>;
  inbox: DocRecord[];
  onAssign: (docId: string, target: string) => void;
  onDiscard: (docId: string) => void;
  onAddFiles: (f: ReadFile[]) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onAddJob: () => void;
  onAnswerHike: (jobId: string, docId: string, f: Partial<Facts>) => void;
  onChangeJob: (e: import('../../domain/types').Employment) => void;
  onNext: () => void;
}) {
  const { s, r } = props;
  const rules = useRules();
  const errors = validateEmployers(s);
  const unconfirmed = s.employers.slice(0, -1).filter((e) => !e.totalsOnly && e.endSource !== 'doc' && e.endSource !== 'user');
  const n = s.employers.length;
  return (
    <>
      <p class="lead">Here's {fyLabel(s.fy)} as your documents tell it. Check each company's numbers, then see the money month by month.</p>

      {props.inbox.length > 0 && (
        <div class="card conflicts">
          <h3>Which job are these files for?</h3>
          {props.inbox.map((d) => (
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

      {r && (
        <CompanyCards s={s} r={r} badges>
          {(k) => {
            const e = s.employers[k];
            return (
              <>
                {k < n - 1 && !e.totalsOnly && e.endSource !== 'doc' && e.endSource !== 'user' && (
                  <ExitQuestion emp={e} next={s.employers[k + 1]} fy={s.fy} thirty={s.settings.thirtyDayMonth} onConfirm={props.onChangeJob} />
                )}
                {(props.needs[e.id] ?? []).map((need) => (
                  <HikeQuestion need={need} onAnswer={(f) => props.onAnswerHike(e.id, need.docId, f)} />
                ))}
                {(() => {
                  const rc = reconcile(e, e.structure, e.start > `${s.fy}-04-01` ? e.start.slice(0, 7) : `${s.fy}-04`, rules);
                  return rc && !rc.ok ? (
                    <p class="callout warn small">
                      The salary breakup {rc.gap > 0 ? `is ${rs(rc.gap)} a month short of` : `is ${rs(-rc.gap)} a month more than`} what the CTC implies. Open "Check the
                      numbers" to fix it.
                    </p>
                  ) : null;
                })()}
                {(props.notes[e.id] ?? []).map((t) => (
                  <p class="callout warn small">{t}</p>
                ))}
                <div class="tl-actions">
                  <button type="button" class="btn small" onClick={() => props.onEdit(e.id)}>
                    Check the numbers
                  </button>
                  {n > 1 && (
                    <button type="button" class="btn small ghost" onClick={() => props.onRemove(e.id)}>
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

      <div class="card">
        <h3>What happens when</h3>
        <Timeline events={props.events} today={s.today} jobs={n} />
      </div>

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
        label="Continue"
        disabled={errors.length > 0 || props.inbox.length > 0 || unconfirmed.length > 0}
        why={
          props.inbox.length
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
