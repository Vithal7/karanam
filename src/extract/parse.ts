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
  | 'arrears'
  | 'perquisite'
  | 'vpf'
  | 'leaveEnc'
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
  /** Every fixed allowance row beyond Basic, HRA and the first special allowance, by its own name. */
  allowances: { label: string; monthly: number }[];
  doj?: { date: string; confidence: Confidence };
  employer?: string;
  /** Letter date, or the first day of the payslip's month (YYYY-MM-DD). */
  docDate?: string;
  /** Year-to-date income tax on a payslip. */
  ytdTds?: number;
  warnings: string[];
}

/** Recurring components are monthly; these are one-off or annual by nature. */
const ANNUAL_ONLY: ComponentKey[] = ['joining', 'retention', 'variable', 'ctc', 'gratuity', 'insurance', 'arrears', 'perquisite', 'leaveEnc'];
/** Paid once, not every month: on a payslip the figure is this month's amount (the next column is year-to-date). */
const ONE_OFF: ComponentKey[] = ['joining', 'retention', 'variable', 'arrears', 'perquisite', 'leaveEnc'];

// Order matters: the first match wins, so more specific patterns come first.
const LABELS: [ComponentKey, RegExp][] = [
  ['ctc', /\bt?ctc\b|cost\s+to\s+(the\s+)?company|total\s+(annual\s+|target\s+|fixed\s+and\s+variable\s+)?(compensation|remuneration|package|rewards?|emoluments)|annual\s+(compensation|package|remuneration|emoluments)|gross\s+annual\s+compensation|target\s+compensation|annual\s+salary\s+package|\b(compensation|package)\s*[:\-](?=\s*(?:₹|rs\.?|inr)?\s*\d)/i],
  ['arrears', /\barrears?\b/i],
  ['perquisite', /perquisite|\bperqs?\b|\besops?\b|\bespp\b|\brsus?\b|stock\s+(option|award)s?\s+(perq|benefit|income)/i],
  ['vpf', /\bvpf\b|voluntary\s+(provident\s+fund|pf)/i],
  ['leaveEnc', /leave\s+encash(ment)?|encashment\s+of\s+leave|\bel\s+encash/i],
  ['joining', /joining\s+(bonus|amount)|sign(ing)?[\s-]*on\s+bonus|signing\s+bonus|one[\s-]*time\s+(joining|bonus)|relocation\s+(bonus|allowance)/i],
  ['retention', /retention\s+bonus/i],
  ['variable', /variable|performance\s+(linked|bonus|pay|incentive)|\bpli\b|\bstip\b|target\s+bonus|annual\s+(bonus|incentive)|incentive|(?<!statutory\s)\bbonus\b/i],
  ['employeePf', /employee'?s?\s+(contribution\s+(to|towards)\s+)?(pf|provident|epf)|(pf|epf|provident\s+fund)\s*[-(]?\s*employee/i],
  ['employerPf', /employer'?s?\s+(contribution\s+(to|towards)\s+)?(pf|provident|epf)|(pf|epf|provident\s+fund)\s*[-(]?\s*employer|provident\s+fund|\bepf\b|\bpf\b/i],
  ['nps', /\bnps\b|national\s+pension/i],
  ['gratuity', /gratuity/i],
  ['insurance', /insurance|mediclaim|medical\s+cover|group\s+(health|term)/i],
  ['pt', /professional\s+tax|prof\.?\s*tax|\bp\.?\s*tax\b/i],
  ['tds', /income\s+tax|\btds\b/i],
  ['basic', /\bbasic\b|\bbase\s+(salary|pay)\b/i],
  ['hra', /\bhra\b|house\s+rent/i],
  ['lta', /\blta\b|leave\s+travel/i],
  ['conveyance', /conveyance|transport\s+allowance/i],
  ['special', /special\s+(allowance|pay)|\bspecial\b|flexi(ble)?\s+(benefit|allowance|pay|component)|\bflexi\b|misc(ellaneous)?\.?\s*(allowance|allow|allw|alw)\.?|\bmisc(ellaneous)?\b|fixed\s+allowance|personal\s+allowance|supplementary\s+allowance|balance\s+allowance|cash\s+allowance|ad[\s-]?hoc\s+allowance|management\s+allowance|consolidated\s+allowance/i],
  ['otherAllowance', /statutory\s+bonus|dearness\s+allowance|\bd\.?a\.?\b(?=\s*[:\d₹r])|other\s+allowance|allowance|\ballow\b\.?|\ballw\.?\b|\balw\.?\b|\ballce\b/i],
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
  arrears: 'Arrears',
  perquisite: 'Perquisite (ESOP/RSU)',
  vpf: 'Voluntary PF',
  leaveEnc: 'Leave encashment',
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
    const digits = m[1].replace(/,/g, '');
    // Account numbers, phone numbers, PAN/UAN digits: long digit runs are never salary.
    if (digits.length > 9 || (!m[1].includes(',') && digits.length > 8)) continue;
    let v = parseFloat(digits + (m[2] || ''));
    const unit = (m[3] || '').toLowerCase();
    if (unit === '%') {
      out.push({ value: v / 100, pct: true });
      continue;
    }
    if (unit.startsWith('l')) v *= 100_000;
    else if (unit.startsWith('cr')) v *= 10_000_000;
    else if (unit === 'k') v *= 1_000;
    if (v < 100) continue; // serial numbers, days, clause numbers
    if (v > 500_000_000) continue; // above ₹50 crore: not a salary figure
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

type Columns = 'monthly-first' | 'annual-first' | 'annual-only' | 'monthly-only';

/**
 * How the salary table's figures are laid out: both columns (in which order), or a single annual
 * or monthly column ("Component | Amount (INR p.a.)", "Salary structure (per month)").
 */
function detectColumns(lines: string[]): Columns | undefined {
  for (const l of lines) {
    if (/[.!?]$/.test(l)) continue;
    const mi = l.search(/\bmonthly\b|per\s+month|(?<![a-z])p\.?m\.?(?![a-z])/i);
    const ai = l.search(/\bannual(ly)?\b|\byearly\b|per\s+annum|(?<![a-z])p\.?a\.?(?![a-z])/i);
    if (mi >= 0 && ai >= 0 && l.length < 120) return mi < ai ? 'monthly-first' : 'annual-first';
  }
  // A table header with one period and no figures of its own, right above the salary rows. A
  // sentence ("Your salary will be reviewed annually.") is not a header.
  for (const [i, l] of lines.entries()) {
    if (l.length > 80 || numbersIn(l).length || /[.!?]$/.test(l) || l.split(' ').length > 9) continue;
    if (!/component|particular|salary|compensation|structure|break\s*-?up|amount|earnings|ctc|\(inr|\(rs|₹/i.test(l)) continue;
    const rowsBelow = lines.slice(i + 1, i + 3).some((x) => segments(x).length > 0 && numbersIn(x).filter((n) => !n.pct).length === 1);
    if (!rowsBelow) continue;
    const m = /\bmonthly\b|per\s+month|(?<![a-z])p\.?\s*m\.?(?![a-z])|\/\s*month/i.test(l);
    const a = /\bannual(ly)?\b|\byearly\b|per\s+annum|(?<![a-z])p\.?\s*a\.?(?![a-z])|\/\s*(year|annum)/i.test(l);
    if (m !== a) return a ? 'annual-only' : 'monthly-only';
  }
  return undefined;
}

/** Figures that are always small each month: a larger one is the year's total. */
const MONTHLY_CAP: Partial<Record<ComponentKey, number>> = { pt: 2_500, employerPf: 30_000, employeePf: 30_000, vpf: 200_000 };

interface Segment {
  key: ComponentKey;
  text: string;
}

const isTotalText = (t: string) => /\btotal\b|\bgross\b|\bnet\s+(pay|salary|take)/i.test(t.replace(/\([^)]*\)/g, ' '));

/**
 * Splits a line into labelled segments. Several components can share a line ("Basic 82,080
 * Provident Fund 1,800", or prose), so a new segment starts at a label only when a number sits
 * between it and the previous label; otherwise labels merge ("House Rent Allowance").
 */
export function segments(raw: string): Segment[] {
  // "Variable pay(IN Total CTC)": a bracketed note never names the row. Blank it out, keeping positions.
  const line = raw.replace(/\([^)]*\)/g, (m) => ' '.repeat(m.length));
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
    const text = raw.slice(g.start, groups[i + 1]?.start ?? raw.length);
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
      // In a per-month table the CTC row is the month's cost, unless that row says it's annual.
      const v = Math.max(...pool.map((n) => n.value)) * (cols === 'monthly-only' && !ANNUAL_HINT.test(lines[i]) ? 12 : 1);
      if (v >= 100_000 && (!ctc || v > ctc)) ctc = v;
    }
  }
  // No CTC label: an annexure's bottom line ("Total", "Grand Total", "Total (A+B+C)") usually is it.
  if (!ctc && kind === 'offer') {
    for (const l of lines) {
      if (!/^\s*(grand\s+)?total\s*(\([^)]*\))?\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*\d/i.test(l)) continue;
      const raw = Math.max(0, ...numbersIn(l).filter((n) => !n.pct).map((n) => n.value));
      const v = cols === 'monthly-only' ? raw * 12 : raw;
      if (v >= 100_000 && (!ctc || v > ctc)) ctc = v;
    }
  }
  if (ctc) components.ctc = { key: 'ctc', label: NICE.ctc, monthly: ctc / 12, annual: ctc, confidence: 'found' };

  const allowances: { label: string; monthly: number }[] = [];
  const ALLOWANCE_KEYS: ComponentKey[] = ['special', 'otherAllowance', 'lta', 'conveyance'];
  for (let i = 0; i < lines.length; i++) for (const [si, seg] of segments(lines[i]).entries()) {
    const { key, text: line } = seg;
    // The row's own name starts at the line start for the first label ("Acme Allowance").
    const rowName = rowLabel(si === 0 ? lines[i] : line);
    // Several allowance rows are common ("Miscellaneous", "Dearness", "Acme Allowance"): keep them all.
    if (key === 'ctc' || (components[key] && !ALLOWANCE_KEYS.includes(key))) continue;
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

    if (kind === 'payslip' && ONE_OFF.includes(key) && money.length) {
      // Payslip columns are this month and year-to-date: the first figure was paid this month.
      monthly = annual = money[0];
      confidence = 'found';
    } else if (money.length >= 2) {
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
      if (ANNUAL_ONLY.includes(key) && !(cols === 'monthly-only' && (key === 'gratuity' || key === 'insurance'))) {
        annual = v;
        monthly = v / 12;
        confidence = 'found';
      } else if (cols === 'annual-only' || cols === 'monthly-only') {
        monthly = cols === 'annual-only' ? v / 12 : v;
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
    } else if (pct !== undefined && (key === 'variable' || key === 'nps' || key === 'basic' || key === 'hra')) {
      // "Variable pay: 10% of CTC", "NPS: 10% of basic" - resolved later.
      components[key] = { key, label: NICE[key], monthly: 0, annual: 0, confidence: 'guessed', pct };
      continue;
    } else continue;

    if (ALLOWANCE_KEYS.includes(key)) {
      // Allowances come from salary tables, not sentences ("reimbursement up to Rs. 100 per month").
      if (!looksLikeTableRow(rowName, money)) continue;
      const label = rowName || NICE[key];
      if (components[key] || (key !== 'special' && key !== 'lta' && key !== 'conveyance')) {
        if (!allowances.some((a) => a.label.toLowerCase() === label.toLowerCase())) allowances.push({ label, monthly: monthly! });
        if (components[key]) continue;
        if (key === 'otherAllowance') continue;
      }
      components[key] = { key, label: key === 'special' ? label : NICE[key], monthly: monthly!, annual: annual!, confidence, pct };
      continue;
    }
    components[key] = { key, label: NICE[key], monthly: monthly!, annual: annual!, confidence, pct, monthOffset: monthOffsetIn(lines[i]) };
  }

  // A PF or PT figure too big for a month is the year's amount (an annual-only table we couldn't tell).
  for (const [k, cap] of Object.entries(MONTHLY_CAP) as [ComponentKey, number][]) {
    const c = components[k];
    if (c && c.monthly > cap && c.confidence === 'guessed') {
      c.monthly = c.monthly / 12;
      c.annual = c.monthly * 12;
    }
  }
  const b = components.basic;
  for (const k of ['employerPf', 'employeePf'] as const) {
    const c = components[k];
    if (c && b && c.monthly > 0.125 * b.monthly && c.monthly / 12 <= 0.125 * b.monthly) {
      c.monthly = c.monthly / 12;
      c.annual = c.monthly * 12;
    }
  }
  // A CTC smaller than a year's basic is a monthly total.
  if (components.ctc && b && components.ctc.annual < b.monthly * 12 && components.ctc.annual * 12 >= b.monthly * 12) {
    components.ctc = { ...components.ctc, annual: components.ctc.annual * 12, monthly: components.ctc.annual };
    ctc = components.ctc.annual;
  }

  // Percent-only rows: basic as a share of CTC, HRA as a share of basic.
  const bp = components.basic;
  if (bp && !bp.annual && bp.pct && ctc) {
    bp.annual = ctc * bp.pct;
    bp.monthly = bp.annual / 12;
  }
  const hp = components.hra;
  if (hp && !hp.annual && hp.pct && components.basic?.monthly) {
    hp.monthly = components.basic.monthly * hp.pct;
    hp.annual = hp.monthly * 12;
  }
  for (const k of ['basic', 'hra'] as const) if (components[k] && !components[k]!.annual) delete components[k];
  const v = components.variable;
  if (v && !v.annual && v.pct && ctc) {
    v.annual = ctc * v.pct;
    v.monthly = v.annual / 12;
  }

  // Date of joining.
  let doj: Extracted['doj'];
  const dojRe =
    /date\s+of\s+(joining|appointment|commencement)|joining\s+date|\bdoj\b|join(ing|ed)?\s+(us|the\s+company|the\s+services\s+of[^.]{0,50}?)?\s*(on|by|from|w\.?e\.?f\.?|with\s+effect\s+from)|you\s+will\s+join|report(ing)?\s+(to\s+.{0,40}?)?(on|by)|commence(ment)?|start(ing)?\s+date|effective\s+(date|from)|expected\s+to\s+join|appoint(ed|ment)[^.\n]{0,80}?(w\.?e\.?f\.?|with\s+effect\s+from|effective)|with\s+effect\s+from/i;
  for (let i = 0; i < lines.length && !doj; i++) {
    if (!dojRe.test(lines[i])) continue;
    const d = findDate(lines[i].slice(lines[i].search(dojRe))) ?? findDate(lines[i + 1] || '');
    if (d) doj = { date: d, confidence: 'found' };
  }

  // Employer name: "<Name> Private Limited / Pvt Ltd / Limited / LLP / Inc".
  const employer = findEmployer(text);

  // Sanity check against CTC.
  if (ctc) {
    const keys: ComponentKey[] = ['basic', 'hra', 'special', 'lta', 'conveyance', 'otherAllowance', 'employerPf', 'gratuity', 'nps', 'insurance', 'variable'];
    const sum = keys.reduce((a, k) => a + (components[k]?.annual || 0), 0) + allowances.reduce((a, x) => a + x.monthly * 12, 0);
    if (sum > 0 && Math.abs(sum - ctc) / ctc > 0.1)
      warnings.push(
        `Components add up to ₹${Math.round(sum).toLocaleString('en-IN')} but the letter's CTC is ₹${Math.round(ctc).toLocaleString('en-IN')}. Please double-check the figures.`,
      );
  }
  // Still no CTC: work it out from the breakup (fixed pay, employer PF, gratuity, insurance, variable).
  if (!ctc && kind === 'offer' && components.basic) {
    const keys: ComponentKey[] = ['basic', 'hra', 'special', 'lta', 'conveyance', 'otherAllowance', 'employerPf', 'gratuity', 'nps', 'insurance', 'variable'];
    const sum = keys.reduce((a, k) => a + (components[k]?.annual || 0), 0) + allowances.reduce((a, x) => a + x.monthly * 12, 0);
    if (sum >= 100_000) {
      components.ctc = { key: 'ctc', label: NICE.ctc, monthly: sum / 12, annual: Math.round(sum), confidence: 'guessed' };
      warnings.push(`The letter's CTC wasn't found, so it's worked out from the breakup: ₹${Math.round(sum).toLocaleString('en-IN')} a year. Check it against your letter.`);
    }
  }
  if (!components.basic) warnings.push('Could not find Basic salary. Please enter it.');
  if (kind === 'offer' && !doj) warnings.push('Could not find the date of joining. Please enter it.');

  // Rows we don't recognise by name but that read like salary lines (monthly and annual figures
  // 12x apart), e.g. "Acme Allow  5,24,520  43,710" or "Fixed Pay  ...": keep them as allowances.
  for (const l of lines) {
    if (segments(l).length) continue;
    const label = rowLabel(l);
    if (!label || /\b(total|gross|net|ctc|cost|deduction|pf|provident|gratuity|bonus|variable|incentive|insurance|tax|tds|reimburse|annual|monthly|component|particulars|amount)\b/i.test(label)) continue;
    const money = numbersIn(l).filter((n) => !n.pct).map((n) => n.value);
    const pair = money.length >= 2 && money.find((a) => money.some((b) => b !== a && Math.abs(b / a - 12) < 0.25));
    if (pair && looksLikeTableRow(label, money) && !allowances.some((a) => a.label.toLowerCase() === label.toLowerCase())) allowances.push({ label, monthly: pair });
  }

  // Don't count allowances already captured under their own key.
  const own = allowances.filter((a) => !Object.values(components).some((c) => c && c.label === a.label && ALLOWANCE_KEYS.includes(c.key)));
  return { kind, components, allowances: own, doj, employer, docDate: findDocDate(lines, kind), ytdTds: findYtdTds(lines, text), warnings };
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

// Words that make a capitalised run a salary row, not a company ("Performance Linked Incentive").
const NOT_COMPANY = /\b(allowance|incentive|bonus|basic|salary|pay|fund|provident|gratuity|insurance|compensation|ctc|total|amount|deduction|tax|annexure|component|monthly|annual|reimbursement|variable|performance|linked|leave|notice|period|dear|subject|date|offer|letter|appointment|employee|designation|grade|band)\b/i;
const SUFFIX_RE = "(Private[ \\t]+Limited|PRIVATE[ \\t]+LIMITED|Pvt\\.?[ \\t]*Ltd\\.?|PVT\\.?[ \\t]*LTD\\.?|Limited|LIMITED|Ltd\\.?|LTD\\.?|LLP|Inc\\.?|INC\\.?|Corporation|CORPORATION)(?![A-Za-z])";
const WEAK_SUFFIX_RE = "(Technologies|TECHNOLOGIES|Solutions|SOLUTIONS|Systems|SYSTEMS|Services|SERVICES|Labs|Software|SOFTWARE|Energy|ENERGY|Industries|INDUSTRIES)(?![A-Za-z])";

/** "ACME ENERGY LIMITED" -> "Acme Energy Limited"; short acronyms (TCS, IBM) stay. */
function tidyName(n: string) {
  return n
    .split(/\s+/)
    .map((w) => (w.length > 4 && w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w))
    .join(' ');
}

/**
 * The employer's name: a run of capitalised words ending in a legal suffix. Names in the letter
 * head (first lines) and names repeated in the text win; salary-table rows never count.
 */
export function findEmployer(text: string): string | undefined {
  // Letterheads often wrap: "Acme Technology Information\nPrivate Limited".
  const joined = text.replace(/([A-Za-z&.)'’-])[ \t]*\n[ \t]*((Private|PRIVATE|Pvt|PVT)\b|Limited\b|LIMITED\b|Ltd\b|LTD\b|LLP\b)/g, '$1 $2');
  const lines = joined.split(/\n/);
  const cands = new Map<string, { name: string; score: number }>();
  // "Larsen & Toubro Limited": a lone "&" joins two words of the name.
  const run = "((?:[A-Z0-9][\\w&.'’-]*[ \\t]+)(?:(?:[A-Z0-9][\\w&.'’-]*|&)[ \\t]+){0,4}?)";
  lines.forEach((line, i) => {
    for (const [suffix, weight] of [[SUFFIX_RE, 3], [WEAK_SUFFIX_RE, 1]] as const) {
      const re = new RegExp(run + suffix, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        const name = `${m[1]}${m[2]}`.trim().replace(/^(for|from|at|with|of|by|to|dear|and|the)\s+/i, '');
        if (NOT_COMPANY.test(m[1]) || name.split(/\s+/).length < 2) continue;
        // "Private Limited" on its own, or "The Company Limited", names nothing.
        const core = name.replace(/\b(private|pvt|limited|ltd|llp|inc|corporation|the|company|india)\b\.?/gi, '').replace(/[^A-Za-z0-9]/g, '');
        if (core.length < 2) continue;
        const key = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const c = cands.get(key) ?? { name: tidyName(name), score: 0 };
        c.score += weight + (i < 8 ? 3 : 0) + 1;
        cands.set(key, c);
      }
    }
  });
  let best: { name: string; score: number } | undefined;
  for (const c of cands.values()) if (!best || c.score > best.score) best = c;
  return best?.name;
}

/** "Acme Allowance (Monthly) : 12,500" -> "Acme Allowance". */
export function rowLabel(segment: string): string {
  const head = segment.split(/[\d₹]|\brs\.?\s|\binr\b/i)[0];
  return head
    .replace(/\(.*?\)/g, ' ')
    .replace(/[:\-–|]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\d+[.)]\s*/, '')
    .slice(0, 40);
}

/** A salary-table row: a short label and money figures, not a sentence of the letter. */
function looksLikeTableRow(label: string, money: number[]): boolean {
  if (!money.length || money.some((v) => v < 500)) return false;
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  return !/\b(will|shall|entitled|as\s+per|up\s*to|upto|per\s+policy|eligible|subject|reimburs|payable|you|your)\b/i.test(label);
}
