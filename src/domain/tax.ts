/**
 * New tax regime (s.115BAC) for salaried individuals, FY 2025-26 onwards.
 * Keep all law-dependent constants here so a budget change is a one-file edit.
 */
export const NEW_REGIME = {
  standardDeduction: 75_000,
  slabs: [
    { upto: 400_000, rate: 0 },
    { upto: 800_000, rate: 0.05 },
    { upto: 1_200_000, rate: 0.1 },
    { upto: 1_600_000, rate: 0.15 },
    { upto: 2_000_000, rate: 0.2 },
    { upto: 2_400_000, rate: 0.25 },
    { upto: Infinity, rate: 0.3 },
  ],
  /** s.87A: full rebate up to this taxable income, with marginal relief above it. */
  rebateLimit: 1_200_000,
  surcharge: [
    { above: 5_000_000, rate: 0.1 },
    { above: 10_000_000, rate: 0.15 },
    { above: 20_000_000, rate: 0.25 },
  ],
  cess: 0.04,
  /** 80CCD(2): employer NPS deductible up to this share of basic. */
  npsCapPctOfBasic: 0.14,
  /** s.10(10AA) cap on leave encashment exemption at retirement/resignation. */
  leaveEncashmentCap: 2_500_000,
};

/** Section 288A: taxable income rounded to the nearest ten rupees (Excel MROUND). */
export const round10 = (x: number) => Math.sign(x) * Math.round(Math.abs(x) / 10) * 10;

export function slabTax(taxable: number): number {
  let tax = 0;
  let lower = 0;
  for (const { upto, rate } of NEW_REGIME.slabs) {
    if (taxable <= lower) break;
    tax += (Math.min(taxable, upto) - lower) * rate;
    lower = upto;
  }
  return tax;
}

/** Slab tax after the 87A rebate and its marginal relief. */
export function taxAfterRebate(taxable: number): number {
  const t = slabTax(taxable);
  if (taxable <= NEW_REGIME.rebateLimit) return 0;
  return Math.min(t, taxable - NEW_REGIME.rebateLimit);
}

function surchargeRate(taxable: number) {
  let rate = 0;
  for (const s of NEW_REGIME.surcharge) if (taxable > s.above) rate = s.rate;
  return rate;
}

/** Surcharge with marginal relief at each threshold. */
export function surcharge(taxable: number): number {
  const base = taxAfterRebate(taxable);
  const rate = surchargeRate(taxable);
  if (rate === 0) return 0;
  const threshold = [...NEW_REGIME.surcharge].reverse().find((s) => taxable > s.above)!.above;
  const atThreshold = taxAfterRebate(threshold) * (1 + surchargeRate(threshold));
  const capped = atThreshold + (taxable - threshold);
  return Math.max(0, Math.min(base * rate, capped - base));
}

/** Total tax (incl. rebate, surcharge and cess) on an already-rounded taxable income. */
export function taxOn(taxable: number) {
  const slab = slabTax(taxable);
  const afterRebate = taxAfterRebate(taxable);
  const sur = surcharge(taxable);
  const cess = (afterRebate + sur) * NEW_REGIME.cess;
  return {
    slabTax: slab,
    rebate: slab - afterRebate,
    surcharge: sur,
    cess,
    total: afterRebate + sur + cess,
  };
}
