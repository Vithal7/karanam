/**
 * Writes a small Outlook .msg (Compound File v3, 512-byte sectors, 64-byte mini sectors) for
 * tests. Streams under 4096 bytes go in the mini stream, as Outlook does.
 */
export interface Node {
  [name: string]: Uint8Array | Node;
}

const SECTOR = 512;
const MINI = 64;
const END = 0xfffffffe;
const FREE = 0xffffffff;
const FATSECT = 0xfffffffd;

export const utf16z = (s: string) => {
  const b = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    b[i * 2] = s.charCodeAt(i) & 0xff;
    b[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return b;
};

/** A property stream holding FILETIMEs, with the header size Outlook uses for that storage. */
export function propStream(headerSize: number, times: Record<number, Date>): Uint8Array {
  const ids = Object.keys(times).map(Number);
  const b = new Uint8Array(headerSize + ids.length * 16);
  const v = new DataView(b.buffer);
  ids.forEach((id, i) => {
    const o = headerSize + i * 16;
    v.setUint32(o, (id << 16) | 0x0040, true);
    v.setUint32(o + 4, 6, true);
    const ticks = (times[id].getTime() + 11_644_473_600_000) * 10_000;
    v.setUint32(o + 8, ticks % 2 ** 32, true);
    v.setUint32(o + 12, Math.floor(ticks / 2 ** 32), true);
  });
  return b;
}

interface Dir {
  name: string;
  type: number;
  data?: Uint8Array;
  kids: number[];
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

export function writeCompound(tree: Node): Uint8Array {
  const dirs: Dir[] = [];
  const add = (name: string, n: Uint8Array | Node, type?: number): number => {
    const i = dirs.length;
    const isData = n instanceof Uint8Array;
    dirs.push({ name, type: type ?? (isData ? 2 : 1), data: isData ? n : undefined, kids: [], left: FREE, right: FREE, child: FREE, start: END, size: 0 });
    if (!isData) for (const [k, v] of Object.entries(n)) dirs[i].kids.push(add(k, v));
    return i;
  };
  add('Root Entry', tree, 5);
  // Siblings as a right-leaning chain, in the order the format sorts names (length, then upper case).
  const cmp = (a: Dir, b: Dir) => a.name.length - b.name.length || (a.name.toUpperCase() < b.name.toUpperCase() ? -1 : 1);
  for (const d of dirs) {
    const kids = d.kids.sort((a, b) => cmp(dirs[a], dirs[b]));
    if (kids.length) d.child = kids[0];
    kids.forEach((k, j) => (dirs[k].right = kids[j + 1] ?? FREE));
  }

  // Mini stream for small streams, regular sectors for the rest.
  const mini: number[] = [];
  const miniData: Uint8Array[] = [];
  let miniCount = 0;
  const big: { d: Dir; sectors: number }[] = [];
  for (const d of dirs) {
    if (!d.data) continue;
    d.size = d.data.length;
    if (d.size === 0) continue;
    if (d.size < 4096) {
      const n = Math.ceil(d.size / MINI);
      d.start = miniCount;
      for (let k = 0; k < n; k++) mini.push(k === n - 1 ? END : miniCount + k + 1);
      const padded = new Uint8Array(n * MINI);
      padded.set(d.data);
      miniData.push(padded);
      miniCount += n;
    } else big.push({ d, sectors: Math.ceil(d.size / SECTOR) });
  }
  const miniStream = new Uint8Array(miniCount * MINI);
  miniData.reduce((o, p) => (miniStream.set(p, o), o + p.length), 0);

  const dirBytes = new Uint8Array(Math.ceil(dirs.length / 4) * 4 * 128);
  const miniFatBytes = new Uint8Array(Math.max(1, Math.ceil((mini.length * 4) / SECTOR)) * SECTOR).fill(0xff);
  mini.forEach((m, i) => new DataView(miniFatBytes.buffer).setUint32(i * 4, m, true));

  // Layout: [FAT][dir][minifat][ministream][big streams...]
  const count = (n: number) => Math.ceil(n / SECTOR);
  const plan = [
    { key: 'dir', n: count(dirBytes.length) },
    { key: 'minifat', n: count(miniFatBytes.length) },
    { key: 'ministream', n: count(miniStream.length) },
    ...big.map((b) => ({ key: b.d.name, n: b.sectors, d: b.d })),
  ];
  const dataSectors = plan.reduce((s, p) => s + p.n, 0);
  let fatSectors = 1;
  while (fatSectors * (SECTOR / 4) < fatSectors + dataSectors) fatSectors++;
  const fat: number[] = Array(fatSectors).fill(FATSECT);
  const starts: Record<string, number> = {};
  for (const p of plan) {
    starts[p.key] = p.n ? fat.length : END;
    for (let k = 0; k < p.n; k++) fat.push(k === p.n - 1 ? END : fat.length + 1);
    if ('d' in p && p.d) p.d.start = starts[p.key];
  }
  while (fat.length % (SECTOR / 4)) fat.push(FREE);

  const root = dirs[0];
  root.start = starts.ministream;
  root.size = miniStream.length;
  const dv = new DataView(dirBytes.buffer);
  dirs.forEach((d, i) => {
    const o = i * 128;
    dirBytes.set(utf16z(d.name), o);
    dv.setUint16(o + 64, (d.name.length + 1) * 2, true);
    dirBytes[o + 66] = d.type;
    dirBytes[o + 67] = 1; // black
    dv.setUint32(o + 68, d.left, true);
    dv.setUint32(o + 72, d.right, true);
    dv.setUint32(o + 76, d.child, true);
    dv.setUint32(o + 116, d.start, true);
    dv.setUint32(o + 120, d.size, true);
  });
  for (let i = dirs.length; i < dirBytes.length / 128; i++) {
    dv.setUint32(i * 128 + 68, FREE, true);
    dv.setUint32(i * 128 + 72, FREE, true);
    dv.setUint32(i * 128 + 76, FREE, true);
  }

  const out = new Uint8Array(SECTOR * (1 + fat.length / (SECTOR / 4) + dataSectors));
  const ov = new DataView(out.buffer);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  ov.setUint16(0x18, 0x3e, true);
  ov.setUint16(0x1a, 3, true);
  ov.setUint16(0x1c, 0xfffe, true);
  ov.setUint16(0x1e, 9, true);
  ov.setUint16(0x20, 6, true);
  ov.setUint32(0x2c, fatSectors, true);
  ov.setUint32(0x30, starts.dir, true);
  ov.setUint32(0x38, 4096, true);
  ov.setUint32(0x3c, starts.minifat, true);
  ov.setUint32(0x40, count(miniFatBytes.length), true);
  ov.setUint32(0x44, END, true);
  for (let i = 0; i < 109; i++) ov.setUint32(0x4c + i * 4, i < fatSectors ? i : FREE, true);
  const at = (s: number) => (s + 1) * SECTOR;
  fat.forEach((f, i) => ov.setUint32(SECTOR + i * 4, f, true));
  out.set(dirBytes, at(starts.dir));
  out.set(miniFatBytes, at(starts.minifat));
  if (miniStream.length) out.set(miniStream, at(starts.ministream));
  for (const b of big) out.set(b.d.data!, at(b.d.start));
  return out;
}
