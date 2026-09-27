/**
 * Month-wise tables in tax computation sheets and salary registers: what was actually paid and
 * deducted each month. Handles months across the top ("Apr-26 May-26 ... Total") and months
 * down the side ("Apr 2026  Basic  HRA ... TDS"). Column positions decide which month a figure
 * belongs to, so a bonus under "Jul" lands in July even when other cells are blank.
 */
import type { MonthActual } from '../domain/types';

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON_TOKEN = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:[\s'’-]{0,2}(\d{4}|\d{2}))?\b/gi;
const VALUE = /(?<![\w.])(?:[-–—]|\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\w%])/g;

export type RowKind = 'tds' | 'bonus' | 'arrears' | 'gross';

/** What a row (or column) holds, from its label. */
export function rowKind(label: string): RowKind | undefined {
  const l = label.toLowerCase();
  if (/payable|projected|balance|remaining|to\s+be|net\s+tax|on\s+which|taxable|exempt|deduction\s+u\/s|professional|p\.?\s*tax\b|\bpt\b|tax\s+on\b|surcharge|cess|rebate/.test(l)) return undefined;
  if (/\b(tds|tax\s+deducted|tax\s+recovered|income[\s-]*tax|i\.?\s*tax|tax\s+paid|tax\s+deduction|it\s+(deducted|deduction|recovered)|\btax\b)/.test(l)) return 'tds';
  if (/arrear/.test(l)) return 'arrears';
  if (/joining|sign[\s-]*on/.test(l)) return undefined;
  if (/bonus|variable|incentive|\bpli\b|performance\s+(pay|linked)|ex[\s-]?gratia|award|\bvpp\b|\bspp\b/.test(l)) return 'bonus';
  if (/^gross|gross\s+(salary|earnings|pay)|total\s+earnings/.test(l)) return 'gross';
  return undefined;
}

/** Financial year the sheet is for ("Financial Year 2026-27", "FY 26-27", "AY 2027-28"). */
export function sheetFy(text: string): number | undefined {
  const fy = /(?:financial\s+year|f\.?\s?y\.?)\s*[:\-]?\s*(\d{2,4})\s*[-–/]\s*(\d{2,4})/i.exec(text);
  if (fy) return fy[1].length === 2 ? 2000 + +fy[1] : +fy[1];
  const ay = /(?:assessment\s+year|a\.?\s?y\.?)\s*[:\-]?\s*(\d{4})\s*[-–/]\s*(\d{2,4})/i.exec(text);
  if (ay) return +ay[1] - 1;
  return undefined;
}

const monthKey = (m: number, fy: number, yearHint?: string) => {
  let y = m >= 4 ? fy : fy + 1;
  if (yearHint) y = yearHint.length === 2 ? 2000 + +yearHint : +yearHint;
  return `${y}-${String(m).padStart(2, '0')}`;
};

interface Cell {
  at: number;
  text: string;
}

const cells = (line: string, re: RegExp): Cell[] => {
  const out: Cell[] = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = g.exec(line))) out.push({ at: m.index + m[0].length / 2, text: m[0] });
  return out;
};

const num = (t: string) => (/^[-–—]$/.test(t) ? 0 : parseFloat(t.replace(/,/g, '')));

