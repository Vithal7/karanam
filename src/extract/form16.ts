/**
 * Form 16 (s.203 certificate, TRACES layout): the employer's own figures for the year. Part A has
 * the TDS deducted and deposited; Part B the salary, exemptions and deductions. These are
 * actuals, so filing uses them over any projection.
 */
import type { Form16 } from '../domain/types';
import { numbersIn } from './parse';

const IS_FORM16 = /form\s*(no\.?)?\s*16\b|certificate\s+under\s+section\s+203/i;

/** The amount on the line matching `label`, or on the next line when the label wraps. Last figure wins (the amount column). */
function amountAfter(lines: string[], label: RegExp): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (!label.test(lines[i])) continue;
    // Drop section references ("section 17(1)", "16(ia)", "80CCD(2)") so they aren't read as amounts.
    const after = lines[i].replace(/(section\s+)?\b(17|10|16|80[a-z]*|192|203)\s*\(\s*[0-9a-z]+\s*\)(\([a-z]+\))?/gi, ' ').replace(/section\s+(10|16|17|192|203)\b/gi, ' ');
    const here = numbersIn(after).filter((n) => !n.pct);
    if (here.length) return here[here.length - 1].value;
    // "0.00" on the row itself: nil, not the next row's figure.
    if (/\d[\d,]*\.\d{2}\s*$|\s0\s*$/.test(after)) return 0;
    const next = numbersIn(lines[i + 1] ?? '').filter((n) => !n.pct);
    if (next.length && !/^\(?[a-z0-9]\)|^\d+\./i.test(lines[i + 1] ?? '')) return next[next.length - 1].value;
  }
  return undefined;
}

const zero = (lines: string[], label: RegExp) => (lines.some((l) => label.test(l)) ? amountAfter(lines, label) ?? 0 : undefined);

export function parseForm16(text: string): Form16 | undefined {
  if (!IS_FORM16.test(text)) return undefined;
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const s171 = amountAfter(lines, /salary\s+as\s+per\s+provisions\s+contained\s+in\s+section\s+17\s*\(\s*1\s*\)|section\s+17\s*\(\s*1\s*\)/i);
  const s172 = zero(lines, /value\s+of\s+perquisites|section\s+17\s*\(\s*2\s*\)/i);
  const s173 = zero(lines, /profits\s+in\s+lieu\s+of\s+salary|section\s+17\s*\(\s*3\s*\)/i);
  const exempt = zero(lines, /total\s+amount\s+of\s+exemption\s+claimed\s+under\s+section\s+10|exemption[s]?\s+(claimed\s+)?(u\/s|under\s+section)\s+10/i);
  const sd = zero(lines, /standard\s+deduction/i);
  const pt = zero(lines, /tax\s+on\s+employment|professional\s+tax/i);
  const chargeable = amountAfter(lines, /income\s+chargeable\s+under\s+the\s+head\s+["“”']?salaries|income\s+chargeable\s+under\s+the\s+head\s+salar/i);
  const nps = zero(lines, /80\s*ccd\s*\(\s*2\s*\)|contribution\s+by\s+(the\s+)?employer\s+to\s+(the\s+)?pension/i);
  // Part A: the quarterly summary's total row (amount paid, tax deducted, tax deposited).
  let tds: number | undefined;
  for (const l of lines) {
    if (!/^total\b/i.test(l) || /income|salary|exemption|deduction|gross/i.test(l)) continue;
    const v = numbersIn(l).filter((n) => !n.pct).map((n) => n.value);
    if (v.length >= 3) {
      tds = v[v.length - 2];
      break;
    }
  }
  tds ??= amountAfter(lines, /net\s+tax\s+(payable|deducted)|tax\s+deducted\s+at\s+source|total\s+tax\s+deducted/i);
  const tan = /\bTAN\b[^A-Z0-9]{0,40}([A-Z]{4}\d{5}[A-Z])\b/i.exec(text)?.[1]?.toUpperCase() ?? /\b([A-Z]{4}\d{5}[A-Z])\b/.exec(text)?.[1];
  const part = /part\s*b/i.test(text) ? (/part\s*a/i.test(text) ? 'AB' : 'B') : 'A';
  if (s171 === undefined && tds === undefined) return undefined;
  return { s171, s172, s173, exempt, sd, pt, chargeable, nps, tds, tan, part };
}
