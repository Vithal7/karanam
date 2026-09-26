import { useRef, useState } from 'preact/hooks';
import { parseText, type Extracted } from '../extract/parse';
import { ACCEPT, fileToText } from '../extract/text';

export interface ReadFile {
  name: string;
  x: Extracted;
}

/** File picker + drop zone. Reads one or more files on the device, then hands back what it found. */
export function Uploader(props: {
  onFiles: (files: ReadFile[]) => void;
  onManual?: () => void;
  manualLabel?: string;
  compact?: boolean;
  buttonLabel?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ status: string; p: number; file: string; i: number; n: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);

  async function handle(list: FileList | null | undefined) {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    setErrors([]);
    const read: ReadFile[] = [];
    const errs: string[] = [];
    for (const [i, file] of files.entries()) {
      setBusy({ status: 'Opening', p: 0, file: file.name, i: i + 1, n: files.length });
      try {
        const { text } = await fileToText(file, (status, p) => setBusy({ status: humanStatus(status), p, file: file.name, i: i + 1, n: files.length }));
        read.push({ name: file.name, x: parseText(text) });
      } catch (e) {
        console.error(e);
        errs.push(`${file.name}: ${e instanceof Error ? e.message : 'could not read this file.'}`);
      }
    }
    setBusy(null);
    setErrors(errs);
    if (input.current) input.current.value = '';
    if (read.length) props.onFiles(read);
  }

  return (
    <div>
      <div
        class={`drop ${drag ? 'drag' : ''} ${props.compact ? 'compact' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handle(e.dataTransfer?.files);
        }}
      >
        {busy ? (
          <div class="progress" role="status" aria-live="polite">
            <div class="spinner" aria-hidden="true" />
            <p>
              {busy.n > 1 && `File ${busy.i} of ${busy.n}: `}
              {busy.status}…
            </p>
            <p class="muted small">{busy.file}</p>
            {busy.p > 0 && busy.p < 1 && (
              <div class="bar" aria-hidden="true">
                <span style={{ width: `${Math.round(busy.p * 100)}%` }} />
              </div>
            )}
          </div>
        ) : (
          <>
            {!props.compact && (
              <svg class="drop-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            )}
            <button type="button" class={`btn ${props.compact ? '' : 'primary'}`} onClick={() => input.current?.click()}>
              {props.buttonLabel ?? 'Choose files or take a photo'}
            </button>
            {!props.compact && <p class="muted small">Offer letter, revision letters or payslips. PDF, Word or photos. You can pick several at once. They're read on your device and never uploaded.</p>}
          </>
        )}
        <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => handle((e.target as HTMLInputElement).files)} />
      </div>
      {errors.length > 0 && (
        <div class="callout err">
          {errors.map((e) => (
            <p>{e}</p>
          ))}
        </div>
      )}
      {props.onManual && (
        <button type="button" class="btn link" onClick={props.onManual} disabled={!!busy}>
          {props.manualLabel ?? 'No letter handy? Type the numbers in'}
        </button>
      )}
    </div>
  );
}

function humanStatus(s: string) {
  if (/loading tesseract core|loading language|initializ/i.test(s)) return 'Getting the text reader ready (first time only)';
  if (/recognizing/i.test(s)) return 'Reading text from the image';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
