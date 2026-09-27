import { createPortal } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';

const STAGE_NAMES = ['Upload documents', 'Answer questions', 'Verify timeline', "What's my in-hand"];

/** Two-tap reset (no browser confirm dialog, which embedded views block). */
function StartOver({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" class={`drawer-item ${armed ? 'danger' : ''}`} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      <span class="drawer-icon" aria-hidden="true">↺</span>
      <span>
        <strong>{armed ? 'Tap again to clear everything' : 'Start over'}</strong>
        <span class="muted small">Removes your documents and answers from this device</span>
      </span>
    </button>
  );
}

/** Burger menu: the year's projection, or filing the return. */
export function Drawer(props: { view: 'projection' | 'filing'; stage: number; onView: (v: 'projection' | 'filing') => void; onStartOver: () => void; canStartOver: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  const pick = (v: 'projection' | 'filing') => {
    props.onView(v);
    setOpen(false);
  };
  return (
    <>
      <button type="button" class="burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
      {open &&
        createPortal(
        <div class="drawer-backdrop" onClick={() => setOpen(false)}>
          <nav class="drawer" aria-label="Main" onClick={(e) => e.stopPropagation()}>
            <div class="drawer-head">
              <strong>In-hand</strong>
              <button type="button" class="drawer-close" aria-label="Close menu" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <button type="button" class={`drawer-item ${props.view === 'projection' ? 'active' : ''}`} onClick={() => pick('projection')}>
              <span class="drawer-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M4 19V9m6 10V5m6 14v-7m4 7H3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
              </span>
              <span>
                <strong>Projection</strong>
                <span class="muted small">Month-by-month in-hand and tax · now: {STAGE_NAMES[props.stage] ?? STAGE_NAMES[0]}</span>
              </span>
            </button>
            <button type="button" class={`drawer-item ${props.view === 'filing' ? 'active' : ''}`} onClick={() => pick('filing')}>
              <span class="drawer-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
                </svg>
              </span>
              <span>
                <strong>Filing (ITR-1)</strong>
                <span class="muted small">What to enter in the return, and what to reconcile</span>
              </span>
            </button>
            {props.canStartOver && (
              <>
                <hr />
                <StartOver
                  onConfirm={() => {
                    props.onStartOver();
                    setOpen(false);
                  }}
                />
              </>
            )}
          </nav>
        </div>,
          document.body,
        )}
    </>
  );
}
