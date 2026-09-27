/** Plain-language meanings of the payroll terms the questions use. */
const TERMS: [string, string][] = [
  ['CTC', 'Cost to company: everything the employer spends on you in a year, including employer PF, gratuity, insurance and variable pay. Your monthly pay is less.'],
  ['In hand', 'What reaches your bank account after PF, professional tax and income tax (TDS).'],
  ['TDS', 'Income tax your employer deducts from each salary and pays to the government for you.'],
  ['LWD', 'Last working day: your final day at a job.'],
  ['Notice shortfall', 'Notice days you don’t serve. Your employer recovers pay for them, usually from the F&F.'],
  ['Notice buyout', 'When your new employer pays you back what the old one recovered for the notice you didn’t serve.'],
  ['F&F', 'Full & final settlement: the last payout when you leave, with leave encashment, recoveries and gratuity.'],
  ['Clawback', 'A joining or retention bonus you repay because you left before the period in your letter.'],
  ['Gratuity / ex gratia', 'Gratuity is paid by law after 5 years’ service. Some employers pay "ex gratia" instead if you leave earlier; most don’t.'],
  ['Form 12B', 'A form you give a new employer with your salary and TDS at earlier jobs this year, so it deducts the right tax.'],
  ['EPF wage ceiling', 'The salary on which PF is compulsory. It rose from ₹15,000 to ₹25,000 a month on 17 Sep 2026, raising PF for many people.'],
  ['80CCD(2)', 'The section that makes employer NPS (up to 14% of basic) tax-free in the new regime.'],
];

export function Glossary() {
  return (
    <details class="card glossary">
      <summary>What do these terms mean?</summary>
      <dl>
        {TERMS.map(([t, d]) => (
          <>
            <dt>{t}</dt>
            <dd class="small">{d}</dd>
          </>
        ))}
      </dl>
    </details>
  );
}
