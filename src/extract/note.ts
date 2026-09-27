/**
 * A note you type or paste instead of a letter: "I got an offer from BP Pvt Ltd, 34.2 base (17.10
 * basic, 50% basic HRA, rest special), joining 12th Nov 2026. Resigned on 3rd Sept, LWD 11 Nov
 * 2026, 22 leaves at Suzlon. 1.5 joining bonus paid in the 4th month salary, 50k relocation
 * reimbursed...". It describes two jobs at once: the offer you're taking and the job you're
 * leaving. It becomes one record for each, so each job gets its own facts.
 */
import { addMonths, monthOf } from '../domain/fy';
import type { DocRecord, Facts } from '../domain/types';
import { uid } from '../format';
import { bundledRules, epfCeiling } from '../rules';
import { MON_RE, MONTHS, findDate, monthOffsetIn, validDate } from './parse';

/** Written like a message rather than a letter: first person, about an offer or leaving a job. */
export function isNote(text: string): boolean {
  if (text.length > 4000) return false;
  const firstPerson = /\b(i|i'm|i've|i have|my|me)\b/i.test(text);
  const about = /\boffer\b|\bjoin(ing)?\b|\bresign(ed)?\b|\blwd\b|last\s+working\s+day/i.test(text);
  // A letter or payslip has a table: several lines ending in figures.
  const tableRows = text.split('\n').filter((l) => /\d[\d,]{3,}(\.\d+)?\s*$/.test(l.trim())).length;
  return firstPerson && about && tableRows < 3;
}

const UNIT = '(k|l|lakhs?|lacs?|lpa|cr|crores?)?';
const NUM = `(?:₹|rs\\.?|inr)?\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}\\b`;

/** "34.2" or "34.2 L" -> 34,20,000; "50k" -> 50,000. Bare small figures in a salary note are lakhs. */
function rupees(n: string, unit?: string): number {
  const v = parseFloat(n);
  const u = (unit ?? '').toLowerCase();
  if (u === 'k') return Math.round(v * 1_000);
  if (u.startsWith('cr')) return Math.round(v * 10_000_000);
  if (u || v < 1000) return Math.round(v * 100_000);
  return Math.round(v);
}

/** An amount right before a word ("1.8 variable") or right after it ("variable of 1.8"). */
function amountNear(text: string, word: string): number | undefined {
  const before = new RegExp(`${NUM}\\s*(?:lpa\\s*)?(?:of\\s+|as\\s+|p\\.?a\\.?\\s+)?(?:${word})`, 'i').exec(text);
  if (before) return rupees(before[1], before[2]);
  const after = new RegExp(`(?:${word})\\s*(?:bonus\\s+)?(?:of|is|:|=|-|at)?\\s*${NUM}(?!\\s*%)`, 'i').exec(text);
  if (after) return rupees(after[1], after[2]);
  return undefined;
}

/** "3rd sept" (no year): the year that puts it on or before `before`. */
function dayMonth(s: string, before?: string): string | undefined {
  const full = findDate(s);
  if (full) return full;
  const m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MON_RE}\\b`, 'i').exec(s) ?? new RegExp(`\\b${MON_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i').exec(s);
  if (!m) return undefined;
  const [d, mon] = /^\d/.test(m[1]) ? [+m[1], m[2]] : [+m[2], m[1]];
  const month = MONTHS.indexOf(mon.slice(0, 3).toLowerCase()) + 1;
  const ref = before ?? new Date().toISOString().slice(0, 10);
  let y = +ref.slice(0, 4);
  let date = validDate(y, month, d);
  if (date && date > ref) date = validDate(--y, month, d);
  return date;
}

/** The text right after a phrase (a date usually follows it). */
const after = (text: string, re: RegExp, n = 40) => {
  const m = re.exec(text);
  // Only this clause: "resigned on 3rd sept, lwd is 11 Nov 2026" must not take the LWD.
  return m ? text.slice(m.index + m[0].length, m.index + m[0].length + n).split(/[,;]|\.(?!\d)|\s(?:and|lwd|but)\s/i)[0] : undefined;
};

/** "bp pvt ltd" -> "BP Pvt Ltd". */
function companyName(raw: string): string {
  return raw
    .trim()
    .replace(/[.,]+$/, '')
    .split(/\s+/)
    .map((w) => (/^(pvt|ltd|private|limited|inc|llp|india|technologies|solutions|services|systems)\.?$/i.test(w) || w.length > 3 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()))
    .join(' ');
}

