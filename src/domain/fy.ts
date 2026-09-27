/** Date helpers that avoid timezones entirely by working on Y/M/D integers. */

export interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

export const parseDate = (s: string): YMD => {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d: d || 1 };
};

export const fmtDate = ({ y, m, d }: YMD) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Day number since epoch, for day differences. */
export const dayNum = ({ y, m, d }: YMD) => Math.round(Date.UTC(y, m - 1, d) / 86_400_000);

/** FY start year for a date: Apr 2026 - Mar 2027 -> 2026. */
export const fyOf = (s: string) => {
  const { y, m } = parseDate(s);
  return m >= 4 ? y : y - 1;
};

export const fyLabel = (fy: number) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;

/** The 12 month keys of a financial year, Apr..Mar. */
export const fyMonths = (fy: number): string[] =>
  Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    return monthKey(i >= 9 ? fy + 1 : fy, m);
  });

export const fyStart = (fy: number) => `${fy}-04-01`;
export const fyEnd = (fy: number) => `${fy + 1}-03-31`;

export const monthOf = (date: string) => date.slice(0, 7);

/** Month key n months after the given month key. */
export const addMonths = (key: string, n: number) => {
  const { y, m } = parseDate(key);
  const idx = y * 12 + (m - 1) + n;
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1);
};

export const monthName = (key: string, withYear = true) => {
  const { y, m } = parseDate(key);
  const n = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return withYear ? `${n} ${String(y).slice(2)}` : n;
};

/**
 * Share of the month's salary earned between start and end (inclusive).
 * Payroll either divides by calendar days or by a flat 30.
 */
export function monthFactor(key: string, start: string, end: string, thirty: boolean): number {
  const { y, m } = parseDate(key);
  const dim = daysInMonth(y, m);
  const first = dayNum({ y, m, d: 1 });
  const last = dayNum({ y, m, d: dim });
  const s = Math.max(first, dayNum(parseDate(start)));
  const e = Math.min(last, dayNum(parseDate(end)));
  const days = e - s + 1;
  if (days <= 0) return 0;
  if (days >= dim) return 1;
  return Math.min(1, days / (thirty ? 30 : dim));
}

/** Days from start to end, both inclusive. */
export const daysBetween = (start: string, end: string) =>
  dayNum(parseDate(end)) - dayNum(parseDate(start)) + 1;

export const maxDate = (a: string, b: string) => (a > b ? a : b);
export const minDate = (a: string, b: string) => (a < b ? a : b);

/** "Apr 2026": unambiguous month for sentences ("Apr 26" could read as a date). */
export const monthLong = (key: string) => {
  const { y } = parseDate(key);
  return `${monthName(key, false)} ${y}`;
};
