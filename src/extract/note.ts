/**
 * A note you type or paste instead of a letter: "Got an offer from BP Pvt Ltd, 34.2 base (17.10
 * basic, 50% basic HRA, rest special), joining 12th Nov 2026. Resigned on 3rd Sept, LWD 11 Nov,
 * 22 leaves at Suzlon. 1.5 joining bonus in the 4th month, 50k relocation reimbursed...".
 *
 * It can describe several things at once: the offer you're taking (or two offers to compare) and
 * the job you're leaving. Each becomes its own record. An offer's clauses (its notice period,
 * bonus terms) are terms of a job that hasn't started: they never become events like a
 * resignation.
 */
import { addMonths, monthOf } from '../domain/fy';
import type { DocRecord, Facts } from '../domain/types';
import { uid } from '../format';
import { bundledRules, epfCeiling } from '../rules';
import { MON_RE, MONTHS, findDate, monthOffsetIn, validDate } from './parse';

/** Letters have a salutation, sign-off or a table; a note has none of these. */
export function isNote(text: string): boolean {
  if (text.length > 4000) return false;
  const about = /\boffers?\b|\bjoin(ing|ed)?\b|\bresign(ed|ing)?\b|\blwd\b|last\s+working\s+day|\bctc\b|\blpa\b|\bpackage\b|\bnotice\b|\bbasic\b/i.test(text);
  const letter = /\bdear\b|we\s+are\s+pleased|yours\s+(sincerely|faithfully|truly)|\bregards\b|annexure|offer\s+of\s+employment|letter\s+of\s+appointment|appointment\s+letter|pay\s*slip|salary\s+slip|full\s+and\s+final|form\s*16/i.test(text);
  // A table: several lines ending in figures.
  const tableRows = text.split('\n').filter((l) => /\d[\d,]{3,}(\.\d+)?\s*$/.test(l.trim())).length;
  return about && !letter && tableRows < 3;
}

/** One amount as written: "34.2", "34,20,000", "50k", "2.85L/month", "34.2 LPA", "40%". */
interface Amount {
  value: number;
  pct?: boolean;
  perMonth?: boolean;
  /** Stated per year ("LPA", "per annum"), or in lakhs/crores, which are yearly in a salary note. */
  perYear?: boolean;
  /** Written without a unit or commas ("34.2"): small figures are lakhs. */
  bare?: boolean;
}

const AMT_SRC =
  '(?:₹|rs\\.?|inr)?\\s*(\\d{1,3}(?:,\\d{2,3})+|\\d+(?:\\.\\d+)?)\\s*(k|l|lakhs?|lacs?|lpa|cr|crores?)?\\b(\\s*%)?((?:\\s*(?:\\/|per|a|p\\.?)\\s*(?:month|mo\\b|m\\b|annum|year|yr|a\\b\\.?))|\\s+monthly|\\s+pm\\b|\\s+pa\\b|\\s+p\\.a\\.?)?';

function toAmount(m: RegExpExecArray | RegExpMatchArray): Amount {
  const v = parseFloat(m[1].replace(/,/g, ''));
  const unit = (m[2] ?? '').toLowerCase();
  const period = (m[4] ?? '').toLowerCase();
  const perYear = /annum|year|yr|\bpa\b|p\.a|\/\s*a\b|per\s+a\b/.test(period) || unit === 'lpa';
  const perMonth = !perYear && /month|mo\b|\bm\b|monthly|pm\b/.test(period);
  if (m[3]) return { value: v / 100, pct: true };
  if (unit === 'k') return { value: Math.round(v * 1_000), perMonth, perYear };
  if (unit.startsWith('cr')) return { value: Math.round(v * 10_000_000), perMonth, perYear: !perMonth };
  if (unit) return { value: Math.round(v * 100_000), perMonth, perYear: !perMonth };
  if (!m[1].includes(',') && v < 1000) return { value: Math.round(v * 100_000), perMonth, perYear: !perMonth, bare: true };
  return { value: Math.round(v), perMonth, perYear };
}