export interface NoteDocs {
  offer?: DocRecord;
  exit?: DocRecord;
  /** Assumptions made reading the offer, to show on its job. */
  warnings?: string[];
}

/** Split a note into the new offer and the exit from the current job. */
export function parseNote(text: string, name: string): NoteDocs {
  const t = text.replace(/\s+/g, ' ');
  const out: NoteDocs = {};

  // --- The job you're leaving ---
  const lwdText = after(t, /\blwd\b|last\s+working\s+day|last\s+day|relieving\s+date/i, 50);
  const lwd = lwdText ? dayMonth(lwdText) : undefined;
  const resText = after(t, /resign(ed|ation)?\s*(date|on|dated)?\s*(is|was|:)?/i, 40);
  const resigned = resText ? dayMonth(resText, lwd) : undefined;
  const leave = /(\d{1,3}(?:\.\d+)?)\s*(?:days?\s+(?:of\s+)?)?(?:earned\s+|privilege\s+|el\s+|pl\s+)?leaves?\b/i.exec(t) ?? /leave\s+balance\s*(?:is|of|:)?\s*(\d{1,3}(?:\.\d+)?)/i.exec(t);
  const oldCo = /(?:leaves?|resigned|resigning|leaving|working|currently)\s+(?:at|from|with|in)\s+([a-z][\w&.-]*(?:\s+(?:pvt|ltd|private|limited|global|india)\.?)*)/i.exec(t)?.[1];
  const notice = /notice\s+(?:period\s+)?(?:is|of)?\s*(\d{1,3})\s*days|(\d{1,3})\s*days?\s+notice/i.exec(t);
  const exitFacts: Facts = {};
  if (lwd) exitFacts.lastWorkingDay = lwd;
  if (resigned) exitFacts.resignationDate = resigned;
  if (leave) exitFacts.leaveDays = parseFloat(leave[1]);
  if (notice) exitFacts.noticeDays = +(notice[1] ?? notice[2]);
  const noticeM = /notice\s+(?:period\s+)?(?:is|of)?\s*(\d|one|two|three|six)\s*months?|(\d|one|two|three|six)\s*months?'?\s+notice/i.exec(t);
  if (noticeM && !notice) {
    const n = { one: 1, two: 2, three: 3, six: 6 }[(noticeM[1] ?? noticeM[2]).toLowerCase() as 'one'] ?? +(noticeM[1] ?? noticeM[2]);
    exitFacts.noticeMonths = n;
    exitFacts.noticeDays = n * 30;
  }
  if (Object.keys(exitFacts).length) {
    out.exit = {
      id: uid(),
      name: `${name} (leaving${oldCo ? ` ${companyName(oldCo)}` : ''})`,
      kind: 'resignation',
      fields: {},
      facts: exitFacts,
      employer: oldCo ? companyName(oldCo) : undefined,
      docDate: resigned,
      text: text.slice(0, 60_000),
    };
  }

  // --- The offer you're taking ---
  const newCo = /(?:offer|job|joining)\s+(?:letter\s+)?(?:from|at|with)\s+([a-z][\w&.-]*(?:\s+(?!with\b|for\b|at\b|of\b|on\b|and\b)[a-z][\w&.-]*){0,3}?)(?=\s*(?:,|\.|$|\s+with\b|\s+for\b|\s+at\b|\s+on\b|\s+and\b|\s+offering\b))/i.exec(t)?.[1];
  const dojText = after(t, /\bjoin(?:ing)?\s*(?:date|on|from|by)?\s*(?:is|:)?|\bdoj\b\s*(?:is|:)?/i, 40);
  const doj = dojText ? findDate(dojText) ?? dayMonth(dojText, addMonths(monthOf(lwd ?? new Date().toISOString().slice(0, 10)), 12) + '-28') : undefined;
  const fields: Record<string, number> = {};
  const facts: Facts = {};
  const warnings: string[] = [];
  const basic = amountNear(t, 'basic(?!\\s+hra)');
  const base = amountNear(t, 'base|fixed(?:\\s+pay|\\s+ctc)?');
  const ctc = amountNear(t, '(?<!in\\s)ctc|package');
  const variable = amountNear(t, 'variable(?:\\s+pay)?|performance\\s+bonus|pli');
  const joining = amountNear(t, 'joining\\s+bonus|sign[\\s-]*on\\s+bonus|joining\\s+amount');
  if (basic) fields.basic = Math.round(basic / 12);
  const hraPct = /(\d{1,2})\s*%\s*(?:of\s+)?(?:basic\s+)?hra|hra\s*(?:is|of|at|:)?\s*(\d{1,2})\s*%/i.exec(t);
  const hra = hraPct ? undefined : amountNear(t, 'hra|house\\s+rent(?:\\s+allowance)?');
  if (fields.basic && hraPct) fields.hra = Math.round((fields.basic * +(hraPct[1] ?? hraPct[2])) / 100);
  else if (hra) fields.hra = Math.round(hra / 12);
  const fixed = base ?? (ctc && variable ? ctc - variable : ctc);
  if (fixed && fields.basic) {
    // "Rest special allowance": what's left of the fixed pay after basic, HRA and employer PF.
    const month = doj ? monthOf(doj) : monthOf(new Date().toISOString().slice(0, 10));
    const pf = Math.round(bundledRules.epf.rate * Math.min(fields.basic, epfCeiling(bundledRules, month)));
    const special = Math.round(fixed / 12) - fields.basic - (fields.hra ?? 0) - pf;
    if (special > 0 && /special|rest|balance|remaining/i.test(t)) {
      fields.special = special;
      fields.employerPf = pf;
      fields.epf = pf;
      warnings.push(`Special allowance taken as the rest of your ₹${fixed.toLocaleString('en-IN')} fixed pay after basic, HRA and employer PF (₹${pf.toLocaleString('en-IN')} a month). Correct it under "Check the numbers" if your fixed pay doesn't include PF.`);
    }
  }
  if (fixed || ctc) fields.ctc = (ctc && !base ? ctc : (fixed ?? 0) + (variable ?? 0));
  if (variable) fields.variable = variable;
  if (joining) {
    fields.joining = joining;
    const jb = /joining\s+bonus|sign[\s-]*on\s+bonus/i.exec(t);
    const off = jb ? monthOffsetIn(t.slice(jb.index, jb.index + 120)) ?? monthOffsetIn(t.slice(Math.max(0, jb.index - 80), jb.index)) : undefined;
    if (off !== undefined) fields.joiningOffset = off;
  }
  // Notice buyout by the new employer: "agreed to buy out", "will reimburse my notice".
  const bo = /(buy\s*-?\s*out|buyout|reimburs\w*\s+(?:my\s+|the\s+)?notice)[^.]{0,160}/i.exec(t);
  if (bo) {
    const cap = /(?:up\s*to|upto|max(?:imum)?|capped\s+at|limit\s+of)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(k|l|lakhs?|lacs?)?/i.exec(bo[0]);
    const clawback = /joining\s+bonus|clawback|claw\s*back|bonus\s+recovery/i.test(bo[0]);
    facts.buyout = { ...(cap ? { mode: 'cap' as const, cap: rupees(cap[1], cap[2]) } : { mode: 'actuals' as const }), ...(clawback ? { includesClawback: true } : {}) };
  }
  // Relocation: an amount near the word, reimbursed (tax-free) or a fixed allowance.
  const rel = /relocat\w*|shifting/i.exec(t);
  if (rel) {
    const around = t.slice(Math.max(0, rel.index - 60), rel.index + 80);
    const amt = new RegExp(`${NUM}(?!\\s*%)`, 'gi');
    let best: number | undefined;
    for (const m of around.matchAll(amt)) {
      const v = rupees(m[1], m[2]);
      const pos = Math.max(0, rel.index - 60) + (m.index ?? 0);
      // The figure closest to the word, and not a date.
      if (v >= 1000 && !new RegExp(MON_RE, 'i').test(around.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 6)) && (best === undefined || Math.abs(pos - rel.index) < 60)) best = v;
    }
    facts.relocation = { amount: best, reimbursement: /reimburs|tax[\s-]*free|exempt|against\s+bills|actuals/i.test(around) };
  }
  if (Object.keys(fields).length || doj || newCo) {
    out.offer = {
      id: uid(),
      name: `${name} (${newCo ? companyName(newCo) : 'new job'} offer)`,
      kind: 'offer',
      fields,
      facts,
      doj,
      employer: newCo ? companyName(newCo) : undefined,
      text: text.slice(0, 60_000),
    };
    out.warnings = warnings;
  }
  return out;
}
