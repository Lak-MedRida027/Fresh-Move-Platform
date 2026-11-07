/**
 * Admin photo uploader. For each picked file, one at a time (phones have little
 * memory): resize + re-encode in the browser, ask the server for signed upload
 * URLs, upload the three WebP files straight to storage with progress, then
 * register the photo. Reloads the page when everything worked.
 */
import { ImageError, processImage } from '../lib/images/pipeline';
import { SIZES } from '../lib/images/sizes';
import type { ImageSize } from '../lib/media';

const API = '/admin/api/photos/';

type Messages = Record<string, string>;

class UploadError extends Error {}

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({ ok: false, error: 'generic' }))) as { ok: boolean; error?: string } & T;
  if (!data.ok) throw new UploadError(data.error ?? 'generic');
  return data;
}

/** PUT one file to a signed storage URL; reports uploaded bytes. */
function put(url: string, blob: Blob, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadError('upload_failed')));
    xhr.onerror = () => reject(new UploadError('upload_failed'));
    const body = new FormData();
    // Paths are unique per photo, so the files never change: cache for a year.
    body.append('cacheControl', '31536000');
    body.append('', blob);
    xhr.send(body);
  });
}

function setup(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>('[data-files]');
  const list = root.querySelector<HTMLUListElement>('[data-progress]');
  const tripId = root.dataset.trip;
  if (!input || !list || !tripId) return;
  const msg: Messages = JSON.parse(root.dataset.messages ?? '{}');
  const text = (key: string, vars: Record<string, string | number> = {}) =>
    (msg[key] ?? msg['err.generic'] ?? key).replace(/\{(\w+)\}/g, (m, n: string) => (n in vars ? String(vars[n]) : m));
  const errorText = (code: string) => (msg[`err.${code}`] ? text(`err.${code}`) : text('err.generic'));
  input.disabled = false;

  input.addEventListener('change', async () => {
    const files = [...(input.files ?? [])];
    if (!files.length) return;
    const kind = root.querySelector<HTMLInputElement>('input[name="upload-kind"]:checked')?.value ?? 'gallery';
    input.disabled = true;
    list.replaceChildren();
    const rows = files.map((file) => {
      const li = document.createElement('li');
      li.className = 'upload-item';
      const name = document.createElement('span');
      name.className = 'upload-item__name';
      name.textContent = file.name;
      const bar = document.createElement('progress');
      bar.max = 100;
      bar.value = 0;
      bar.setAttribute('aria-label', file.name);
      const status = document.createElement('span');
      status.className = 'muted-sm';
      status.dataset.uploadStatus = '';
      li.append(name, bar, status);
      list.append(li);
      return { file, li, bar, status };
    });

    let failed = 0;
    for (const row of rows) {
      let imageId: string | null = null;
      try {
        row.status.textContent = text('processing');
        const img = await processImage(row.file);
        const total = SIZES.reduce((n, s) => n + img.files[s].size, 0);
        const loaded: Record<string, number> = {};
        const prep = await api<{ id: string; uploads: Record<ImageSize, string> }>({ action: 'prepare', trip_id: tripId, kind });
        imageId = prep.id;
        const report = () => {
          const percent = Math.round((Object.values(loaded).reduce((a, b) => a + b, 0) / total) * 100);
          row.bar.value = percent;
          row.status.textContent = text('uploading', { percent });
        };
        report();
        await Promise.all(
          SIZES.map((s) =>
            put(prep.uploads[s], img.files[s], (n) => {
              loaded[s] = n;
              report();
            }),
          ),
        );
        row.status.textContent = text('saving');
        await api({ action: 'register', trip_id: tripId, id: imageId, kind, width: img.width, height: img.height, placeholder: img.placeholder });
        row.bar.value = 100;
        row.status.textContent = text('done');
        row.li.dataset.state = 'done';
      } catch (e) {
        failed++;
        const code = e instanceof ImageError || e instanceof UploadError ? e.message : 'generic';
        row.status.textContent = errorText(code);
        row.li.dataset.state = 'error';
        row.li.setAttribute('role', 'alert');
        // Files may be in storage without a row: remove them (best effort).
        if (imageId) api({ action: 'abort', trip_id: tripId, id: imageId }).catch(() => {});
      }
    }

    input.value = '';
    input.disabled = false;
    const back = root.dataset.back ?? location.pathname;
    if (!failed) {
      location.assign(`${back}?ok=uploaded`);
      return;
    }
    if (failed < rows.length) {
      // Some worked: offer to reload so they show in the list (keep the errors visible).
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = back;
      a.textContent = text('showAll');
      li.append(a);
      list.append(li);
    }
  });
}

document.querySelectorAll<HTMLElement>('[data-uploader]').forEach(setup);