/** The clause around t[i..j]: amounts belong to the word in their own clause. */
function clauseAround(t: string, i: number, j: number): { start: number; end: number } {
  // A comma between digits is part of a number ("34,20,000"), not a clause break.
  const breakAt = (k: number) => /[;()]/.test(t[k]) || (t[k] === ',' && !(/\d/.test(t[k - 1] ?? '') && /\d/.test(t[k + 1] ?? ''))) || (t[k] === '.' && (k + 1 >= t.length || /\s/.test(t[k + 1])));
  let start = i;
  while (start > 0 && !breakAt(start - 1)) start--;
  let end = j;
  while (end < t.length && !breakAt(end)) end++;
  return { start, end };
}
const clauseText = (t: string, i: number, j: number) => {
  const c = clauseAround(t, i, j);
  return t.slice(c.start, c.end);
};

/**
 * The amount written next to a word: right after it ("variable of 1.8", "CTC: 34,20,000") or
 * right before it ("1.8 variable", "50k relocation"), within the same clause.
 */
function amountNear(t: string, word: string): Amount | undefined {
  for (const w of t.matchAll(new RegExp(`\\b(?:${word})\\b`, 'gi'))) {
    const i = w.index ?? 0;
    const j = i + w[0].length;
    const c = clauseAround(t, i, j);
    const after = new RegExp(`^\\s*(?:bonus\\s+)?(?:of|is|was|:|=|-|at|around|about|would\\s+be|will\\s+be)?\\s*${AMT_SRC}`, 'i').exec(t.slice(j, c.end));
    if (after) return toAmount(after);
    const before = [...t.slice(Math.max(c.start, i - 40), i).matchAll(new RegExp(`${AMT_SRC}\\s*(?:[a-z][a-z-]*\\s+){0,2}$`, 'gi'))].pop();
    if (before) return toAmount(before);
  }
  return undefined;
}

