import { describe, expect, it } from 'vitest';
import { docFromText } from '../intake';
import { decompressRtf, parseMsg, rtfToText } from '../msg';
import { sniff } from '../text';
import { propStream, utf16z, writeCompound, type Node } from './msgWriter';

const ascii = (s: string) => new TextEncoder().encode(s);
const str = (id: string, s: string) => ({ [`__substg1.0_${id}001F`]: utf16z(s) });
const hex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));

// A PDF bigger than the mini stream cutoff, so it sits in regular sectors.
const PDF = ascii(`%PDF-1.4\n${'%'.repeat(6000)}\n`);
const sent = new Date('2026-09-14T04:42:00Z'); // 10:12 in India

const resignation: Node = {
  __properties_version1: new Uint8Array(0), // decoy name that must not be read as properties
  '__properties_version1.0': propStream(32, { 0x0039: sent }),
  ...str('0037', 'Acceptance of your resignation – Sigma'),
  ...str('0C1A', 'HR Operations'),
  ...str('5D01', 'hr.ops@sigmasystems.com'),
  ...str('0E04', 'Priya'),
  ...str(
    '1000',
    'Dear Priya,\r\n\r\nWe accept your resignation dated 14/09/2026. Your last working day will be 13th November 2026.\r\n\r\nSigma Systems Private Limited',
  ),
  '__recip_version1.0_#00000000': { ...str('3001', 'Priya'), ...str('39FE', 'priya@example.com') },
  '__attach_version1.0_#00000000': {
    ...str('3707', 'relieving.pdf'),
    ...str('370E', 'application/pdf'),
    '__substg1.0_37010102': PDF,
  },
};

describe('Outlook emails (.msg)', () => {
  const bytes = writeCompound(resignation);
  const m = parseMsg(bytes);
  it('reads the sender, date, subject, body and attachment', () => {
    expect(m.text).toMatch(/^From: HR Operations <hr\.ops@sigmasystems\.com>/);
    expect(m.text).toContain('To: Priya');
    expect(m.text).toContain('Date: 14/09/2026');
    expect(m.text).toContain('Subject: Acceptance of your resignation – Sigma');
    expect(m.text).toContain('Your last working day will be 13th November 2026.');
    expect(m.attachments.map((a) => [a.name, a.type, a.bytes.length])).toEqual([['relieving.pdf', 'application/pdf', PDF.length]]);
    expect(m.attachments[0].bytes).toEqual(PDF);
  });
  it('is read as a resignation, like the same email saved as .eml', () => {
    const d = docFromText(m.text, 'Resignation.msg');
    expect(d.kind).toBe('resignation');
    expect(d.facts?.lastWorkingDay).toBe('2026-11-13');
    expect(d.facts?.resignationDate).toBe('2026-09-14');
    expect(d.employer).toMatch(/Sigma/);
  });
  it('is recognised from its first bytes when the name says nothing', () => {
    expect(sniff(bytes.slice(0, 2048), '')).toBe('msg');
  });

  it('an HTML-only mail in 8-bit strings', () => {
    const b = writeCompound({
      '__substg1.0_0037001E': ascii('Offer of employment'),
      '__substg1.0_10130102': ascii('<html><body><p>Dear Ravi,</p><p>Your date of joining will be 1st December 2026.</p><table><tr><td>Basic</td><td>1,00,000</td></tr></table></body></html>'),
    });
    const t = parseMsg(b).text;
    expect(t).toContain('Subject: Offer of employment');
    expect(t).toContain('Your date of joining will be 1st December 2026.');
    expect(t).toMatch(/Basic\s+1,00,000/);
    expect(t).not.toContain('<p>');
  });

  it('a mail with only a compressed RTF body', () => {
    const rtf = hex(RTF);
    expect(decompressRtf(rtf)).toMatch(/^\{\\rtf1/);
    const t = parseMsg(writeCompound({ '__substg1.0_10090102': rtf, ...str('0037', 'Resignation') })).text;
    expect(t).toContain('Your last working day will be 13th November 2026.');
    expect(t).toContain('Northwind Global Services Limited');
    expect(t).not.toMatch(/\\par|fonttbl|Arial/);
  });

  it('HTML carried inside RTF', () => {
    const rtf = String.raw`{\rtf1\ansi\fromhtml1 {\*\htmltag19 <html>}{\*\htmltag50 <p>}\htmlrtf {\htmlrtf0 Joining bonus \{Rs. 1,00,000\}{\*\htmltag58 </p>}\htmlrtf }\htmlrtf0 {\*\htmltag50 <p>}Repayable within 12 months{\*\htmltag58 </p>}}`;
    const t = rtfToText(rtf);
    expect(t).toContain('Joining bonus {Rs. 1,00,000}');
    expect(t).toContain('Repayable within 12 months');
    expect(t).not.toMatch(/<p>|htmltag/);
  });

  it('an email forwarded as an Outlook attachment', () => {
    const b = writeCompound({
      ...str('0037', 'FW: offer'),
      ...str('1000', 'See below.'),
      '__attach_version1.0_#00000000': {
        ...str('3001', 'Offer'),
        '__substg1.0_3701000D': { ...str('0037', 'Offer from Zeta'), ...str('1000', 'Your date of joining will be 1st December 2026.') },
      },
    });
    const t = parseMsg(b).text;
    expect(t).toContain('--- Attached email ---');
    expect(t).toContain('Subject: Offer from Zeta');
    expect(t).toContain('1st December 2026');
  });

  it('an old Office file is not taken for an email', () => {
    expect(() => parseMsg(writeCompound({ WordDocument: ascii('x') }))).toThrow(/not an Outlook email/);
  });
});

const RTF =
  'bb000000dd0000004c5a46756d7653f803000a0072637067313235e23203437465780541010301f76f02a403e4071302807d0a810bb5201444650ac150051079612c6b0aa20a80590861200970009067506e6174690220200400209900d06365053009802e2012f3550b607305407705b06b0b80677020646179156003100320624065203133746807b06f2c766506d004902001d032362e2e1294170000206803f06e64b4204709006207400652760de0b507914c077069148112947d1ac0';
