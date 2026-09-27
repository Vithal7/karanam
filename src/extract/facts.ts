/**
 * What kind of document a file is, and the dated facts it carries beyond salary components:
 * hike effective dates, last working days, F&F amounts, buyout caps, bonus clawbacks.
 */
import type { Facts } from '../domain/types';
import { MON_RE, MONTHS, findDate, numbersIn, toLines, validDate, year4 } from './parse';

import type { DocKind } from '../domain/types';
export type { DocKind };

export type { Facts };

const has = (re: RegExp, t: string) => (t.match(new RegExp(re.source, 'gi')) ?? []).length;

/** Scores each kind by its tell-tale phrases; offer letters are the fallback. */
export function classifyDoc(text: string): DocKind {
  const score: Record<DocKind, number> = {
    other: 0,
    taxsheet:
      3 *
      has(
        /tax\s+computation|computation\s+of\s+(income|tax)|income\s+tax\s+(computation|projection|worksheet|calculation|statement)|projected\s+(annual\s+)?(income|salary|gross)|tax\s+on\s+total\s+income|form\s*12\s*bb|chapter\s+vi\s*-?\s*a|tax\s+(already\s+)?(deducted|recovered)\s+(till|so\s+far|to\s+date|up\s*to)|tax\s+worksheet|balance\s+tax\s+(payable|to\s+be\s+deducted)/,
        text,
      ),
    fnf: 3 * has(/full\s*(and|&)\s*final|\bf\s*&\s*f\b|\bfnf\b|final\s+settlement|settlement\s+(statement|slip)/, text),
    payslip: 3 * has(/pay\s*slip|salary\s+slip|payslip|pay\s+period|net\s+pay\b/, text),
    appraisal:
      2 * has(/appraisal|increment|salary\s+revision|revised\s+(annual\s+)?(ctc|compensation|salary|pay|package)|compensation\s+revision|merit\s+increase|annual\s+review|performance\s+review|promot(ed|ion)/, text) +
      has(/\bhike\b|with\s+effect\s+from|w\.?e\.?f/, text),
    resignation:
      3 * has(/accept(ed|ance of)?\s+(of\s+)?your\s+resignation|resignation\s+(letter|email|dated|has\s+been)|i\s+(hereby\s+)?resign|tender(ing)?\s+my\s+resignation|relieving\s+letter|relieved\s+from/, text) +
      2 * has(/last\s+working\s+day|date\s+of\s+relieving|relieving\s+date|\blwd\b|separation/, text),
    offer: 2 * has(/offer\s+(letter|of\s+employment)|pleased\s+to\s+offer|letter\s+of\s+appointment|appointment\s+letter|date\s+of\s+joining|joining\s+date/, text) + has(/welcome|annexure/, text),
  };
  // A new offer usually mentions "relieving letter" only as a joining requirement.
  if (score.offer >= 4) score.resignation = Math.max(0, score.resignation - 3);
  const order: DocKind[] = ['taxsheet', 'fnf', 'payslip', 'resignation', 'appraisal', 'offer'];
  let best: DocKind = 'offer';
  for (const k of order) if (score[k] > score[best] || (score[k] === score[best] && score[k] > 0 && order.indexOf(k) < order.indexOf(best))) best = k;
  return score[best] > 0 ? best : 'offer';
}

/** "April 2026", "Apr'26", "04/2026" -> "2026-04". */
export function findMonthYear(s: string): string | undefined {
  const d = findDate(s);
  if (d) return d.slice(0, 7);
  const m = new RegExp(`${MON_RE}[\\s,'’-]*(\\d{4}|\\d{2})\\b`, 'i').exec(s);
  if (m) {
    const v = validDate(year4(+m[2]), MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, 1);
    if (v) return v.slice(0, 7);
  }
  const n = /\b(0?[1-9]|1[0-2])[/-](\d{4})\b/.exec(s);
  if (n) return `${n[2]}-${n[1].padStart(2, '0')}`;
  return undefined;
}

/** The first date or month-year within a short window after a phrase. */
function dateAfter(text: string, re: RegExp, window = 90): string | undefined {
  const g = new RegExp(re.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + window);
    const d = findDate(tail);
    if (d) return d;
    const my = findMonthYear(tail);
    if (my) return `${my}-01`;
  }
  return undefined;
}

