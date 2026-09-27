/**
 * Heuristic, fully offline extraction of salary components from offer-letter / payslip text.
 * It never has to be perfect: the user reviews every field before anything is calculated.
 */

export type Confidence = 'found' | 'guessed';

export type ComponentKey =
  | 'basic'
  | 'hra'
  | 'special'
  | 'lta'
  | 'conveyance'
  | 'otherAllowance'
  | 'employerPf'
  | 'employeePf'
  | 'gratuity'
  | 'nps'
  | 'insurance'
  | 'joining'
  | 'retention'
  | 'variable'
  | 'pt'
  | 'tds'
  | 'ctc';

export interface Found {
  key: ComponentKey;
  label: string;
  /** Monthly value for recurring components, the full amount for one-offs and CTC. */
  monthly: number;
  annual: number;
  confidence: Confidence;
  /** e.g. "10% of CTC" for variable pay or NPS given as a percent. */
  pct?: number;
  /** For one-offs: "paid with the third month's salary" -> 2 months after joining. */
  monthOffset?: number;
}

export interface Extracted {
  kind: 'offer' | 'payslip';
  components: Partial<Record<ComponentKey, Found>>;
  doj?: { date: string; confidence: Confidence };
  employer?: string;
  /** Letter date, or the first day of the payslip's month (YYYY-MM-DD). */
  docDate?: string;
  /** Year-to-date income tax on a payslip. */
  ytdTds?: number;
  warnings: string[];
}

/** Recurring components are monthly; these are one-off or annual by nature. */
const ANNUAL_ONLY: ComponentKey[] = ['joining', 'retention', 'variable', 'ctc', 'gratuity', 'insurance'];

