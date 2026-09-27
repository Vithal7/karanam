import { describe, expect, it } from 'vitest';
import { parseText } from '../parse';

const breakup = `Basic Salary 1,42,500 17,10,000
House Rent Allowance 71,250 8,55,000
Special Allowance 69,450 8,33,400`;

describe('CTC in the ways offer letters say it', () => {
  const cases: [string, string, number][] = [
    ['prose', `Your total annual CTC will be INR 38,00,000/- per annum.\n${breakup}`, 3_800_000],
    ['lakhs', `We are pleased to offer you a CTC of Rs. 38 Lakhs per annum.\n${breakup}`, 3_800_000],
    ['LPA', `Compensation: 38.5 LPA\n${breakup}`, 3_850_000],
    ['western commas', `Total Cost to Company: INR 3,800,000\n${breakup}`, 3_800_000],
    ['target compensation', `${breakup}\nTotal Target Compensation 3,16,667 38,00,000`, 3_800_000],
    ['TCTC', `${breakup}\nTCTC 38,00,000`, 3_800_000],
    ['label then value on next line', `${breakup}\nTotal Cost to Company (A+B+C)\n38,00,000`, 3_800_000],
    ['bare total row', `Annexure A\nComponent Monthly Annual\n${breakup}\nTotal (A+B+C) 3,16,667 38,00,000`, 3_800_000],
  ];
  for (const [name, text, want] of cases) it(name, () => expect(parseText(text).components.ctc?.annual).toBe(want));

  it('worked out from the breakup when the letter never states it, and said so', () => {
    const x = parseText(`Offer of employment\n${breakup}\nEmployer PF 1,800 21,600\nGratuity 6,854 82,248\nPerformance Linked Incentive 1,80,000`);
    expect(x.components.ctc?.annual).toBe(1_710_000 + 855_000 + 833_400 + 21_600 + 82_248 + 180_000);
    expect(x.components.ctc?.confidence).toBe('guessed');
    expect(x.warnings.join(' ')).toMatch(/worked out from the breakup/);
  });
});
