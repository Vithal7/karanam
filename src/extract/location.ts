/**
 * Where a job is: the state decides professional tax. A labelled work location wins ("Place of
 * posting: Pune"); otherwise a city mentioned in the letter's body, but not in a registered-office
 * or corporate-address line, which is often in another city.
 */
export const STATES: Record<string, string> = {
  AN: 'Andaman and Nicobar Islands', AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar', CH: 'Chandigarh', CG: 'Chhattisgarh',
  DN: 'Dadra and Nagar Haveli and Daman and Diu', DL: 'Delhi', GA: 'Goa', GJ: 'Gujarat', HR: 'Haryana', HP: 'Himachal Pradesh', JK: 'Jammu and Kashmir',
  JH: 'Jharkhand', KA: 'Karnataka', KL: 'Kerala', LA: 'Ladakh', LD: 'Lakshadweep', MP: 'Madhya Pradesh', MH: 'Maharashtra', MN: 'Manipur', ML: 'Meghalaya',
  MZ: 'Mizoram', NL: 'Nagaland', OD: 'Odisha', PY: 'Puducherry', PB: 'Punjab', RJ: 'Rajasthan', SK: 'Sikkim', TN: 'Tamil Nadu', TG: 'Telangana',
  TR: 'Tripura', UP: 'Uttar Pradesh', UK: 'Uttarakhand', WB: 'West Bengal',
};

/** Cities people commonly work in -> state code. Several spellings each. */
const CITIES: [RegExp, string, string][] = [
  [/\b(mumbai|bombay|navi\s+mumbai|thane|powai|andheri|goregaon|bandra|lower\s+parel|vikhroli|malad|airoli)\b/i, 'Mumbai', 'MH'],
  [/\b(pune|hinjewadi|hinjawadi|kharadi|magarpatta|hadapsar|baner|viman\s+nagar|yerwada|kalyani\s+nagar)\b/i, 'Pune', 'MH'],
  [/\bnagpur\b/i, 'Nagpur', 'MH'],
  [/\bnashik\b/i, 'Nashik', 'MH'],
  [/\b(bengaluru|bangalore|whitefield|koramangala|electronic\s+city|marathahalli|bellandur|manyata)\b/i, 'Bengaluru', 'KA'],
  [/\b(mysuru|mysore|mangaluru|mangalore|hubli)\b/i, 'Karnataka', 'KA'],
  [/\b(hyderabad|secunderabad|gachibowli|hitec\s+city|hitech\s+city|madhapur|kondapur|nanakramguda)\b/i, 'Hyderabad', 'TG'],
  [/\b(chennai|madras|guindy|sholinganallur|siruseri|perungudi|taramani)\b/i, 'Chennai', 'TN'],
  [/\b(coimbatore|madurai|tiruchirappalli|trichy)\b/i, 'Tamil Nadu', 'TN'],
  [/\b(kolkata|calcutta|salt\s+lake|rajarhat|new\s+town)\b/i, 'Kolkata', 'WB'],
  [/\b(ahmedabad|gandhinagar|gift\s+city|vadodara|baroda|surat|rajkot)\b/i, 'Gujarat', 'GJ'],
  [/\b(kochi|cochin|kakkanad|thiruvananthapuram|trivandrum|technopark|infopark)\b/i, 'Kerala', 'KL'],
  [/\b(indore|bhopal|jabalpur)\b/i, 'Madhya Pradesh', 'MP'],
  [/\b(bhubaneswar|cuttack)\b/i, 'Odisha', 'OD'],
  [/\b(guwahati)\b/i, 'Guwahati', 'AS'],
  [/\b(visakhapatnam|vizag|vijayawada|amaravati|tirupati)\b/i, 'Andhra Pradesh', 'AP'],
  [/\b(ranchi|jamshedpur)\b/i, 'Jharkhand', 'JH'],
  [/\b(patna)\b/i, 'Patna', 'BR'],
  [/\b(mohali|ludhiana|amritsar)\b/i, 'Punjab', 'PB'],
  [/\b(gurugram|gurgaon|manesar|faridabad|panchkula)\b/i, 'Gurugram', 'HR'],
  [/\b(noida|greater\s+noida|ghaziabad|lucknow|kanpur)\b/i, 'Noida', 'UP'],
  [/\b(new\s+delhi|delhi|okhla|nehru\s+place|connaught\s+place)\b/i, 'Delhi', 'DL'],
  [/\b(jaipur|udaipur|jodhpur)\b/i, 'Jaipur', 'RJ'],
  [/\bchandigarh\b/i, 'Chandigarh', 'CH'],
  [/\b(dehradun)\b/i, 'Dehradun', 'UK'],
  [/\b(goa|panaji|panjim|margao|verna)\b/i, 'Goa', 'GA'],
  [/\b(raipur|bhilai)\b/i, 'Raipur', 'CG'],
  [/\b(puducherry|pondicherry)\b/i, 'Puducherry', 'PY'],
];