// Order matters: the first match wins, so more specific patterns come first.
const LABELS: [ComponentKey, RegExp][] = [
  ['ctc', /\bctc\b|cost\s+to\s+(the\s+)?company|total\s+(annual\s+)?(compensation|remuneration|package)|annual\s+(compensation|package|remuneration)|gross\s+annual\s+compensation/i],
  ['joining', /joining\s+(bonus|amount)|sign(ing)?[\s-]*on\s+bonus|signing\s+bonus|one[\s-]*time\s+(joining|bonus)|relocation\s+(bonus|allowance)/i],
  ['retention', /retention\s+bonus/i],
  ['variable', /variable|performance\s+(linked|bonus|pay|incentive)|\bpli\b|\bstip\b|target\s+bonus|annual\s+(bonus|incentive)|incentive/i],
  ['employeePf', /employee'?s?\s+(contribution\s+(to|towards)\s+)?(pf|provident|epf)|(pf|epf|provident\s+fund)\s*[-(]?\s*employee/i],
  ['employerPf', /employer'?s?\s+(contribution\s+(to|towards)\s+)?(pf|provident|epf)|(pf|epf|provident\s+fund)\s*[-(]?\s*employer|provident\s+fund|\bepf\b|\bpf\b/i],
  ['nps', /\bnps\b|national\s+pension/i],
  ['gratuity', /gratuity/i],
  ['insurance', /insurance|mediclaim|medical\s+cover|group\s+(health|term)/i],
  ['pt', /professional\s+tax|prof\.?\s*tax|\bp\.?\s*tax\b/i],
  ['tds', /income\s+tax|\btds\b/i],
  ['basic', /\bbasic\b/i],
  ['hra', /\bhra\b|house\s+rent/i],
  ['lta', /\blta\b|leave\s+travel/i],
  ['conveyance', /conveyance|transport\s+allowance/i],
  ['special', /special|flexi(ble)?\s+(benefit|allowance|pay)|\bflexi\b|misc(ellaneous)?\.?\s+allowance|personal\s+allowance|supplementary\s+allowance|balance\s+allowance|cash\s+allowance/i],
  ['otherAllowance', /other\s+allowance|allowance/i],
];

const NICE: Record<ComponentKey, string> = {
  basic: 'Basic',
  hra: 'HRA',
  special: 'Special allowance',
  lta: 'LTA',
  conveyance: 'Conveyance',
  otherAllowance: 'Other allowance',
  employerPf: 'Employer PF',
  employeePf: 'Employee PF',
  gratuity: 'Gratuity',
  nps: 'Employer NPS',
  insurance: 'Insurance',
  joining: 'Joining bonus',
  retention: 'Retention bonus',
  variable: 'Variable pay',
  pt: 'Professional tax',
  tds: 'Income tax (TDS)',
  ctc: 'CTC',
};

export const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const DATE_PATTERNS: RegExp[] = [
  /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, // ISO
  /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/, // dd/mm/yyyy
  new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]*(?:of\\s+)?${MON_RE}[,.\\s-]*(\\d{2,4})\\b`, 'i'), // 12th Nov 2026
  new RegExp(`\\b${MON_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i'), // November 12, 2026
];

const pad = (n: number) => String(n).padStart(2, '0');
export const year4 = (y: number) => (y < 100 ? 2000 + y : y);

export function validDate(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** First date found in a string, as YYYY-MM-DD. Indian dd/mm order is assumed. */
export function findDate(s: string): string | undefined {
  let best: { idx: number; date: string } | undefined;
  DATE_PATTERNS.forEach((re, i) => {
    const m = re.exec(s);
    if (!m) return;
    let date: string | undefined;
    if (i === 0) date = validDate(+m[1], +m[2], +m[3]);
    else if (i === 1) date = validDate(year4(+m[3]), +m[2], +m[1]);
    else if (i === 2) date = validDate(year4(+m[3]), MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]);
    else date = validDate(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
    if (date && (!best || m.index < best.idx)) best = { idx: m.index, date };
  });
  return best?.date;
}

function stripDates(s: string) {
  let out = s;
  for (const re of DATE_PATTERNS) out = out.replace(new RegExp(re.source, 'gi'), ' ');
  return out;
}

export interface Num {
  value: number;
  pct: boolean;
}

/** Money-like numbers on a line: handles 1,23,456.00, ₹, Rs., INR, lakh/L/LPA, crore, k. */
export function numbersIn(line: string): Num[] {
  const s = stripDates(line);
  const re = /(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d+)?\s*(%|lakhs?|lacs?|lpa|l\b|crores?|cr\b|k\b)?/gi;
  const out: Num[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let v = parseFloat(m[1].replace(/,/g, '') + (m[2] || ''));
    const unit = (m[3] || '').toLowerCase();
    if (unit === '%') {
      out.push({ value: v / 100, pct: true });
      continue;
    }
    if (unit.startsWith('l')) v *= 100_000;
    else if (unit.startsWith('cr')) v *= 10_000_000;
    else if (unit === 'k') v *= 1_000;
    if (v < 100) continue; // serial numbers, days, clause numbers
    out.push({ value: v, pct: false });
  }
  return out;
}

const MONTHLY_HINT = /per\s+month|p\.?\s*m\.?\b|monthly|\/\s*month|\bpm\b/i;
const ANNUAL_HINT = /per\s+annum|p\.?\s*a\.?\b|annual(ly)?|yearly|\/\s*(year|annum)|\bpa\b|\blpa\b/i;

/** Normalised text lines. */
export const toLines = (text: string) =>
  text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean);

function detectColumns(lines: string[]): 'monthly-first' | 'annual-first' | undefined {
  for (const l of lines) {
    const mi = l.search(/monthly|per\s+month|p\.?m\.?\b/i);
    const ai = l.search(/annual|yearly|per\s+annum|p\.?a\.?\b/i);
    if (mi >= 0 && ai >= 0 && l.length < 120) return mi < ai ? 'monthly-first' : 'annual-first';
  }
  return undefined;
}

interface Segment {
  key: ComponentKey;
  text: string;
}

const isTotalText = (t: string) => /\btotal\b|\bgross\b|\bnet\s+(pay|salary|take)/i.test(t);

/**
 * Splits a line into labelled segments. Several components can share a line ("Basic 82,080
 * Provident Fund 1,800", or prose), so a new segment starts at a label only when a number sits
 * between it and the previous label; otherwise labels merge ("House Rent Allowance").
 */
export function segments(line: string): Segment[] {
  const hits: { key: ComponentKey; prio: number; start: number; end: number }[] = [];
  LABELS.forEach(([key, re], prio) => {
    const g = new RegExp(re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = g.exec(line))) {
      hits.push({ key, prio, start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) g.lastIndex++;
    }
  });
  hits.sort((a, b) => a.start - b.start || a.prio - b.prio);
  const groups: { key: ComponentKey; prio: number; start: number; end: number }[] = [];
  for (const h of hits) {
    const cur = groups[groups.length - 1];
    if (cur && (h.start < cur.end || numbersIn(line.slice(cur.end, h.start)).length === 0)) {
      if (h.prio < cur.prio) {
        cur.key = h.key;
        cur.prio = h.prio;
      }
      cur.end = Math.max(cur.end, h.end);
      continue;
    }
    groups.push({ ...h });
  }
  return groups.map((g, i) => {
    let key = g.key;
    const text = line.slice(g.start, groups[i + 1]?.start ?? line.length);
    if (key === 'employerPf' && /employee/i.test(text) && !/employer/i.test(text)) key = 'employeePf';
    return { key, text };
  });
}

const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, twelfth: 12 };

/** "with the third month's salary" / "after 6 months" -> months after joining. */
export function monthOffsetIn(s: string): number | undefined {
  const m = s.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|twelfth|\d{1,2})(?:st|nd|rd|th)?\s+month/i);
  if (m) {
    const n = ORD[m[1].toLowerCase()] ?? parseInt(m[1], 10);
    return /after|completion/i.test(s) ? n : n - 1;
  }
  return undefined;
}

