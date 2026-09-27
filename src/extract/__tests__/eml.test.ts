import { describe, expect, it } from 'vitest';
import { emailDate, parseEml } from '../eml';
import { docFromText } from '../intake';

const EML = [
  'From: "HR Operations" <hr.ops@sigmasystems.com>',
  'To: Priya <priya@example.com>',
  'Subject: =?UTF-8?Q?Acceptance_of_your_resignation_=E2=80=93_Sigma?=',
  'Date: Sat, 12 Sep 2026 10:12:00 +0530',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="outer"',
  '',
  '--outer',
  'Content-Type: multipart/alternative; boundary="alt"',
  '',
  '--alt',
  'Content-Type: text/html; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  '<p>Dear Priya,</p><p>We accept your resignation dated 12/09/2026. Your last work=',
  'ing day will be 11th November 2026.</p><p>Sigma Systems Private Limited</p>',
  '--alt--',
  '--outer',
  'Content-Type: application/pdf; name="relieving.pdf"',
  'Content-Disposition: attachment; filename="relieving.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  'JVBERi0xLjQK',
  '--outer--',
  '',
].join('\r\n');

describe('resignation emails (.eml)', () => {
  const e = parseEml(EML);
  it('reads headers, decodes the HTML body and finds attachments', () => {
    expect(e.text).toMatch(/^From: "HR Operations" <hr\.ops@sigmasystems\.com>/);
    expect(e.text).toContain('Date: 12/09/2026');
    expect(e.text).toContain('Subject: Acceptance of your resignation – Sigma');
    expect(e.text).toContain('Your last working day will be 11th November 2026.');
    expect(e.text).not.toMatch(/<p>|=\r?\n/);
    expect(e.attachments).toEqual([{ name: 'relieving.pdf', type: 'application/pdf', bytes: expect.any(Uint8Array) }]);
    expect(new TextDecoder().decode(e.attachments[0].bytes)).toBe('%PDF-1.4\n');
  });
  it('is read as a resignation with its dates', () => {
    const d = docFromText(e.text, 'Resignation.eml');
    expect(d.kind).toBe('resignation');
    expect(d.facts?.lastWorkingDay).toBe('2026-11-11');
    expect(d.facts?.resignationDate).toBe('2026-09-12');
    expect(d.employer).toMatch(/Sigma/);
  });
  it('dates in the Date header', () => {
    expect(emailDate('Tue, 5 Jan 2027 09:00:00 +0530')).toBe('05/01/2027');
  });
});
