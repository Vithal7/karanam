import { monthLong, monthOf } from '../domain/fy';
import type { DocKind, DocRecord, Employment } from '../domain/types';
import { DOC_KIND_LABEL, DOC_KIND_SHORT } from './docKinds';
import { baseDocs, fieldLabel, mergeDocs, type Choices } from '../extract/merge';
import { rs } from '../format';
import { useState } from 'preact/hooks';
import { Uploader, type ReadFile } from './Uploader';

const when = (d?: string) => (d ? monthLong(monthOf(d)) : 'no date found');

/** A few words on what we took from a file, so a wrong read is easy to spot. */
function readSummary(d: DocRecord): string {
  const f = d.facts ?? {};
  const bits: string[] = [];
  if (d.doj) bits.push(`joining ${d.doj}`);
  if (d.fields.basic) bits.push(`basic ${rs(d.fields.basic)}/mo`);
  if (d.fields.ctc) bits.push(`CTC ${rs(d.fields.ctc)}`);
  if (f.effectiveFrom) bits.push(`from ${monthLong(monthOf(f.effectiveFrom))}`);
  if (f.incrementPct) bits.push(`+${(f.incrementPct * 100).toFixed(1)}%`);
  if (f.revisedCtc) bits.push(`new CTC ${rs(f.revisedCtc)}`);
  if (f.lastWorkingDay) bits.push(`last day ${f.lastWorkingDay}`);
  if (f.leaveAmount) bits.push(`leave ${rs(f.leaveAmount)}`);
  if (f.noticeRecoveryAmount) bits.push(`notice ${rs(f.noticeRecoveryAmount)}`);
  if (d.ytdTds !== undefined) bits.push(`TDS so far ${rs(d.ytdTds)}`);
  return bits.length ? bits.join(' · ') : d.kind === 'other' ? 'not used' : 'nothing found';
}

/** The files read for one job, plus a question for every figure they disagree on. */
export function DocsPanel(props: {
  emp: Employment;
  choices: Choices;
  onAdd: (files: ReadFile[]) => void;
  onRemove: (docId: string) => void;
  onChoose: (field: string, choice: string) => void;
  onReclassify?: (docId: string, kind: DocKind) => void;
  /** Correct the text a file was read from (a pasted note, or a misread scan) and read it again. */
  onEditText?: (docId: string, text: string) => void;
}) {
  const { emp, choices } = props;
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const { conflicts } = mergeDocs(baseDocs(emp.docs));
  return (
    <>
      <div class="card">
        <h3>Your files</h3>
        {emp.docs.length === 0 && <p class="muted small">No files yet. Add an offer letter, a revision letter or recent payslips, or type the numbers in below.</p>}
        {emp.docs.length > 0 && (
          <ul class="files">
            {emp.docs.map((d) => (
              <li>
                <span class="file-name">
                  {d.name}
                  <span class="muted small">
                    {' '}
                    · {when(d.docDate)}
                    <br />
                    Read: {readSummary(d)}
                  </span>
                </span>
                {props.onReclassify ? (
                  <select class="kind-select" aria-label={`Type of ${d.name}`} value={d.kind} onChange={(ev) => props.onReclassify!(d.id, (ev.target as HTMLSelectElement).value as DocKind)}>
                    {(Object.keys(DOC_KIND_LABEL) as DocKind[]).map((k) => (
                      <option value={k}>{DOC_KIND_LABEL[k]}</option>
                    ))}
                  </select>
                ) : (
                  <span class="file-kind">{DOC_KIND_SHORT[d.kind]}</span>
                )}
                <button
                  type="button"
                  class="btn icon"
                  aria-label={`Remove ${d.name}`}
                  onClick={() => confirm(`Remove ${d.name}? Its figures will no longer be used for ${emp.name || 'this job'}.`) && props.onRemove(d.id)}
                >
                  ×
                </button>
                {props.onEditText && d.text && editing?.id !== d.id && (
                  <button type="button" class="btn link inline small" onClick={() => setEditing({ id: d.id, text: d.text! })}>
                    Edit text
                  </button>
                )}
                {editing?.id === d.id && (
                  <div class="paste edit-text">
                    <textarea class="text" rows={8} aria-label={`Text of ${d.name}`} value={editing.text} onInput={(ev) => setEditing({ id: d.id, text: (ev.target as HTMLTextAreaElement).value })} />
                    <div class="paste-actions">
                      <button
                        type="button"
                        class="btn primary small"
                        disabled={editing.text.trim().length < 20}
                        onClick={() => {
                          props.onEditText!(d.id, editing.text);
                          setEditing(null);
                        }}
                      >
                        Read it again
                      </button>
                      <button type="button" class="btn ghost small" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
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