function monthAfter(text: string, re: RegExp, window = 80): string | undefined {
  const g = new RegExp(re.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    const my = findMonthYear(text.slice(m.index + m[0].length, m.index + m[0].length + window));
    if (my) return my;
  }
  return undefined;
}

/** Largest rupee amount within a short window after a phrase (ignores percentages, days and years). */
function moneyAfter(text: string, re: RegExp, window = 80, min = 500): number | undefined {
  const g = new RegExp(re.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    const tail = text
      .slice(m.index + m[0].length, m.index + m[0].length + window)
      .split(/\n/)[0]
      .replace(/\b\d+(\.\d+)?\s*(days?|months?|years?)\b/gi, ' ')
      .replace(new RegExp(`${MON_RE}[\\s,'’-]*(19|20)\\d\\d\\b`, 'gi'), ' ')
      .replace(/(?<![\d,.])(19|20)\d\d(?![\d,])/g, ' ');
    const nums = numbersIn(tail).filter((n) => !n.pct && n.value >= min);
    if (nums.length) return Math.max(...nums.map((n) => n.value));
  }
  return undefined;
}

function numberBefore(text: string, re: RegExp): number | undefined {
  const m = new RegExp(re.source, 'i').exec(text);
  return m ? parseFloat(m[1]) : undefined;
}

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, nine: 9, twelve: 12, eighteen: 18, twenty: 20, 'twenty-four': 24, 'thirty-six': 36 };

