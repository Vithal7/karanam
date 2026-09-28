import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { rs } from '../format';
import type { Confidence } from '../extract/parse';

export type Mark = Confidence | 'missing' | undefined;

export function MarkChip({ mark }: { mark: Mark }) {
  if (mark === 'guessed') return <span class="chip warn">check this</span>;
  if (mark === 'missing') return <span class="chip miss">not found</span>;
  if (mark === 'found') return <span class="chip ok">from letter</span>;
  return null;
}

export function Field(props: { label: string; hint?: ComponentChildren; mark?: Mark; children: ComponentChildren }) {
  return (
    <label class={`field ${props.mark ? `m-${props.mark}` : ''}`}>
      <span class="field-label">
        {props.label} <MarkChip mark={props.mark} />
      </span>
      {props.children}
      {props.hint && <span class="field-hint">{props.hint}</span>}
    </label>
  );
}

const parseNum = (s: string) => {
  const t = s.replace(/[,₹\s]/g, '');
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/** A rupee input that accepts "1,25,000" and shows the formatted figure while you type. */
export function Money(props: {
  value: number;
  onChange: (v: number) => void;
  /** Multiply for display (e.g. 12 to edit a monthly value as yearly). */
  scale?: number;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const scale = props.scale ?? 1;
  const fmt = (v: number) => (v ? (Math.round(v * scale * 100) / 100).toLocaleString('en-IN') : '');
  const [text, setText] = useState(fmt(props.value));
  const [focus, setFocus] = useState(false);
  // Follow outside changes (e.g. the monthly/yearly switch) but never while the user is typing.
  useEffect(() => {
    if (!focus) setText(fmt(props.value));
  }, [props.value, scale, focus]);
  return (
    <div class="money">
      <span class="money-prefix">₹</span>
      <input
        inputMode="decimal"
        aria-label={props.ariaLabel}
        placeholder={props.placeholder ?? '0'}
        value={text}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onInput={(e) => {
          const t = (e.target as HTMLInputElement).value;
          setText(t);
          const n = parseNum(t);
          if (!Number.isNaN(n)) props.onChange(n / scale);
        }}
      />
    </div>
  );
}

export function Num(props: { value: number; onChange: (v: number) => void; suffix?: string; step?: number; ariaLabel?: string }) {
  return (
    <div class="money">
      <input
        type="number"
        inputMode="decimal"
        aria-label={props.ariaLabel}
        step={props.step ?? 1}
        value={Number.isFinite(props.value) ? props.value : ''}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).valueAsNumber;
          props.onChange(Number.isFinite(v) ? v : 0);
        }}
      />
      {props.suffix && <span class="money-suffix">{props.suffix}</span>}
    </div>
  );
}

export function Percent(props: { value: number; onChange: (v: number) => void; ariaLabel?: string }) {
  return (
    <Num
      ariaLabel={props.ariaLabel}
      value={Math.round(props.value * 10000) / 100}
      step={0.5}
      suffix="%"
      onChange={(v) => props.onChange(v / 100)}
    />
  );
}

export function DateInput(props: { value: string; onChange: (v: string) => void; ariaLabel?: string }) {
  return (
    <input type="date" class="text" aria-label={props.ariaLabel} value={props.value} onInput={(e) => props.onChange((e.target as HTMLInputElement).value)} />
  );
}

export function MonthInput(props: { value: string; onChange: (v: string) => void; ariaLabel?: string }) {
  return (
    <input type="month" class="text" aria-label={props.ariaLabel} value={props.value} onInput={(e) => props.onChange((e.target as HTMLInputElement).value)} />
  );
}

export function Choices<T extends string>(props: {
  options: { value: T; label: string; sub?: string }[];
  value: T | null | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <div class="choices" role="radiogroup">
      {props.options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          class={`choice ${props.value === o.value ? 'on' : ''}`}
          onClick={() => props.onChange(o.value)}
        >
          <span class="choice-label">{o.label}</span>
          {o.sub && <span class="choice-sub">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: ComponentChildren }) {
  return (
    <label class="toggle">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export function Segmented<T extends string>(props: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div class="segmented" role="group" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button type="button" aria-pressed={props.value === o.value} class={props.value === o.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div class="callout warn" role="status">
      {items.map((w) => (
        <p>{w}</p>
      ))}
    </div>
  );
}

export const Amount = ({ v }: { v: number }) => <span class="num">{rs(v)}</span>;
