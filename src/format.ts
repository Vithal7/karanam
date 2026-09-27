const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹1,23,456 */
export const rs = (n: number) => `${n < 0 ? '−' : ''}₹${inr.format(Math.abs(Math.round(n)))}`;

/** Compact: ₹1.6L, ₹32.4L, ₹1.2Cr, ₹45K */
export function rsShort(n: number) {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2).replace(/\.?0+$/, '')}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2).replace(/\.?0+$/, '')}L`;
  if (a >= 1e3) return `${sign}₹${Math.round(a / 1e3)}K`;
  return `${sign}₹${Math.round(a)}`;
}

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits).replace(/\.0+$/, '')}%`;

export const uid = () => Math.random().toString(36).slice(2, 9);

/** "LinkedIn Technology Information Private Limited" -> "LinkedIn Technology Information". */
export const shortCompany = (name: string) =>
  name
    .replace(/[\s,]+(private|pvt\.?)\s+(limited|ltd\.?)\s*$/i, '')
    .replace(/[\s,]+(limited|ltd\.?|llp|inc\.?|corporation|corp\.?)\s*$/i, '')
    .trim() || name;