export function extractFacts(text: string, kind: DocKind): Facts {
  const t = text.replace(/\r/g, '');
  const flat = toLines(t).join('\n');
  const f: Facts = {};

  if (kind === 'appraisal') {
    f.effectiveFrom = dateAfter(flat, /with\s+effect\s+from|w\.?\s?e\.?\s?f\.?|effective\s+(from|date|as\s+of)|applicable\s+from|effective/);
    f.payoutMonth = monthAfter(
      flat,
      /(paid|reflect(ed)?|credited|disbursed|processed|implemented|payable)\s+(in|with|from|along\s+with|as\s+part\s+of)\s+(the\s+)?(month\s+of\s+|salary\s+(for|of)\s+|payroll\s+(for|of)\s+)?/,
    );
    const pct = /(\d{1,2}(?:\.\d+)?)\s*%\s*(increment|hike|increase|raise|revision)|(increment|hike|increase|raise|revision)\s+(of\s+)?(\d{1,2}(?:\.\d+)?)\s*%/i.exec(flat);
    if (pct) f.incrementPct = parseFloat(pct[1] ?? pct[5]) / 100;
    const fromTo = new RegExp(`from\\s+(?:₹|rs\\.?|inr)?\\s*([\\d,]+(?:\\.\\d+)?\\s*(?:lakhs?|lacs?|l|lpa)?)\\s+to\\s+(?:₹|rs\\.?|inr)?\\s*([\\d,]+(?:\\.\\d+)?\\s*(?:lakhs?|lacs?|l|lpa)?)`, 'i').exec(flat);
    if (fromTo) {
      const a = numbersIn(fromTo[1])[0]?.value;
      const b = numbersIn(fromTo[2])[0]?.value;
      if (a && b && b > a && a >= 100_000) {
        f.oldCtc = a;
        f.revisedCtc = b;
      }
    }
    f.revisedCtc ??= moneyAfter(flat, /(revised|new|enhanced)\s+(annual\s+)?(ctc|cost\s+to\s+(the\s+)?company|compensation|salary|package|total\s+compensation)(\s+(will\s+be|is|of|shall\s+be|stands\s+at|:))?/, 100, 100_000);
    f.incrementAmount = moneyAfter(flat, /(increment|increase|hike|raise)\s+(in\s+your\s+\w+\s+)?(of|amounting\s+to|worth)\s+(?=₹|rs|inr)/, 40, 10_000);
    // "your annual CTC has been revised to Rs. 18,00,000", "total cost to company stands revised at ..."
    f.revisedCtc ??= moneyAfter(
      flat,
      /(ctc|cost\s+to\s+(the\s+)?company|compensation|package|salary|remuneration)(\s*\([^)]*\))?\s+(has\s+been|is|stands|shall\s+be|will\s+be|was)?\s*(revised|increased|enhanced|raised|refixed|re-fixed|fixed)\s+(to|at|as)/,
      60,
      100_000,
    );
    f.oldCtc ??= moneyAfter(flat, /(current|existing|present|previous)\s+(annual\s+)?(ctc|cost\s+to\s+(the\s+)?company|compensation|package)(\s+(of|is|:))?/, 60, 100_000);
  }

  if (kind === 'resignation' || kind === 'fnf') {
    f.lastWorkingDay = dateAfter(
      flat,
      /last\s+working\s+day|last\s+day\s+(of\s+(employment|work|service)|at\s+work)|date\s+of\s+relieving|relieving\s+date|relieved\s+(from\s+(your|the)\s+(duties|services)\s+)?(on|w\.?e\.?f\.?|with\s+effect\s+from)|\blwd\b|date\s+of\s+(exit|leaving|separation)|separation\s+date|exit\s+date/,
      60,
    );
    f.resignationDate = dateAfter(flat, /resignation\s+(dated|submitted\s+on|received\s+on|on|date)|date\s+of\s+resignation|resigned\s+on/, 40);
    f.noticeDays = findNoticeDays(flat);
    f.shortfallDays =
      numberBefore(flat, /(?:shortfall|short\s*fall|unserved|not\s+served|buy\s*-?\s*out|recovery)\D{0,40}?(\d{1,3})\s*days/) ??
      numberBefore(flat, /(\d{1,3})\s*days\s*(?:of\s+)?(?:notice\s+)?(?:shortfall|short\s*fall|unserved|buy\s*-?\s*out|notice\s+recovery)/);
  }

  if (kind === 'fnf') {
    f.leaveDays = numberBefore(flat, /leave\s+encash\w*\D{0,30}?(\d{1,3}(?:\.\d+)?)\s*days/) ?? numberBefore(flat, /(\d{1,3}(?:\.\d+)?)\s*days\D{0,20}leave\s+encash/);
    f.leaveAmount = moneyAfter(flat, /leave\s+encash\w*(\s*\([^)]*\))?/, 60);
    f.noticeRecoveryAmount = moneyAfter(flat, /notice\s+(pay\s+|period\s+)?(recovery|shortfall|buy\s*-?\s*out|deduction)(\s*\([^)]*\))?/, 60);
    f.gratuity = moneyAfter(flat, /gratuity/, 40);
    f.netPayable = moneyAfter(flat, /net\s+(amount\s+)?(payable|pay|settlement|amount)/, 40);
    f.fnfPayMonth = monthAfter(flat, /(will\s+be|shall\s+be|to\s+be|was|is)\s+(paid|credited|processed|released|disbursed)\s+(on|by|in|with|along\s+with)\s+(the\s+)?/, 60);
  }

  if (kind === 'resignation' || kind === 'fnf') {
    f.clawback =
      moneyAfter(flat, /(recover(y|ed)?|repay(ment)?|refund|claw\s*-?\s*back)\s+(of\s+)?(the\s+)?(joining|sign[\s-]*on|relocation|retention)\s+bonus/, 60) ??
      moneyAfter(flat, /(joining|sign[\s-]*on|relocation|retention)\s+bonus\s+(recovery|repayment|refund|claw\s*-?\s*back)/, 40);
    f.penalty = moneyAfter(flat, /(penalty|liquidated\s+damages|bond\s+(amount|recovery)|breach\s+of\s+contract)/, 60);
  }

  if (kind === 'taxsheet') f.tdsToDate = findTdsToDate(flat);

  if (kind === 'offer') {
    f.noticeDays = findNoticeDays(flat);
    const bo = /notice\s*(period\s*)?buy\s*-?\s*out|buy\s*-?\s*out\s+(of\s+)?(your\s+)?notice|reimburse\w*\s+(the\s+)?notice/i.exec(flat);
    if (bo) {
      const around = flat.slice(bo.index, bo.index + 260);
      const cap = moneyAfter(around, /up\s+to|upto|maximum\s+(of)?|max\.?|capped\s+at|not\s+exceeding|limit\s+of|subject\s+to\s+a\s+(maximum|cap)\s+of/, 40);
      f.buyout = cap ? { mode: 'cap', cap } : { mode: 'actuals' };
    }
    const jb = /(joining|sign[\s-]*on)\s+(bonus|amount)/i.exec(flat);
    if (jb) {
      const around = flat.slice(jb.index, jb.index + 400);
      const m = /(within|before\s+(completing|completion\s+of)|less\s+than|prior\s+to\s+(completing|completion\s+of))\s+(\d{1,2}|one|two|three|six|nine|twelve|eighteen|twenty-four)\s*(months?|years?)/i.exec(around);
      if (m) {
        const n = WORDS[m[4].toLowerCase()] ?? parseInt(m[4], 10);
        f.joiningClawbackMonths = /year/i.test(m[5]) ? n * 12 : n;
      }
    }
  }
  // Anything above ₹5 crore is a misread (an ID or a merged table cell), not a settlement amount.
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && !(typeof v === 'number' && v > 50_000_000))) as Facts;
}