/** A yearly figure in rupees. Bare small numbers are lakhs; "40,000" with no period is a month's pay. */
function yearly(a: Amount | undefined, monthlyBelow = 250_000): number | undefined {
  if (!a || a.pct) return undefined;
  if (a.perMonth) return a.value * 12;
  if (a.perYear) return a.value;
  return a.value < monthlyBelow ? a.value * 12 : a.value;
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

/** The rest of the clause after a phrase (a date usually follows it). */
const after = (text: string, re: RegExp, n = 40) => {
  const m = re.exec(text);
  // Only this clause: "resigned on 3rd sept, lwd is 11 Nov 2026" must not take the LWD.
  return m ? text.slice(m.index + m[0].length, m.index + m[0].length + n).split(/[,;]|\.(?!\d)|\s(?:and|lwd|but)\s/i)[0] : undefined;
};

const CO_WORD = /^(pvt|ltd|private|limited|inc|llp|india|technologies|technology|solutions|services|systems|software|labs|global|consulting|group)\.?$/i;
/** "bp pvt ltd" -> "BP Pvt Ltd"; "infosys" -> "Infosys". */
function companyName(raw: string): string {
  return raw
    .trim()
    .replace(/[.,]+$/, '')
    .split(/\s+/)
    .map((w) => (CO_WORD.test(w) || w.length > 3 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()))
    .join(' ');
}

/** Words that follow "joining"/"offer from" but aren't a company. */
const NOT_CO = 'on|in|by|from|at|with|date|bonus|amount|the|a|an|as|and|for|of|is|was|will|would|next|this|soon|after|before|letter|me|my|us|we|i|it|there|here|them|company|job|role|position|new|salary|ctc';
const NAME = `([a-z][\\w&.-]*(?:\\s+(?!(?:${NOT_CO}|offering|joining|paying)\\b)[a-z][\\w&.-]*){0,3}?)`;
const NAME_END = `(?=\\s*(?:,|\\.(?:\\s|$)|$|:|;|\\(|\\s+(?:with|for|at|on|and|offering|paying|of|is|was|-|\\d)))`;
/** Where each offer starts, and whose it is: "offer from BP", "Offer B from Beta", "joining Google". */
function offerMarkers(t: string): { at: number; name: string }[] {
  const res = [
    new RegExp(`\\b(?:offers?|job)\\s+(?:[a-z0-9]\\s+)?(?:letter\\s+)?(?:from|at|with|by)\\s+${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\bjoining\\s+(?!(?:${NOT_CO})\\b)${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\b${NAME}\\s+(?:has\\s+)?offered\\b`, 'gi'),
  ];
  const out: { at: number; name: string }[] = [];
  for (const re of res)
    for (const m of t.matchAll(re)) {
      const name = m[1].trim();
      if (!name || new RegExp(`^(?:${NOT_CO})$`, 'i').test(name)) continue;
      if (!out.some((o) => o.name.toLowerCase() === name.toLowerCase())) out.push({ at: m.index ?? 0, name });
    }
  return out.sort((a, b) => a.at - b.at);
}

export interface NoteDocs {
  /** The offer you're taking: the first one named. */
  offer?: DocRecord;
  /** Other offers in the same note, to compare side by side. */
  alternatives: DocRecord[];
  exit?: DocRecord;
  /** Assumptions made reading the offer, to show on its job. */
  warnings?: string[];
}

/** Everything about one offer from its part of the note. `whole` is the full note, for shared facts. */
function readOffer(seg: string, whole: string, company: string | undefined, name: string, lwd: string | undefined, raw: string): { doc: DocRecord; warnings: string[] } {
  const fields: Record<string, number> = {};
  const facts: Facts = {};
  const warnings: string[] = [];
  const DOJ = /\bjoin(?:ing)?\s*(?:date|on|from|by)\s*(?:is|:)?|\bjoining\s*(?:is|:)|\bdoj\b\s*(?:is|:)?|\bstart(?:ing)?\s+(?:on|from)/i;
  const dojText = after(seg, DOJ, 40) ?? after(whole, DOJ, 40);
  const doj = dojText ? findDate(dojText) ?? dayMonth(dojText, addMonths(monthOf(lwd ?? new Date().toISOString().slice(0, 10)), 12) + '-28') : undefined;

  const ctcA = amountNear(seg, 'ctc|package|compensation|offered');
  const lpa = ctcA ? undefined : [...seg.matchAll(new RegExp(AMT_SRC, 'gi'))].map(toAmount).find((a) => a.perYear && !a.pct && !a.bare);
  const baseA = amountNear(seg, 'base(?:\\s+pay|\\s+salary)?|fixed(?:\\s+pay|\\s+ctc|\\s+salary)?');
  const basicA = amountNear(seg, 'basic(?!\\s+hra)');
  const variableA = amountNear(seg, 'variable(?:\\s+pay)?|performance\\s+(?:bonus|pay)|pli|annual\\s+bonus|bonus(?!\\s+(?:paid|payable))');
  const joiningA = amountNear(seg, 'joining\\s+bonus|sign[\\s-]*on\\s+bonus|joining\\s+amount|signing\\s+bonus');
  const ctc = yearly(ctcA ?? lpa, 100_000);
  let fixed = yearly(baseA);
  let variable = variableA && !variableA.pct ? (variableA.perMonth ? variableA.value * 12 : variableA.value) : undefined;
  if (variableA?.pct) variable = Math.round(variableA.value * (fixed ?? ctc ?? 0)) || undefined;
  if (!fixed && ctc && variable) fixed = ctc - variable;
  const pay = fixed ?? ctc;

  // Basic: an amount, or a share of CTC / fixed pay ("basic 40% of CTC").
  let basic = basicA && !basicA.pct ? yearly(basicA) : undefined;
  if (basicA?.pct && pay) basic = basicA.value * (/basic[^,;.]{0,20}of\s+(?:the\s+)?(?:fixed|base)/i.test(seg) && fixed ? fixed : ctc ?? pay);
  if (basic) fields.basic = Math.round(basic / 12);
  const hraPct = /(\d{1,2})\s*%\s*(?:of\s+)?(?:basic\s+)?(?:as\s+)?hra|hra\s*(?:is|of|at|:|=)?\s*(\d{1,2})\s*%/i.exec(seg);
  const hraA = hraPct ? undefined : amountNear(seg, 'hra|house\\s+rent(?:\\s+allowance)?');
  if (fields.basic && hraPct) fields.hra = Math.round((fields.basic * +(hraPct[1] ?? hraPct[2])) / 100);
  else if (hraA && !hraA.pct) fields.hra = Math.round(yearly(hraA)! / 12);
  if (pay && fields.basic) {
    // "Rest special allowance": what's left of the fixed pay after basic, HRA and employer PF.
    const month = doj ? monthOf(doj) : monthOf(new Date().toISOString().slice(0, 10));
    const pf = Math.round(bundledRules.epf.rate * Math.min(fields.basic, epfCeiling(bundledRules, month)));
    const special = Math.round(pay / 12) - fields.basic - (fields.hra ?? 0) - pf;
    if (special > 0) {
      fields.special = special;
      fields.employerPf = pf;
      fields.epf = pf;
      warnings.push(
        `Special allowance taken as the rest of your ₹${Math.round(pay).toLocaleString('en-IN')} ${fixed ? 'fixed pay' : 'CTC'} after basic, HRA and employer PF (₹${pf.toLocaleString('en-IN')} a month). Correct it under "Check the numbers" if that's not how it's split.`,
      );
    }
  }
  if (ctc) fields.ctc = ctc;
  else if (fixed) fields.ctc = fixed + (variable ?? 0);
  if (variable) fields.variable = variable;
  if (joiningA && !joiningA.pct) {
    fields.joining = joiningA.value;
    const jb = /joining\s+bonus|sign[\s-]*on\s+bonus|signing\s+bonus/i.exec(seg);
    const off = jb ? monthOffsetIn(seg.slice(jb.index, jb.index + 120)) ?? monthOffsetIn(seg.slice(Math.max(0, jb.index - 80), jb.index)) : undefined;
    if (off !== undefined) fields.joiningOffset = off;
  }
  // Notice buyout by the new employer: "agreed to buy out", "will reimburse my notice".
  const bo = /(buy\s*-?\s*out|buyout|reimburs\w*\s+(?:my\s+|the\s+)?notice)[^.]{0,160}/i.exec(seg);
  if (bo) {
    const capAt = /(?:up\s*to|upto|max(?:imum)?|capped\s+at|limit\s+of)\s*/i.exec(bo[0]);
    const capM = capAt ? new RegExp(`^${AMT_SRC}`, 'i').exec(bo[0].slice(capAt.index + capAt[0].length)) : null;
    const cap = capM ? toAmount(capM) : undefined;
    const clawback = /joining\s+bonus|clawback|claw\s*back|bonus\s+recovery/i.test(bo[0]);
    facts.buyout = { ...(cap && !cap.pct ? { mode: 'cap' as const, cap: cap.value } : { mode: 'actuals' as const }), ...(clawback ? { includesClawback: true } : {}) };
  }
  // Relocation: the amount in its clause, reimbursed (tax-free) or a fixed allowance.
  const rel = /relocat\w*|shifting/i.exec(seg);
  if (rel) {
    const a = amountNear(seg, 'relocat\\w*(?:\\s+(?:allowance|bonus|support|reimbursement|expenses|assistance))?|shifting(?:\\s+allowance)?');
    const clause = clauseText(seg, rel.index, rel.index + rel[0].length);
    facts.relocation = { amount: a && !a.pct ? a.value : undefined, reimbursement: /reimburs|tax[\s-]*free|exempt|against\s+bills|actuals/i.test(clause) };
  }
  // The new job's notice clause is a term of that job, not a resignation.
  const noticeHere = /notice\s+(?:period\s+)?(?:is|of|will\s+be|:)?\s*(\d{1,3})\s*days|(\d{1,3})\s*days?'?\s+notice/i.exec(seg);
  if (noticeHere && !/resign|lwd|serv(e|ing)|current/i.test(clauseText(seg, noticeHere.index, noticeHere.index + noticeHere[0].length))) facts.noticeDays = +(noticeHere[1] ?? noticeHere[2]);

  const doc: DocRecord = {
    id: uid(),
    name: `${name} (${company ? companyName(company) : 'new job'} offer)`,
    kind: 'offer',
    fields,
    facts,
    doj,
    employer: company ? companyName(company) : undefined,
    text: raw.slice(0, 60_000),
  };
  return { doc, warnings };
}

/** Split a note into the offer(s) and the exit from the current job. */
export function parseNote(text: string, name: string): NoteDocs {
  const t = text.replace(/\s+/g, ' ');
  const out: NoteDocs = { alternatives: [] };

  // --- The job you're leaving ---
  const lwdText = after(t, /\blwd\b|last\s+working\s+day|last\s+day|relieving\s+date/i, 50);
  const lwd = lwdText ? dayMonth(lwdText) : undefined;
  const resText = after(t, /resign(ed|ation)?\s*(date|on|dated)?\s*(is|was|:)?/i, 40);
  const resigned = resText ? dayMonth(resText, lwd) : undefined;
  const leave = /(\d{1,3}(?:\.\d+)?)\s*(?:days?\s+(?:of\s+)?)?(?:earned\s+|privilege\s+|el\s+|pl\s+)?leaves?\b(?!\s+(?:on|in|by|after|before))/i.exec(t) ?? /leave\s+balance\s*(?:is|of|:)?\s*(\d{1,3}(?:\.\d+)?)/i.exec(t);
  const oldCo = /(?:leaves?|resigned|resigning|leaving|working|currently|notice)\s+(?:at|from|with|in)\s+([a-z][\w&.-]*(?:\s+(?:pvt|ltd|private|limited|global|india)\.?)*)/i.exec(t)?.[1];
  const exitFacts: Facts = {};
  if (lwd) exitFacts.lastWorkingDay = lwd;
  if (resigned) exitFacts.resignationDate = resigned;
  if (leave && (lwd || resigned || oldCo)) exitFacts.leaveDays = parseFloat(leave[1]);
  // Notice at the current job: only when you're leaving it, and the clause is about you serving it.
  if (lwd || resigned) {
    for (const m of t.matchAll(/notice\s+(?:period\s+)?(?:is|of|was|:)?\s*(\d{1,3})\s*(days?|months?)|(\d{1,3}|one|two|three|six)\s*(days?|months?)'?\s+(?:of\s+)?notice/gi)) {
      const clause = clauseText(t, m.index ?? 0, (m.index ?? 0) + m[0].length);
      if (/offer|new\s+job|there\b|their/i.test(clause) && !/current|my\s+notice|serv/i.test(clause)) continue;
      const raw = (m[1] ?? m[3]).toLowerCase();
      const n = ({ one: 1, two: 2, three: 3, six: 6 } as Record<string, number>)[raw] ?? +raw;
      if (/month/i.test(m[2] ?? m[4])) {
        exitFacts.noticeMonths = n;
        exitFacts.noticeDays = n * 30;
      } else exitFacts.noticeDays = n;
      break;
    }
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

  // --- Offers: one part of the note per company offering ---
  const markers = offerMarkers(t).filter((m) => !oldCo || m.name.toLowerCase() !== oldCo.toLowerCase());
  const parts = markers.length > 1 ? markers.map((m, i) => ({ name: m.name, seg: t.slice(i === 0 ? 0 : m.at, markers[i + 1]?.at ?? t.length) })) : [{ name: markers[0]?.name, seg: t }];
  const read = parts.map((p) => readOffer(p.seg, t, p.name, name, lwd, text));
  const real = read.filter((r) => Object.keys(r.doc.fields).length || r.doc.doj || r.doc.employer);
  if (real.length) {
    out.offer = real[0].doc;
    out.warnings = real[0].warnings;
    out.alternatives = real.slice(1).map((r) => r.doc);
  }
  return out;
}
