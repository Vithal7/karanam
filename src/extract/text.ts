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
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!('str' in it) || !it.str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) rows.push((row = { y, items: [] }));
      row.items.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    pages.push(rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join('  ')).join('\n'));
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

export const ACCEPT = '.pdf,.docx,.txt,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function fileToText(file: File, onProgress?: Progress): Promise<{ text: string; ocr: boolean }> {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    const text = await pdfText(file, onProgress);
    // Scanned PDFs have no text layer; render page 1 and OCR it.
    if (text.replace(/\s/g, '').length > 40) return { text, ocr: false };
    onProgress?.('This PDF is a scan - reading it with OCR', 0);
    return { text: await ocrPdf(file, onProgress), ocr: true };
  }
  if (name.endsWith('.docx')) return { text: await docxText(file), ocr: false };
  if (file.type.startsWith('text/') || name.endsWith('.txt')) return { text: await file.text(), ocr: false };
  if (file.type.startsWith('image/')) return { text: await ocrImage(file, onProgress), ocr: true };
  throw new Error('Unsupported file. Please upload a PDF, DOCX or a photo.');
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
