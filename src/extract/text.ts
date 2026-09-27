import { parseEml } from './eml';
import { ocrImage, type Progress } from './ocr';

/** Rebuilds visual lines from pdf.js text items so table rows stay on one line. */
async function pdfText(file: Blob, onProgress?: Progress): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(workerUrl, document.baseURI).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(`Reading page ${p} of ${doc.numPages}`, p / doc.numPages);
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows: { y: number; items: { x: number; s: string }[] }[] = [];
    const widths: number[] = [];
    for (const it of content.items as { str: string; transform: number[]; height?: number; width?: number }[]) {
      if ('str' in it && it.str.trim() && it.width) widths.push(it.width / it.str.length);
    }
    for (const it of content.items as { str: string; transform: number[]; height?: number }[]) {
      if (!('str' in it) || !it.str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      // Table cells in one row can sit a few points apart (vertical centring), so allow
      // for about half a line height rather than a fixed gap.
      const tol = Math.max(3, 0.6 * (it.height || Math.abs(it.transform[3]) || 10));
      let row = rows.find((r) => Math.abs(r.y - y) < tol);
      if (!row) rows.push((row = { y, items: [] }));
      row.items.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    // Lay text out by x position (like pdftotext -layout), so table columns line up across rows:
    // a bonus in the July column stays under "Jul" even when other months are blank.
    widths.sort((a, b) => a - b);
    const charW = widths[Math.floor(widths.length / 2)] || 5;
    pages.push(
      rows
        .map((r) => {
          let line = '';
          for (const i of r.items.sort((a, b) => a.x - b.x)) {
            const col = Math.round(i.x / charW);
            line += line ? ' '.repeat(Math.max(2, col - line.length)) : ' '.repeat(Math.max(0, col));
            line += i.s;
          }
          return line.replace(/\s+$/, '');
        })
        .join('\n'),
    );
  }
  return pages.join('\n');
}

async function docxText(file: Blob): Promise<string> {
  const mammoth = (await import('mammoth/mammoth.browser.js')).default as {
    convertToHtml(i: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
  };
  // HTML keeps table cells apart; turn rows into lines and cells into double spaces.
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const html = value
    .replace(/<\/(td|th)>/gi, '  ')
    .replace(/<\/(tr|p|h\d|li)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  const el = document.createElement('textarea');
  el.innerHTML = html;
  return el.value;
}

const IMAGE = /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/;

/** What a file is from its first bytes, for files picked without a telling name or type. */
export function sniff(head: Uint8Array, start: string): 'pdf' | 'docx' | 'image' | 'eml' | 'text' | undefined {
  const b = (i: number) => head[i];
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return 'pdf'; // %PDF
  if (b(0) === 0x50 && b(1) === 0x4b) return 'docx'; // PK (zip)
  if ((b(0) === 0xff && b(1) === 0xd8) || (b(0) === 0x89 && b(1) === 0x50) || (b(0) === 0x47 && b(1) === 0x49) || (b(0) === 0x52 && b(1) === 0x49)) return 'image';
  if (String.fromCharCode(...head.slice(4, 12)).startsWith('ftyphei') || String.fromCharCode(...head.slice(4, 12)).startsWith('ftypmif')) return 'image';
  if (/^(?:[\w-]+:[^\n]*\r?\n(?:[ \t][^\n]*\r?\n)*){2,}/.test(start) && /^(from|received|return-path|mime-version|subject|date|delivered-to|message-id|x-[\w-]+):/im.test(start)) return 'eml';
  const printable = [...head].filter((c) => c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 128).length;
  if (head.length && printable / head.length > 0.95) return 'text';
  return undefined;
}

export async function fileToText(file: File, onProgress?: Progress): Promise<{ text: string; ocr: boolean }> {
  const name = file.name.toLowerCase();
  const known = /\.(pdf|docx|eml|txt)$/.test(name) || IMAGE.test(name) || /^(application\/pdf|image\/|message\/rfc822)/.test(file.type);
  if (!known) {
    const head = new Uint8Array(await file.slice(0, 2048).arrayBuffer());
    const kind = sniff(head, new TextDecoder().decode(head));
    const as = (ext: string, type: string) => fileToText(new File([file], `${file.name || 'file'}.${ext}`, { type }), onProgress);
    if (kind === 'pdf') return as('pdf', 'application/pdf');
    if (kind === 'docx') return as('docx', '');
    if (kind === 'image') return as('jpg', 'image/jpeg');
    if (kind === 'eml') return as('eml', 'message/rfc822');
    if (kind === 'text') return { text: await file.text(), ocr: false };
  }
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    const text = await pdfText(file, onProgress);
    // Scanned PDFs have no text layer; render page 1 and OCR it.
    if (text.replace(/\s/g, '').length > 40) return { text, ocr: false };
    onProgress?.('This PDF is a scan - reading it with OCR', 0);
    return { text: await ocrPdf(file, onProgress), ocr: true };
  }
  if (name.endsWith('.docx')) return { text: await docxText(file), ocr: false };
  if (name.endsWith('.eml') || file.type === 'message/rfc822') return emlToText(file, onProgress);
  if (file.type.startsWith('text/') || name.endsWith('.txt')) return { text: await file.text(), ocr: false };
  if (file.type.startsWith('image/') || IMAGE.test(name)) return { text: await ocrImage(file, onProgress), ocr: true };
  if (name.endsWith('.msg')) throw new Error("Outlook .msg files can't be read. Save the email as .eml or PDF (or forward it to yourself and save it), then add it.");
  throw new Error('Unsupported file. Please upload a PDF, Word file, email (.eml) or a photo (JPG, PNG).');
}

/** An email: its headers and body, then the text of any attached letter (PDF, Word, photo). */
async function emlToText(file: File, onProgress?: Progress): Promise<{ text: string; ocr: boolean }> {
  const { text, attachments } = parseEml(await file.text());
  const parts = [text];
  let ocr = false;
  for (const a of attachments.slice(0, 4)) {
    const n = a.name.toLowerCase();
    if (!/\.(pdf|docx|txt)$/.test(n) && !IMAGE.test(n) && !/^(application\/pdf|image\/)/.test(a.type)) continue;
    if (/^image\//.test(a.type) && a.bytes.length < 20_000) continue; // signature logos
    try {
      onProgress?.(`Reading attachment ${a.name}`, 0);
      const r = await fileToText(new File([a.bytes as BlobPart], a.name, { type: a.type }), onProgress);
      parts.push(`--- Attachment: ${a.name} ---\n${r.text}`);
      ocr ||= r.ocr;
    } catch {
      /* an attachment we can't read doesn't stop the email */
    }
  }
  return { text: parts.join('\n\n'), ocr };
}

async function ocrPdf(file: Blob, onProgress?: Progress): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 4); p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    out.push(await ocrImage(blob, (s, f) => onProgress?.(`Page ${p}: ${s}`, f)));
  }
  return out.join('\n');
}
