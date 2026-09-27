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

type View = 'projection' | 'filing';

const ICONS: Record<View, preact.JSX.Element> = {
  projection: (
    <svg viewBox="0 0 24 24">
      <path d="M4 19V9m6 10V5m6 14v-7m4 7H3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  ),
  filing: (
    <svg viewBox="0 0 24 24">
      <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  ),
};

/** The modules: the year's projection, and filing the return. Shared by the phone drawer and the desktop sidebar. */
function NavItems(props: { view: View; stage: number; onPick: (v: View) => void; compact?: boolean }) {
  const items: { v: View; title: string; sub: string }[] = [
    { v: 'projection', title: 'Projection', sub: `Month-by-month in-hand and tax · now: ${STAGE_NAMES[props.stage] ?? STAGE_NAMES[0]}` },
    { v: 'filing', title: 'Filing (ITR-1)', sub: 'What to enter in the return, from your Form 16' },
  ];
  return (
    <>
      {items.map((it) => (
        <button
          type="button"
          class={`drawer-item ${props.view === it.v ? 'active' : ''}`}
          aria-current={props.view === it.v ? 'page' : undefined}
          title={props.compact ? it.title : undefined}
          onClick={() => props.onPick(it.v)}
        >
          <span class="drawer-icon" aria-hidden="true">
            {ICONS[it.v]}
          </span>
          <span class="drawer-text">
            <strong>{it.title}</strong>
            <span class="muted small">{it.sub}</span>
          </span>
          {props.compact && <span class="visually-hidden">{it.title}</span>}
        </button>
      ))}
    </>
  );
}

/** Desktop: the menu is part of the page, expanded or collapsed to icons. */
export function Sidebar(props: { collapsed: boolean; view: View; stage: number; onView: (v: View) => void; onStartOver: () => void; canStartOver: boolean }) {
  return (
    <aside class={`sidebar ${props.collapsed ? 'collapsed' : ''}`} aria-label="Main">
      <div class="sidebar-cap">Modules</div>
      <nav>
        <NavItems view={props.view} stage={props.stage} onPick={props.onView} compact={props.collapsed} />
        {props.canStartOver && !props.collapsed && (
          <>
            <hr />
            <StartOver onConfirm={props.onStartOver} />
          </>
        )}
      </nav>
    </aside>
  );
}

/** Burger: on phones it opens the drawer; on desktop it collapses or expands the sidebar. */
export function Drawer(props: {
  view: View;
  stage: number;
  onView: (v: View) => void;
  onStartOver: () => void;
  canStartOver: boolean;
  desktop?: boolean;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  const pick = (v: View) => {
    props.onView(v);
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        class="burger"
        aria-label={props.desktop ? (props.sidebarOpen ? 'Collapse menu' : 'Expand menu') : 'Menu'}
        aria-expanded={props.desktop ? props.sidebarOpen : open}
        onClick={() => (props.desktop ? props.onToggleSidebar?.() : setOpen(true))}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
      {open &&
        !props.desktop &&
        createPortal(
        <div class="drawer-backdrop" onClick={() => setOpen(false)}>
          <nav class="drawer" aria-label="Main" onClick={(e) => e.stopPropagation()}>
            <div class="drawer-head">
              <strong>In-hand</strong>
              <button type="button" class="drawer-close" aria-label="Close menu" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <NavItems view={props.view} stage={props.stage} onPick={pick} />
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
