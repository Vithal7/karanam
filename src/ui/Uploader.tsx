import { useRef, useState } from 'preact/hooks';
import { parseText, type Extracted } from '../extract/parse';
import { ACCEPT, fileToText } from '../extract/text';

/** File picker + drop zone that turns a letter into extracted components. */
export function Uploader(props: { onExtracted: (x: Extracted, fileName: string) => void; onManual: () => void; manualLabel?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ status: string; p: number } | null>(null);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);

  async function handle(file: File | undefined) {
    if (!file) return;
    setError('');
    setBusy({ status: 'Opening file', p: 0 });
    try {
      const { text } = await fileToText(file, (status, p) => setBusy({ status: humanStatus(status), p }));
      const x = parseText(text);
      props.onExtracted(x, file.name);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div
        class={`drop ${drag ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handle(e.dataTransfer?.files[0]);
        }}
      >
        {busy ? (
          <div class="progress" role="status" aria-live="polite">
            <div class="spinner" aria-hidden="true" />
            <p>{busy.status}…</p>
            {busy.p > 0 && busy.p < 1 && (
              <div class="bar" aria-hidden="true">
                <span style={{ width: `${Math.round(busy.p * 100)}%` }} />
              </div>
            )}
          </div>
        ) : (
          <>
            <svg class="drop-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <button type="button" class="btn primary" onClick={() => input.current?.click()}>
              Choose file or take photo
            </button>
            <p class="muted small">PDF, Word (.docx) or a photo. Read on your device, never uploaded.</p>
          </>
        )}
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => handle((e.target as HTMLInputElement).files?.[0])} />
      </div>
      {error && <div class="callout err">{error}</div>}
      <button type="button" class="btn link" onClick={props.onManual} disabled={!!busy}>
        {props.manualLabel ?? 'No letter handy? Type the numbers in'}
      </button>
    </div>
  );
}

function humanStatus(s: string) {
  if (/loading tesseract core|loading language|initializ/i.test(s)) return 'Getting the text reader ready (first time only)';
  if (/recognizing/i.test(s)) return 'Reading text from the image';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
