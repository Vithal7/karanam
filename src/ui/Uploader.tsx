import { useRef, useState } from 'preact/hooks';
import { parseText, type Extracted } from '../extract/parse';
import { fileToText } from '../extract/text';

export interface ReadFile {
  name: string;
  text: string;
  x: Extracted;
  /** Typed or pasted by you, not a file: read as your own words. */
  typed?: boolean;
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
  const camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ status: string; p: number; file: string; i: number; n: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');

  function readPasted() {
    // A typed note can be short ("hiked to 19 LPA from July"); anything shorter says nothing.
    if (pasted.trim().length < 12) {
      setErrors(['That looks too short. Paste the letter, or write a line like "offer from Zeta, 20 LPA, joining 1 Dec".']);
      return;
    }
    const x = parseText(pasted);
    setErrors([]);
    setPasting(false);
    setPasted('');
    props.onFiles([{ name: 'Pasted text', text: pasted, x, typed: true }]);
  }

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
        read.push({ name: file.name, text, x: parseText(text) });
      } catch (e) {
        console.error(e);
        errs.push(`${file.name}: ${e instanceof Error ? e.message : 'could not read this file.'}`);
      }
    }
    setBusy(null);
    setErrors(errs);
    if (input.current) input.current.value = '';
    if (camera.current) camera.current.value = '';
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
            {/* A real label around the input: phones and in-app browsers often ignore input.click(). */}
            {/* No accept filter: phone pickers grey out types they don't recognise (.eml and .msg on
                iOS and Android), so any file can be picked and its type is worked out after. */}
            <div class="file-btns">
              <label class={`btn file-btn ${props.compact ? '' : 'primary'}`}>
                {props.buttonLabel ?? 'Choose files'}
                <input ref={input} class="visually-hidden" type="file" multiple onChange={(e) => handle((e.target as HTMLInputElement).files)} />
              </label>
              <label class="btn file-btn">
                Take a photo
                <input ref={camera} class="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(e) => handle((e.target as HTMLInputElement).files)} />
              </label>
            </div>
            {!props.compact && (
              <p class="muted small">
                Select several at once: offer letters (old and new), appraisal letters, payslips, your resignation email, the F&F slip. PDF, Word, emails (.eml or Outlook .msg) or photos (JPG, PNG). They're read on this device and never uploaded.
              </p>
            )}
          </>
        )}
      </div>
      {errors.length > 0 && (
        <div class="callout err">
          {errors.map((e) => (
            <p>{e}</p>
          ))}
        </div>
      )}
      {pasting ? (
        <div class="paste">
          <label class="field-label" for="paste-text">
            Paste your letter or payslip, or describe your offer in your own words
          </label>
          <textarea
            id="paste-text"
            class="text"
            rows={8}
            placeholder={'Paste the letter\'s text, or write e.g.\nGot an offer from KV Pvt Ltd: 30 base (15 basic, 50% basic HRA, rest special), 1.6 variable. Joining 14 Nov 2026. Resigned 5 Sept, LWD 13 Nov 2026, 18 leaves at Northwind.'}
            value={pasted}
            onInput={(e) => setPasted((e.target as HTMLTextAreaElement).value)}
          />
          <div class="paste-actions">
            <button type="button" class="btn primary" disabled={!pasted.trim()} onClick={readPasted}>
              Read this text
            </button>
            <button type="button" class="btn ghost" onClick={() => setPasting(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" class="btn link" onClick={() => setPasting(true)} disabled={!!busy}>
          Can't pick a file? Paste the letter's text instead
        </button>
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