export function parseText(text: string): Extracted {
  const lines = toLines(text);
  const warnings: string[] = [];
  const kind: Extracted['kind'] = /pay\s*slip|salary\s+slip|payslip|net\s+pay|earnings\s+.*deductions/i.test(text)
    ? 'payslip'
    : 'offer';
  const cols = detectColumns(lines);
  const components: Extracted['components'] = {};

  // Pass 1: CTC, so single-number rows can be sized against it.
  let ctc: number | undefined;
  for (let i = 0; i < lines.length; i++) {
    for (const seg of segments(lines[i])) {
      if (seg.key !== 'ctc') continue;
      const nums = numbersIn(seg.text).filter((n) => !n.pct);
      const pool = nums.length ? nums : segments(lines[i + 1] || '').length ? [] : numbersIn(lines[i + 1] || '').filter((n) => !n.pct);
      if (!pool.length) continue;
      const v = Math.max(...pool.map((n) => n.value));
      if (v >= 100_000 && (!ctc || v > ctc)) ctc = v;
    }
  }
  if (ctc) components.ctc = { key: 'ctc', label: NICE.ctc, monthly: ctc / 12, annual: ctc, confidence: 'found' };

  for (let i = 0; i < lines.length; i++) for (const seg of segments(lines[i])) {
    const { key, text: line } = seg;
    if (key === 'ctc' || components[key]) continue;
    if (isTotalText(line)) continue;
    let nums = numbersIn(line);
    // Tables sometimes break the label and its figures onto separate lines.
    if (!nums.length && lines[i + 1] && !segments(lines[i + 1]).length) nums = numbersIn(lines[i + 1]);
    if (!nums.length) continue;
    const pct = nums.find((n) => n.pct)?.value;
    const money = nums.filter((n) => !n.pct).map((n) => n.value);
    let monthly: number | undefined;
    let annual: number | undefined;
    let confidence: Confidence = 'guessed';

    if (money.length >= 2) {
      // Find a monthly/annual pair (x and ~12x).
      outer: for (const a of money)
        for (const b of money)
          if (a !== b && Math.abs(b / a - 12) < 0.25) {
            monthly = a;
            annual = b;
            confidence = 'found';
            break outer;
          }
      if (monthly === undefined) {
        if (cols === 'monthly-first') [monthly, annual] = [money[0], money[0] * 12];
        else if (cols === 'annual-first') [monthly, annual] = [money[0] / 12, money[0]];
        else [monthly, annual] = [money[0], money[0] * 12];
      }
    } else if (money.length === 1) {
      const v = money[0];
      if (ANNUAL_ONLY.includes(key)) {
        annual = v;
        monthly = v / 12;
        confidence = 'found';
      } else if (MONTHLY_HINT.test(line) && !ANNUAL_HINT.test(line)) {
        monthly = v;
        confidence = 'found';
      } else if (ANNUAL_HINT.test(line) && !MONTHLY_HINT.test(line)) {
        monthly = v / 12;
        confidence = 'found';
      } else if (kind === 'payslip') {
        monthly = v;
        confidence = 'found';
      } else if (ctc) {
        // Any single recurring component above ~8% of CTC is an annual figure.
        monthly = v >= ctc * 0.08 ? v / 12 : v;
      } else if (cols) {
        monthly = cols === 'annual-first' ? v / 12 : v;
      } else {
        monthly = v > 150_000 ? v / 12 : v;
      }
      annual = annual ?? monthly * 12;
    } else if (pct !== undefined && (key === 'variable' || key === 'nps')) {
      // "Variable pay: 10% of CTC", "NPS: 10% of basic" - resolved later.
      components[key] = { key, label: NICE[key], monthly: 0, annual: 0, confidence: 'guessed', pct };
      continue;
    } else continue;

    components[key] = { key, label: NICE[key], monthly: monthly!, annual: annual!, confidence, pct, monthOffset: monthOffsetIn(lines[i]) };
  }

  // Percent-only rows.
  const v = components.variable;
  if (v && !v.annual && v.pct && ctc) {
    v.annual = ctc * v.pct;
    v.monthly = v.annual / 12;
  }

  // Date of joining.
  let doj: Extracted['doj'];
  const dojRe = /date\s+of\s+joining|joining\s+date|\bdoj\b|join(ing)?\s+(us\s+)?(on|by|from)|report(ing)?\s+(to\s+.{0,40}?)?(on|by)|commence(ment)?|start(ing)?\s+date|effective\s+(date|from)|expected\s+to\s+join/i;
  for (let i = 0; i < lines.length && !doj; i++) {
    if (!dojRe.test(lines[i])) continue;
    const d = findDate(lines[i].slice(lines[i].search(dojRe))) ?? findDate(lines[i + 1] || '');
    if (d) doj = { date: d, confidence: 'found' };
  }

  // Employer name: "<Name> Private Limited / Pvt Ltd / Limited / LLP / Inc".
  // A company name is a run of capitalised words ending in a legal suffix ("Sigma Systems Pvt Ltd").
  const NAME = "((?:[A-Z0-9][\\w&.'’-]*[ \\t]+){1,6}?)";
  const em =
    new RegExp(`${NAME}(Private[ \\t]+Limited|Pvt\\.?[ \\t]*Ltd\\.?|Limited|Ltd\\.?|LLP|Inc\\.?)`).exec(text) ??
    new RegExp(`${NAME}(Technologies|Solutions|Systems|Services|Labs|Software)\\b`).exec(text);
  const employer = em ? `${em[1]}${em[2]}`.trim().replace(/^(for|from|at|with|of|by|to|dear)\s+/i, '') : undefined;

  // Sanity check against CTC.
  if (ctc) {
    const keys: ComponentKey[] = ['basic', 'hra', 'special', 'lta', 'conveyance', 'otherAllowance', 'employerPf', 'gratuity', 'nps', 'insurance', 'variable'];
    const sum = keys.reduce((a, k) => a + (components[k]?.annual || 0), 0);
    if (sum > 0 && Math.abs(sum - ctc) / ctc > 0.1)
      warnings.push(
        `Components add up to ₹${Math.round(sum).toLocaleString('en-IN')} but the letter's CTC is ₹${Math.round(ctc).toLocaleString('en-IN')}. Please double-check the figures.`,
      );
  }
  if (!components.basic) warnings.push('Could not find Basic salary. Please enter it.');
  if (kind === 'offer' && !doj) warnings.push('Could not find the date of joining. Please enter it.');

  return { kind, components, doj, employer, docDate: findDocDate(lines, kind), ytdTds: findYtdTds(lines, text), warnings };
}

