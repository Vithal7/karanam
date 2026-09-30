/**
 * Outlook emails (.msg): a Compound File (OLE2) holding MAPI properties as streams. Returns the
 * same shape as a saved .eml, so both go through one path: key headers, the body, attachments.
 */
import { emailDate, htmlToText, type Eml, type EmlPart } from './eml';

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe;
const NONE = 0xffffffff;

export const isCompoundFile = (b: Uint8Array) => SIGNATURE.every((v, i) => b[i] === v);

interface Entry {
  name: string;
  type: number; // 1 storage, 2 stream, 5 root
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

/** A storage in the file: its streams by name and its sub-storages by name. */
interface Storage {
  streams: Map<string, Uint8Array>;
  storages: Map<string, Storage>;
}

function readCompound(b: Uint8Array): Storage {
  if (!isCompoundFile(b)) throw new Error('Not an Outlook message');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u32 = (o: number) => (o + 4 <= b.length ? v.getUint32(o, true) : NONE);
  const sectorSize = 1 << v.getUint16(0x1e, true);
  const miniSize = 1 << v.getUint16(0x20, true);
  const cutoff = u32(0x38);
  const at = (s: number) => (s + 1) * sectorSize;

  // The FAT sectors are listed in the header, then in a chain of DIFAT sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) fatSectors.push(u32(0x4c + i * 4));
  for (let d = u32(0x44), n = 0; d < END && n < 1 << 16; n++) {
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per; i++) fatSectors.push(u32(at(d) + i * 4));
    d = u32(at(d) + per * 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors.slice(0, u32(0x2c))) {
    if (s >= END) continue;
    for (let i = 0; i < sectorSize / 4; i++) fat.push(u32(at(s) + i * 4));
  }
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let s = start; s < END && s < table.length && !seen.has(s); s = table[s]) {
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  const readChain = (start: number, size?: number) => {
    const sectors = chain(start, fat);
    const out = new Uint8Array(sectors.length * sectorSize);
    sectors.forEach((s, i) => out.set(b.subarray(at(s), at(s) + sectorSize), i * sectorSize));
    return size === undefined ? out : out.subarray(0, size);
  };

  const dir = readChain(u32(0x30));
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries: Entry[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const len = Math.max(0, dv.getUint16(o + 64, true) - 2);
    let name = '';
    for (let i = 0; i < len; i += 2) name += String.fromCharCode(dv.getUint16(o + i, true));
    entries.push({
      name,
      type: dir[o + 66],
      left: dv.getUint32(o + 68, true),
      right: dv.getUint32(o + 72, true),
      child: dv.getUint32(o + 76, true),
      start: dv.getUint32(o + 116, true),
      size: dv.getUint32(o + 120, true),
    });
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw new Error('Not an Outlook message');

  // Streams under the cutoff live in the mini stream, in 64-byte sectors with their own table.
  const miniStream = readChain(root.start, root.size);
  const miniFatBytes = readChain(u32(0x3c));
  const miniFat: number[] = [];
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset).getUint32(i, true));
  const readMini = (start: number, size: number) => {
    const out = new Uint8Array(size);
    let o = 0;
    for (const s of chain(start, miniFat)) {
      const part = miniStream.subarray(s * miniSize, (s + 1) * miniSize);
      out.set(part.subarray(0, Math.min(part.length, size - o)), o);
      o += part.length;
      if (o >= size) break;
    }
    return out;
  };

  const visited = new Set<number>();
  const build = (e: Entry): Storage => {
    const st: Storage = { streams: new Map(), storages: new Map() };
    const walk = (i: number) => {
      if (i >= entries.length || visited.has(i)) return;
      visited.add(i);
      const c = entries[i];
      walk(c.left);
      walk(c.right);
      if (c.type === 2) st.streams.set(c.name.toLowerCase(), c.size < cutoff ? readMini(c.start, c.size) : readChain(c.start, c.size));
      else if (c.type === 1) st.storages.set(c.name.toLowerCase(), build(c));
    };
    walk(e.child);
    return st;
  };
  return build(root);
}

