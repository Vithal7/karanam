import { useState } from 'preact/hooks';
import type { Result } from '../domain/compute';
import { fyLabel } from '../domain/fy';
import type { Scenario } from '../domain/types';
import type { Rules } from '../rules';

function save(bytes: Uint8Array, name: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Download as Excel (a sheet per financial year) or PDF. The writers load only when used. */
export function DownloadMenu(props: { r: Result; s: Scenario; rules: Rules }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const base = `in-hand-${fyLabel(props.r.fy).replace(/\s/g, '')}`;
  const run = async (kind: 'xlsx' | 'pdf') => {
    setOpen(false);
    setBusy(kind);
    try {
      const { buildSheets } = await import('../export/sheets');
      const sheets = buildSheets(props.r, props.s, props.rules);
      if (kind === 'xlsx') {
        const { toXlsx } = await import('../export/xlsx');
        save(toXlsx(sheets), `${base}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      } else {
        const { toPdf } = await import('../export/pdf');
        const names = props.s.employers.map((e) => e.name).filter(Boolean).join(', ');
        save(toPdf(sheets, `${names} · made ${new Date().toLocaleDateString('en-IN')}`), `${base}.pdf`, 'application/pdf');
      }
    } finally {
      setBusy(null);
    }
  };
  return (
    <div class="menu-wrap">
      <button type="button" class="btn" aria-haspopup="menu" aria-expanded={open} disabled={!!busy} onClick={() => setOpen(!open)}>
        {busy ? `Making ${busy === 'xlsx' ? 'Excel' : 'PDF'}…` : 'Download ▾'}
      </button>
      {open && (
        <div class="menu" role="menu">
          <button type="button" role="menuitem" onClick={() => run('xlsx')}>
            <strong>Excel (.xlsx)</strong>
            <span class="muted small">A sheet per year: {fyLabel(props.r.fy)} and {fyLabel(props.r.fy + 1)}, with the tax workings</span>
          </button>
          <button type="button" role="menuitem" onClick={() => run('pdf')}>
            <strong>PDF</strong>
            <span class="muted small">The same, ready to print or share</span>
          </button>
        </div>
      )}
    </div>
  );
}
