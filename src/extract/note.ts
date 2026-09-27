/**
 * A note you type or paste instead of a letter: "Got an offer from BP Pvt Ltd, 34.2 base (17.10
 * basic, 50% basic HRA, rest special), joining 12th Nov 2026. Resigned on 3rd Sept, LWD 11 Nov,
 * 22 leaves at Suzlon. 1.5 joining bonus in the 4th month, 50k relocation reimbursed...".
 *
 * It can describe several things at once, and each becomes its own record:
 *  - the offer you're taking, and any other offers (compared side by side, never in the timeline);
 *  - the job you have ("joined June 2024", "current CTC 12 LPA at Acme");
 *  - leaving it (resignation, last day, leave balance);
 *  - a hike at it ("salary hiked to 19 LPA from April").
 * An offer's clauses (its notice period, bonus terms) are terms of a job that hasn't started: they
 * never become events like a resignation.
 */
import type { DocRecord, Facts } from '../domain/types';
import { uid } from '../format';
import { bundledRules, epfCeiling } from '../rules';
import { findLocation } from './location';
import { MON_RE, MONTHS, findDate, monthOffsetIn, validDate } from './parse';

/** Letters and emails have a salutation, sign-off, headers, a letterhead or a table; a note has none. */
export function isNote(text: string): boolean {
  if (text.length > 4000) return false;
  const about = /\boffers?\b|\bjoin(ing|ed)?\b|\bresign(ed|ing)?\b|\blwd\b|last\s+working\s+day|\bctc\b|\blpa\b|\bpackage\b|\bnotice\b|\bbasic\b|\bhike[ds]?\b|\bincrement\b/i.test(text);
  const letter =
    /\bdear\b|we\s+are\s+(pleased|happy|delighted)|yours\s+(sincerely|faithfully|truly)|\bregards\b|warm\s+wishes|best\s+wishes|to\s+whom\s+it\s+may\s+concern|this\s+is\s+to\s+certify|annexure|offer\s+of\s+employment|letter\s+of\s+appointment|appointment\s+letter|pay\s*slip|salary\s+slip|full\s+and\s+final|form\s*16/i.test(text) ||
    // An email's headers, or a letterhead: a company's legal name on a line of its own.
    /^\s*(from|to|subject|date|cc)\s*:/im.test(text) ||
    /^\s*[A-Z][\w&.,' -]{2,60}\b(private\s+limited|pvt\.?\s*ltd\.?|limited|ltd\.?|llp|inc\.?)\s*$/im.test(text.split('\n').slice(0, 3).join('\n'));
  // A table: several lines ending in figures.
  const tableRows = text.split('\n').filter((l) => /\d[\d,]{3,}(\.\d+)?\s*$/.test(l.trim())).length;
  return about && !letter && tableRows < 3;
}

/* ---------- amounts ---------- */

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
  const breakAt = (k: number) =>
    /[;()+]/.test(t[k]) || (t[k] === ',' && !(/\d/.test(t[k - 1] ?? '') && /\d/.test(t[k + 1] ?? ''))) || (t[k] === '.' && (k + 1 >= t.length || /\s/.test(t[k + 1])));
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
/** About the job you have, not the offer: "my current CTC", "present salary". */
const ABOUT_NOW = /\b(current(ly)?|present|existing|previous|old|last\s+year)\b/i;

/**
 * The amount written next to a word: right after it ("variable of 1.8", "CTC: 34,20,000") or
 * right before it ("1.8 variable", "50k relocation"), within the same clause. Clauses about your
 * current job are skipped unless `now` is set, and then only those are used.
 */
function amountNear(t: string, word: string, now = false): Amount | undefined {
  for (const w of t.matchAll(new RegExp(`\\b(?:${word})\\b`, 'gi'))) {
    const i = w.index ?? 0;
    const j = i + w[0].length;
    const c = clauseAround(t, i, j);
    if (ABOUT_NOW.test(t.slice(c.start, c.end)) !== now) continue;
    const after = new RegExp(`^\\s*(?:bonus\\s+)?(?:of|is|was|:|=|-|at|around|about|would\\s+be|will\\s+be|to)?\\s*${AMT_SRC}`, 'i').exec(t.slice(j, c.end));
    if (after) return toAmount(after);
    const before = [...t.slice(Math.max(c.start, i - 40), i).matchAll(new RegExp(`${AMT_SRC}\\s*(?:[a-z][a-z-]*\\s+){0,2}$`, 'gi'))].pop();
    if (before) return toAmount(before);
  }
  return undefined;
}

/**
 * A yearly figure in rupees. Stated per month or per year wins; otherwise it's sized against the
 * CTC (a figure of at least 8% of it is annual) or, with no CTC, "40,000" is a month's pay.
 */
function yearly(a: Amount | undefined, ctc?: number): number | undefined {
  if (!a || a.pct) return undefined;
  if (a.perMonth) return a.value * 12;
  if (a.perYear) return a.value;
  if (ctc) return a.value >= 0.08 * ctc ? a.value : a.value * 12;
  return a.value < 250_000 ? a.value * 12 : a.value;
}

/* ---------- dates ---------- */

const today = () => new Date().toISOString().slice(0, 10);

/**
 * A date as written. With no year: `before`/`after` bound it (a resignation before the last day,
 * a joining after it); otherwise the year that puts it nearest today. "June 2024" is the 1st.
 */
function dateIn(s: string, opts: { before?: string; after?: string } = {}): string | undefined {
  const full = findDate(s);
  if (full) return full;
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MON_RE}\\b(?![\\s,'’-]*\\d{2,4})`, 'i').exec(s) ?? new RegExp(`\\b${MON_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*,?\\s*\\d{4})`, 'i').exec(s);
  if (!dm) {
    const my = new RegExp(`\\b${MON_RE}[\\s,'’-]*(\\d{4}|\\d{2})\\b`, 'i').exec(s);
    if (!my) return undefined;
    const y = +my[2] < 100 ? 2000 + +my[2] : +my[2];
    return validDate(y, MONTHS.indexOf(my[1].slice(0, 3).toLowerCase()) + 1, 1);
  }
  const [d, mon] = /^\d/.test(dm[1]) ? [+dm[1], dm[2]] : [+dm[2], dm[1]];
  const month = MONTHS.indexOf(mon.slice(0, 3).toLowerCase()) + 1;
  const ref = opts.before ?? opts.after ?? today();
  const y0 = +ref.slice(0, 4);
  const options = [y0 - 1, y0, y0 + 1].map((y) => validDate(y, month, d)).filter((x): x is string => !!x);
  if (opts.before) return options.filter((x) => x <= opts.before!).pop();
  if (opts.after) return options.find((x) => x > opts.after!);
  const dist = (x: string) => Math.abs(Date.parse(x) - Date.parse(ref));
  return options.sort((a, b) => dist(a) - dist(b))[0];
}

/** The first mention of `re` followed, in its own clause, by a date. */
function dateAfter(t: string, re: RegExp, opts: { before?: string; after?: string } = {}): string | undefined {
  for (const m of t.matchAll(new RegExp(re.source, 'gi'))) {
    const j = (m.index ?? 0) + m[0].length;
    const tail = t.slice(j, j + 40).split(/[,;]|\.(?!\d)|\s(?:and|lwd|but)\s/i)[0];
    const d = dateIn(tail, opts);
    if (d) return d;
  }
  return undefined;
}

/* ---------- companies ---------- */

const CO_WORD = /^(pvt|ltd|private|limited|inc|llp|india|technologies|technology|solutions|services|systems|software|labs|global|consulting|group|development|centre|center)\.?$/i;
/** "bp pvt ltd" -> "BP Pvt Ltd"; "infosys" -> "Infosys"; "larsen & toubro" -> "Larsen & Toubro". */
function companyName(raw: string): string {
  return raw
    .trim()
    .replace(/[.,]+$/, '')
    .split(/\s+/)
    .map((w) => (w === '&' ? w : CO_WORD.test(w) || w.length > 3 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()))
    .join(' ');
}

/** Words that aren't a company. */
const NOT_CO =
  'on|in|by|from|at|with|date|bonus|amount|the|a|an|as|and|or|for|of|is|was|will|would|next|this|soon|after|before|letter|me|my|us|we|i|it|there|here|them|company|job|role|position|new|salary|ctc|have|has|had|got|get|also|two|three|another|other|one|offer|offers|offered|both|their|his|her|our|current|currently|present|previous|lpa|fixed|base|variable|joining|joined|resigned|hike|hiked';
const WORD = `(?:(?:pvt|ltd|inc|co)\\.|&|[a-z][\\w-]*)`;
const NAME = `((?!(?:${NOT_CO})\\b)[a-z][\\w-]*(?:\\s+(?!(?:${NOT_CO}|offering|paying)\\b)${WORD}){0,6}?)`;
const NAME_END = `(?=\\s*(?:,|\\.(?:\\s|$)|$|:|;|\\(|\\s+(?:with|for|at|on|and|offering|paying|of|is|was|-|\\d|₹|rs\\b)))`;

/** Where each offer starts, and whose it is: "offer from BP", "Zeta offer:", "joining Google", "Zeta offered". */
function offerMarkers(t: string): { at: number; name: string }[] {
  const res = [
    new RegExp(`\\b(?:offers?|job)\\s+(?:[a-z0-9]\\s+)?(?:letter\\s+)?(?:from|at|with|by)\\s+${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\bjoining\\s+${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\b${NAME}\\s+(?:has\\s+)?offered\\b`, 'gi'),
    new RegExp(`\\b${NAME}\\s+offer\\s*[:\\-]`, 'gi'),
  ];
  // "offers from Zeta (25 LPA) and Omega (28 LPA)": every name with its figure in brackets.
  if (/\boffers\b/i.test(t)) res.push(new RegExp(`(?:,|\\band)\\s+${NAME}(?=\\s*\\(\\s*(?:₹|rs|\\d))`, 'gi'));
  const out: { at: number; name: string }[] = [];
  for (const re of res)
    for (const m of t.matchAll(re)) {
      const name = m[1].trim();
      if (!name) continue;
      if (!out.some((o) => o.name.toLowerCase() === name.toLowerCase())) out.push({ at: m.index ?? 0, name });
    }
  return out.sort((a, b) => a.at - b.at);
}

/** The company of the job you have: "leaves at Suzlon", "LWD at Acme", "working at X", "current CTC at X". */
function currentCompany(t: string, offers: string[]): string | undefined {
  const re = new RegExp(`(?:leaves?|resigned|resigning|leaving|working|work|currently|notice(?:\\s+period)?(?:\\s+is\\s+\\d+\\s+\\w+)?|lwd|last\\s+(?:working\\s+)?day|joined|ctc(?:\\s+is\\s+[\\d.,]+\\s*\\w*)?)\\s+(?:at|from|with|in)\\s+${NAME}${NAME_END}`, 'gi');
  for (const m of t.matchAll(re)) {
    const name = m[1].trim();
    if (offers.some((o) => o.toLowerCase() === name.toLowerCase())) continue;
    // "working in Bangalore" is a place, not a company.
    if (findLocation(name)) continue;
    return name;
  }
  return undefined;
}

/* ---------- the note ---------- */

export interface NoteDocs {
  /** The offer you're taking: the first one named. */
  offer?: DocRecord;
  /** Other offers in the same note, to compare side by side. */
  alternatives: DocRecord[];
  /** The job you have now: when you joined, what it pays. */
  current?: DocRecord;
  /** Leaving the job you have. */
  exit?: DocRecord;
  /** A hike at the job you have. */
  hike?: DocRecord;
  /** Assumptions made reading the offer, to show on its job. */
  warnings?: string[];
}

interface Pay {
  fields: Record<string, number>;
  warnings: string[];
}

/** Salary figures in one part of the note: CTC, fixed pay, basic, HRA, variable, bonuses. */
function readPay(seg: string, doj: string | undefined, now = false): Pay {
  const fields: Record<string, number> = {};
  const warnings: string[] = [];
  const near = (w: string) => amountNear(seg, w, now);
  const ctcA = near('ctc|package|compensation|offered|salary');
  const baseA = near('base(?:\\s+pay|\\s+salary)?|fixed(?:\\s+pay|\\s+ctc|\\s+salary|\\s+component)?');
  const basicA = near('basic(?!\\s+hra)');
  const variableA = near(
    'variable(?:\\s+pay)?|performance\\s+(?:bonus|pay)|pli|annual\\s+bonus|(?<!(?:joining|signing|sign[\\s-]on|retention|relocation|referral)\\s)bonus(?!\\s+(?:paid|payable))',
  );
  const joiningA = near('joining\\s+bonus|sign[\\s-]*on\\s+bonus|joining\\s+amount|signing\\s+bonus');
  const retentionA = near('retention\\s+bonus');
  // A bare "34.2 LPA" with no word: the CTC, unless it's the fixed or variable figure.
  const lpa = ctcA || baseA || now ? undefined : [...seg.matchAll(new RegExp(AMT_SRC, 'gi'))].map(toAmount).find((a) => a.perYear && !a.pct && !a.bare && a.value !== variableA?.value);
  const ctcStated = yearly(ctcA ?? lpa, 100_000);
  let fixed = yearly(baseA, ctcStated);
  let variable = variableA && !variableA.pct ? (variableA.perMonth ? variableA.value * 12 : variableA.value) : undefined;
  if (variableA?.pct) variable = Math.round(variableA.value * (fixed ?? ctcStated ?? 0)) || undefined;
  const ctc = ctcStated ?? (fixed ? fixed + (variable ?? 0) : undefined);
  if (!fixed && ctc && variable) fixed = ctc - variable;
  const pay = fixed ?? ctc;
  if (fixed) fields.fixed = fixed;

  // Basic: an amount, or a share of CTC / fixed pay ("basic 40% of CTC").
  let basic = basicA && !basicA.pct ? yearly(basicA, ctc) : undefined;
  if (basicA?.pct && pay) basic = basicA.value * (/basic[^,;.]{0,20}of\s+(?:the\s+)?(?:fixed|base)/i.test(seg) && fixed ? fixed : ctc ?? pay);
  // A breakup bigger than the CTC was read at the wrong scale.
  if (basic && ctc && basic > ctc) basic = basic / 12;
  if (basic) fields.basic = Math.round(basic / 12);
  const hraPct = /(\d{1,2})\s*%\s*(?:of\s+)?(?:basic\s+)?(?:as\s+)?hra|hra\s*(?:is|of|at|:|=)?\s*(\d{1,2})\s*%/i.exec(seg);
  const hraA = hraPct ? undefined : near('hra|house\\s+rent(?:\\s+allowance)?');
  if (fields.basic && hraPct) fields.hra = Math.round((fields.basic * +(hraPct[1] ?? hraPct[2])) / 100);
  else if (hraA && !hraA.pct) fields.hra = Math.round(yearly(hraA, ctc)! / 12);
  if (pay && fields.basic) {
    // "Rest special allowance": what's left of the fixed pay after basic, HRA and employer PF.
    const month = (doj ?? today()).slice(0, 7);
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
  if (variable) fields.variable = variable;
  if (joiningA && !joiningA.pct) {
    fields.joining = joiningA.value;
    const jb = /joining\s+bonus|sign[\s-]*on\s+bonus|signing\s+bonus/i.exec(seg);
    const off = jb ? monthOffsetIn(seg.slice(jb.index, jb.index + 120)) ?? monthOffsetIn(seg.slice(Math.max(0, jb.index - 80), jb.index)) : undefined;
    if (off !== undefined) fields.joiningOffset = off;
  }
  if (retentionA && !retentionA.pct) fields.retention = retentionA.value;
  return { fields, warnings };
}

/** Everything about one offer from its part of the note. */
function readOffer(seg: string, whole: string, company: string | undefined, name: string, lwd: string | undefined, raw: string): { doc: DocRecord; warnings: string[] } {
  const facts: Facts = {};
  const DOJ = /\bjoin(?:ing)?(?!\s+bonus|\s+amount)\s*(?:date|on|from|by|in)?\s*(?:is|:|-)?|\bdoj\b\s*(?:is|:)?|\bstart(?:ing)?\s*(?:date)?\s*(?:on|from|is|:)?/i;
  const doj = dateAfter(seg, DOJ, lwd ? { after: lwd } : {}) ?? dateAfter(whole, DOJ, lwd ? { after: lwd } : {});
  const { fields, warnings } = readPay(seg, doj);

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
  if (noticeHere) {
    const clause = clauseText(seg, noticeHere.index, noticeHere.index + noticeHere[0].length);
    if (!/resign|lwd|serv(e|ing)|current|\bat\s+(?!(?:the\s+)?(?:new|this))/i.test(clause) || (company && new RegExp(`\\b${company}\\b`, 'i').test(clause))) facts.noticeDays = +(noticeHere[1] ?? noticeHere[2]);
  }
  const loc = findLocation(seg);
  if (loc) facts.location = loc;
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

/** Split a note into its offers, the job you have, leaving it, and a hike at it. */
export function parseNote(text: string, name: string): NoteDocs {
  const t = text.replace(/\s+/g, ' ');
  const out: NoteDocs = { alternatives: [] };
  const markers = offerMarkers(t);
  const oldCo = currentCompany(t, markers.map((m) => m.name));
  const offers = markers.filter((m) => !oldCo || m.name.toLowerCase() !== oldCo.toLowerCase());
  const raw = text.slice(0, 60_000);

  // --- Leaving the job you have ---
  const lwd = dateAfter(t, /\blwd\b\s*(?:at\s+\S+\s*)?(?:is|was|:|on|-)?|last\s+(?:working\s+)?day\s*(?:at\s+\S+\s*)?(?:is|was|will\s+be|:|on)?|relieving\s+date\s*(?:is|:)?/i);
  const resigned = dateAfter(t, /resign(?:ed|ation)?\s*(?:date|on|dated)?\s*(?:is|was|:)?/i, lwd ? { before: lwd } : {});
  const leave = /(\d{1,3}(?:\.\d+)?)\s*(?:days?\s+(?:of\s+)?)?(?:earned\s+|privilege\s+|el\s+|pl\s+)?leaves?\b(?!\s+(?:on|in|by|after|before))/i.exec(t) ?? /leave\s+balance\s*(?:is|of|:)?\s*(\d{1,3}(?:\.\d+)?)/i.exec(t);
  const exitFacts: Facts = {};
  if (lwd) exitFacts.lastWorkingDay = lwd;
  if (resigned) exitFacts.resignationDate = resigned;
  if (leave && (lwd || resigned || oldCo)) exitFacts.leaveDays = parseFloat(leave[1]);
  // Notice at the job you have: when you're leaving it, and the clause is about you serving it.
  const noticeNow = (() => {
    for (const m of t.matchAll(/notice\s+(?:period\s+)?(?:is|of|was|:)?\s*(\d{1,3})\s*(days?|months?)|(\d{1,3}|one|two|three|six)\s*(days?|months?)'?\s+(?:of\s+)?notice/gi)) {
      const clause = clauseText(t, m.index ?? 0, (m.index ?? 0) + m[0].length);
      const aboutOffer = offers.some((o) => new RegExp(`\\b${o.name}\\b`, 'i').test(clause)) || /offer|new\s+job|there\b|their/i.test(clause);
      const aboutNow = /current|my\s+notice|serv/i.test(clause) || (!!oldCo && new RegExp(`\\b${oldCo}\\b`, 'i').test(clause));
      if (aboutOffer && !aboutNow) continue;
      if (!aboutNow && !lwd && !resigned) continue;
      const raw = (m[1] ?? m[3]).toLowerCase();
      const n = ({ one: 1, two: 2, three: 3, six: 6 } as Record<string, number>)[raw] ?? +raw;
      return /month/i.test(m[2] ?? m[4]) ? { days: n * 30, months: n } : { days: n };
    }
    return undefined;
  })();
  if (noticeNow && (lwd || resigned)) {
    exitFacts.noticeDays = noticeNow.days;
    if (noticeNow.months) exitFacts.noticeMonths = noticeNow.months;
  }
  if (Object.keys(exitFacts).length) {
    out.exit = { id: uid(), name: `${name} (leaving${oldCo ? ` ${companyName(oldCo)}` : ''})`, kind: 'resignation', fields: {}, facts: exitFacts, employer: oldCo ? companyName(oldCo) : undefined, docDate: resigned, text: raw };
  }

  // --- A hike at the job you have ---
  const hike = /\b(hike[ds]?|hiked|increment(?:ed)?|revised|revision|raise[ds]?|appraisal|promot(?:ed|ion))\b/i.exec(t);
  if (hike && !offers.length) {
    const facts: Facts = {};
    const to = amountNear(t, 'to|revised\\s+(?:ctc|salary|package)|new\\s+(?:ctc|salary|package)|ctc|package|salary');
    const pct = /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:hike|increment|raise|increase)|(?:hike|increment|raise|increase)\s+(?:of\s+)?(\d{1,2}(?:\.\d+)?)\s*%/i.exec(t);
    if (to && !to.pct) facts.revisedCtc = yearly(to, 100_000);
    if (pct) facts.incrementPct = +(pct[1] ?? pct[2]) / 100;
    const from = dateAfter(t, /\b(?:from|effective(?:\s+from)?|w\.?e\.?f\.?|with\s+effect\s+from|starting)\b/i);
    if (from) facts.effectiveFrom = from;
    if (facts.revisedCtc || facts.incrementPct) {
      out.hike = { id: uid(), name: `${name} (hike${oldCo ? ` at ${companyName(oldCo)}` : ''})`, kind: 'appraisal', fields: {}, facts, employer: oldCo ? companyName(oldCo) : undefined, docDate: from, text: raw };
      return out;
    }
  }

  // --- The job you have: "joined June 2024", "current CTC 12 LPA at Acme" ---
  const joined = dateAfter(t, /\bjoined\s*(?:on|in|at\s+\S+\s+(?:on|in))?/i);
  const nowPay = readPay(t, joined, true).fields;
  const nowOnly = !offers.length && joined ? readPay(t, joined).fields : {};
  const currentFields = { ...nowOnly, ...nowPay };
  if (joined || Object.keys(nowPay).length) {
    out.current = {
      id: uid(),
      name: `${name} (${oldCo ? companyName(oldCo) : 'your job'})`,
      kind: 'offer',
      fields: currentFields,
      facts: noticeNow && !lwd && !resigned ? { noticeDays: noticeNow.days, ...(noticeNow.months ? { noticeMonths: noticeNow.months } : {}) } : {},
      doj: joined,
      employer: oldCo ? companyName(oldCo) : undefined,
      text: raw,
    };
    if (!offers.length && joined) return out;
  }

  // --- Offers: one part of the note per company. Sentences about the job you have stay out. ---
  const aboutNow = (s: string) => ABOUT_NOW.test(s) || /\bjoined\b/i.test(s) || (!!oldCo && new RegExp(`\\bat\\s+${oldCo}\\b`, 'i').test(s) && !/offer/i.test(s));
  const offerText = (from: number, to: number) => {
    const seg = t.slice(from, to);
    return seg
      .split(/(?<=\.)\s+/)
      .filter((s) => !aboutNow(s) || offers.some((o) => s.toLowerCase().includes(o.name.toLowerCase())))
      .join(' ');
  };
  const parts = offers.length > 1 ? offers.map((m, i) => ({ name: m.name, seg: offerText(i === 0 ? 0 : m.at, offers[i + 1]?.at ?? t.length) })) : [{ name: offers[0]?.name, seg: offerText(0, t.length) }];
  const read = parts.map((p) => readOffer(p.seg, t, p.name, name, lwd, raw));
  const real = read.filter((r) => Object.keys(r.doc.fields).length || r.doc.doj || r.doc.employer);
  if (real.length) {
    out.offer = real[0].doc;
    out.warnings = real[0].warnings;
    out.alternatives = real.slice(1).map((r) => r.doc);
  }
  return out;
}