const SUFFIX = /\b(private|pvt|limited|ltd|llp|inc|incorporated|corporation|corp|co|company|technologies|technology|tech|solutions|services|systems|software|labs|india|global|consulting|group)\b\.?/gi;

/** "ACME Technologies Pvt. Ltd." and "Acme" both become "acme", for grouping files by company. */
export const companyKey = (name?: string) =>
  (name ?? '')
    .toLowerCase()
    .replace(SUFFIX, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Company from an email address when the letter doesn't name one ("hr@sigma-systems.com"). */
export function companyFromEmail(text: string): string | undefined {
  const m = text.match(/[\w.+-]+@([a-z0-9-]+)\.(?:co\.in|com|in|io|ai|net|org|tech)\b/i);
  if (!m) return undefined;
  const d = m[1].toLowerCase();
  if (/^(gmail|yahoo|outlook|hotmail|live|icloud|proton(mail)?|rediffmail|me)$/.test(d)) return undefined;
  return d.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, six: 6, thirty: 30, sixty: 60, ninety: 90 };

/** "notice period of 90 days", "three months' notice", "60 days notice", "notice period: 2 months". */
export function findNoticeDays(text: string): number | undefined {
  const n = '(\\d{1,3}|one|two|three|four|six|thirty|sixty|ninety)';
  const res = [
    new RegExp(`notice\\s+period\\s*(of|is|:|shall\\s+be|will\\s+be)?\\s*${n}\\s*(\\(\\w+\\)\\s*)?(calendar\\s+)?(days?|months?)`, 'i'),
    new RegExp(`${n}\\s*(\\(\\w+\\)\\s*)?(calendar\\s+)?(days?|months?)[’'\`s]*\\s+(written\\s+)?(prior\\s+)?notice`, 'i'),
    new RegExp(`notice\\s+of\\s+${n}\\s*(\\(\\w+\\)\\s*)?(calendar\\s+)?(days?|months?)`, 'i'),
  ];
  for (const re of res) {
    const m = re.exec(text);
    if (!m) continue;
    const num = m.slice(1).find((x) => x && /^(\d{1,3}|one|two|three|four|six|thirty|sixty|ninety)$/i.test(x))!;
    const unit = m.slice(1).find((x) => x && /^(days?|months?)$/i.test(x))!;
    const v = NUM_WORDS[num.toLowerCase()] ?? parseInt(num, 10);
    const days = /month/i.test(unit) ? v * 30 : v;
    if (days > 0 && days <= 180) return days;
  }
  return undefined;
}

/** Tax already deducted this year on a tax computation sheet, however the sheet phrases it. */
export function findTdsToDate(text: string): number | undefined {
  const direct = moneyAfter(
    text,
    /(income\s+tax|tax|tds)\s+(already\s+)?(deducted|paid|recovered|collected)\s*(till|to|up\s*to|so\s*far|until|upto|in\s+previous\s+months|till\s+last\s+month)?\s*(date|now)?\s*(\(ytd\))?\s*(:|-)?/,
    60,
    100,
  );
  if (direct !== undefined) return direct;
  // Table rows: a line naming tax/TDS as deducted/recovered/paid; the rightmost figure is the total.
  for (const line of text.split('\n')) {
    if (!/\b(tax|tds)\b/i.test(line) || !/(deducted|recovered|paid|ytd|till\s+date|to\s+date)/i.test(line)) continue;
    if (/payable|balance|remaining|per\s+month|projected|to\s+be\s+deducted|net\s+tax/i.test(line)) continue;
    const nums = numbersIn(line).filter((x) => !x.pct);
    if (nums.length) return nums[nums.length - 1].value;
  }
  return undefined;
}