/** Assigns each value to the nearest column; values far right of the last column (a Total) are dropped. */
function byColumn(values: Cell[], cols: number[]): (number | undefined)[] {
  const out: (number | undefined)[] = cols.map(() => undefined);
  // A single value column ("Month | TDS") takes the row's value however it's aligned.
  if (cols.length === 1) return values.length ? [num(values[values.length - 1].text)] : out;
  const gap = cols.length > 1 ? (cols[cols.length - 1] - cols[0]) / (cols.length - 1) : 10;
  for (const v of values) {
    let best = -1;
    let bestD = Infinity;
    cols.forEach((c, i) => {
      const d = Math.abs(v.at - c);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0 && bestD <= gap * 0.6) out[best] = num(v.text);
  }
  return out;
}

/** In order, when positions can't be trusted (pasted or re-flowed text). */
function inOrder(values: Cell[], n: number): (number | undefined)[] {
  if (values.length < n) return [];
  return values.slice(0, n).map((v) => num(v.text));
}

const labelOf = (line: string) => (line.match(/^\s*([A-Za-z][A-Za-z0-9 .&/()'’+-]*?[A-Za-z)])(?=\s+[-–—\d₹]|\s*$)/)?.[1] ?? '').trim();

/**
 * Month-by-month actuals from a table. `cutoff` (YYYY-MM): only months before it count as
 * actuals; later columns are the payroll's projection.
 */
export function parseMonthTable(text: string, fallbackFy: number, cutoff: string): Record<string, MonthActual> {
  const lines = text.replace(/\r/g, '').split('\n');
  const fy = sheetFy(text) ?? fallbackFy;
  const out: Record<string, MonthActual> = {};
  const put = (month: string, kind: RowKind, label: string, v: number | undefined) => {
    if (v === undefined || !Number.isFinite(v) || month >= cutoff) return;
    const a = (out[month] ??= {});
    if (kind === 'tds') a.tds = v;
    else if (kind === 'gross') a.gross = v;
    else if (v > 0) (a.items ??= []).push({ label, amount: v, kind: kind === 'arrears' ? 'arrears' : 'bonus' });
  };

  // 1. Months across the top.
  lines.forEach((header, hi) => {
    const months = cells(header, MON_TOKEN).filter((c) => MON.includes(c.text.slice(0, 3).toLowerCase()));
    if (months.length < 3) return;
    const keys = months.map((c) => {
      const m = /^([a-z]{3})[a-z]*\.?(?:[\s'’-]{0,2}(\d{4}|\d{2}))?/i.exec(c.text)!;
      return monthKey(MON.indexOf(m[1].toLowerCase()) + 1, fy, m[2]);
    });
    const cols = months.map((c) => c.at);
    for (const line of lines.slice(hi + 1, hi + 60)) {
      if (cells(line, MON_TOKEN).length >= 3) break; // next table
      const label = labelOf(line);
      const kind = rowKind(label);
      if (!kind) continue;
      const values = cells(line.slice(label.length ? line.indexOf(label) + label.length : 0), VALUE).map((v) => ({ ...v, at: v.at + (label.length ? line.indexOf(label) + label.length : 0) }));
      const positional = values.some((v) => v.at >= cols[0] - 2) && values.every((v) => v.at >= cols[0] - (cols[1] - cols[0]) * 0.6);
      let assigned = positional ? byColumn(values, cols) : inOrder(values, cols.length);
      // Columns that don't line up with the header (a long label pushed them right): values
      // collide or fall outside every column. A full row of values is then read in order.
      const placed = assigned.filter((v) => v !== undefined).length;
      if (positional && placed < Math.min(values.length, cols.length) && values.length >= cols.length) assigned = inOrder(values, cols.length);
      assigned.forEach((v, i) => put(keys[i], kind, label, v));
    }
  });
  if (Object.keys(out).length) return out;

  // 2. Months down the side: find a header row with column names, then month rows.
  const monthRows = lines
    .map((l, i) => ({ l, i, m: /^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:[\s'’-]{0,2}(\d{4}|\d{2}))?/i.exec(l) }))
    .filter((x) => x.m && cells(x.l.slice(x.m![0].length), VALUE).length >= 1);
  if (monthRows.length >= 3) {
    const headerLine = lines.slice(0, monthRows[0].i).reverse().find((l) => /[a-z]{3,}/i.test(l) && cells(l, VALUE).length === 0) ?? '';
    const heads = [...headerLine.matchAll(/\S+(?:\s\S+)*/g)].map((m) => ({ at: (m.index ?? 0) + m[0].length / 2, text: m[0] }));
    const cols = heads.map((h) => ({ ...h, kind: rowKind(h.text) }));
    for (const r of monthRows) {
      const key = monthKey(MON.indexOf(r.m![1].toLowerCase()) + 1, fy, r.m![2]);
      const values = cells(r.l.slice(r.m![0].length), VALUE).map((v) => ({ ...v, at: v.at + r.m![0].length }));
      const valueCols = cols.slice(1);
      const assigned = heads.length > 1 ? byColumn(values, valueCols.map((c) => c.at)) : [];
      valueCols.forEach((c, i) => c.kind && put(key, c.kind, c.text, assigned[i]));
    }
  }
  if (Object.keys(out).length) return out;

  // 3. Month-amount pairs on a line under a TDS heading: "Apr 16,110  May 16,110  Jun 16,110".
  lines.forEach((line, i) => {
    const pairs = [...line.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:[\s'’-]{0,2}(\d{4}|\d{2}))?\s*[:=-]?\s*(\d{1,3}(?:,\d{2,3})+|\d+)/gi)];
    if (pairs.length < 3) return;
    const context = `${lines[i - 1] ?? ''} ${line}`;
    if (rowKind(labelOf(line) || context) !== 'tds' && !/\b(tds|tax)\b/i.test(context)) return;
    for (const p of pairs) put(monthKey(MON.indexOf(p[1].toLowerCase()) + 1, fy, p[2]), 'tds', 'TDS', num(p[3]));
  });
  return out;
}