const PT_STRING = '001f';
const PT_STRING8 = '001e';
const PT_BINARY = '0102';

const utf16 = (b: Uint8Array) => new TextDecoder('utf-16le').decode(b).replace(/\0+$/, '');
const ansi = (b: Uint8Array) => new TextDecoder('windows-1252').decode(b).replace(/\0+$/, '');

function prop(st: Storage, id: string): string | undefined {
  const s = st.streams.get(`__substg1.0_${id}${PT_STRING}`);
  if (s) return utf16(s);
  const a = st.streams.get(`__substg1.0_${id}${PT_STRING8}`);
  return a ? ansi(a) : undefined;
}
const binary = (st: Storage, id: string) => st.streams.get(`__substg1.0_${id}${PT_BINARY}`);

/** A date property (FILETIME) from the fixed-size property stream. */
function timeProp(st: Storage, id: number, headerSize: number): Date | undefined {
  const p = st.streams.get('__properties_version1.0');
  if (!p) return undefined;
  const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
  for (let o = headerSize; o + 16 <= p.length; o += 16) {
    const tag = v.getUint32(o, true);
    if (tag >>> 16 !== id || (tag & 0xffff) !== 0x0040) continue;
    const ticks = v.getUint32(o + 8, true) + v.getUint32(o + 12, true) * 2 ** 32;
    const ms = ticks / 10_000 - 11_644_473_600_000;
    return ms > 0 ? new Date(ms) : undefined;
  }
  return undefined;
}

/** "Mon, 14 Sep 2026" in India time, for the Date line our readers already know. */
function mailDate(d: Date | undefined) {
  if (!d) return undefined;
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  const mon = ist.toUTCString().slice(8, 11);
  return emailDate(`${ist.getUTCDate()} ${mon} ${ist.getUTCFullYear()}`);
}

/** Compressed RTF (LZFu), which some Outlook mails carry instead of a plain body. */
export function decompressRtf(b: Uint8Array): string {
  if (b.length < 16) return '';
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const size = v.getUint32(0, true);
  const raw = v.getUint32(4, true);
  const magic = v.getUint32(8, true);
  if (magic === 0x414c454d) return ansi(b.subarray(16, 16 + raw)); // "MELA": stored uncompressed
  if (magic !== 0x75465a4c) return ''; // "LZFu"
  const dict = new Uint8Array(4096);
  const pre =
    '{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx';
  for (let i = 0; i < pre.length; i++) dict[i] = pre.charCodeAt(i);
  let w = pre.length;
  const out: number[] = [];
  let i = 16;
  const end = Math.min(b.length, size + 4);
  while (i < end && out.length < raw) {
    const flags = b[i++];
    for (let bit = 0; bit < 8 && i < end && out.length < raw; bit++) {
      if (flags & (1 << bit)) {
        const ref = (b[i] << 8) | b[i + 1];
        i += 2;
        const off = ref >> 4;
        const len = (ref & 0xf) + 2;
        if (off === (w & 0xfff)) return ansi(new Uint8Array(out));
        for (let k = 0; k < len; k++) {
          const c = dict[(off + k) & 0xfff];
          out.push(c);
          dict[w++ & 0xfff] = c;
        }
      } else {
        const c = b[i++];
        out.push(c);
        dict[w++ & 0xfff] = c;
      }
    }
  }
  return ansi(new Uint8Array(out));
}

const ESC: Record<string, string> = { '{': '\ue000', '}': '\ue001', '\\': '\ue002' };
const unpark = (s: string) => s.replace(/[\ue000-\ue002]/g, (c) => '{}\\'[c.charCodeAt(0) - 0xe000]);

