import { describe, expect, it } from 'vitest';
import { compute } from '../compute';
import type { Employment, Scenario, Structure } from '../types';
import { findLocation } from '../../extract/location';

const st = (basic: number): Structure => ({ basic, hra: basic / 2, special: basic / 2, others: [], epfMode: 'fixed', epf: 1800, pt: 999, npsPct: 0, npsInGross: false });
const job = (state: string | undefined, start = '2025-01-01', end = '', basic = 60000): Employment => ({
  id: 'j', name: 'J', start, end, structure: st(basic), revisions: [], oneTimes: [], recoveries: [], ctc: 0, tdsKnown: {}, form12B: 'never', docs: [],
  location: state ? { state, source: 'user' } : undefined,
});
const pts = (e: Employment) => {
  const s: Scenario = { fy: 2026, today: '2026-09-27', employers: [e], settings: { thirtyDayMonth: false, nextFyHike: 0 } };
  return Object.fromEntries(compute(s).employers[0].lines.map((l) => [l.month.slice(5), l.pt]));
};
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe('professional tax by state', () => {
  it('Maharashtra and Karnataka: ₹200 a month, ₹300 in February (₹2,500 a year)', () => {
    for (const s of ['MH', 'KA']) {
      const p = pts(job(s));
      expect(p['02']).toBe(300);
      expect(p['05']).toBe(200);
      expect(sum(p)).toBe(2500);
    }
  });
  it('no PT in Delhi, Haryana, Uttar Pradesh', () => {
    for (const s of ['DL', 'HR', 'UP']) expect(sum(pts(job(s)))).toBe(0);
  });
  it('Telangana ₹200 a month; West Bengal ₹200 above ₹40,000', () => {
    expect(sum(pts(job('TG')))).toBe(2400);
    expect(sum(pts(job('WB')))).toBe(2400);
  });
  it('Tamil Nadu: ₹1,250 each half-year, in September and March', () => {
    const p = pts(job('TN'));
    expect([p['09'], p['03'], p['05']]).toEqual([1250, 1250, 0]);
    // Leaving in July: the first half's PT is taken in the last month.
    const q = pts(job('TN', '2025-01-01', '2026-07-15'));
    expect(q['07']).toBe(1250);
    expect(sum(q)).toBe(1250);
  });
  it('Madhya Pradesh: ₹2,500 a year as ₹208 a month and ₹212 in March', () => {
    const p = pts(job('MP'));
    expect([p['04'], p['03']]).toEqual([208, 212]);
    expect(sum(p)).toBe(2500);
  });
  it('a joining month that falls below the threshold pays the lower slab', () => {
    // Joined 29 Apr in Maharashtra on a small salary: 2 days' pay is under ₹7,500.
    const p = pts(job('MH', '2026-04-29', '', 20000));
    expect(p['04']).toBe(0);
    expect(p['05']).toBe(200);
  });
  it('unknown state: the payslip amount', () => {
    expect(pts(job(undefined))['05']).toBe(999);
  });
});

describe('where the job is', () => {
  it('a labelled work location', () => {
    expect(findLocation('Offer of employment\nPlace of Posting: Hinjewadi, Pune\nRegistered Office: Mumbai')).toEqual({ city: 'Pune', state: 'MH', source: 'doc' });
    expect(findLocation('Work Location : Bengaluru')).toMatchObject({ state: 'KA', source: 'doc' });
    expect(findLocation('Location: Tower B, Sector 62, 201301')).toMatchObject({ state: 'UP', source: 'doc' });
  });
  it('ignores the registered office; otherwise guesses from the body', () => {
    expect(findLocation('Registered Office: 5th floor, Gurugram 122002\nYou will be based at our Chennai office. Chennai is...')).toEqual({ city: 'Chennai', state: 'TN', source: 'guess' });
    expect(findLocation('Registered Office: Pune 411001')).toBeUndefined();
  });
});
