import { validateEmployers, MAX_EMPLOYERS } from '../../domain/compute';
import { fyLabel } from '../../domain/fy';
import { fixedMonthly } from '../../domain/schedule';
import type { Employment, Scenario } from '../../domain/types';
import { rs } from '../../format';
import { canAddJob, earlierJobs, offerOf } from '../../state';
import { Continue } from '../Continue';

const fmt = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '…');

function summary(e: Employment) {
  if (e.totalsOnly) return `Totals only: ${rs(e.totalsOnly.gross)} earned, ${rs(e.totalsOnly.tds)} tax`;
  const g = fixedMonthly(e.structure);
  return g ? `${rs(g)} a month gross${e.docs.length ? ` · ${e.docs.length} file${e.docs.length > 1 ? 's' : ''}` : ''}` : 'Salary not entered yet';
}

/** Timeline of this FY's jobs, with the offer last. */
export function JobsStep(props: {
  s: Scenario;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onEditOffer: () => void;
  onNext: () => void;
}) {
  const { s } = props;
  const earlier = earlierJobs(s);
  const offer = offerOf(s);
  const errors = validateEmployers(s);
  return (
    <>
      <p class="lead">
        Salary from every job in {fyLabel(s.fy)} is taxed together. Add any job you had between 1 April and {fmt(offer.start)}, up to {MAX_EMPLOYERS} jobs in total.
      </p>
      <ol class="timeline">
        {earlier.map((e, i) => (
          <li class="tl-item">
            <span class={`tl-dot s${i + 2}`} aria-hidden="true" />
            <div class="card tl-card">
              <div class="tl-head">
                <strong>{e.name || `Job ${i + 1}`}</strong>
                <span class="muted small">
                  {fmt(e.start)} – {fmt(e.end)}
                </span>
              </div>
              <p class="muted small">{summary(e)}</p>
              <div class="tl-actions">
                <button type="button" class="btn small" onClick={() => props.onEdit(e.id)}>
                  Edit details
                </button>
                <button type="button" class="btn small ghost" onClick={() => props.onRemove(e.id)}>
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
        <li class="tl-item">
          <span class="tl-dot s1" aria-hidden="true" />
          <div class="card tl-card">
            <div class="tl-head">
              <strong>{offer.name || 'New job'}</strong>
              <span class="muted small">from {fmt(offer.start)}</span>
            </div>
            <p class="muted small">{summary(offer)} · the offer you're checking</p>
            <div class="tl-actions">
              <button type="button" class="btn small" onClick={props.onEditOffer}>
                Edit offer
              </button>
            </div>
          </div>
        </li>
      </ol>
      {canAddJob(s) ? (
        <button type="button" class="btn wide" onClick={props.onAdd}>
          + Add {earlier.length ? 'another' : 'a'} job from earlier this year
        </button>
      ) : (
        <p class="muted small">That's the maximum of {MAX_EMPLOYERS} jobs.</p>
      )}
      {errors.length > 0 && earlier.length > 0 && (
        <div class="callout warn" role="status">
          {errors.map((e) => (
            <p>{e}</p>
          ))}
        </div>
      )}
      <Continue
        label={earlier.length ? 'Continue' : 'No other jobs this year, continue'}
        disabled={earlier.length > 0 && errors.length > 0}
        why="Fix the dates above first."
        onClick={props.onNext}
      />
    </>
  );
}
