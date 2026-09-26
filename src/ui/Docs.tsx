import { monthName, monthOf } from '../domain/fy';
import type { Employment } from '../domain/types';
import { fieldLabel, mergeDocs, type Choices } from '../extract/merge';
import { rs } from '../format';
import { Uploader, type ReadFile } from './Uploader';

const when = (d?: string) => (d ? monthName(monthOf(d)) : 'no date found');

/** The files read for one job, plus a question for every figure they disagree on. */
export function DocsPanel(props: {
  emp: Employment;
  choices: Choices;
  onAdd: (files: ReadFile[]) => void;
  onRemove: (docId: string) => void;
  onChoose: (field: string, choice: string) => void;
}) {
  const { emp, choices } = props;
  const { conflicts } = mergeDocs(emp.docs);
  return (
    <>
      <div class="card">
        <h3>Your files</h3>
        {emp.docs.length === 0 && <p class="muted small">No files yet. Add an offer letter, a revision letter or recent payslips, or type the numbers in below.</p>}
        {emp.docs.length > 0 && (
          <ul class="files">
            {emp.docs.map((d) => (
              <li>
                <span class="file-kind">{d.kind === 'payslip' ? 'Payslip' : 'Letter'}</span>
                <span class="file-name">
                  {d.name}
                  <span class="muted small"> · {when(d.docDate)} · {Object.keys(d.fields).filter((f) => f !== 'joiningOffset').length} figures</span>
                </span>
                <button type="button" class="btn icon" aria-label={`Remove ${d.name}`} onClick={() => props.onRemove(d.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <Uploader compact buttonLabel={emp.docs.length ? '+ Add more files' : 'Choose files'} onFiles={props.onAdd} />
      </div>

      {conflicts.length > 0 && (
        <div class="card conflicts">
          <h3>These files disagree</h3>
          <p class="muted small">Pick the right figure for each. If your salary changed between them, say so and we'll use each figure for the right months.</p>
          {conflicts.map((c) => (
            <fieldset class={`conflict ${choices[c.field] ? '' : 'open'}`}>
              <legend>{fieldLabel(c.field)}</legend>
              {c.options.map((o) => (
                <label class="radio">
                  <input type="radio" name={`c-${emp.id}-${c.field}`} checked={choices[c.field] === o.docId} onChange={() => props.onChoose(c.field, o.docId)} />
                  <span>
                    <span class="num strong">{rs(o.value)}</span> <span class="muted small">in {o.docName} ({when(o.docDate)})</span>
                  </span>
                </label>
              ))}
              {c.canBeRevision && (
                <label class="radio">
                  <input type="radio" name={`c-${emp.id}-${c.field}`} checked={choices[c.field] === 'changed'} onChange={() => props.onChoose(c.field, 'changed')} />
                  <span>
                    My salary changed: {rs(c.options[c.options.length - 1].value)} before {when(c.options[0].docDate)}, {rs(c.options[0].value)} from then on
                  </span>
                </label>
              )}
            </fieldset>
          ))}
        </div>
      )}
    </>
  );
}
