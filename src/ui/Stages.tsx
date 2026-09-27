const STAGES = ['Upload documents', 'Answer questions', 'Verify timeline', "What's my in-hand"];

/**
 * The four stages, ticked off as they're done. A done stage, and the first one not done yet, can
 * be opened; later ones wait until the earlier ones are done.
 */
export function Stages(props: { current: number; done: boolean[]; onGo: (i: number) => void }) {
  const firstOpen = props.done.findIndex((d) => !d);
  const reachable = (i: number) => props.done[i] || i === firstOpen || (firstOpen === -1 && i <= 3) || (i <= props.current);
  return (
    <nav class="stages" aria-label="Progress">
      <ol>
        {STAGES.map((label, i) => {
          const state = props.done[i] ? 'done' : i === props.current ? 'current' : 'todo';
          const can = reachable(i) && i !== props.current;
          return (
            <li class={`stage ${state} ${i === props.current ? 'here' : ''}`} aria-current={i === props.current ? 'step' : undefined}>
              <button type="button" disabled={!can} onClick={() => props.onGo(i)}>
                <span class="stage-dot" aria-hidden="true">
                  {props.done[i] ? (
                    <svg viewBox="0 0 16 16">
                      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span class="stage-label">{label}</span>
                <span class="visually-hidden">{props.done[i] ? ' (done)' : i === props.current ? ' (you are here)' : ''}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