/** Readable text from RTF: HTML wrapped in RTF by Outlook when there is some, else the plain text. */
export function rtfToText(rtf: string): string {
  // Escaped braces and backslashes are text; park them while the control words go.
  rtf = rtf.replace(/\\([{}\\])/g, (_, c: string) => ESC[c]);
  if (/\\fromhtml1/.test(rtf)) {
    const html = rtf
      .replace(/\\htmlrtf(?!0)[\s\S]*?\\htmlrtf0\s?/g, '')
      .replace(/\{\\\*\\htmltag\d*\s?([^{}]*)\}/g, '$1')
      .replace(/\\par\b\s?/g, '\n')
      .replace(/\\'([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\[a-z]+-?\d*\s?|[{}]/gi, '');
    return unpark(htmlToText(html));
  }
  return unpark(rtf
    .replace(/\{\\\*[^{}]*\}|\{\\(fonttbl|colortbl|stylesheet)[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '')
    .replace(/\\par[d]?\b\s?|\\line\b\s?/g, '\n')
    .replace(/\\tab\b\s?/g, '  ')
    .replace(/\\'([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n: string) => String.fromCharCode((+n + 65536) % 65536))
    .replace(/\\[a-z]+-?\d*\s?|[{}]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim());
}

/** HTML bodies are stored in the message's code page: UTF-16 as a string, else usually UTF-8. */
function htmlString(b: Uint8Array) {
  if (b[1] === 0) return utf16(b);
  const t = new TextDecoder('utf-8').decode(b);
  return t.includes('\ufffd') ? ansi(b) : t;
}

function message(st: Storage, headerSize: number): Eml {
  const from = prop(st, '0c1a') ?? prop(st, '0042');
  const fromAddr = prop(st, '5d01') ?? prop(st, '0c1f') ?? prop(st, '0065');
  const recips = [...st.storages].filter(([k]) => k.startsWith('__recip_version1.0_')).map(([, r]) => prop(r, '3001') ?? prop(r, '39fe'));
  const to = prop(st, '0e04') || recips.filter(Boolean).join('; ');
  const date = mailDate(timeProp(st, 0x0039, headerSize) ?? timeProp(st, 0x0e06, headerSize));
  const subject = prop(st, '0037');
  const top = [
    (from || fromAddr) && `From: ${from && fromAddr && !from.includes(fromAddr) ? `${from} <${fromAddr}>` : from || fromAddr}`,
    to && `To: ${to}`,
    date && `Date: ${date}`,
    subject && `Subject: ${subject}`,
  ].filter(Boolean);

  const html = binary(st, '1013') ?? st.streams.get(`__substg1.0_1013${PT_STRING}`);
  const rtf = binary(st, '1009');
  const body =
    prop(st, '1000')?.trim() ||
    (html && htmlToText(htmlString(html)).trim()) ||
    (rtf && rtfToText(decompressRtf(rtf))) ||
    '';

  const attachments: EmlPart[] = [];
  const texts: string[] = [];
  for (const [key, a] of st.storages) {
    if (!key.startsWith('__attach_version1.0_')) continue;
    const name = prop(a, '3707') || prop(a, '3704') || prop(a, '3001') || 'attachment';
    const data = binary(a, '3701');
    if (data) attachments.push({ name, type: (prop(a, '370e') ?? '').toLowerCase(), bytes: data });
    // A forwarded email attached as an Outlook item: read it as part of this one.
    const inner = a.storages.get('__substg1.0_3701000d');
    if (inner) {
      const m = message(inner, 24);
      texts.push(`--- Attached email ---\n${m.text}`);
      attachments.push(...m.attachments);
    }
  }
  return { text: [`${top.join('\n')}\n\n${body}`.trim(), ...texts].join('\n\n'), attachments };
}

export function parseMsg(bytes: Uint8Array): Eml {
  const root = readCompound(bytes);
  if (![...root.streams.keys()].some((k) => k.startsWith('__substg1.0_'))) {
    throw new Error("This is an old Office file, not an Outlook email. Save it as PDF or .docx, then add it.");
  }
  return message(root, 32);
}
