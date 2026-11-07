/**
 * Admin "Export to Excel": asks the server for the rows (the export is
 * recorded there), builds the .xlsx here in the browser and downloads it.
 * The spreadsheet library is only fetched on the first export.
 */
import type { ExportSpec } from '../lib/excel/spec';

type Messages = Record<'working' | 'done' | 'too_many_rows' | 'forbidden' | 'generic', string>;

function download(data: ArrayBuffer, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function run(box: HTMLElement, button: HTMLButtonElement, status: HTMLElement, msg: Messages) {
  button.disabled = true;
  box.setAttribute('aria-busy', 'true');
  status.textContent = msg.working;
  status.removeAttribute('data-state');
  try {
    const res = await fetch('/admin/api/export/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ kind: box.dataset.kind, trip_id: box.dataset.trip || null, query: box.dataset.query ?? '', lang: box.dataset.lang }),
    });
    const body = (await res.json().catch(() => ({ ok: false, error: 'generic' }))) as
      | { ok: true; rows: number; spec: ExportSpec }
      | { ok: false; error: string };
    if (!body.ok) throw new Error(body.error);
    const { buildWorkbook } = await import('../lib/excel/workbook');
    download(await buildWorkbook(body.spec), body.spec.filename);
    status.textContent = msg.done.replace('{count}', body.rows.toLocaleString(box.dataset.lang === 'ar' ? 'ar-DZ' : 'en'));
    status.dataset.state = 'done';
  } catch (e) {
    const code = e instanceof Error ? e.message : 'generic';
    status.textContent = msg[code as keyof Messages] ?? msg.generic;
    status.dataset.state = 'error';
  } finally {
    button.disabled = false;
    box.removeAttribute('aria-busy');
  }
}

for (const box of document.querySelectorAll<HTMLElement>('[data-export]')) {
  const button = box.querySelector<HTMLButtonElement>('[data-export-button]');
  const status = box.querySelector<HTMLElement>('[data-export-status]');
  if (!button || !status) continue;
  let msg: Messages;
  try {
    msg = JSON.parse(box.dataset.messages ?? '{}') as Messages;
  } catch {
    continue;
  }
  button.disabled = false;
  button.addEventListener('click', () => void run(box, button, status, msg));
}