const LABEL = /(work(?:ing)?\s+location|place\s+of\s+(?:posting|work|employment)|posting\s+(?:location|place)|base\s+location|location\s+of\s+(?:work|posting)|job\s+location|work\s+place|workplace|branch|\blocation)\s*[:\-–]?\s*(.{0,80})/i;
const OFFICE = /registered\s+office|regd\.?\s+office|corporate\s+office|head\s+office|\bcin\b|corporate\s+identity|website|www\.|e-?mail|phone|tel\b/i;

/** PIN code prefixes (first two digits) -> state, for addresses. */
const PIN: [number, number, string][] = [
  [11, 11, 'DL'], [12, 13, 'HR'], [14, 15, 'PB'], [16, 16, 'CH'], [17, 17, 'HP'], [18, 19, 'JK'], [20, 28, 'UP'], [30, 34, 'RJ'], [36, 39, 'GJ'],
  [40, 44, 'MH'], [45, 48, 'MP'], [49, 49, 'CG'], [50, 50, 'TG'], [51, 53, 'AP'], [56, 59, 'KA'], [60, 64, 'TN'], [67, 69, 'KL'], [70, 74, 'WB'],
  [75, 77, 'OD'], [78, 78, 'AS'], [80, 81, 'BR'], [82, 83, 'JH'], [84, 85, 'BR'],
];

const cityIn = (s: string) => {
  for (const [re, city, state] of CITIES) if (re.test(s)) return { city, state };
  return undefined;
};

export interface FoundLocation {
  state: string;
  city?: string;
  /** 'doc' when the letter labels it as the work location; 'guess' from a mention elsewhere. */
  source: 'doc' | 'guess';
}

export function findLocation(text: string): FoundLocation | undefined {
  const lines = text.replace(/\r/g, '').split('\n');
  for (const [i, l] of lines.entries()) {
    const m = LABEL.exec(l);
    if (!m || OFFICE.test(l)) continue;
    // The value is on the label's line; only an empty label line continues on the next.
    const next = lines[i + 1] ?? '';
    const after = m[2].trim().length >= 3 || OFFICE.test(next) ? m[2] : `${m[2]} ${next}`;
    const c = cityIn(after);
    if (c) return { ...c, source: 'doc' };
    const pin = /\b([1-8]\d)\d{4}\b/.exec(after);
    const st = pin && PIN.find(([a, b]) => +pin[1] >= a && +pin[1] <= b)?.[2];
    if (st) return { state: st, source: 'doc' };
  }
  // No label: the city mentioned most in the body, outside office-address lines.
  const counts = new Map<string, { city: string; state: string; n: number }>();
  for (const l of lines) {
    if (OFFICE.test(l)) continue;
    for (const [re, city, state] of CITIES) {
      const n = (l.match(new RegExp(re.source, 'gi')) ?? []).length;
      if (n) {
        const cur = counts.get(city) ?? { city, state, n: 0 };
        cur.n += n;
        counts.set(city, cur);
        break;
      }
    }
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return best ? { state: best.state, city: best.city, source: 'guess' } : undefined;
}
