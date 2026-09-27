/** The same sheets as a PDF: landscape A4, one financial year per section, a table per block. */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Cell, Sheet } from './sheets';

// The PDF's built-in fonts have no ₹ glyph.
const txt = (s: string) => s.replace(/₹\s?/g, 'Rs ');
const inr = (n: number) => (n < 0 ? '-' : '') + Math.abs(Math.round(n)).toLocaleString('en-IN');
const show = (v: Cell) => (v === null ? '' : typeof v === 'number' ? inr(v) : txt(v));

export function toPdf(sheets: Sheet[], subtitle: string): Uint8Array {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const margin = 32;
  sheets.forEach((sh, si) => {
    if (si) doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(txt(sh.title), margin, 40);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(txt(subtitle), margin, 56);
    doc.setTextColor(0);
    let y = 72;
    for (const sec of sh.sections) {
      const wide = (sec.head?.length ?? 0) > 4;
      if (y > doc.internal.pageSize.getHeight() - 80) {
        doc.addPage();
        y = 40;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.text(txt(sec.title), margin, y + 10);
      autoTable(doc, {
        startY: y + 16,
        margin: { left: margin, right: margin },
        tableWidth: wide ? 'auto' : 380,
        head: sec.head ? [sec.head.map(txt)] : undefined,
        body: sec.rows.map((row) => row.map(show)),
        theme: 'grid',
        styles: { fontSize: wide ? 7 : 8.5, cellPadding: 3, lineColor: 220, lineWidth: 0.4, overflow: 'linebreak' },
        headStyles: { fillColor: [221, 235, 247], textColor: 20, fontStyle: 'bold' },
        columnStyles: Object.fromEntries(
          Array.from({ length: Math.max(sec.head?.length ?? 0, ...sec.rows.map((r) => r.length)) }, (_, i) => [i, { halign: sec.textCols?.includes(i) ? 'left' : 'right' }]),
        ),
        didParseCell: (d) => {
          if (d.section === 'body' && sec.bold?.includes(d.row.index)) d.cell.styles.fontStyle = 'bold';
        },
      });
      y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? y) + 18;
    }
  });
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`Page ${p} of ${pages}. Worked out on your device from your documents; check against your payslips.`, margin, doc.internal.pageSize.getHeight() - 16);
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
