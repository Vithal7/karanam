/**
 * Saved emails (.eml, RFC 822 / MIME): resignation acceptances and relieving mails. Returns the
 * readable text (key headers plus the body) and any attached files, e.g. a relieving letter PDF.
 */
export interface EmlPart {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface Eml {
  text: string;
  attachments: EmlPart[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Headers with folded lines joined, keys lower-case. */
function headers(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1].toLowerCase()] ??= decodeWords(m[2]);
  }
  return out;
}

/** =?UTF-8?B?...?= and =?UTF-8?Q?...?= words in headers. */
function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, cs: string, enc: string, data: string) => {
    const bytes = enc.toLowerCase() === 'b' ? b64(data) : qp(data.replace(/_/g, ' '));
    return decode(bytes, cs);
  });
}

function b64(s: string): Uint8Array {
  const bin = atob(s.replace(/[^A-Za-z0-9+/=]/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function qp(s: string): Uint8Array {
  const t = s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9A-F]{2}$/i.test(t.slice(i + 1, i + 3))) {
      out.push(parseInt(t.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(t.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

function decode(bytes: Uint8Array, charset = 'utf-8') {
  try {
    return new TextDecoder(charset.trim() || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

const param = (h: string | undefined, key: string) => {
  const m = new RegExp(`${key}\\*?=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i').exec(h ?? '');
  return m ? decodeWords(m[1] ?? m[2]).replace(/^utf-8''/i, '') : undefined;
};

export const htmlToText = (html: string) =>
  html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(td|th)>/gi, '  ')
    .replace(/<\/(tr|p|div|h\d|li)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

/** "Tue, 15 Sep 2026 10:12:00 +0530" -> "15/09/2026", the form our date readers know. */
export function emailDate(h: string | undefined): string | undefined {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(h ?? '');
  if (!m) return undefined;
  const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1;
  return mo ? `${m[1].padStart(2, '0')}/${String(mo).padStart(2, '0')}/${m[3]}` : undefined;
}

interface Walk {
  plain: string[];
  html: string[];
  attachments: EmlPart[];
}

function walk(raw: string, w: Walk) {
  const split = /\r?\n\r?\n/.exec(raw);
  const head = headers(split ? raw.slice(0, split.index) : raw);
  const body = split ? raw.slice(split.index + split[0].length) : '';
  const ctype = head['content-type'] ?? 'text/plain';
  const type = ctype.split(';')[0].trim().toLowerCase();
  const boundary = param(ctype, 'boundary');
  if (type.startsWith('multipart/') && boundary) {
    const parts = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*\\r?\\n?`));
    for (const p of parts.slice(1)) if (p.trim()) walk(p, w);
    return;
  }
  if (type === 'message/rfc822') return walk(body, w);
  const enc = (head['content-transfer-encoding'] ?? '').toLowerCase();
  const bytes = enc === 'base64' ? b64(body) : enc === 'quoted-printable' ? qp(body) : new TextEncoder().encode(body);
  const name = param(head['content-disposition'], 'filename') ?? param(ctype, 'name');
  const isAttachment = /attachment/i.test(head['content-disposition'] ?? '') || (!!name && !type.startsWith('text/'));
  if (isAttachment) {
    w.attachments.push({ name: name ?? 'attachment', type, bytes });
    return;
  }
  const text = decode(bytes, param(ctype, 'charset'));
  if (type === 'text/html') w.html.push(htmlToText(text));
  else if (type.startsWith('text/')) w.plain.push(text);
}

export function parseEml(raw: string): Eml {
  const split = /\r?\n\r?\n/.exec(raw);
  const head = headers(split ? raw.slice(0, split.index) : raw);
  const w: Walk = { plain: [], html: [], attachments: [] };
  walk(raw, w);
  const date = emailDate(head.date);
  const top = [
    head.from && `From: ${head.from}`,
    head.to && `To: ${head.to}`,
    date && `Date: ${date}`,
    head.subject && `Subject: ${head.subject}`,
  ].filter(Boolean);
  // Plain text is cleaner when both are there; HTML-only mails are common from HR systems.
  const body = (w.plain.length ? w.plain : w.html).join('\n\n');
  return { text: `${top.join('\n')}\n\n${body}`.trim(), attachments: w.attachments };
}
