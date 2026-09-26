export function Continue(props: { onClick: () => void; disabled?: boolean; why?: string; label?: string }) {
  return (
    <div class="continue">
      {props.disabled && props.why && <p class="muted small">{props.why}</p>}
      <button type="button" class="btn primary wide" disabled={props.disabled} onClick={props.onClick}>
        {props.label ?? 'Continue'}
      </button>
    </div>
  );
}
