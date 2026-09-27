import { describe, expect, it, vi } from 'vitest';
import { bundledRules, epfCeiling, newerVersion, rulesFor, validateRules } from '../index';
import { refreshRules } from '../update';

const clone = () => JSON.parse(JSON.stringify(bundledRules));

describe('rules', () => {
  it('bundled rules are valid', () => {
    expect(validateRules(bundledRules)).toBe(true);
  });
  it('later years inherit the latest earlier entry', () => {
    const r = clone();
    r.incomeTax['2027'] = { ...r.incomeTax['2025'], standardDeduction: 100000 };
    expect(rulesFor(r, 2026).standardDeduction).toBe(75000);
    expect(rulesFor(r, 2027).standardDeduction).toBe(100000);
    expect(rulesFor(r, 2030).standardDeduction).toBe(100000);
  });
  it('EPF ceiling switches from the month it takes effect', () => {
    expect(epfCeiling(bundledRules, '2026-08')).toBe(15000);
    expect(epfCeiling(bundledRules, '2026-09')).toBe(25000);
  });
  it('rejects malformed rules', () => {
    for (const mutate of [
      (r: any) => delete r.version,
      (r: any) => (r.incomeTax['2025'].slabs = []),
      (r: any) => (r.incomeTax['2025'].slabs[1].upto = 100),
      (r: any) => (r.incomeTax['2025'].cess = 'x'),
      (r: any) => (r.epf.wageCeiling = [{ from: 'soon', amount: 1 }]),
    ]) {
      const r = clone();
      mutate(r);
      expect(validateRules(r)).toBe(false);
    }
  });
  it('compares versions numerically', () => {
    expect(newerVersion('2026.10.01', '2026.09.17')).toBe(true);
    expect(newerVersion('2026.9.17', '2026.10.1')).toBe(false);
  });
});

describe('refreshRules', () => {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => (store[k] = v),
    removeItem: (k: string) => delete store[k],
  });
  const ok = (body: unknown) => (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;

  it('keeps current rules when offline or the download is bad', async () => {
    expect(await refreshRules((async () => { throw new Error('offline'); }) as unknown as typeof fetch, 'x')).toBeNull();
    expect(await refreshRules(ok({ junk: true }), 'x')).toBeNull();
    expect(await refreshRules(ok(bundledRules), 'x')).toBeNull(); // not newer
  });
  it('adopts newer valid rules', async () => {
    const r = clone();
    r.version = '2099.01.01';
    const got = await refreshRules(ok(r), 'x');
    expect(got?.version).toBe('2099.01.01');
    const { activeRules } = await import('../update');
    expect(activeRules().version).toBe('2099.01.01');
  });
});
