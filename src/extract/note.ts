/**
 * A note you type or paste instead of a letter: "Got an offer from KV Pvt Ltd, 30 base (15
 * basic, 50% basic HRA, rest special), joining 14th Nov 2026. Resigned on 5th Sept, LWD 13 Nov,
 * 18 leaves at Northwind. 1.2 joining bonus in the 4th month, 50k relocation reimbursed...".
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

/** Signs of a letter or email: a salutation, sign-off, headers, a letterhead. */
function letterSigns(text: string): boolean {
  const firstLines = text.split('\n').slice(0, 3);
  // A letterhead is a company's legal name on a line of its own, capitalised as letters print it.
  const letterhead = firstLines.some(
    (l) => /^\s*[A-Z][\w&.,' -]{2,60}\b(Private Limited|PRIVATE LIMITED|Pvt\.? Ltd\.?|PVT\.? LTD\.?|Limited|LIMITED|Ltd\.?|LTD\.?|LLP|Inc\.?)\s*$/.test(l) && !/\b(offer|from|got|joining|join|resign|ctc|lpa|with)\b/i.test(l),
  );
  return (
    letterhead ||
    /\bdear\b|we\s+are\s+(pleased|happy|delighted)|yours\s+(sincerely|faithfully|truly)|warm\s+wishes|to\s+whom\s+it\s+may\s+concern|this\s+is\s+to\s+certify|annexure|offer\s+of\s+employment|letter\s+of\s+appointment|appointment\s+letter|salary\s+slip|full\s+and\s+final\s+settlement\s+statement/i.test(text) ||
    /^\s*(from|to|subject|date|cc)\s*:/im.test(text)
  );
}

/**
 * Pasted text that is clearly a document, not your own words: a letter or email (salutation,
 * headers, letterhead), or a payslip, F&F statement or tax sheet (their own wording with a table).
 * It goes through the document reader, as a file would.
 */
export function looksLikeDocument(text: string): boolean {
  if (letterSigns(text)) return true;
  const rows = text.split('\n').filter((l) => /\d[\d,]{3,}(\.\d+)?\s*$/.test(l.trim())).length;
  const words = new Set(
    (text.match(/pay\s*slip|salary\s+slip|net\s+pay|gross\s+earnings|total\s+(earnings|deductions)|full\s*(and|&)\s*final|settlement\s+(statement|slip)|form\s*16|tax\s+computation|certificate\s+under\s+section|employee\s+(code|id|no)|\buan\b|pay\s+period|days\s+paid|lop\s+days/gi) ?? []).map((w) => w.toLowerCase().replace(/\s+/g, ' ')),
  ).size;
  return words >= 2 || (rows >= 3 && words >= 1) || rows >= 5;
}

/** A file's text written like a message rather than a letter. (Text you type or paste is always a note.) */
export function isNote(text: string): boolean {
  if (text.length > 4000) return false;
  const about = /\boffers?\b|\bjoin(ing|ed)?\b|\bresign(ed|ing)?\b|\blwd\b|last\s+working\s+day|\bctc\b|\blpa\b|\bpackage\b|\bnotice\b|\bbasic\b|\bhike[ds]?\b|\bincrement\b/i.test(text);
  const tableRows = text.split('\n').filter((l) => /\d[\d,]{3,}(\.\d+)?\s*$/.test(l.trim())).length;
  return about && !letterSigns(text) && !/pay\s*slip|form\s*16/i.test(text) && tableRows < 3;
}

/* ---------- amounts ---------- */

/** One amount as written: "30", "30,00,000", "50k", "2.5L/month", "30 LPA", "40%". */
interface Amount {
  value: number;
  pct?: boolean;
  perMonth?: boolean;
  /** Stated per year ("LPA", "per annum"), or in lakhs/crores, which are yearly in a salary note. */
  perYear?: boolean;
  /** Written without a unit or commas ("30"): small figures are lakhs. */
  bare?: boolean;
  /** Written as "LPA": a whole year's pay, not an amount added to it. */
  lpa?: boolean;
}

const AMT_SRC =
  '(?:₹|rs\\.?|inr)?\\s*(\\d{1,3}(?:,\\d{2,3})+|\\d+(?:\\.\\d+)?)\\s*(k|l|lakhs?|lacs?|lpa|cr|crores?|thousands?)?\\b(\\s*(?:%|per\\s*cent\\b|percent\\b))?((?:\\s*(?:\\/|per|a|p\\.?)\\s*(?:month|mo\\b|m\\b\\.?|annum|year|yr|a\\b\\.?))|\\s+monthly|\\s+pm\\b|\\s+pa\\b|\\s+p\\.a\\.?)?';

function toAmount(m: RegExpExecArray | RegExpMatchArray): Amount {
  const v = parseFloat(m[1].replace(/,/g, ''));
  const unit = (m[2] ?? '').toLowerCase();
  const period = (m[4] ?? '').toLowerCase();
  const perYear = /annum|year|yr|\bpa\b|p\.a|\/\s*a\b|per\s+a\b/.test(period) || unit === 'lpa';
  const perMonth = !perYear && /month|mo\b|\bm\b|monthly|pm\b|p\.m/.test(period);
  if (m[3]) return { value: v / 100, pct: true };
  if (unit === 'k' || unit.startsWith('thousand')) return { value: Math.round(v * 1_000), perMonth, perYear };
  if (unit.startsWith('cr')) return { value: Math.round(v * 10_000_000), perMonth, perYear: !perMonth };
  if (unit) return { value: Math.round(v * 100_000), perMonth, perYear: !perMonth, lpa: unit === 'lpa' };
  if (!m[1].includes(',') && v < 1000) return { value: Math.round(v * 100_000), perMonth, perYear: !perMonth, bare: true };
  return { value: Math.round(v), perMonth, perYear };
}

/** Abbreviations whose full stop doesn't end a sentence ("Rs. 18,00,000", "No. 5"). */
const ABBR = /(?:^|[^a-z])(rs|no|approx|inr|mr|ms|mrs|dr|vs|sr|jr|w\.e\.f|e\.f|w\.e)$/i;
/** "Pvt." / "Ltd." end a sentence only when a new one starts after them (not "Pvt. Ltd."). */
const CO_ABBR = /(?:^|[^a-z])(pvt|ltd|co|inc|corp)$/i;

/** Where a sentence or clause ends. A comma between digits is part of a number ("30,00,000"). */
function breakAt(t: string, k: number): boolean {
  const c = t[k];
  if (/[;()+]/.test(c)) return true;
  if (c === ',') return !(/\d/.test(t[k - 1] ?? '') && /\d/.test(t[k + 1] ?? ''));
  if (c !== '.') return false;
  if (k + 1 < t.length && !/\s/.test(t[k + 1])) return false;
  const before = t.slice(Math.max(0, k - 8), k);
  if (ABBR.test(before)) return false;
  if (CO_ABBR.test(before)) {
    const next = /^\s+(\S+)/.exec(t.slice(k + 1, k + 20))?.[1] ?? '';
    return /^[A-Z]/.test(next) && !/^(ltd|limited|pvt|private|co|inc)\b/i.test(next);
  }
  // "p.a." / "p.m." end a sentence only when a new one starts after them.
  if (/p\.[am]$/i.test(before)) return /^\s+[A-Z]/.test(t.slice(k + 1, k + 3));
  return true;
}

/** The clause around t[i..j]: amounts belong to the word in their own clause. */
function clauseAround(t: string, i: number, j: number): { start: number; end: number } {
  let start = i;
  while (start > 0 && !breakAt(t, start - 1)) start--;
  let end = j;
  while (end < t.length && !breakAt(t, end)) end++;
  return { start, end };
}
const clauseText = (t: string, i: number, j: number) => {
  const c = clauseAround(t, i, j);
  return t.slice(c.start, c.end);
};
/** Sentences, split where a full stop really ends one. */
function sentencesOf(t: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (let k = 0; k < t.length; k++) if (t[k] === '.' && breakAt(t, k)) {
    out.push(t.slice(from, k + 1).trim());
    from = k + 1;
  }
  if (t.slice(from).trim()) out.push(t.slice(from).trim());
  return out;
}

/** About the job you have, not the offer: "my current CTC", "present salary". */
const ABOUT_NOW = /\b(current(ly)?|present|existing|previous|old|last\s+year|now)\b/i;
const HIKE_WORD = /\b(hike[ds]?|hiked|increment(?:ed)?|revised|revision|raise[ds]?|appraisal|promot(?:ed|ion)|increased|new\s+(?:ctc|salary|package|pay))\b/i;
/** "50% hike over current": the size of an offer, not a hike at your job. */
const OVER_CURRENT = /(\d{1,3}(?:\.\d+)?)\s*(?:%|per\s*cent|percent)\s*(?:hike|increase|jump|more)?\s*(?:over|on|than|from|above)\s+(?:my\s+|the\s+)?(?:current|present|existing)|(?:hike|increase|jump)\s+(?:of\s+)?(\d{1,3}(?:\.\d+)?)\s*(?:%|per\s*cent|percent)\s*(?:over|on|than|from|above)\s+(?:my\s+|the\s+)?(?:current|present|existing)/i;
const OFFER_WORD = /\b(offers?|offered|offering|joining|join|switch(?:ing)?|new\s+(?:job|company|role)|selected|starting\s+at)\b/i;

/**
 * The amount written next to a word: right after it ("variable of 1.8", "CTC: 30,00,000") or
 * right before it ("1.6 variable", "50k relocation"), within the same clause. `now` picks figures
 * about the job you have ("my current CTC 18 LPA"), judged by the words just before the figure.
 */
function amountNear(t: string, word: string, now = false, allowPct = true): Amount | undefined {
  for (const w of t.matchAll(new RegExp(`\\b(?:${word})\\b`, 'gi'))) {
    const i = w.index ?? 0;
    const j = i + w[0].length;
    const c = clauseAround(t, i, j);
    if (ABOUT_NOW.test(t.slice(Math.max(c.start, i - 25), Math.min(c.end, j + 8))) !== now) continue;
    // "monthly salary 1,50,000", "in-hand 80k": a month's figure.
    const monthly = /\b(monthly|per\s+month|a\s+month|in[\s-]?hand|take[\s-]?home)\s*$/i.test(t.slice(Math.max(c.start, i - 20), i));
    const after = new RegExp(`^\\s*(?:bonus\\s+)?(?:of|is|was|:|=|-|at|around|about|would\\s+be|will\\s+be|to)?\\s*(?:now\\s+)?${AMT_SRC}`, 'i').exec(t.slice(j, c.end));
    const before = after ? null : [...t.slice(Math.max(c.start, i - 40), i).matchAll(new RegExp(`${AMT_SRC}\\s*(?:[a-z][a-z-]*\\s+){0,2}$`, 'gi'))].pop();
    const m = after ?? before;
    if (!m) continue;
    const a = toAmount(m);
    if (a.pct && !allowPct) continue;
    return monthly && !a.pct && !a.perYear ? { ...a, perMonth: true } : a;
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
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

interface Dated {
  date: string;
  /** No year was written and another year is just as plausible: ask. */
  options?: string[];
}

/**
 * A date as written. With no year: `before`/`after` bound it (a resignation before the last day,
 * a joining after it); `upcoming` (a last day, a joining date) takes the next one from two months
 * ago; otherwise the year nearest today. When the other year is also plausible, both are returned.
 */
function dateIn(s: string, opts: { before?: string; after?: string; upcoming?: boolean } = {}): Dated | undefined {
  const full = findDate(s);
  if (full) return { date: full };
  // "14 Nov '26"
  const apos = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*${MON_RE}[\\s,]*['’](\\d{2})\\b`, 'i').exec(s);
  if (apos) {
    const d = validDate(2000 + +apos[3], MONTHS.indexOf(apos[2].slice(0, 3).toLowerCase()) + 1, +apos[1]);
    if (d) return { date: d };
  }
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MON_RE}\\b(?![\\s,'’-]*\\d{2,4})`, 'i').exec(s) ?? new RegExp(`\\b${MON_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*,?\\s*\\d{4})`, 'i').exec(s);
  let day: number;
  let month: number;
  if (dm) {
    const [d, mon] = /^\d/.test(dm[1]) ? [+dm[1], dm[2]] : [+dm[2], dm[1]];
    day = d;
    month = MONTHS.indexOf(mon.slice(0, 3).toLowerCase()) + 1;
  } else {
    const my = new RegExp(`\\b${MON_RE}[\\s,'’-]*(\\d{4}|\\d{2})\\b`, 'i').exec(s);
    if (my) {
      const y = +my[2] < 100 ? 2000 + +my[2] : +my[2];
      const d = validDate(y, MONTHS.indexOf(my[1].slice(0, 3).toLowerCase()) + 1, 1);
      return d ? { date: d } : undefined;
    }
    // "joining in December": the 1st.
    const mo = new RegExp(`\\b(?:in|from|by)\\s+${MON_RE}\\b`, 'i').exec(s);
    if (!mo) return undefined;
    day = 1;
    month = MONTHS.indexOf(mo[1].slice(0, 3).toLowerCase()) + 1;
  }
  const ref = opts.before ?? opts.after ?? today();
  const y0 = +ref.slice(0, 4);
  const options = [y0 - 1, y0, y0 + 1].map((y) => validDate(y, month, day)).filter((x): x is string => !!x);
  if (opts.before) {
    const d = options.filter((x) => x <= opts.before!).pop();
    return d ? { date: d } : undefined;
  }
  if (opts.after) {
    const d = options.find((x) => x > opts.after!);
    return d ? { date: d } : undefined;
  }
  const t0 = today();
  if (opts.upcoming) {
    const d = options.find((x) => x >= shift(t0, -60));
    if (!d) return undefined;
    // The year before is plausible too if it's within ~7 months of today: ask.
    const other = options.find((x) => x < d && Math.abs(Date.parse(x) - Date.parse(t0)) < 210 * 86_400_000);
    return other ? { date: d, options: [d, other] } : { date: d };
  }
  const dist = (x: string) => Math.abs(Date.parse(x) - Date.parse(t0));
  return { date: options.sort((a, b) => dist(a) - dist(b))[0] };
}

/** The first mention of `re` followed, in its own clause, by a date. */
function dateAfter(t: string, re: RegExp, opts: { before?: string; after?: string; upcoming?: boolean } = {}): Dated | undefined {
  for (const m of t.matchAll(new RegExp(re.source, 'gi'))) {
    const j = (m.index ?? 0) + m[0].length;
    const tail = t.slice(j, j + 40).split(/[,;]|\.(?!\d)(?!\s*\d)|\s(?:and|lwd|but)\s/i)[0];
    const d = dateIn(tail, opts);
    if (d) return d;
  }
  return undefined;
}

/* ---------- companies ---------- */

const CO_WORD = /^(pvt|ltd|private|limited|inc|llp|india|technologies|technology|solutions|services|systems|software|labs|global|consulting|group|development|centre|center|corp|corporation)\.?$/i;
/** "kv pvt ltd" -> "KV Pvt Ltd"; "infosys" -> "Infosys"; "larsen & toubro" -> "Larsen & Toubro". */
function companyName(raw: string): string {
  return raw
    .trim()
    .replace(/[.,]+$/, '')
    .split(/\s+/)
    .map((w) => (w === '&' ? w : CO_WORD.test(w) || w.length > 3 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()))
    .join(' ');
}

const MONTH_WORDS = 'jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december';
const DAY_WORDS = 'mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday|today|tomorrow|tonight|week|month|year';
/** Words that aren't a company. */
const NOT_CO = `on|in|by|from|at|with|date|bonus|amount|the|a|an|as|and|or|for|of|is|was|will|would|next|this|soon|after|before|letter|me|my|us|we|i|it|there|here|them|company|job|role|position|new|salary|ctc|have|has|had|got|get|also|two|three|another|other|one|offer|offers|offered|both|their|his|her|our|current|currently|present|previous|lpa|fixed|base|variable|joining|joined|resigned|hike|hiked|immediately|expected|tentatively|formalities|asap|shortly|within|probably|likely|around|approximately|end|early|mid|received|details|package|${MONTH_WORDS}|${DAY_WORDS}`;
const WORD = `(?:(?:pvt|ltd|inc|co)\\.|&|[a-z][\\w-]*)`;
const NAME = `((?!(?:${NOT_CO})\\b)[a-z][\\w-]*(?:\\s+(?!(?:${NOT_CO}|offering|paying)\\b)${WORD}){0,6}?)`;
const NAME_END = `(?=\\s*(?:,|\\.(?:\\s|$)|$|:|;|\\(|\\s+(?:(?:with|for|at|on|and|offering|paying|of|is|was|as|in|from|received|today|yesterday|recently|rs|vs)\\b|-|\\d|₹)))`;

/** Where each offer starts, and whose it is: "offer from KV", "Zeta offer:", "joining Google", "switching to Zeta". */
function offerMarkers(t: string): { at: number; name: string }[] {
  const res = [
    new RegExp(`\\b(?:offers?|job)\\s+(?:[a-z0-9]\\s+)?(?:letter\\s+)?(?:from|at|with|by)\\s+${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\bjoining\\s+${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\bjoin(?:ing)?\\b[^.,;]{0,30}?\\b(?:at|with)\\s+${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\b${NAME}\\s+(?:has\\s+|is\\s+)?(?:offered|offering)\\b`, 'gi'),
    new RegExp(`\\b${NAME}\\s+offer\\b(?!\\s+(?:from|letter|of|to|for)\\b)`, 'gi'),
    new RegExp(`\\boffer\\s*:\\s*${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\bnew\\s+(?:job|role|position|company)\\s+(?:at|with|in)\\s+${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\bnew\\s+offer\\s*[:\\-]?\\s*(?:from\\s+)?${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\b(?:switching|moving|shifting)\\s+to\\s+${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\bstarting\\s+(?:at|with)\\s+${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\bselected\\s+(?:at|by|in)\\s+${NAME}${NAME_END}`, 'gi'),
  ];
  // "offers from Zeta (25 LPA) and Omega (28 LPA)": every name with its figure in brackets.
  if (/\boffers\b/i.test(t)) res.push(new RegExp(`(?:,|\\band)\\s+${NAME}(?=\\s*\\(\\s*(?:₹|rs|\\d))`, 'gi'));
  const out: { at: number; name: string }[] = [];
  for (const re of res)
    for (const m of t.matchAll(re)) {
      const name = m[1].trim();
      if (!name || (!/\s/.test(name) && findLocation(name))) continue;
      if (!out.some((o) => o.name.toLowerCase() === name.toLowerCase())) out.push({ at: m.index ?? 0, name });
    }
  return out.sort((a, b) => a.at - b.at);
}

/** The company of the job you have: "leaves at Northwind", "LWD at Acme", "leaving Acme", "current company Infosys". */
function currentCompany(t: string, offers: string[]): string | undefined {
  const res = [
    new RegExp(`\\bcurrent(?:ly)?\\s+(?:company|employer|organi[sz]ation|org|firm)\\s*(?:is|:|-)?\\s*${NAME}${NAME_END}`, 'gi'),
    new RegExp(`(?:leaves?|resigned|resigning|leaving|left|working|work|currently|notice(?:\\s+period)?(?:\\s+is\\s+\\d+\\s+\\w+)?|lwd|last\\s+(?:working\\s+)?day|joined|ctc(?:\\s+is\\s+[\\d.,]+\\s*\\w*)?)\\s+(?:at|from|with|in)\\s+${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\bresign(?:ed|ing)?\\b(?:\\s+(?!offer)\\S+){1,5}?\\s+(?:at|from)\\s+${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\b(?:leaving|left|quit|quitting|joined)\\s+${NAME}${NAME_END}`, 'gi'),
    new RegExp(`\\b(?:lwd|last\\s+(?:working\\s+)?day|leaves?)\\b[^.,;]{0,25}?\\bat\\s+${NAME}${NAME_END}`, 'gi'),
    // "salary revised to 25 LPA at Northwind", "my CTC at Acme is 18 LPA"
    new RegExp(`\\b(?:revised|hiked|hike|increment\\w*|promoted|appraisal|salary|ctc|pay|package)\\b[^.;]{0,40}?\\bat\\s+${NAME}${NAME_END}`, 'gi'),
  ];
  for (const re of res)
    for (const m of t.matchAll(re)) {
      const name = m[1].trim();
      if (offers.some((o) => o.toLowerCase() === name.toLowerCase())) continue;
      // "working in Bangalore" is a place, not a company.
      if (!/\s/.test(name) && findLocation(name)) continue;
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

const ctcWords = '(?<!fixed\\s|base\\s)ctc|package|compensation|offered|offering|salary';

/** Salary figures in one part of the note: CTC, fixed pay, basic, HRA, allowances, variable, bonuses. */
function readPay(seg: string, doj: string | undefined, now = false, offerName?: string): Pay {
  const fields: Record<string, number> = {};
  const warnings: string[] = [];
  const near = (w: string, allowPct = true) => amountNear(seg, w, now, allowPct);
  let ctcA = near(now ? `${ctcWords}|current|present|existing` : ctcWords, false);
  let baseA = near('base(?:\\s+pay|\\s+salary)?|fixed(?:\\s+pay|\\s+ctc|\\s+salary|\\s+component)?|gross');
  // "monthly salary 1,50,000": a month's gross, not a CTC.
  if (ctcA?.perMonth && !baseA) [baseA, ctcA] = [ctcA, undefined];
  const basicA = near('basic(?!\\s+hra)');
  const variableA = near(
    'variable(?:\\s+pay)?|performance\\s+(?:bonus|pay)|pli|annual\\s+bonus|(?<!(?:joining|signing|sign[\\s-]on|retention|relocation|referral)\\s)bonus(?!\\s+(?:paid|payable))',
  );
  const joiningA = near('joining\\s+bonus|sign[\\s-]*on\\s+bonus|joining\\s+amount|signing\\s+bonus');
  const retentionA = near('retention\\s+bonus');
  // A bare "30 LPA" with no word: the CTC. In a note with an offer, from a sentence about it.
  let lpa: Amount | undefined;
  if (!ctcA && !baseA && !now) {
    const sentences = sentencesOf(seg);
    const pick = (ss: string[]) => ss.flatMap((s) => [...s.matchAll(new RegExp(AMT_SRC, 'gi'))].map(toAmount)).find((a) => a.perYear && !a.pct && !a.bare && a.value !== variableA?.value);
    const aboutOffer = sentences.filter((s) => (offerName && s.toLowerCase().includes(offerName.toLowerCase())) || OFFER_WORD.test(s));
    lpa = pick(aboutOffer) ?? (offerName ? undefined : pick(sentences));
  }
  const ctcStated = yearly(ctcA ?? lpa, 100_000);
  let fixed = yearly(baseA, ctcStated);
  let variable = variableA && !variableA.pct ? (variableA.perMonth ? variableA.value * 12 : variableA.value) : undefined;
  if (variableA?.pct) variable = Math.round(variableA.value * (fixed ?? ctcStated ?? 0)) || undefined;
  let ctc = ctcStated ?? (fixed ? fixed + (variable ?? 0) : undefined);
  if (!fixed && ctc && variable) fixed = ctc - variable;
  let pay = fixed ?? ctc;
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
  // Allowances you state ("special 40000 pm").
  const specialA = near('special(?:\\s+allowance)?|flexi(?:\\s+(?:pay|allowance|benefit))?|misc(?:ellaneous)?(?:\\s+allowance)?', false);
  if (specialA) fields.special = Math.round(yearly(specialA, ctc)! / 12);
  if (fields.basic) {
    const month = (doj ?? today()).slice(0, 7);
    const pf = Math.round(bundledRules.epf.rate * Math.min(fields.basic, epfCeiling(bundledRules, month)));
    const stated = fields.basic + (fields.hra ?? 0) + (fields.special ?? 0);
    if (pay) {
      // Whatever of the fixed pay isn't stated is the rest: special allowance if none was given,
      // else another allowance, so the breakup adds up to the fixed pay.
      const rest = Math.round(pay / 12) - stated - pf;
      if (rest > 500) {
        if (fields.special === undefined) fields.special = rest;
        else fields['other:Other allowance'] = rest;
        warnings.push(
          `${fields.special === rest ? 'Special allowance' : 'An other allowance of ₹' + rest.toLocaleString('en-IN')} taken as the rest of your ₹${Math.round(pay).toLocaleString('en-IN')} ${fixed ? 'fixed pay' : 'CTC'} after the parts you gave and employer PF (₹${pf.toLocaleString('en-IN')} a month). Correct it under "Check the numbers" if that's not how it's split.`,
        );
      } else if (rest < -500) warnings.push(`The parts you gave add up to more than your ${fixed ? 'fixed pay' : 'CTC'}. Check them under "Check the numbers".`);
    } else if (fields.special !== undefined) {
      // No CTC given: it's the breakup plus employer PF, plus variable pay.
      ctc = (stated + pf) * 12 + (variable ?? 0);
      pay = ctc - (variable ?? 0);
    }
    fields.employerPf = pf;
    fields.epf = pf;
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

const DOJ = /\bjoin(?:ing)?(?!\s+bonus|\s+amount)\s*(?:date|on|from|by)?\s*(?:is|:|-)?|\bdoj\b\s*(?:is|:)?|\bstart(?:ing)?\s*(?:date)?\s*(?:on|from|is|:)?/i;

/** Everything about one offer from its part of the note. `whole` is only used for the first offer's date. */
function readOffer(seg: string, whole: string | undefined, company: string | undefined, name: string, lwd: string | undefined, raw: string): { doc: DocRecord; warnings: string[] } {
  const facts: Facts = {};
  const opts = lwd ? { after: lwd } : { upcoming: true };
  const dated =
    dateAfter(seg, DOJ, opts) ??
    (whole ? dateAfter(whole, DOJ, opts) : undefined) ??
    // "New job at KV from 14 Nov 2026"
    dateAfter(sentencesOf(seg).filter((x) => OFFER_WORD.test(x) || (company && x.toLowerCase().includes(company.toLowerCase()))).join(' '), /\b(?:from|starting|w\.?e\.?f\.?)(?![a-z])/i, opts);
  const doj = dated?.date;
  if (dated?.options) facts.yearGuess = { field: 'doj', options: dated.options };
  const { fields, warnings } = readPay(seg, doj, false, company);

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
  const sentences = sentencesOf(t);
  const namesOffer = (s: string) => offers.some((o) => s.toLowerCase().includes(o.name.toLowerCase()));
  // An offer without a company name still counts: "40% hike in the new offer, 25 LPA, joining 1 Dec".
  const offerish = offers.length > 0 || sentences.some((s) => OFFER_WORD.test(s) && !/\bjoined\b/i.test(s));

  // --- Leaving the job you have ---
  const lwdAt = dateAfter(
    t,
    /\blwd\b\s*(?:at\s+\S+\s*)?(?:is|was|:|on|-)?|last\s+(?:working\s+)?day\s*(?:at\s+\S+\s*)?(?:is|was|will\s+be|:|on)?|relieving\s+date\s*(?:is|:)?|\b(?:leaving|left|quitting)\s+(?:\S+\s+){0,3}?(?:on|by)\b/i,
    { upcoming: true },
  );
  const lwd = lwdAt?.date;
  const resigned = dateAfter(t, /resign(?:ed|ation)?\s*(?:date|on|dated)?\s*(?:is|was|:)?/i, lwd ? { before: lwd } : {})?.date;
  const leave = /(\d{1,3}(?:\.\d+)?)\s*(?:days?\s+(?:of\s+)?)?(?:earned\s+|privilege\s+|el\s+|pl\s+)?leaves?\b(?!\s+(?:on|in|by|after|before))/i.exec(t) ?? /leave\s+balance\s*(?:is|of|:)?\s*(\d{1,3}(?:\.\d+)?)/i.exec(t);
  const exitFacts: Facts = {};
  if (lwd) exitFacts.lastWorkingDay = lwd;
  if (lwdAt?.options) exitFacts.yearGuess = { field: 'lastWorkingDay', options: lwdAt.options };
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

  // --- A hike at the job you have: sentences about a hike that aren't about an offer ---
  const hikeText = sentences.filter((s) => HIKE_WORD.test(s) && !OFFER_WORD.test(s) && !namesOffer(s) && !(offerish && OVER_CURRENT.test(s))).join(' ');
  if (hikeText) {
    const facts: Facts = {};
    const to = amountNear(hikeText, 'to|revised\\s+(?:ctc|salary|package)|new\\s+(?:ctc|salary|package)|ctc|package|salary', false, false);
    const by = to ? undefined : amountNear(hikeText, 'hike[ds]?|hiked|increment(?:ed)?|raise[ds]?|appraisal|revised|revision|promot(?:ed|ion)|increased', false);
    const PCT = '(\\d{1,2}(?:\\.\\d+)?)\\s*(?:%|per\\s*cent\\b|percent\\b)';
    const pct = new RegExp(`${PCT}\\s*(?:hike|increment|raise|increase)|(?:hike[ds]?|hiked|increment(?:ed)?|raise[ds]?|increase[ds]?)\\s+(?:of\\s+|by\\s+)?${PCT}`, 'i').exec(hikeText);
    if (to) facts.revisedCtc = yearly(to, 100_000);
    else if (by && !by.pct) {
      // "appraisal: 20 LPA" is the new CTC; "got 2L hike" is what's added.
      const v = yearly(by, 100_000) ?? by.value;
      if (by.lpa || v >= 500_000) facts.revisedCtc = v;
      else facts.incrementAmount = v;
    }
    if (pct) facts.incrementPct = +(pct[1] ?? pct[2]) / 100;
    const from =
      dateAfter(hikeText, /\b(?:from|effective(?:\s+from)?|w\.?e\.?f\.?|with\s+effect\s+from|starting)(?![a-z])/i) ?? dateAfter(hikeText, /\b(?:hike[ds]?|hiked|increment(?:ed)?|revised|raise[ds]?|appraisal|promot(?:ed|ion))\b\s*(?:in|on)?/i);
    if (from) facts.effectiveFrom = from.date;
    if (facts.revisedCtc || facts.incrementPct || facts.incrementAmount) {
      out.hike = { id: uid(), name: `${name} (hike${oldCo ? ` at ${companyName(oldCo)}` : ''})`, kind: 'appraisal', fields: {}, facts, employer: oldCo ? companyName(oldCo) : undefined, docDate: from?.date, text: raw };
      if (!offerish) return out;
    }
  }

  // --- The job you have: "joined June 2024", "current CTC 12 LPA at Acme", "current company Infosys" ---
  const joined = dateAfter(t, /\bjoined(?:\s+\S+(?=\s+(?:on|in)\b))?\s*(?:on|in)?/i)?.date;
  const nowPay = readPay(t, joined, true).fields;
  const nowOnly = !offerish && joined ? readPay(sentences.filter((s) => !HIKE_WORD.test(s)).join(' '), joined).fields : {};
  const currentFields = { ...nowOnly, ...nowPay };
  // Only a CTC for the job you have: it's your pay now. With a letter it's a hike to date; without, the CTC.
  if (!joined && !nowOnly.basic && nowPay.ctc && Object.keys(nowPay).length === 1) {
    out.current = { id: uid(), name: `${name} (current CTC${oldCo ? ` at ${companyName(oldCo)}` : ''})`, kind: 'appraisal', fields: {}, facts: { revisedCtc: nowPay.ctc, currentCtc: true }, employer: oldCo ? companyName(oldCo) : undefined, text: raw };
  } else if (joined || Object.keys(currentFields).length || (oldCo && !out.exit && !out.hike)) {
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
  }
  if (!offerish) return out;

  // --- Offers: one part of the note per company. Sentences about the job you have stay out. ---
  const aboutNow = (s: string) =>
    ((ABOUT_NOW.test(s) || /\bjoined\b/i.test(s) || (HIKE_WORD.test(s) && !OFFER_WORD.test(s))) && !namesOffer(s) && !/\boffer/i.test(s)) ||
    (!!oldCo && new RegExp(`\\bat\\s+${oldCo}\\b`, 'i').test(s) && !/offer/i.test(s));
  const offerText = (from: number, to: number) => sentencesOf(t.slice(from, to)).filter((s) => !aboutNow(s)).join(' ');
  const parts = offers.length > 1 ? offers.map((m, i) => ({ name: m.name, seg: offerText(i === 0 ? 0 : m.at, offers[i + 1]?.at ?? t.length) })) : [{ name: offers[0]?.name, seg: offerText(0, t.length) }];
  // A last day whose year is a guess can't anchor the joining date: that one is asked about too.
  const anchor = lwdAt?.options ? undefined : lwd;
  const read = parts.map((p, i) => readOffer(p.seg, i === 0 ? t : undefined, p.name, name, anchor, raw));
  const real = read.filter((r) => Object.keys(r.doc.fields).length || r.doc.doj || r.doc.employer);
  // "50% hike over current": the offer's size, from your current CTC when the note gives it.
  const over = OVER_CURRENT.exec(t);
  if (over && real.length && !real[0].doc.fields.ctc) {
    const pct = +(over[1] ?? over[2]) / 100;
    const now = out.current?.facts?.revisedCtc ?? out.current?.fields.ctc;
    if (now) real[0].doc.fields.ctc = Math.round(now * (1 + pct));
    else real[0].doc.facts = { ...real[0].doc.facts, hikeOverCurrent: pct };
  }
  if (real.length) {
    out.offer = real[0].doc;
    out.warnings = real[0].warnings;
    out.alternatives = real.slice(1).map((r) => r.doc);
  }
  return out;
}