/** The payslip month ("Payslip for the month of August 2026", "Pay period: Aug-2026") or the letter's date. */
export function findDocDate(lines: string[], kind: Extracted['kind']): string | undefined {
  const monthYear = new RegExp(`${MON_RE}[\\s,'-]*(\\d{4}|\\d{2})\\b`, 'i');
  if (kind === 'payslip') {
    for (const l of lines.slice(0, 15)) {
      if (!/pay\s*slip|salary\s+slip|month|pay\s+period/i.test(l)) continue;
      const m = monthYear.exec(l);
      if (m) {
        const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
        const d = validDate(year4(+m[2]), mo, 1);
        if (d) return d;
      }
    }
  }
  for (const l of lines.slice(0, 12)) {
    if (/^\s*(date|dated)\b|^\s*(effective|with\s+effect)/i.test(l)) {
      const d = findDate(l);
      if (d) return d;
    }
  }
  // Letters usually carry their date near the top.
  for (const l of lines.slice(0, 6)) {
    if (/join|report|effective/i.test(l)) continue;
    const d = findDate(l);
    if (d) return d;
  }
  return undefined;
}

/** Year-to-date TDS from a payslip row like "Income Tax  18,019  1,72,170" under a YTD column. */
export function findYtdTds(lines: string[], text: string): number | undefined {
  if (!/\bytd\b|year\s*to\s*date|cumulative/i.test(text)) return undefined;
  for (const l of lines)
    for (const seg of segments(l)) {
      if (seg.key !== 'tds') continue;
      // Count every figure (a current-month TDS of 0 still fills a column).
      const tokens = (seg.text.match(/\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? []).map((x) => parseFloat(x.replace(/,/g, '')));
      if (tokens.length >= 2) return Math.max(...tokens);
    }
  return undefined;
}
