import { MAX_EMPLOYERS, validateEmployers } from '../../domain/compute';
import { fyLabel } from '../../domain/fy';
import type { StoryJob } from '../../domain/story';
import type { DocRecord, Scenario } from '../../domain/types';
import { Continue } from '../Continue';
import { seriesClass } from '../Chart';
import { Uploader, type ReadFile } from '../Uploader';

const KIND: Record<DocRecord['kind'], string> = {
  offer: 'Offer letter',
  appraisal: 'Appraisal letter',
  payslip: 'Payslip',
  resignation: 'Resignation',
  fnf: 'F&F slip',
};

/** The year's jobs as a story, with any files we couldn't place. */
export function StoryStep(props: {
  s: Scenario;
  story: StoryJob[];
  notes: Record<string, string[]>;
  inbox: DocRecord[];
  onAssign: (docId: string, target: string) => void;
  onDiscard: (docId: string) => void;
  onAddFiles: (f: ReadFile[]) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onAddJob: () => void;
  onNext: () => void;
}) {
  const { s } = props;
  const errors = validateEmployers(s);
  const n = s.employers.length;
  return (
    <>
      <p class="lead">Here's what your documents say about {fyLabel(s.fy)}. Check each job, then see the money.</p>

      {props.inbox.length > 0 && (
        <div class="card conflicts">
          <h3>Which job are these files for?</h3>
          {props.inbox.map((d) => (
            <div class="inbox-row">
              <span class="file-kind">{KIND[d.kind]}</span>
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

      <ol class="timeline">
        {props.story.map((j, k) => {
          const e = s.employers[k];
          return (
            <li class="tl-item">
              <span class={`tl-dot ${seriesClass(k, n)}`} aria-hidden="true" />
              <div class="card tl-card">
                <div class="tl-head">
                  <strong>{j.name || `Job ${k + 1}`}</strong>
                  <span class={`badge ${j.isNew ? 'new' : ''}`}>{j.isNew ? (n > 1 ? 'New job' : 'Your job') : 'Earlier job'}</span>
                </div>
                <ul class="story">
                  {j.lines.map((l) => (
                    <li class={l.tone ?? ''}>{l.text}</li>
                  ))}
                </ul>
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
              </div>
            </li>
          );
        })}
      </ol>

      <div class="card">
        <h3>Missing something?</h3>
        <p class="muted small">Add another appraisal letter, payslip, resignation email or F&F slip. It goes to the right job automatically.</p>
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
      <Continue label="Continue" disabled={errors.length > 0 || props.inbox.length > 0} why={props.inbox.length ? 'Tell us which job each file is for.' : 'Fix the dates above first.'} onClick={props.onNext} />
    </>
  );
}
